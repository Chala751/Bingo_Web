// controllers/bingoController.js (Full optimized for Step 2 - .lean(), projections, batch updates; FIXED: Include gameNumber in selects)
import mongoose from "mongoose";
import {
  checkCardBingo,
  getMarkedGrid,
  getNumbersForPattern,
  getCashierIdFromUser,
  logJackpotUpdate,
  generateQuickWinSequence,
  logNumberCall,
  getSpecificLineInfo,
  checkSpecificLineCompletion,
  detectLateCallOpportunity,
} from "../utils/gameUtils.js";
import Game from "../models/Game.js";
import Result from "../models/Result.js";
import Jackpot from "../models/Jackpot.js";
import JackpotLog from "../models/JackpotLog.js";
import Card from "../models/Card.js";
import GameLog from "../models/GameLog.js";
import FutureWinner from "../models/FutureWinner.js";
import {
  emitNumberCalled,
  roomHasClients,
  clearDeferredForGame,
} from "../socket.js";

// In-memory guard to prevent burst calls even if client omits minIntervalMs
// Stores last known preferred interval per game (from client) to enforce spacing on server
const preferredIntervalByGame = new Map();
// Track the last emit/play time per game to enforce spacing even across transient DB failures
const lastEmitAtByGame = new Map();

export const getCard = async (req, res) => {
  try {
    const { id } = req.params;
    const card = await Card.findOne({ card_number: Number(id) })
      .select("numbers card_number")
      .lean();
    if (!card) return res.status(404).json({ message: "Card not found" });
    res.json(card);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

export const callNumber = async (req, res, next) => {
  try {
    const { gameId } = req.params;
    if (!gameId) {
      return res.status(400).json({ message: "Game ID is required" });
    }

    // Playback scheduling from client
    const providedPlayAtEpoch = (() => {
      try {
        const p = req?.body?.playAtEpoch;
        if (typeof p === "number" && isFinite(p)) return p;
        const after = Number(req?.body?.playAfterMs || 0);
        if (after > 0) return Date.now() + after;
      } catch {}
      return null;
    })();

    const requestId =
      req.headers["x-request-id"] || req.body?.requestId || null;
    const enforceRequested =
      req.body?.enforce === true || req.body?.mustMatch === true;

    // Idempotency: if the request was already processed, return previous result
    if (requestId) {
      const previous = await GameLog.findOne({
        gameId,
        action: "callNumber",
        "details.requestId": requestId,
      })
        .sort({ _id: -1 })
        .lean();
      if (previous) {
        const safeGame = await Game.findById(gameId)
          .select(
            "gameNumber status calledNumbers calledNumbersLog forcedCallIndex pattern forcedPattern moderatorWinnerCardId prizePool"
          )
          .lean();
        return res.json({
          game: safeGame,
          calledNumber: previous.details?.calledNumber || null,
          callSource: previous.details?.type || "idempotent",
          isUsingForcedSequence: previous.details?.type === "forced",
          patternUsed: safeGame?.forcedPattern || safeGame?.pattern,
          forcedCallIndex: safeGame?.forcedCallIndex || 0,
          forcedCallSequenceLength: previous.details?.forcedCallLength || 0,
          idempotent: true,
        });
      }
    }

    // Acquire call lock
    const lockTTLms = 3000;
    const lockUntil = new Date(Date.now() + lockTTLms);
    const lockDoc = await Game.findOneAndUpdate(
      {
        _id: gameId,
        status: "active",
        $or: [
          { callLock: { $exists: false } },
          { callLock: { $lte: new Date() } },
        ],
      },
      { $set: { callLock: lockUntil } },
      { new: true }
    )
      .select(
        "gameNumber status calledNumbers calledNumbersLog forcedCallSequence forcedCallIndex pattern forcedPattern moderatorWinnerCardId prizePool callLock cashierId autoCallEnabled nextAllowedAt"
      )
      .lean();

    if (!lockDoc) {
      return res.status(409).json({
        message: "Another call is currently being processed. Please retry.",
        errorCode: "CALL_IN_PROGRESS",
      });
    }

    const game = lockDoc;

    // Reject auto queue if auto-call disabled (manual still allowed)
    const requestedNumber = Number(req.body?.number);
    const hasRequested = !isNaN(requestedNumber);
    const isManualTrigger = req?.body?.manual === true;
    if (game.autoCallEnabled === false && !hasRequested && !isManualTrigger) {
      await Game.findByIdAndUpdate(gameId, { $unset: { callLock: "" } });
      const safeGame = await Game.findById(gameId)
        .select(
          "gameNumber status calledNumbers calledNumbersLog forcedCallIndex pattern forcedPattern moderatorWinnerCardId prizePool"
        )
        .lean();
      await GameLog.create({
        gameId,
        action: "callNumber",
        status: "blocked",
        details: { reason: "AUTO_CALL_DISABLED", timestamp: new Date() },
      });
      return res.status(423).json({
        message: "Auto call is disabled",
        errorCode: "AUTO_CALL_DISABLED",
        game: safeGame,
      });
    }

    if (!game) return res.status(404).json({ message: "Game not found" });
    if (game.status !== "active")
      return res.status(400).json({ message: `Game is ${game.status}` });

    // Ensure a listener exists (cashier room)
    try {
      const cashierRoom = game?.cashierId?.toString();
      if (cashierRoom && !roomHasClients(cashierRoom)) {
        await Game.findByIdAndUpdate(gameId, { $unset: { callLock: "" } });
        return res.status(409).json({
          message: "No active client connected. Waiting for network.",
          errorCode: "NO_ACTIVE_CLIENT",
        });
      }
    } catch (e) {
      console.warn(
        "[callNumber] roomHasClients check failed:",
        e?.message || e
      );
    }

    // Interval enforcement unless explicitly overridden by playNow
    if (req?.body?.playNow !== true) {
      try {
        const clientInterval = Math.max(
          0,
          Number(req?.body?.minIntervalMs || 0)
        );
        if (clientInterval > 0)
          preferredIntervalByGame.set(gameId, clientInterval);

        let effIntervalMs = clientInterval;
        if (!effIntervalMs) {
          const remembered = preferredIntervalByGame.get(gameId);
          if (Number.isFinite(remembered) && remembered > 0) {
            effIntervalMs = remembered;
          } else if (
            Array.isArray(game?.calledNumbersLog) &&
            game.calledNumbersLog.length >= 2
          ) {
            const last =
              game.calledNumbersLog[game.calledNumbersLog.length - 1];
            const prev =
              game.calledNumbersLog[game.calledNumbersLog.length - 2];
            const lastTs = last?.calledAt
              ? new Date(last.calledAt).getTime()
              : null;
            const prevTs = prev?.calledAt
              ? new Date(prev.calledAt).getTime()
              : null;
            if (Number.isFinite(lastTs) && Number.isFinite(prevTs)) {
              const derived = Math.max(0, lastTs - prevTs);
              if (derived > 0) effIntervalMs = derived;
            }
          }
        }

        if (effIntervalMs > 0) {
          const lastLog = Array.isArray(game?.calledNumbersLog)
            ? game.calledNumbersLog[game.calledNumbersLog.length - 1]
            : null;
          const lastTsLog = lastLog?.calledAt
            ? new Date(lastLog.calledAt).getTime()
            : null;
          const lastEmitTs = Number(lastEmitAtByGame.get(gameId)) || null;
          const lastTs = [lastTsLog, lastEmitTs].filter(Number.isFinite).length
            ? Math.max(
                ...[lastTsLog, lastEmitTs].filter((v) =>
                  Number.isFinite(Number(v))
                )
              )
            : null;

          const persistedNext = game?.nextAllowedAt
            ? new Date(game.nextAllowedAt).getTime()
            : null;

          if (Number.isFinite(lastTs) || Number.isFinite(persistedNext)) {
            let earliest = Number.isFinite(lastTs)
              ? lastTs + effIntervalMs
              : null;
            if (Number.isFinite(persistedNext)) {
              earliest = Number.isFinite(earliest)
                ? Math.max(earliest, persistedNext)
                : persistedNext;
            }
            if (Number.isFinite(earliest)) {
              const nowTs = Date.now();
              // IMPORTANT: Do NOT consider providedPlayAtEpoch for interval gating.
              // Emission occurs NOW; providedPlayAtEpoch only helps clients schedule audio.
              if (nowTs < earliest - 10) {
                await Game.findByIdAndUpdate(gameId, {
                  $unset: { callLock: "" },
                });
                return res.status(409).json({
                  message: "Too early to call next number",
                  errorCode: "TOO_EARLY",
                  nextAllowedAt: earliest,
                });
              }
            }
          }
        }
      } catch (e) {
        console.warn("[callNumber] minInterval guard failed:", e?.message || e);
      }
    }

    // Decide next number
    const calledNumbersCopy = game.calledNumbers || [];
    const callsMade = calledNumbersCopy.length;
    let nextNumber;
    let callSource = "random";
    let isUsingForcedSequence = false;

    // Use forced sequence sometimes while still reserving them
    if (
      game.forcedCallSequence?.length &&
      game.forcedCallIndex < game.forcedCallSequence.length
    ) {
      const remainingForced =
        game.forcedCallSequence.length - game.forcedCallIndex;
      if (callsMade + remainingForced >= 14 || Math.random() < 0.4) {
        nextNumber = game.forcedCallSequence[game.forcedCallIndex];
        callSource = "forced";
        isUsingForcedSequence = true;
      }
    }

    // Manual override if provided and valid
    const requestedValid =
      hasRequested && requestedNumber >= 1 && requestedNumber <= 75;
    const alreadyCalled = calledNumbersCopy.includes(requestedNumber);
    if (requestedValid && !alreadyCalled) {
      nextNumber = requestedNumber;
      callSource = "manual";
      isUsingForcedSequence = false;
    }

    if (enforceRequested && (!requestedValid || alreadyCalled)) {
      await Game.findByIdAndUpdate(gameId, { $unset: { callLock: "" } });
      const safeGame = await Game.findById(gameId)
        .select(
          "gameNumber status calledNumbers calledNumbersLog forcedCallIndex pattern forcedPattern moderatorWinnerCardId prizePool"
        )
        .lean();
      await GameLog.create({
        gameId,
        action: "callNumber",
        status: "rejected",
        details: {
          requestId,
          requestedNumber,
          reason: requestedValid
            ? "requested number already called"
            : "requested number invalid",
          enforce: true,
        },
      });
      return res.status(412).json({
        message: "Requested number cannot be honored",
        errorCode: "REQUESTED_NUMBER_REJECTED",
        reason: requestedValid ? "ALREADY_CALLED" : "INVALID_NUMBER",
        game: safeGame,
      });
    }

    // Random selection if still not decided
    if (typeof nextNumber !== "number") {
      const all = Array.from({ length: 75 }, (_, i) => i + 1);
      const blacklist = new Set([...(game.forcedCallSequence || [])]);
      const remainingNumbers = all.filter(
        (n) => !calledNumbersCopy.includes(n) && !blacklist.has(n)
      );
      if (!remainingNumbers.length)
        return res.status(400).json({ message: "No numbers left to call" });
      nextNumber =
        remainingNumbers[Math.floor(Math.random() * remainingNumbers.length)];
      callSource = "random";
      isUsingForcedSequence = false;
    }

    // Duplicate guard
    if ((game.calledNumbers || []).includes(nextNumber)) {
      await Game.findByIdAndUpdate(gameId, { $unset: { callLock: "" } });
      const safeGame = await Game.findById(gameId)
        .select(
          "gameNumber status calledNumbers calledNumbersLog forcedCallIndex pattern forcedPattern moderatorWinnerCardId prizePool"
        )
        .lean();
      await GameLog.create({
        gameId,
        action: "callNumber",
        status: "duplicate",
        details: {
          requestId,
          calledNumber: nextNumber,
          type: callSource,
          note: "Number already called — returning without mutation",
          timestamp: new Date(),
        },
      });
      return res.json({
        game: safeGame,
        calledNumber: nextNumber,
        callSource,
        isUsingForcedSequence,
        patternUsed: game.forcedPattern || game.pattern,
        forcedCallIndex: safeGame.forcedCallIndex,
        forcedCallSequenceLength: game.forcedCallSequence?.length || 0,
        duplicate: true,
      });
    }

    // Persist number
    const updateData = {
      $addToSet: { calledNumbers: nextNumber },
      ...(isUsingForcedSequence ? { $inc: { forcedCallIndex: 1 } } : {}),
    };
    const afterAdd = await Game.findByIdAndUpdate(gameId, updateData, {
      new: true,
      runValidators: true,
    })
      .select(
        "gameNumber status calledNumbers calledNumbersLog forcedCallIndex pattern forcedPattern moderatorWinnerCardId prizePool cashierId"
      )
      .lean();

    let updatedGame = afterAdd;
    if (afterAdd?.calledNumbers?.includes(nextNumber)) {
      // Log the ACTUAL emit time (Date.now()), not the scheduled playAtEpoch.
      const pushLogUpdate = await Game.findByIdAndUpdate(
        gameId,
        {
          $push: {
            calledNumbersLog: {
              number: nextNumber,
              calledAt: new Date(Date.now()),
            },
          },
        },
        { new: true, runValidators: true }
      )
        .select(
          "gameNumber status calledNumbers calledNumbersLog forcedCallIndex pattern forcedPattern moderatorWinnerCardId prizePool cashierId"
        )
        .lean();
      updatedGame = pushLogUpdate || afterAdd;
    }

    await GameLog.create({
      gameId,
      action: "callNumber",
      status: "success",
      details: {
        requestId,
        calledNumber: nextNumber,
        type: callSource,
        forcedCallIndex: updatedGame.forcedCallIndex,
        forcedCallLength: game.forcedCallSequence?.length || 0,
        pattern: game.forcedPattern || game.pattern,
        moderatorWinnerCardId: game.moderatorWinnerCardId,
        timestamp: new Date(),
      },
    });

    // Emit
    try {
      const cashierRoom =
        updatedGame?.cashierId?.toString() || lockDoc?.cashierId?.toString();
      if (cashierRoom) {
        const playAtEpoch = providedPlayAtEpoch || null;
        // Effective emit timestamp is always NOW; do not let future playAtEpoch distort pacing.
        const effectiveEmitTs = Date.now();
        try {
          lastEmitAtByGame.set(gameId, effectiveEmitTs);
        } catch {}

        // Persist nextAllowedAt
        try {
          const clientInterval = Math.max(
            0,
            Number(req?.body?.minIntervalMs || 0)
          );
          const remembered = preferredIntervalByGame.get(gameId) || 0;
          const effIntervalMs = clientInterval || remembered || 0;
          if (effIntervalMs > 0) {
            await Game.findByIdAndUpdate(gameId, {
              $set: {
                nextAllowedAt: new Date(effectiveEmitTs + effIntervalMs),
              },
            }).lean();
          }
        } catch (e) {
          console.warn(
            "[callNumber] Failed to persist nextAllowedAt:",
            e?.message || e
          );
        }

        emitNumberCalled(cashierRoom, {
          gameId,
          gameNumber: updatedGame?.gameNumber,
          calledNumber: nextNumber,
          callSource, // include source so clients can decide whether to honor when auto-call is OFF
          playAtEpoch: playAtEpoch || undefined, // advisory for client-side audio scheduling ONLY
          game: {
            _id: gameId,
            gameNumber: updatedGame?.gameNumber,
            status: updatedGame?.status,
            calledNumbers: updatedGame?.calledNumbers,
            calledNumbersLog: updatedGame?.calledNumbersLog,
            forcedCallIndex: updatedGame?.forcedCallIndex,
            pattern: updatedGame?.forcedPattern || updatedGame?.pattern,
          },
        });
      }
    } catch (e) {
      console.warn("[callNumber] Socket emit failed:", e?.message || e);
    }

    return res.json({
      game: updatedGame,
      calledNumber: nextNumber,
      callSource,
      isUsingForcedSequence,
      patternUsed: game.forcedPattern || game.pattern,
      forcedCallIndex: updatedGame.forcedCallIndex,
      forcedCallSequenceLength: game.forcedCallSequence?.length || 0,
      idempotent: false,
    });
  } catch (err) {
    console.error("[callNumber] ❌ ERROR:", err);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    const { gameId } = req.params || {};
    if (gameId) {
      try {
        const game = await Game.findById(gameId).select("callLock").lean();
        if (game?.callLock) {
          await Game.findByIdAndUpdate(gameId, { $unset: { callLock: "" } });
        }
      } catch (e) {
        console.warn("[callNumber] Failed to release call lock:", e?.message);
      }
    }
  }
};

// controllers/bingoController.js — Full corrected checkBingo with enhanced logs and fixes
// controllers/bingoController.js — Full corrected checkBingo with enhanced logs and fixes
export const checkBingo = async (req, res, next) => {
  try {
    const { cardId, preferredPattern } = req.body;
    const gameId = req.params.id;

    if (!cardId) {
      return res.status(400).json({ message: "Card identifier is required" });
    }

    const game = await Game.findById(gameId)
      .select(
        "gameNumber status calledNumbers calledNumbersLog selectedCards forced* pattern winner prizePool"
      )
      .lean();

    if (!game) {
      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: "failed",
        details: { error: "Game not found", timestamp: new Date() },
      });
      return res.status(404).json({ message: "Game not found" });
    }

    const lastCalledNumber =
      game.calledNumbersLog?.[game.calledNumbersLog.length - 1] || null;
    if (!lastCalledNumber) {
      return res.json({
        isBingo: false,
        message: "No numbers called yet",
        winners: [],
        game,
      });
    }

    // Find the specific card in selectedCards
    const selectedCard = game.selectedCards.find(
      (sc) => sc.id === parseInt(cardId)
    );
    if (!selectedCard) {
      return res
        .status(404)
        .json({ message: "Card not found in selected cards" });
    }

    // Fetch full card
    const fullCard = await Card.findOne({ card_number: parseInt(cardId) })
      .select("numbers")
      .lean();
    if (!fullCard?.numbers) {
      return res.status(404).json({ message: "Full card data not found" });
    }
    // Helper: flatten 5x5 grid (row-major) for client speed
    const flatten25 = (grid) =>
      Array.isArray(grid) && grid.length === 5
        ? grid.flat().map((v) => (v === null ? "FREE" : v))
        : [];

    // 🚨 FIXED: Removed FutureWinner check — now allows any selected card to bingo
    // If needed, add back as optional: const requireScheduled = req.query.requireScheduled === 'true';
    // Then fetch/validate only if true, else log warning and proceed.

    // Use preferredPattern or fallback to game pattern
    const expectedPattern = preferredPattern || game.pattern || "all";

    // Log if no future winner scheduled (for auditing)
    // await GameLog.create({ gameId, action: "checkBingo", status: "unscheduled_check", details: { cardId: parseInt(cardId), pattern: expectedPattern } });

    // Check card state
    let checkCount = selectedCard.checkCount || 0;
    let disqualified = selectedCard.disqualified || false;
    const lastCheckTime = selectedCard.lastCheckTime || null;

    // Reset or increment checkCount based on whether a new number has been called since last check
    if (
      lastCheckTime &&
      lastCalledNumber.calledAt &&
      new Date(lastCheckTime) < new Date(lastCalledNumber.calledAt)
    ) {
      checkCount += 1;
    } else {
      checkCount = 1;
      disqualified = false;
    }

    // Update the specific card
    const currentTime = new Date();
    const index = game.selectedCards.findIndex(
      (sc) => sc.id === parseInt(cardId)
    ); // Safer index lookup
    if (index === -1) {
      return res
        .status(404)
        .json({ message: "Card index not found in selectedCards" });
    }
    await Game.findByIdAndUpdate(gameId, {
      $set: {
        [`selectedCards.${index}.checkCount`]: checkCount,
        [`selectedCards.${index}.lastCheckTime`]: currentTime,
        [`selectedCards.${index}.disqualified`]: disqualified,
      },
    });

    // If this card was already checked in a previous call (checkCount > 1),
    // it's disqualified for any subsequent win in this game. We still compute
    // completion info to return helpful UI details when applicable.
    if (checkCount > 1) {
      // Evaluate completion state for context
      const [isCompleteOnRecheck, detectedPatternOnRecheck] = checkCardBingo(
        fullCard.numbers,
        game.calledNumbers,
        expectedPattern,
        lastCalledNumber?.number
      );

      const actualPatternOnRecheck =
        expectedPattern === "all" ? detectedPatternOnRecheck : expectedPattern;

      // Persist disqualification state for this card
      await Game.findByIdAndUpdate(gameId, {
        $set: {
          [`selectedCards.${index}.disqualified`]: true,
        },
      });

      if (isCompleteOnRecheck) {
        const lateInfo = await detectLateCallForCurrentPattern(
          fullCard.numbers,
          actualPatternOnRecheck,
          game.calledNumbers,
          gameId
        );
        const completingNumberOnRecheck =
          lateInfo?.completingNumber || lastCalledNumber.number;

        return res.json({
          isBingo: false,
          message:
            "Card disqualified due to previous check; subsequent wins are not eligible",
          winners: [
            {
              cardId: parseInt(cardId),
              numbers: fullCard.numbers,
              winningPattern: actualPatternOnRecheck,
              disqualified: true,
              completingNumber: completingNumberOnRecheck,
              lateCall: true,
              lateCallMessage:
                lateInfo?.message ||
                "This card was already checked before; later completion is disqualified.",
              jackpotEnabled: false,
            },
          ],
          gameStatus: game.status,
          card: flatten25(fullCard.numbers),
          patternInfo: (() => {
            try {
              const { selectedIndices } = getNumbersForPattern(
                fullCard.numbers,
                actualPatternOnRecheck,
                game.calledNumbers,
                true,
                [],
                true
              );
              let rowIndex = null;
              let colIndex = null;
              if (selectedIndices && selectedIndices.length === 5) {
                const rows = selectedIndices.map((i) => Math.floor(i / 5));
                const cols = selectedIndices.map((i) => i % 5);
                if (rows.every((r) => r === rows[0])) rowIndex = rows[0];
                if (cols.every((c) => c === cols[0])) colIndex = cols[0];
              }
              return {
                selectedIndices: selectedIndices || [],
                rowIndex,
                colIndex,
              };
            } catch {
              return null;
            }
          })(),
        });
      }

      return res.json({
        isBingo: false,
        message: "Card disqualified or multiple checks",
        winners: [],
        game,
      });
    }

    // Check if pattern is complete with all called numbers
    const [isComplete, detectedPattern] = checkCardBingo(
      fullCard.numbers,
      game.calledNumbers,
      expectedPattern,
      lastCalledNumber?.number
    );

    const actualPattern =
      expectedPattern === "all" ? detectedPattern : expectedPattern;

    if (!isComplete) {
      return res.json({
        isBingo: false,
        message: "Pattern not complete",
        winners: [],
        game,
        card: flatten25(fullCard.numbers),
      });
    }

    // Late call check: determine if completed by last number or earlier
    const lateCallResult = await detectLateCallForCurrentPattern(
      fullCard.numbers,
      actualPattern,
      game.calledNumbers,
      gameId
    );

    const completingNumber =
      lateCallResult?.completingNumber || lastCalledNumber.number;

    if (lateCallResult?.hasMissedOpportunity) {
      // Mark as late call
      disqualified = true;
      await Game.findByIdAndUpdate(gameId, {
        $set: {
          [`selectedCards.${index}.disqualified`]: true,
        },
      });

      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: "late_call",
        details: {
          cardId: parseInt(cardId),
          pattern: actualPattern,
          completingNumber,
          lateCallMessage: lateCallResult.message,
          timestamp: new Date(),
        },
      });

      return res.json({
        isBingo: false,
        message: "Late call detected",
        winners: [
          {
            cardId: parseInt(cardId),
            numbers: fullCard.numbers,
            winningPattern: actualPattern,
            disqualified: true,
            completingNumber,
            lateCall: true,
            lateCallMessage: lateCallResult.message,
            jackpotEnabled: false, // Default since no fw
          },
        ],
        gameStatus: game.status,
        card: flatten25(fullCard.numbers),
        // lightweight pattern info for UI highlights
        patternInfo: (() => {
          try {
            const { numbers: nums, selectedIndices } = getNumbersForPattern(
              fullCard.numbers,
              actualPattern,
              game.calledNumbers,
              true,
              [],
              true
            );
            // Derive row/col if applicable
            let rowIndex = null;
            let colIndex = null;
            if (selectedIndices && selectedIndices.length === 5) {
              const rows = selectedIndices.map((i) => Math.floor(i / 5));
              const cols = selectedIndices.map((i) => i % 5);
              if (rows.every((r) => r === rows[0])) rowIndex = rows[0];
              if (cols.every((c) => c === cols[0])) colIndex = cols[0];
            }
            return {
              selectedIndices: selectedIndices || [],
              rowIndex,
              colIndex,
            };
          } catch {
            return null;
          }
        })(),
      });
    }

    // It's a valid bingo, completed by last number
    const winningCard = {
      cardId: parseInt(cardId),
      numbers: fullCard.numbers,
      winningPattern: actualPattern,
      disqualified: false,
      completingNumber,
      lateCall: false,
      lateCallMessage: null,
      jackpotEnabled: false, // Default since no fw
    };

    // Save winner to Game & Result
    const session = await Game.startSession();
    try {
      await session.withTransaction(async () => {
        const freshGame = await Game.findById(gameId).session(session);
        freshGame.status = "completed";
        freshGame.winnerCards = [
          // Assuming winnerCards as per earlier note; adjust to winner if standardized
          {
            cardId: winningCard.cardId,
            winningPattern: winningCard.winningPattern,
            numbers: winningCard.numbers,
            jackpotEnabled: winningCard.jackpotEnabled,
          },
        ];
        await freshGame.save({ session });

        await Result.create(
          [
            {
              gameId: freshGame._id,
              winnerCardId: winningCard.cardId,
              userId: req.user?._id || null,
              identifier: cardId || `${freshGame._id}-${winningCard.cardId}`,
              prize: freshGame.prizePool,
              isJackpot: winningCard.jackpotEnabled,
              winningPattern: winningCard.winningPattern,
              lastCalledNumber: winningCard.completingNumber,
              timestamp: new Date(),
            },
          ],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    await GameLog.create({
      gameId,
      action: "checkBingo",
      status: "success",
      details: {
        cardId: parseInt(cardId),
        pattern: actualPattern,
        completingNumber,
        timestamp: new Date(),
      },
    });

    return res.json({
      isBingo: true,
      winners: [winningCard],
      gameStatus: "completed",
      card: flatten25(fullCard.numbers),
    });
  } catch (err) {
    console.error("[checkBingo] ❌ ERROR:", err);
    return res
      .status(500)
      .json({ message: "Internal server error", error: err.message });
  }
};

// ✅ UPDATED FUNCTION: Pattern-specific late call detection — Now always returns completingNumber when applicable
// ✅ UPDATED FUNCTION: Pattern-specific late call detection — Now always returns completingNumber when applicable
// ✅ UPDATED FUNCTION: Pattern-specific late call detection — Now always returns completingNumber when applicable
const detectLateCallForCurrentPattern = async (
  cardNumbers,
  currentPattern,
  calledNumbers,
  gameId,
  lineInfo = null
) => {
  try {
    console.log(
      `[detectLateCallForCurrentPattern] 🔍 Pattern "${currentPattern}", lineInfo: ${JSON.stringify(
        lineInfo
      )}`
    );

    const targetIndices =
      lineInfo && lineInfo.lineIndex ? [lineInfo.lineIndex] : [];
    const { numbers: patternNumbers } = getNumbersForPattern(
      cardNumbers, // 2D
      currentPattern,
      calledNumbers, // ✅ FIX: Pass actual calledNumbers (not [])
      true, // Use specific line
      targetIndices,
      true // ✅ FIX: includeMarked=true to get full required non-FREE numbers
    );

    const requiredNumbers = patternNumbers
      .filter((num) => num !== "FREE" && !isNaN(parseInt(num)))
      .map((num) => parseInt(num));

    console.log(
      `[detectLateCallForCurrentPattern] 📝 Required: [${requiredNumbers.join(
        ", "
      )}]`
    );

    if (requiredNumbers.length === 0) {
      console.log(`[detectLateCallForCurrentPattern] ⚠️ No required numbers`);
      return {
        hasMissedOpportunity: false,
        completingNumber: null,
        message: null,
      };
    }

    const callHistory = [];
    requiredNumbers.forEach((reqNum) => {
      const callIndex = calledNumbers.findIndex((num) => num === reqNum);
      if (callIndex !== -1) {
        callHistory.push({ number: reqNum, callIndex: callIndex + 1 });
      }
    });

    if (callHistory.length < requiredNumbers.length) {
      console.log(`[detectLateCallForCurrentPattern] ⚠️ Not fully called`);
      return {
        hasMissedOpportunity: false,
        completingNumber: null,
        message: null,
      };
    }

    callHistory.sort((a, b) => a.callIndex - b.callIndex);
    const completionCallIndex = Math.max(
      ...callHistory.map((c) => c.callIndex)
    );
    const currentCallIndex = calledNumbers.length;
    const wasCompleteEarlier = completionCallIndex < currentCallIndex;

    console.log(
      `[detectLateCallForCurrentPattern] 📊 Completion call #${completionCallIndex}, current #${currentCallIndex}, earlier? ${wasCompleteEarlier}`
    );

    const completingEntry = callHistory.find(
      (c) => c.callIndex === completionCallIndex
    );
    const completingNumber = completingEntry ? completingEntry.number : null;

    if (wasCompleteEarlier) {
      const message = `You won before with ${currentPattern.replace(
        "_",
        " "
      )} pattern on call #${completionCallIndex} (number ${completingNumber})`;
      console.log(`[detectLateCallForCurrentPattern] 🚨 LATE CALL: ${message}`);
      return {
        hasMissedOpportunity: true,
        message,
        completingNumber,
        details: {
          pattern: currentPattern,
          completingNumber,
          callIndex: completionCallIndex,
          validPatterns: [currentPattern],
          numbersCalledBefore: callHistory.slice(0, -1).map((c) => c.number),
          totalRequired: requiredNumbers.length,
        },
        earliestCallIndex: completionCallIndex,
      };
    }

    console.log(
      `[detectLateCallForCurrentPattern] ✅ Completed on current call with number ${completingNumber}`
    );
    return {
      hasMissedOpportunity: false,
      message: null,
      completingNumber,
    };
  } catch (error) {
    console.error("[detectLateCallForCurrentPattern] ❌ Error:", error);
    return {
      hasMissedOpportunity: false,
      completingNumber: null,
      message: null,
    };
  }
};
// Other functions (finishGame, pauseGame, updateGameStatus) – OPTIMIZED with lean/select where possible
export const finishGame = async (req, res) => {
  const gameId = req.params.id;

  const safeLog = async (logData) => {
    try {
      await GameLog.create(logData);
    } catch (err) {
      console.error("Failed to log game action:", err.message);
    }
  };

  try {
    const cashierId = req.user?.id;
    if (!cashierId) {
      console.warn(`[finishGame] cashierId missing for game ${gameId}`);
    }

    if (!mongoose.isValidObjectId(gameId)) {
      await safeLog({
        gameId,
        action: "finishGame",
        status: "failed",
        details: { error: "Invalid game ID format" },
      });
      return res.status(400).json({
        message: "Invalid game ID format",
        errorCode: "INVALID_GAME_ID",
      });
    }

    const game = await Game.findOne({ _id: gameId, cashierId })
      .select(
        "gameNumber status winner moderatorWinnerCardId winnerCardNumbers selectedWinnerNumbers"
      )
      .lean();

    if (!game) {
      await safeLog({
        gameId,
        action: "finishGame",
        status: "failed",
        details: { error: "Game not found or unauthorized" },
      });
      return res.status(404).json({
        message: "Game not found or you are not authorized to access it",
        errorCode: "GAME_NOT_FOUND",
      });
    }

    if (!["active", "paused"].includes(game.status)) {
      await safeLog({
        gameId,
        action: "finishGame",
        status: "failed",
        details: { error: "Game not active or paused", status: game.status },
      });
      return res.status(400).json({
        message: "Game is not active or paused",
        errorCode: "GAME_NOT_ACTIVE_OR_PAUSED",
      });
    }

    const updatedGame = await Game.findByIdAndUpdate(
      gameId,
      { status: "completed" },
      { new: true }
    )
      .select("gameNumber")
      .lean();

    // 🚫 Jackpot logic disabled — intentionally not modifying jackpot or logs
    if (game.jackpotEnabled && game.winner) {
      console.log(
        `[finishGame] Jackpot processing skipped for game ${gameId} (disabled logic)`
      );
    }

    await safeLog({
      gameId,
      action: "gameCompleted",
      status: "success",
      details: {
        gameNumber: game.gameNumber,
        winnerCardId: game.winner?.cardId ?? null,
        prize: game.winner?.prize ?? null,
        moderatorWinnerCardId: game.moderatorWinnerCardId ?? null,
        winnerCardNumbers: game.winnerCardNumbers ?? [],
        selectedWinnerNumbers: game.selectedWinnerNumbers ?? [],
      },
    });

    res.json({
      message: "Game completed successfully",
      game: {
        ...updatedGame,
        winnerCardNumbers: game.winnerCardNumbers ?? [],
        selectedWinnerNumbers: game.selectedWinnerNumbers ?? [],
      },
    });
  } catch (error) {
    console.error("[finishGame] Unexpected error:", error?.message ?? error);

    await safeLog({
      gameId,
      action: "finishGame",
      status: "failed",
      details: { error: error?.message ?? "Unknown error" },
    });

    res.status(500).json({
      message: "Internal server error",
      error: error?.message ?? "Unknown error",
    });
  }
};

export const pauseGame = async (req, res, next) => {
  try {
    const { id: gameId } = req.params; // ✅ FIXED param name

    await getCashierIdFromUser(req, res, () => {});
    const cashierId = req.cashierId;

    // FIXED: Include gameNumber in select
    // OPTIMIZED: Lean for read
    const game = await Game.findOne({ _id: gameId, cashierId })
      .select(
        "gameNumber status winner moderatorWinnerCardId winnerCardNumbers selectedWinnerNumbers"
      )
      .lean();

    if (!game) {
      await GameLog.create({
        gameId,
        action: "pauseGame",
        status: "failed",
        details: { error: "Game not found or unauthorized" },
      });
      return res.status(404).json({
        message: "Game not found or you are not authorized to access it",
      });
    }

    if (game.status !== "active") {
      await GameLog.create({
        gameId,
        action: "pauseGame",
        status: "failed",
        details: { error: "Game must be active to pause", status: game.status },
      });
      return res.status(400).json({ message: "Game must be active to pause" });
    }

    // OPTIMIZED: Atomic update
    const updatedGame = await Game.findByIdAndUpdate(
      gameId,
      { status: "paused" },
      { new: true }
    )
      .select("gameNumber") // ✅ Include
      .lean();

    await GameLog.create({
      gameId,
      action: "pauseGame",
      status: "success",
      details: {
        gameNumber: game.gameNumber,
        winnerCardNumbers: game.winnerCardNumbers,
        selectedWinnerNumbers: game.selectedWinnerNumbers,
      },
    });

    res.json({
      message: `Game ${game.gameNumber} paused successfully`,
      game: {
        ...updatedGame,
        status: "paused",
        winnerCardNumbers: game.winnerCardNumbers,
        selectedWinnerNumbers: game.selectedWinnerNumbers,
      },
    });
  } catch (error) {
    console.error("[pauseGame] Error pausing game:", error);
    await GameLog.create({
      gameId: req.params.id,
      action: "pauseGame",
      status: "failed",
      details: { error: error.message || "Internal server error" },
    });
    next(error);
  }
};

export const updateGameStatus = async (req, res, next) => {
  try {
    const { gameId } = req.params;
    const { status } = req.body;

    await getCashierIdFromUser(req, res, () => {});
    const cashierId = req.cashierId;

    if (!mongoose.isValidObjectId(gameId)) {
      await GameLog.create({
        gameId,
        action: "updateGameStatus",
        status: "failed",
        details: { error: "Invalid game ID format" },
      });
      return res.status(400).json({
        message: "Invalid game ID format",
        errorCode: "INVALID_GAME_ID",
      });
    }

    if (!["active", "paused"].includes(status)) {
      await GameLog.create({
        gameId,
        action: "updateGameStatus",
        status: "failed",
        details: { error: `Invalid status: ${status}` },
      });
      return res.status(400).json({
        message: `Invalid status: ${status}. Must be 'active' or 'paused'`,
        errorCode: "INVALID_STATUS",
      });
    }

    // FIXED: Include gameNumber in select
    // OPTIMIZED: Lean for read
    const game = await Game.findOne({ _id: gameId, cashierId })
      .select("gameNumber status") // ✅ Include status to check
      .lean();
    if (!game) {
      await GameLog.create({
        gameId,
        action: "updateGameStatus",
        status: "failed",
        details: { error: "Game not found or unauthorized" },
      });
      return res.status(404).json({
        message: "Game not found or you are not authorized to access it",
        errorCode: "GAME_NOT_FOUND",
      });
    }

    if (game.status === "completed") {
      await GameLog.create({
        gameId,
        action: "updateGameStatus",
        status: "failed",
        details: {
          error: "Cannot modify completed game",
          currentStatus: game.status,
        },
      });
      return res.status(400).json({
        message: "Cannot modify a completed game",
        errorCode: "GAME_COMPLETED",
      });
    }

    if (game.status === status) {
      await GameLog.create({
        gameId,
        action: "updateGameStatus",
        status: "failed",
        details: { error: `Game is already ${status}` },
      });
      return res.status(400).json({
        message: `Game is already ${status}`,
        errorCode: "STATUS_UNCHANGED",
      });
    }

    // OPTIMIZED: Atomic update
    const updatedGame = await Game.findByIdAndUpdate(
      gameId,
      { status },
      { new: true }
    )
      .select("gameNumber")
      .lean();

    await GameLog.create({
      gameId,
      action: "updateGameStatus",
      status: "success",
      details: {
        gameNumber: game.gameNumber,
        newStatus: status,
        timestamp: new Date(),
      },
    });

    res.json({
      message: `Game ${game.gameNumber} ${status} successfully`,
      game: {
        ...updatedGame,
        status,
      },
    });
  } catch (error) {
    console.error("[updateGameStatus] Error updating game status:", error);
    await GameLog.create({
      gameId: req.params.gameId || gameId,
      action: "updateGameStatus",
      status: "failed",
      details: { error: error.message || "Internal server error" },
    });
    next(error);
  }
};

// Toggle auto-call behavior for a game. When disabled, server will reject auto next-call
// requests (i.e., requests without an explicit number). Manual calls remain allowed.
export const setAutoCallEnabled = async (req, res, next) => {
  try {
    const { id: gameId } = req.params;
    const { enabled } = req.body;

    await getCashierIdFromUser(req, res, () => {});
    const cashierId = req.cashierId;

    if (!mongoose.isValidObjectId(gameId)) {
      return res.status(400).json({
        message: "Invalid game ID format",
        errorCode: "INVALID_GAME_ID",
      });
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        message: "'enabled' boolean body is required",
        errorCode: "INVALID_BODY",
      });
    }

    const game = await Game.findOneAndUpdate(
      { _id: gameId, cashierId },
      { autoCallEnabled: enabled },
      { new: true }
    )
      .select("gameNumber autoCallEnabled status")
      .lean();

    if (!game) {
      return res.status(404).json({
        message: "Game not found or unauthorized",
        errorCode: "GAME_NOT_FOUND",
      });
    }

    // If disabling, proactively clear any deferred next-call timers
    if (!enabled) {
      clearDeferredForGame(gameId);
    }

    await GameLog.create({
      gameId,
      action: "setAutoCallEnabled",
      status: "success",
      details: { newValue: enabled, timestamp: new Date() },
    });

    res.json({
      message: `Auto-call ${enabled ? "enabled" : "disabled"} for game ${
        game.gameNumber
      }`,
      game,
    });
  } catch (error) {
    console.error("[setAutoCallEnabled] Error:", error);
    await GameLog.create({
      gameId: req.params.id,
      action: "setAutoCallEnabled",
      status: "failed",
      details: { error: error.message || "Internal server error" },
    });
    next(error);
  }
};

// Restart a game from new: clear called numbers and logs and set active status
// Preserve configured winner queue (forcedCallSequence), but reset the index to 0
// so the configured sequence plays from the beginning on restart.
export const restartGame = async (req, res, next) => {
  try {
    const { id: gameId } = req.params;

    await getCashierIdFromUser(req, res, () => {});
    const cashierId = req.cashierId;

    if (!mongoose.isValidObjectId(gameId)) {
      return res.status(400).json({
        message: "Invalid game ID format",
        errorCode: "INVALID_GAME_ID",
      });
    }

    // Clear any deferred timers and in-memory pacing
    try {
      clearDeferredForGame(gameId);
      preferredIntervalByGame.delete(gameId);
      lastEmitAtByGame.delete(gameId);
    } catch {
      /* noop */
    }

    const game = await Game.findOneAndUpdate(
      { _id: gameId, cashierId },
      {
        $set: {
          calledNumbers: [],
          calledNumbersLog: [],
          forcedCallIndex: 0, // Start forced sequence from beginning
          status: "active",
        },
        $unset: { callLock: "", nextAllowedAt: "" },
      },
      { new: true, runValidators: true }
    )
      .select(
        "gameNumber status calledNumbers calledNumbersLog forcedCallIndex forcedCallSequence autoCallEnabled"
      )
      .lean();

    if (!game) {
      return res.status(404).json({
        message: "Game not found or unauthorized",
        errorCode: "GAME_NOT_FOUND",
      });
    }

    await GameLog.create({
      gameId,
      action: "restartGame",
      status: "success",
      details: { timestamp: new Date() },
    });

    res.json({
      message: `Game ${game.gameNumber} restarted from new`,
      game,
    });
  } catch (error) {
    console.error("[restartGame] Error:", error);
    await GameLog.create({
      gameId: req.params.id,
      action: "restartGame",
      status: "failed",
      details: { error: error.message || "Internal server error" },
    });
    next(error);
  }
};
