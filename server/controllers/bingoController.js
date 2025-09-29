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
import GameLog from "../models/GameLog.js";
import FutureWinner from "../models/FutureWinner.js";

export const callNumber = async (req, res, next) => {
  try {
    const { gameId } = req.params;
    console.log(`[callNumber] 🔵 START — Request for gameId: ${gameId}`);

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    if (game.status !== "active") {
      return res.status(400).json({
        message: `Cannot call number: Game is ${game.status}`,
        errorCode: "GAME_NOT_ACTIVE",
      });
    }

    if (!game.calledNumbers) game.calledNumbers = [];
    if (!game.calledNumbersLog) game.calledNumbersLog = [];
    if (!game.forcedCallIndex) game.forcedCallIndex = 0;

    let nextNumber;
    let callSource = "random";
    let isUsingForcedSequence = false;

    const winnerLimit = 14;
    const callsMade = game.calledNumbers.length;

    if (
      game.forcedCallSequence &&
      Array.isArray(game.forcedCallSequence) &&
      game.forcedCallIndex < game.forcedCallSequence.length
    ) {
      const remainingForced =
        game.forcedCallSequence.length - game.forcedCallIndex;

      if (callsMade + remainingForced >= winnerLimit || Math.random() < 0.4) {
        nextNumber = game.forcedCallSequence[game.forcedCallIndex];
        game.forcedCallIndex++;
        callSource = "forced";
        isUsingForcedSequence = true;
        console.log(
          `[callNumber] 🔄 FORCED CALL: Number ${nextNumber} (Index ${game.forcedCallIndex})`
        );
      }
    }

    if (!nextNumber) {
      const remainingNumbers = Array.from(
        { length: 75 },
        (_, i) => i + 1
      ).filter(
        (n) =>
          !game.calledNumbers.includes(n) &&
          !(game.forcedCallSequence || []).includes(n)
      );

      if (remainingNumbers.length === 0) {
        return res.status(400).json({ message: "No numbers left to call" });
      }

      nextNumber =
        remainingNumbers[Math.floor(Math.random() * remainingNumbers.length)];
      callSource = "random";
      console.log(`[callNumber] 🎲 RANDOM CALL: Number ${nextNumber}`);
    }

    game.calledNumbers.push(Number(nextNumber));
    game.calledNumbersLog.push({
      number: Number(nextNumber),
      calledAt: new Date(),
    });

    await game.save();

    await GameLog.create({
      gameId: game._id,
      action: "callNumber",
      status: "success",
      details: {
        calledNumber: Number(nextNumber),
        type: callSource,
        forcedCallIndex: game.forcedCallIndex,
        forcedCallLength: game.forcedCallSequence?.length || 0,
        pattern: game.forcedPattern || game.pattern,
        moderatorWinnerCardId: game.moderatorWinnerCardId,
        timestamp: new Date(),
      },
    });

    res.json({
      game,
      calledNumber: Number(nextNumber),
      callSource,
      isUsingForcedSequence,
      patternUsed: game.forcedPattern || game.pattern,
      forcedCallIndex: game.forcedCallIndex,
      forcedCallSequenceLength: game.forcedCallSequence?.length || 0,
    });
  } catch (err) {
    console.error("[callNumber] ❌ ERROR:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const checkBingo = async (req, res, next) => {
  try {
    const { cardId, identifier, preferredPattern } = req.body;
    const gameId = req.params.id;

    const game = await Game.findById(gameId);
    if (!game) {
      console.warn(`[checkBingo] ❌ Game not found: ${gameId}`);
      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: "failed",
        details: {
          error: "Game not found",
          timestamp: new Date(),
        },
      });
      return res.status(404).json({ message: "Game not found" });
    }

    const numericCardId = Number(cardId);
    const card = game.selectedCards.find((c) => c.id === numericCardId);
    if (!card) {
      console.warn(`[checkBingo] ❌ Card not in game: ${numericCardId}`);
      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: "failed",
        details: {
          error: `Card ${numericCardId} not in game`,
          timestamp: new Date(),
        },
      });
      return res.status(400).json({ message: "Card not in game" });
    }

    // ✅ NEW: Update lastCheckTime and check if a new number was called since last check
    const currentTime = new Date();
    const lastCalledNumber = game.calledNumbersLog.length
      ? game.calledNumbersLog[game.calledNumbersLog.length - 1]
      : null;
    const lastCalledTime = lastCalledNumber ? lastCalledNumber.calledAt : null;

    // If no new number was called since last check, reset checkCount and disqualification
    if (
      card.lastCheckTime &&
      lastCalledTime &&
      card.lastCheckTime >= lastCalledTime
    ) {
      console.log(
        `[checkBingo] 🔄 No new number called since last check for card ${numericCardId}. Resetting checkCount and disqualification.`
      );
      card.checkCount = 1; // Reset to 1 since this is a valid check
      card.disqualified = false; // Reset disqualification
    } else {
      // Increment checkCount only if a new number was called
      card.checkCount = (card.checkCount || 0) + 1;
    }

    // Update lastCheckTime for this check
    card.lastCheckTime = currentTime;
    await game.save(); // Persist checkCount and lastCheckTime immediately

    // ✅ Modified: Check disqualification status or excessive checks
    if (card.disqualified || card.checkCount > 1) {
      console.log(
        `[checkBingo] ❌ Card ${numericCardId} is disqualified (disqualified: ${card.disqualified}, checkCount: ${card.checkCount})`
      );
      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: "disqualified",
        details: {
          cardId: numericCardId,
          message: card.disqualified
            ? "Card is disqualified due to previous late call or invalid check"
            : "Card checked too many times (more than once)",
          checkCount: card.checkCount,
          disqualified: true,
          timestamp: new Date(),
        },
      });
      return res.json({
        isBingo: false,
        message: card.disqualified
          ? "Card is disqualified and cannot win"
          : "Card cannot win due to multiple checks",
        winningPattern: null,
        validBingoPatterns: [],
        completedPatterns: [],
        disqualified: true,
        checkCount: card.checkCount,
        game: {
          ...game.toObject(),
          winnerCardNumbers: game.winnerCardNumbers || [],
          selectedWinnerNumbers: game.selectedWinnerNumbers || [],
        },
      });
    }

    if (!["active", "paused", "completed"].includes(game.status)) {
      console.warn(`[checkBingo] ❌ Game not checkable: status=${game.status}`);
      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: "failed",
        details: {
          error: `Game not checkable, status: ${game.status}`,
          timestamp: new Date(),
        },
      });
      return res.status(400).json({ message: "Game not checkable" });
    }

    if (!lastCalledNumber) {
      console.log(`[checkBingo] ❌ No last called number - cannot check bingo`);
      return res.json({
        isBingo: false,
        message: "No numbers called yet",
        winningPattern: null,
        validBingoPatterns: [],
        completedPatterns: [],
        disqualified: false,
        checkCount: card.checkCount,
        game: {
          ...game.toObject(),
          winnerCardNumbers: game.winnerCardNumbers || [],
          selectedWinnerNumbers: game.selectedWinnerNumbers || [],
        },
      });
    }

    const validPatterns = [
      "four_corners_center",
      "main_diagonal",
      "other_diagonal",
      "horizontal_line",
      "vertical_line",
      "inner_corners",
      "all",
    ];

    const patternsToCheck =
      game.pattern === "all" && !game.forcedPattern
        ? validPatterns.filter((p) => p !== "all")
        : [game.forcedPattern || game.pattern];

    console.log(`[checkBingo] Patterns to check: ${patternsToCheck}`);

    let isBingo = false;
    let winningPattern = null;
    let markedGrid = getMarkedGrid(card.numbers, game.calledNumbers);
    const validBingoPatterns = [];
    const completedPatterns = [];
    let winningLineInfo = null;

    const previousCalledNumbers = game.calledNumbers.slice(0, -1);

    // Check all patterns for completion (to identify late calls)
    for (const pattern of patternsToCheck) {
      if (!validPatterns.includes(pattern)) {
        console.error(`[checkBingo] ❌ Invalid pattern: ${pattern}`);
        continue;
      }

      try {
        const [isComplete] = checkCardBingo(
          card.numbers,
          game.calledNumbers,
          pattern
        );
        if (isComplete) {
          console.log(`[checkBingo] ✅ Pattern ${pattern} is complete`);
          completedPatterns.push({ pattern });
        }
      } catch (err) {
        console.error(
          `[checkBingo] ❌ Error checking pattern ${pattern}:`,
          err
        );
      }
    }

    // Check for bingo triggered by the last called number
    for (const pattern of patternsToCheck) {
      if (!validPatterns.includes(pattern)) {
        console.error(`[checkBingo] ❌ Invalid pattern: ${pattern}`);
        continue;
      }

      try {
        const specificLineInfo = getSpecificLineInfo(
          card.numbers,
          pattern,
          lastCalledNumber.number
        );
        console.log(
          `[checkBingo] Pattern ${pattern}: specificLineInfo=`,
          specificLineInfo
        );

        if (!specificLineInfo) {
          console.log(
            `[checkBingo] ❌ Last called ${lastCalledNumber.number} not part of pattern ${pattern}`
          );
          continue;
        }

        const currentLineComplete = checkSpecificLineCompletion(
          card.numbers,
          game.calledNumbers,
          pattern,
          specificLineInfo
        );

        console.log(
          `[checkBingo] Pattern ${pattern}: currentLineComplete=${currentLineComplete} (${specificLineInfo.lineType} ${specificLineInfo.lineIndex})`
        );

        if (!currentLineComplete) {
          console.log(
            `[checkBingo] ❌ Specific line for ${pattern} not complete currently`
          );
          continue;
        }

        const wasSpecificLinePreviouslyComplete = checkSpecificLineCompletion(
          card.numbers,
          previousCalledNumbers,
          pattern,
          specificLineInfo
        );

        console.log(
          `[checkBingo] Pattern ${pattern}: wasSpecificLinePreviouslyComplete=${wasSpecificLinePreviouslyComplete}`
        );

        if (wasSpecificLinePreviouslyComplete) {
          console.log(
            `[checkBingo] ❌ Specific line for ${pattern} was already complete before last call`
          );
          continue;
        }

        console.log(
          `[checkBingo] ✅ VALID BINGO! Pattern ${pattern} - specific line ${specificLineInfo.lineType} ${specificLineInfo.lineIndex} completed by last call ${lastCalledNumber.number}`
        );
        validBingoPatterns.push(pattern);

        if (!winningLineInfo) {
          const patternResult = getNumbersForPattern(
            card.numbers,
            pattern,
            game.calledNumbers,
            true,
            specificLineInfo.lineIndex ? [specificLineInfo.lineIndex] : [],
            true
          );

          winningLineInfo = {
            pattern,
            lineInfo: specificLineInfo,
            ...patternResult,
          };

          console.log(
            `[checkBingo] ✅ Winning line info created:`,
            winningLineInfo
          );
        }

        if (preferredPattern && preferredPattern === pattern) {
          isBingo = true;
          winningPattern = pattern;
          const patternResult = getNumbersForPattern(
            card.numbers,
            pattern,
            game.calledNumbers,
            true,
            specificLineInfo.lineIndex ? [specificLineInfo.lineIndex] : [],
            true
          );

          winningLineInfo = {
            pattern,
            lineInfo: specificLineInfo,
            ...patternResult,
          };
          console.log(`[checkBingo] ✅ Preferred pattern match: ${pattern}`);
          break;
        }
      } catch (err) {
        console.error(
          `[checkBingo] ❌ Error checking pattern ${pattern}:`,
          err
        );
        await GameLog.create({
          gameId,
          action: "checkBingo",
          status: "failed",
          details: {
            cardId: numericCardId,
            callsMade: game.calledNumbers.length,
            lastCalledNumber: lastCalledNumber?.number,
            error: `Pattern check failed: ${err.message}`,
            pattern,
            timestamp: new Date(),
          },
        });
      }
    }

    if (validBingoPatterns.length > 0) {
      isBingo = true;
      winningPattern = validBingoPatterns.includes(preferredPattern)
        ? preferredPattern
        : validBingoPatterns[0];
      console.log(
        `[checkBingo] 🎯 Potential WINNER! Card ${numericCardId} matches pattern "${winningPattern}"`
      );
    } else {
      console.log(
        `[checkBingo] 😔 No valid bingo for card ${numericCardId} - last call didn't complete any new specific line`
      );
    }

    // Initialize response
    let response = {
      isBingo,
      winningPattern,
      validBingoPatterns,
      completedPatterns,
      effectivePattern: winningPattern || patternsToCheck[0],
      lastCalledNumber: lastCalledNumber?.number,
      winningLineInfo: winningLineInfo || null,
      game: {
        ...game.toObject(),
        winnerCardNumbers: game.winnerCardNumbers || [],
        selectedWinnerNumbers: game.selectedWinnerNumbers || [],
      },
      winner: null,
      previousWinner: null,
      lateCall: false,
      lateCallMessage: null,
      wouldHaveWon: null,
      disqualified: card.disqualified || false,
      checkCount: card.checkCount,
    };

    let lateCallMessage = null;
    let wouldHaveWon = null;

    if (isBingo && winningPattern) {
      // ✅ Modified: Double-check disqualification and checkCount
      if (card.disqualified || card.checkCount > 1) {
        console.log(
          `[checkBingo] ❌ Card ${numericCardId} is disqualified (disqualified: ${card.disqualified}, checkCount: ${card.checkCount})`
        );
        response.isBingo = false;
        response.winningPattern = null;
        response.winningLineInfo = null;
        response.message = card.disqualified
          ? "Card is disqualified and cannot win"
          : "Card cannot win due to multiple checks";
        response.disqualified = true;

        await GameLog.create({
          gameId,
          action: "checkBingo",
          status: "disqualified",
          details: {
            cardId: numericCardId,
            callsMade: game.calledNumbers.length,
            lastCalledNumber: lastCalledNumber?.number,
            message: card.disqualified
              ? "Card is disqualified from previous check"
              : "Card checked too many times",
            checkCount: card.checkCount,
            disqualified: true,
            timestamp: new Date(),
          },
        });
        return res.json(response);
      }

      const lateCallResult = await detectLateCallForCurrentPattern(
        card.numbers,
        winningPattern,
        game.calledNumbers,
        gameId
      );

      if (lateCallResult && lateCallResult.hasMissedOpportunity) {
        // ✅ NEW: Mark card as disqualified and save immediately
        card.disqualified = true;
        await game.save(); // Persist disqualification status

        lateCallMessage = lateCallResult.message;
        wouldHaveWon = lateCallResult.details;
        response.lateCall = true;
        response.lateCallMessage = lateCallMessage;
        response.wouldHaveWon = wouldHaveWon;
        response.isBingo = false;
        response.winningPattern = null;
        response.winningLineInfo = null;
        response.disqualified = true;
        response.message = `Card disqualified due to late call: ${lateCallMessage}`;
        response.checkCount = card.checkCount;

        console.log(
          `[checkBingo] 🕒 LATE CALL DETECTED for pattern "${winningPattern}": ${lateCallMessage}. Card ${numericCardId} disqualified.`
        );

        await GameLog.create({
          gameId,
          action: "checkBingo",
          status: "late_call",
          details: {
            cardId: numericCardId,
            callsMade: game.calledNumbers.length,
            lastCalledNumber: lastCalledNumber?.number,
            message: lateCallMessage,
            disqualified: true,
            checkCount: card.checkCount,
            lateCallDetails: wouldHaveWon,
            timestamp: new Date(),
          },
        });
        return res.json(response); // Return early to prevent win processing
      } else {
        console.log(
          `[checkBingo] ✅ LEGITIMATE WIN for pattern "${winningPattern}" - no late call opportunity`
        );
      }
    } else if (completedPatterns.length > 0 || game.status === "completed") {
      const lateCallResult = await detectLateCallOpportunity(
        card.numbers,
        game.calledNumbers,
        game.calledNumbersLog,
        patternsToCheck
      );

      if (lateCallResult && lateCallResult.hasMissedOpportunity) {
        // ✅ NEW: Mark card as disqualified and save immediately
        card.disqualified = true;
        await game.save(); // Persist disqualification status

        lateCallMessage = lateCallResult.message;
        wouldHaveWon = lateCallResult.details;
        response.lateCall = true;
        response.lateCallMessage = lateCallMessage;
        response.wouldHaveWon = wouldHaveWon;
        response.disqualified = true;
        response.message = `Card disqualified due to late call: ${lateCallMessage}`;
        response.checkCount = card.checkCount;

        console.log(
          `[checkBingo] 🕒 LATE CALL DETECTED (non-winning check): ${lateCallMessage}. Card ${numericCardId} disqualified.`
        );

        await GameLog.create({
          gameId,
          action: "checkBingo",
          status: "late_call",
          details: {
            cardId: numericCardId,
            callsMade: game.calledNumbers.length,
            lastCalledNumber: lastCalledNumber?.number,
            message: lateCallMessage,
            disqualified: true,
            checkCount: card.checkCount,
            lateCallDetails: wouldHaveWon,
            timestamp: new Date(),
          },
        });
        return res.json(response); // Return early
      }
    }

    // Handle completed game case
    if (game.status === "completed") {
      if (game.winner && game.winner.cardId) {
        const result = await Result.findOne({
          gameId: game._id,
          winnerCardId: game.winner.cardId,
        }).lean();
        response.previousWinner = {
          cardId: game.winner.cardId,
          prize: game.winner.prize,
          winningPattern: result?.winningPattern || null,
          userId: result?.userId || null,
          identifier: result?.identifier || null,
          isJackpot: result?.isJackpot || false,
        };
      }

      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: isBingo ? "success" : lateCallMessage ? "late_call" : "failed",
        details: {
          cardId: numericCardId,
          callsMade: game.calledNumbers.length,
          lastCalledNumber: lastCalledNumber?.number,
          message: isBingo
            ? `Bingo with ${winningPattern}`
            : lateCallMessage || "No valid bingo",
          winningPattern: isBingo ? winningPattern : null,
          validBingoPatterns,
          completedPatterns,
          patternsChecked: patternsToCheck,
          lateCall: lateCallMessage ? true : false,
          lateCallDetails: wouldHaveWon,
          disqualified: card.disqualified || false,
          checkCount: card.checkCount,
          markedGrid: JSON.stringify(markedGrid),
          timestamp: new Date(),
        },
      });

      return res.json(response);
    }

    if (isBingo) {
      // ✅ Modified: Final disqualification and checkCount check
      if (card.disqualified || card.checkCount > 1) {
        console.log(
          `[checkBingo] ❌ Card ${numericCardId} is disqualified (disqualified: ${card.disqualified}, checkCount: ${card.checkCount})`
        );
        response.isBingo = false;
        response.winningPattern = null;
        response.winningLineInfo = null;
        response.message = card.disqualified
          ? "Card is disqualified and cannot win"
          : "Card cannot win due to multiple checks";
        response.disqualified = true;
        response.checkCount = card.checkCount;

        await GameLog.create({
          gameId,
          action: "checkBingo",
          status: "disqualified",
          details: {
            cardId: numericCardId,
            callsMade: game.calledNumbers.length,
            lastCalledNumber: lastCalledNumber?.number,
            message: card.disqualified
              ? "Card is disqualified from previous check"
              : "Card checked too many times",
            checkCount: card.checkCount,
            disqualified: true,
            timestamp: new Date(),
          },
        });
        return res.json(response);
      }

      console.log(
        `[checkBingo] 🏆 FINALIZING WIN - Card ${numericCardId} is the winner!`
      );

      if (game.winner?.cardId) {
        console.warn(
          `[checkBingo] ⚠️ Game already has winner: ${game.winner.cardId}`
        );
        response.winner = null;
        response.isBingo = false;
        response.message = "Game already completed with another winner";
        response.lateCall = false;
        response.lateCallMessage = null;
        response.wouldHaveWon = null;
        response.checkCount = card.checkCount;

        if (completedPatterns.length > 0) {
          const lateCallResult = await detectLateCallForCurrentPattern(
            card.numbers,
            patternsToCheck[0],
            game.calledNumbers,
            gameId
          );
          if (lateCallResult && lateCallResult.hasMissedOpportunity) {
            card.disqualified = true;
            await game.save(); // Persist disqualification status

            lateCallMessage = lateCallResult.message;
            response.lateCall = true;
            response.lateCallMessage = lateCallMessage;
            response.wouldHaveWon = lateCallResult.details;
            response.disqualified = true;

            console.log(
              `[checkBingo] 🕒 LATE CALL DETECTED (post-winner): ${lateCallMessage}. Card ${numericCardId} disqualified.`
            );
          }
        }
        return res.json(response);
      }

      game.winner = {
        cardId: numericCardId,
        prize: game.prizePool,
      };
      game.selectedWinnerNumbers = game.selectedWinnerNumbers || [];
      game.winnerCardNumbers = card.numbers;

      let jackpotAwarded = false;

      game.status = "completed";
      await game.save();

      const resultIdentifier = identifier || `${game._id}-${numericCardId}`;
      await Result.create({
        gameId: game._id,
        winnerCardId: numericCardId,
        userId: req.user?._id || null,
        identifier: resultIdentifier,
        prize: game.winner.prize,
        isJackpot: jackpotAwarded,
        winningPattern,
        lastCalledNumber: lastCalledNumber?.number,
        timestamp: new Date(),
      });

      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: "success",
        details: {
          cardId: numericCardId,
          callsMade: game.calledNumbers.length,
          lastCalledNumber: lastCalledNumber?.number,
          jackpotAwarded,
          winningPattern,
          validBingoPatterns,
          identifier: resultIdentifier,
          completedByLastCall: true,
          winningLineInfo: winningLineInfo,
          disqualified: false,
          checkCount: card.checkCount,
          timestamp: new Date(),
        },
      });

      response.winner = {
        cardId: numericCardId,
        prize: game.winner.prize,
        winningPattern,
        userId: req.user?._id || null,
        identifier: resultIdentifier,
        isJackpot: jackpotAwarded,
        completedByLastCall: true,
      };
      response.checkCount = card.checkCount;

      console.log(
        `[checkBingo] ✅ Game completed! Winner: Card ${numericCardId} with pattern "${winningPattern}" on call ${lastCalledNumber?.number}`
      );
    } else {
      await GameLog.create({
        gameId,
        action: "checkBingo",
        status: lateCallMessage ? "late_call" : "failed",
        details: {
          cardId: numericCardId,
          callsMade: game.calledNumbers.length,
          lastCalledNumber: lastCalledNumber?.number,
          message:
            lateCallMessage ||
            "No valid bingo - last call didn't complete any new specific line",
          patternsChecked: patternsToCheck,
          validBingoPatterns,
          completedPatterns,
          lateCall: lateCallMessage ? true : false,
          lateCallDetails: wouldHaveWon,
          disqualified: card.disqualified || false,
          checkCount: card.checkCount,
          markedGrid: JSON.stringify(markedGrid),
          timestamp: new Date(),
        },
      });
    }

    return res.json(response);
  } catch (err) {
    console.error("[checkBingo] ❌ ERROR:", err);
    await GameLog.create({
      gameId: req.params.id,
      action: "checkBingo",
      status: "failed",
      details: { error: err.message, timestamp: new Date() },
    });
    return res.status(500).json({
      message: "Internal server error",
      error: err.message,
      game: null,
    });
  }
};
// ✅ NEW FUNCTION: Pattern-specific late call detection
const detectLateCallForCurrentPattern = async (
  cardNumbers,
  currentPattern,
  calledNumbers,
  gameId
) => {
  try {
    console.log(
      `[detectLateCallForCurrentPattern] Checking pattern "${currentPattern}" for late call opportunity`
    );

    // Get the numbers required for the CURRENT pattern only
    const { numbers: patternNumbers } = getNumbersForPattern(
      cardNumbers.flat(),
      currentPattern,
      [], // Don't pass called numbers here - we want all pattern numbers
      false
    );

    // Filter out FREE spaces and convert to numbers
    const requiredNumbers = patternNumbers
      .filter((num) => num !== "FREE" && !isNaN(parseInt(num)))
      .map((num) => parseInt(num));

    console.log(
      `[detectLateCallForCurrentPattern] Required numbers for "${currentPattern}":`,
      requiredNumbers
    );

    if (requiredNumbers.length === 0) {
      console.log(
        `[detectLateCallForCurrentPattern] No numbers found for pattern "${currentPattern}"`
      );
      return null;
    }

    // Find when each required number was called
    const callHistory = [];
    requiredNumbers.forEach((requiredNum) => {
      const callIndex = calledNumbers.findIndex((num) => num === requiredNum);
      if (callIndex !== -1) {
        callHistory.push({
          number: requiredNum,
          callIndex: callIndex + 1, // 1-based index
        });
      }
    });

    // Sort by call order
    callHistory.sort((a, b) => a.callIndex - b.callIndex);

    console.log(
      `[detectLateCallForCurrentPattern] Call history for pattern "${currentPattern}":`,
      callHistory
    );

    if (callHistory.length < requiredNumbers.length) {
      console.log(
        `[detectLateCallForCurrentPattern] Pattern "${currentPattern}" not fully complete yet`
      );
      return null;
    }

    // Check if all but one number were called before the current call
    const currentCallIndex = calledNumbers.length;
    const numbersCalledBeforeCurrent = callHistory.filter(
      (call) => call.callIndex < currentCallIndex
    );

    const wasPatternCompleteEarlier =
      numbersCalledBeforeCurrent.length === requiredNumbers.length - 1;

    if (wasPatternCompleteEarlier) {
      const completingNumber = callHistory.find(
        (call) => call.callIndex === currentCallIndex - 1
      );

      console.log(
        `[detectLateCallForCurrentPattern] LATE CALL DETECTED for pattern "${currentPattern}"!`
      );
      console.log(
        `[detectLateCallForCurrentPattern] Would have been complete on call #${
          numbersCalledBeforeCurrent.length + 1
        } with number ${completingNumber.number}`
      );

      return {
        hasMissedOpportunity: true,
        message: `You won before with ${currentPattern.replace(
          "_",
          " "
        )} pattern on call #${numbersCalledBeforeCurrent.length + 1} (number ${
          completingNumber.number
        })`,
        details: {
          pattern: currentPattern,
          completingNumber: completingNumber.number,
          callIndex: numbersCalledBeforeCurrent.length + 1,
          validPatterns: [currentPattern],
          numbersCalledBefore: numbersCalledBeforeCurrent.map((c) => c.number),
          totalRequired: requiredNumbers.length,
        },
        earliestCallIndex: numbersCalledBeforeCurrent.length + 1,
      };
    }

    console.log(
      `[detectLateCallForCurrentPattern] No late call opportunity for current pattern "${currentPattern}"`
    );
    return null;
  } catch (error) {
    console.error("[detectLateCallForCurrentPattern] Error:", error);
    return null;
  }
};
// Other functions (finishGame, pauseGame, updateGameStatus) remain unchanged
export const finishGame = async (req, res, next) => {
  try {
    const gameId = req.params.id;

    await getCashierIdFromUser(req, res, () => {});
    const cashierId = req.cashierId;

    if (!mongoose.isValidObjectId(gameId)) {
      await GameLog.create({
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

    const game = await Game.findOne({ _id: gameId, cashierId });
    if (!game) {
      await GameLog.create({
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

    if (game.status !== "active" && game.status !== "paused") {
      await GameLog.create({
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

    game.status = "completed";
    if (game.jackpotEnabled && game.winner) {
      const jackpot = await Jackpot.findOne({ cashierId });
      if (jackpot) {
        await logJackpotUpdate(
          game.potentialJackpot,
          "Game contribution",
          gameId
        );
        jackpot.amount += game.potentialJackpot;
        await jackpot.save();
      }
    }

    await game.save();

    await GameLog.create({
      gameId,
      action: "gameCompleted",
      status: "success",
      details: {
        gameNumber: game.gameNumber,
        winnerCardId: game.winner?.cardId,
        prize: game.winner?.prize,
        moderatorWinnerCardId: game.moderatorWinnerCardId,
        winnerCardNumbers: game.winnerCardNumbers,
        selectedWinnerNumbers: game.selectedWinnerNumbers,
      },
    });

    res.json({
      message: "Game completed",
      game: {
        ...game.toObject(),
        winnerCardNumbers: game.winnerCardNumbers,
        selectedWinnerNumbers: game.selectedWinnerNumbers,
      },
    });
  } catch (error) {
    console.error("[finishGame] Error in finishGame:", error);
    await GameLog.create({
      gameId: req.params.id,
      action: "finishGame",
      status: "failed",
      details: { error: error.message || "Internal server error" },
    });
    next(error);
  }
};

export const pauseGame = async (req, res, next) => {
  try {
    const { gameId } = req.params;

    await getCashierIdFromUser(req, res, () => {});
    const cashierId = req.cashierId;

    const game = await Game.findOne({ _id: gameId, cashierId });
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

    game.status = "paused";
    await game.save();

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
        ...game.toObject(),
        status: "paused",
        winnerCardNumbers: game.winnerCardNumbers,
        selectedWinnerNumbers: game.selectedWinnerNumbers,
      },
    });
  } catch (error) {
    console.error("[pauseGame] Error pausing game:", error);
    await GameLog.create({
      gameId: req.params.gameId,
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

    const game = await Game.findOne({ _id: gameId, cashierId });
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

    game.status = status;
    await game.save();

    await GameLog.create({
      gameId,
      action: "updateGameStatus",
      status: "success",
      details: {
        gameNumber: game.gameNumber,
        newStatus: status,
        winnerCardNumbers: game.winnerCardNumbers,
        selectedWinnerNumbers: game.selectedWinnerNumbers,
        timestamp: new Date(),
      },
    });

    res.json({
      message: `Game ${game.gameNumber} ${status} successfully`,
      game: {
        ...game.toObject(),
        status,
        winnerCardNumbers: game.winnerCardNumbers,
        selectedWinnerNumbers: game.selectedWinnerNumbers,
      },
    });
  } catch (error) {
    console.error("[updateGameStatus] Error updating game status:", error);
    await GameLog.create({
      gameId: req.params.gameId,
      action: "updateGameStatus",
      status: "failed",
      details: { error: error.message || "Internal server error" },
    });
    next(error);
  }
};
