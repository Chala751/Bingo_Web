// src/components/bingo/hooks/useBingoController.js
import { useContext, useEffect, useState, useCallback, useRef } from "react";
import { LanguageContext } from "../../../context/LanguageProvider";
import { useNavigate, useSearchParams } from "react-router-dom";
import API from "../../../services/axios";
import gameService from "../../../services/game";

import useGameState from "./useGameState";
import useAutoCaller from "./useAutoCaller";
import useNumberCalling from "./useNumberCalling";
import useCardManagement from "./useCardManagement";
import useJackpot from "./useJackpot";
import useShuffleBoard from "./useShuffleBoard";
import useGameLifecycle from "./useGameLifecycle";
import useOnlineRecovery from "./useOnlineRecovery";
import useSoundEffects from "./useSoundEffects";
import useModalState from "./useModalState";
import {
  connectSocket,
  joinCashierRoom,
  requestNextCall,
  cancelNextCall,
} from "../../../services/socket";

export default function useBingoController() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language, translations, toggleLanguage } =
    useContext(LanguageContext);

  /* ------------------------------------------------------------------ *
   *  ONLINE STATUS
   * ------------------------------------------------------------------ */
  const [isOnline, setIsOnline] = useState(() => API.isOnline());
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  /* ------------------------------------------------------------------ *
   *  GAME STATE
   * ------------------------------------------------------------------ */
  const gameState = useGameState({ searchParams, navigate });

  /* ------------------------------------------------------------------ *
   *  INITIAL AUTO-CALL SPEED
   * ------------------------------------------------------------------ */
  const initialSpeed = (() => {
    try {
      return parseInt(localStorage.getItem("bingoAutoCallSpeed")) || 8;
    } catch {
      return 8;
    }
  })();

  /* ------------------------------------------------------------------ *
   *  NUMBER CALLING (core API)
   * ------------------------------------------------------------------ */
  const numberCalling = useNumberCalling(gameState, { speed: initialSpeed });

  // Prevent rapid consecutive NEXT presses from triggering multiple calls
  const nextClickLockRef = useRef(0);

  /* ------------------------------------------------------------------ *
   *  AUTO CALLER – thin wrapper that toggles start/stop
   * ------------------------------------------------------------------ */
  const autoCaller = useAutoCaller({
    ...gameState,
    // Provide no-op starters to avoid double schedulers; useAutoCaller drives timing
    startAutoCall: () => {},
    stopAutoCall: () => {},
    isCallingNumber: numberCalling.isCallingNumber,
    pendingCall: numberCalling.pendingCall,
    generateNextNumber: numberCalling.generateNextNumber,
    callNumber: numberCalling.callNumber,
    callNextFromServer: numberCalling.callNextFromServer,
  });

  // Extract stable references used in effects to satisfy lint deps
  const isAutoCallEnabled = autoCaller?.isAutoCall;
  const isCallInFlight = autoCaller?.isCallInFlight;
  const ackServerCall = autoCaller?.ackServerCall;
  const autoCallSpeed = autoCaller?.speed;

  /* ------------------------------------------------------------------ *
   *  OTHER HOOKS
   * ------------------------------------------------------------------ */
  const cardMgmt = useCardManagement(gameState, numberCalling);
  const jackpot = useJackpot(gameState);
  // Wire shuffle with the specific setters it needs to reset board state safely
  const shuffle = useShuffleBoard({
    setCalledNumbers: gameState.setCalledNumbers,
    setBingoCards: cardMgmt.setBingoCards,
    setCards: cardMgmt.setCards,
  });
  const lifecycle = useGameLifecycle(gameState, jackpot);
  const online = useOnlineRecovery(gameState, numberCalling);
  const sound = useSoundEffects({ language });
  const modals = useModalState();

  const {
    setIsWinnerModalOpen,
    setIsNonWinnerModalOpen,
    setIsInvalidCardModalOpen,
    setIsErrorModalOpen,
    setCallError,
  } = modals;

  /* ------------------------------------------------------------------ *
   *  LOCAL UI STATE (card check flow)
   * ------------------------------------------------------------------ */
  const [cardId, setCardId] = useState("");
  const [bingoStatus, setBingoStatus] = useState(null);
  const [nonWinnerCardData, setNonWinnerCardData] = useState(null);
  const [winnerData, setWinnerData] = useState(null);
  // Stable references used in effects
  const applyCalledNumber = numberCalling.applyCalledNumber;
  const setGameData = gameState.setGameData;

  /* ------------------------------------------------------------------ *
   *  SOCKETS – join cashier room and sync real-time number calls
   * ------------------------------------------------------------------ */
  const getNextTickMs = autoCaller?.getNextTickMs;
  useEffect(() => {
    const userId = gameState.user?.id;
    if (!userId) return;

    const socket = connectSocket();
    try {
      const cashierId = gameState.user?.managedCashier || gameState.user?.id;
      joinCashierRoom(cashierId);
    } catch {
      /* noop */
    }

    const onNumberCalled = (payload) => {
      try {
        // When auto-call is OFF, ignore background auto/forced calls from socket
        // but still allow manual calls (e.g., moderator-triggered or local Next button).
        if (!isAutoCallEnabled) {
          const source = payload?.callSource || payload?.source || null;
          if (source !== "manual") {
            return; // drop auto/forced calls when auto-call is Off
          }
        }

        const called = payload?.calledNumber;
        if (called) {
          // Prefer server-provided epoch schedule if present; fallback to next local tick
          let atMs = null;
          const playAtEpoch = Number(payload?.playAtEpoch);
          if (Number.isFinite(playAtEpoch)) {
            // Convert server epoch to local performance.now-based absolute timestamp
            atMs = performance.now() + Math.max(0, playAtEpoch - Date.now());
          } else {
            // No server schedule provided: play this call immediately (small scheduling skew)
            atMs = performance.now() + 80;
          }
          applyCalledNumber(called, { atMs });
          // Notify auto-caller to advance exactly one tick and schedule next
          if (typeof ackServerCall === "function") {
            try {
              ackServerCall(atMs);
            } catch {
              /* noop */
            }
          }
        }

        if (payload?.game) {
          setGameData((prev) => ({ ...prev, ...payload.game }));
        }
      } catch (e) {
        console.warn("[socket:numberCalled] handler error:", e?.message || e);
      }
    };

    socket.on("numberCalled", onNumberCalled);
    // On (re)connect, if auto-call is enabled and game active, ping server to resume next call
    const onConnect = () => {
      try {
        const gid = gameState.gameData?._id;
        const isBusy = typeof isCallInFlight === "function" && isCallInFlight();
        const isActive = gameState?.gameData?.status === "active";
        if (!gid || !isActive) return;
        if (!isAutoCallEnabled) {
          // Ensure no deferred calls fire if user kept auto OFF
          cancelNextCall(gid);
        } else if (!isBusy) {
          // When auto ON and not busy, let server schedule the next tick at a near-future time
          const playAtEpoch = Date.now() + 1500;
          const intervalMs = Math.max(500, (autoCallSpeed || 8) * 1000);
          requestNextCall({
            gameId: gid,
            playAtEpoch,
            minIntervalMs: intervalMs,
          });
        }
      } catch {
        /* noop */
      }
    };
    socket.on("connect", onConnect);
    return () => {
      socket.off("numberCalled", onNumberCalled);
      socket.off("connect", onConnect);
    };
  }, [
    gameState.user?.id,
    gameState.user?.managedCashier,
    gameState.gameData?._id,
    gameState.gameData?.status,
    applyCalledNumber,
    setGameData,
    getNextTickMs,
    isAutoCallEnabled,
    gameState?.isPlaying,
    isCallInFlight,
    ackServerCall,
    autoCallSpeed,
  ]);

  /* ------------------------------------------------------------------ *
   *  CHECK CARD – fully async, returns true/false
   * ------------------------------------------------------------------ */
  const handleCheckCard = useCallback(
    async (rawCardId = null, preferredPattern = undefined) => {
      // Abort any in-flight check to keep only the latest request relevant
      if (!handleCheckCard.abortRef) {
        handleCheckCard.abortRef = { controller: null };
      }
      try {
        handleCheckCard.abortRef.controller?.abort?.();
      } catch {
        // ignore
      }
      const controller = new AbortController();
      handleCheckCard.abortRef.controller = controller;

      const normalized = `${rawCardId ?? cardId ?? ""}`.trim();
      if (!normalized) {
        setCallError("Please enter a card ID to check.");
        setIsErrorModalOpen(true);
        return false;
      }

      if (!gameState.gameData?._id) {
        setCallError("Game is not ready yet. Select an active game first.");
        setIsErrorModalOpen(true);
        return false;
      }

      // Reset UI
      setCardId(normalized);
      setCallError(null);
      setIsErrorModalOpen(false);
      setIsInvalidCardModalOpen(false);
      setIsWinnerModalOpen(false);
      setIsNonWinnerModalOpen(false);
      setNonWinnerCardData(null);
      setWinnerData(null);
      setBingoStatus(null);

      try {
        const result = await gameService.checkBingo(
          gameState.gameData._id,
          normalized,
          preferredPattern,
          { signal: controller.signal, retries: 1, timeout: 6000 }
        );

        // Update game state if the server sent fresh data
        if (result?.game) {
          gameState.setGameData((prev) => ({ ...prev, ...result.game }));
        }

        const winner = Array.isArray(result?.winners)
          ? result.winners[0]
          : null;

        /* ---------- Resolve card numbers fast (no extra fetch) ---------- */
        // Convert a flat 25 row-major array (5 rows x 5 cols) into {B,I,N,G,O} columns
        const normalizeFlat = (flat) => {
          const panel = { B: [], I: [], N: [], G: [], O: [] };
          ["B", "I", "N", "G", "O"].forEach((letter, col) => {
            const colVals = [];
            for (let row = 0; row < 5; row++) {
              const v = flat[row * 5 + col];
              if (v === "FREE" || v === null) colVals.push("FREE");
              else {
                const n = Number(v);
                colVals.push(Number.isFinite(n) ? n : v);
              }
            }
            panel[letter] = colVals;
          });
          if (panel.N && panel.N.length >= 3) panel.N[2] = "FREE";
          return panel;
        };

        let resolvedCardNumbers = winner?.numbers || null;

        const extract = (cards) =>
          Array.isArray(cards)
            ? cards.find((c) => String(c.id) === normalized)?.numbers || null
            : null;

        if (!resolvedCardNumbers) resolvedCardNumbers = extract(cardMgmt.cards);
        if (
          !resolvedCardNumbers &&
          Array.isArray(result?.card) &&
          result.card.length === 25
        ) {
          resolvedCardNumbers = normalizeFlat(result.card);
        }
        // Avoid extra network fetches to keep check fast

        /* --------------------- WINNER --------------------- */
        if (result?.isBingo && winner && !winner.disqualified) {
          setWinnerData(winner);
          setBingoStatus({
            pattern: winner.winningPattern || result?.winningPattern || null,
            winnerCardNumbers: resolvedCardNumbers,
            winningNumbers: result?.winningNumbers || [],
            winningIndices: result?.winningIndices || [],
            completingNumber: winner?.completingNumber ?? null,
            prize:
              result?.game?.prizePool || gameState.gameData?.prizePool || null,
            lateCall: !!winner?.lateCall,
            disqualified: !!winner?.disqualified,
          });

          setIsWinnerModalOpen(true);
          autoCaller.stopAutoCall(); // stop auto-call
          numberCalling.stopAutoCall(); // ensure timer cleared
          gameState.setIsPlaying(false);
          if (result?.gameStatus === "completed") {
            gameState.setIsGameOver(true);
          }
          return true;
        }

        /* --------------------- LATE CALL --------------------- */
        if (winner?.lateCall) {
          const fallback =
            resolvedCardNumbers ||
            (result.card?.length === 25 ? normalizeFlat(result.card) : null);

          setNonWinnerCardData({
            cardId: normalized,
            lateCall: true,
            lateCallMessage: winner?.lateCallMessage || result?.message || null,
            cardNumbers: fallback,
            pattern:
              winner?.winningPattern || gameState.gameData?.pattern || null,
            wouldHaveWon: {
              pattern: winner?.winningPattern || null,
              completingNumber: winner?.completingNumber || null,
              callIndex: winner?.callIndex || null,
            },
            patternInfo: result?.patternInfo || null,
          });
          setIsNonWinnerModalOpen(true);
          return false;
        }

        /* --------------------- NO BINGO --------------------- */
        const fallback =
          resolvedCardNumbers ||
          (result.card?.length === 25 ? normalizeFlat(result.card) : null);

        // Client-side late-call fallback: infer if the last call wasn't the completing number
        // Build a row-major grid [r][c] from the panel {B,I,N,G,O}
        const inferRowGrid = (card) => {
          if (!card) return null;
          if (Array.isArray(card) && Array.isArray(card[0])) return card;
          if (card && card.B && card.I && card.N && card.G && card.O) {
            const letters = ["B", "I", "N", "G", "O"];
            const grid = Array.from({ length: 5 }, (_, r) =>
              Array.from({ length: 5 }, (_, c) => card[letters[c]][r])
            );
            grid[2][2] = "FREE";
            return grid;
          }
          return null;
        };

        const grid = inferRowGrid(fallback);
        const called = Array.isArray(gameState?.calledNumbers)
          ? gameState.calledNumbers.map(Number)
          : [];

        const detectLocalLate = (grid, called) => {
          if (!grid || grid.length !== 5 || called.length === 0) return null;
          const isMarked = (v) => v === "FREE" || called.includes(Number(v));
          const lastIdx = called.length - 1;

          const buildInfo = (indices) => {
            const nums = indices
              .map((i) => grid[Math.floor(i / 5)][i % 5])
              .filter((v) => v !== "FREE");
            const pos = nums.map((n) => called.indexOf(Number(n)));
            if (pos.some((p) => p < 0)) return null; // some numbers never called
            const completingPos = Math.max(...pos);
            const completingNumber = called[completingPos];
            const isLate = completingPos < lastIdx;
            return { isLate, completingNumber };
          };

          // Rows
          for (let r = 0; r < 5; r++) {
            const ok = [0, 1, 2, 3, 4].every((c) => isMarked(grid[r][c]));
            if (ok) {
              const indices = [0, 1, 2, 3, 4].map((c) => r * 5 + c);
              const info = buildInfo(indices);
              if (info && info.isLate) {
                return {
                  pattern: "horizontal_line",
                  selectedIndices: indices,
                  rowIndex: r,
                  colIndex: null,
                  completingNumber: info.completingNumber,
                };
              }
            }
          }
          // Cols
          for (let c = 0; c < 5; c++) {
            const ok = [0, 1, 2, 3, 4].every((r) => isMarked(grid[r][c]));
            if (ok) {
              const indices = [0, 1, 2, 3, 4].map((r) => r * 5 + c);
              const info = buildInfo(indices);
              if (info && info.isLate) {
                return {
                  pattern: "vertical_line",
                  selectedIndices: indices,
                  rowIndex: null,
                  colIndex: c,
                  completingNumber: info.completingNumber,
                };
              }
            }
          }
          // Main diagonal
          if ([0, 1, 2, 3, 4].every((i) => isMarked(grid[i][i]))) {
            const indices = [0, 6, 12, 18, 24];
            const info = buildInfo(indices);
            if (info && info.isLate) {
              return {
                pattern: "main_diagonal",
                selectedIndices: indices,
                rowIndex: null,
                colIndex: null,
                completingNumber: info.completingNumber,
              };
            }
          }
          // Other diagonal
          if ([0, 1, 2, 3, 4].every((i) => isMarked(grid[i][4 - i]))) {
            const indices = [4, 8, 12, 16, 20];
            const info = buildInfo(indices);
            if (info && info.isLate) {
              return {
                pattern: "other_diagonal",
                selectedIndices: indices,
                rowIndex: null,
                colIndex: null,
                completingNumber: info.completingNumber,
              };
            }
          }
          // Four corners + center
          const corners = [0, 4, 20, 24, 12];
          const allMarked = corners.every((idx) =>
            isMarked(grid[Math.floor(idx / 5)][idx % 5])
          );
          if (allMarked) {
            const info = buildInfo(corners);
            if (info && info.isLate) {
              return {
                pattern: "four_corners_center",
                selectedIndices: corners,
                rowIndex: null,
                colIndex: null,
                completingNumber: info.completingNumber,
              };
            }
          }
          return null;
        };

        const localLate = detectLocalLate(grid, called);
        if (localLate) {
          setNonWinnerCardData({
            cardId: normalized,
            lateCall: true,
            lateCallMessage:
              result?.message || "Late call detected (client fallback)",
            cardNumbers: fallback,
            pattern: localLate.pattern,
            wouldHaveWon: {
              pattern: localLate.pattern,
              completingNumber: localLate.completingNumber,
              callIndex: null,
            },
            patternInfo: {
              selectedIndices: localLate.selectedIndices,
              rowIndex: localLate.rowIndex,
              colIndex: localLate.colIndex,
            },
          });
          setIsNonWinnerModalOpen(true);
          return false;
        }

        // Default: not winner
        setNonWinnerCardData({
          cardId: normalized,
          lateCall: false,
          cardNumbers: fallback,
          pattern:
            winner?.winningPattern || gameState.gameData?.pattern || null,
          patternInfo: result?.patternInfo || null,
        });
        setIsNonWinnerModalOpen(true);
        return false;
      } catch (error) {
        const msg =
          error?.response?.data?.message ||
          error?.message ||
          "Failed to check card.";
        setCallError(msg);

        if (error?.response?.status === 404 || /card not found/i.test(msg)) {
          setIsInvalidCardModalOpen(true);
        } else {
          setIsErrorModalOpen(true);
        }
        return false;
      }
    },
    [
      cardId,
      gameState,
      cardMgmt,
      autoCaller,
      numberCalling,
      setCallError,
      setIsErrorModalOpen,
      setIsInvalidCardModalOpen,
      setIsWinnerModalOpen,
      setIsNonWinnerModalOpen,
    ]
  );

  /* ------------------------------------------------------------------ *
   *  NEXT BUTTON – manual next call even when paused
   * ------------------------------------------------------------------ */
  const handleNextClick = useCallback(async () => {
    // If we're within the lock window, ignore this press
    const now = performance.now();
    if (now < nextClickLockRef.current) return false;

    // Always prefer server-decided next number and request immediate call
    if (typeof numberCalling.callNextFromServer === "function") {
      const cushion = 120; // ms
      const atMs = performance.now() + cushion;
      const playAtEpoch = Date.now() + cushion;

      // Lock until shortly after the scheduled playback time to avoid double calls while "calling"
      const lockBuffer = 400; // ms after playback start
      nextClickLockRef.current = atMs + lockBuffer;

      const ok = await numberCalling.callNextFromServer({
        overridePlaying: true,
        atMs,
        minIntervalMs: 50,
        playAtEpoch,
        playNow: true, // bypass server min-interval
        manual: true, // treat as manual even if no explicit number sent
      });

      // If it failed, release the lock early so the user can retry
      if (!ok) {
        nextClickLockRef.current = performance.now();
      }

      if (ok) return true;
    }
    // If server declined, do not fall back to client-generated numbers to keep authority on server
    return false;
  }, [numberCalling]);

  // NOTE: Auto-calling cadence is driven exclusively by useAutoCaller.
  // We intentionally do not start the internal numberCalling scheduler here
  // to avoid duplicate timers and background calls when toggled off.

  /* ------------------------------------------------------------------ *
   *  PUBLIC API
   * ------------------------------------------------------------------ */
  return {
    navigate,
    searchParams,
    language,
    translations,
    toggleLanguage,
    isOnline,

    // Game state
    ...gameState,

    // Auto caller
    ...autoCaller,
    toggleAutoCall: autoCaller.toggleAutoCall,

    // Number calling
    ...numberCalling,
    handleCallNumber: numberCalling.handleCallNumber, // returns Promise<boolean>
    handleNextClick,

    // Cards
    ...cardMgmt,

    // Jackpot & others
    ...jackpot,
    ...shuffle,
    ...lifecycle,
    ...online,
    ...sound,
    ...modals,

    // Card-check UI
    cardId,
    setCardId,
    bingoStatus,
    setBingoStatus,
    nonWinnerCardData,
    setNonWinnerCardData,
    winnerData,
    setWinnerData,
    handleCheckCard,
  };
}
