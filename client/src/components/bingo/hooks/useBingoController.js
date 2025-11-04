// src/components/bingo/hooks/useBingoController.js
import { useContext, useEffect, useState, useCallback } from "react";
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

  /* ------------------------------------------------------------------ *
   *  OTHER HOOKS
   * ------------------------------------------------------------------ */
  const cardMgmt = useCardManagement(gameState, numberCalling);
  const jackpot = useJackpot(gameState);
  const shuffle = useShuffleBoard(gameState);
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

  /* ------------------------------------------------------------------ *
   *  CHECK CARD – fully async, returns true/false
   * ------------------------------------------------------------------ */
  const handleCheckCard = useCallback(
    async (rawCardId = null, preferredPattern = undefined) => {
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
          preferredPattern
        );

        // Update game state if the server sent fresh data
        if (result?.game) {
          gameState.setGameData((prev) => ({ ...prev, ...result.game }));
        }

        const winner = Array.isArray(result?.winners)
          ? result.winners[0]
          : null;

        /* ---------- Resolve card numbers (fallback chain) ---------- */
        let resolvedCardNumbers = winner?.numbers || null;

        const extract = (cards) =>
          Array.isArray(cards)
            ? cards.find((c) => String(c.id) === normalized)?.numbers || null
            : null;

        if (!resolvedCardNumbers) resolvedCardNumbers = extract(cardMgmt.cards);
        if (!resolvedCardNumbers) {
          const refreshed = await cardMgmt.fetchBingoCards();
          resolvedCardNumbers = extract(refreshed);
        }

        const normalizeFlat = (flat) => {
          const panel = { B: [], I: [], N: [], G: [], O: [] };
          ["B", "I", "N", "G", "O"].forEach((letter, col) => {
            panel[letter] = flat.slice(col * 5, col * 5 + 5).map((v, row) => {
              if (v === "FREE" || v === null) return "FREE";
              const n = Number(v);
              return Number.isFinite(n)
                ? n
                : col === 2 && row === 2
                ? "FREE"
                : v;
            });
          });
          return panel;
        };

        if (
          !resolvedCardNumbers &&
          Array.isArray(result?.card) &&
          result.card.length === 25
        ) {
          resolvedCardNumbers = normalizeFlat(result.card);
        }

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
