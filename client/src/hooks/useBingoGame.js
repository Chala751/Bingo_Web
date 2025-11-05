import { useState, useCallback, useRef, useEffect } from "react";
import gameService from "../services/game";

export const useBingoGame = () => {
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const [bingoStatus, setBingoStatus] = useState(null);

  // Track latest request sequence per action to avoid out-of-order state writes
  const seqRef = useRef({
    fetchGame: 0,
    callNumber: 0,
    checkBingo: 0,
    selectWinner: 0,
    finishGame: 0,
  });

  // Keep AbortControllers per action; abort previous when a new request starts
  const controllersRef = useRef({
    fetchGame: null,
    callNumber: null,
    checkBingo: null,
    selectWinner: null,
    finishGame: null,
  });

  const startAction = (key) => {
    // increment sequence and create/replace controller
    seqRef.current[key] += 1;
    if (controllersRef.current[key]) {
      try {
        controllersRef.current[key].abort();
      } catch {
        // ignore
      }
    }
    const controller = new AbortController();
    controllersRef.current[key] = controller;
    return { seq: seqRef.current[key], signal: controller.signal };
  };

  // On unmount, abort all in-flight requests to avoid late state updates
  useEffect(() => {
    const currentControllers = controllersRef.current;
    return () => {
      Object.values(currentControllers).forEach((c) => {
        try {
          c && c.abort();
        } catch {
          // ignore
        }
      });
    };
  }, []);

  const fetchGame = useCallback(async (id) => {
    if (!id) {
      setError("Invalid game ID");
      throw new Error("Invalid game ID");
    }
    try {
      const { seq, signal } = startAction("fetchGame");
      const response = await gameService.getGame(id, { signal });
      if (!response) {
        throw new Error("No game data returned");
      }
      // Only update state if this is the latest request for this action
      if (seq === seqRef.current.fetchGame) {
        setGame(response);
        setError(null);
      }
      return response;
    } catch (error) {
      const isCanceled =
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        /aborted|canceled/i.test(error?.message || "");
      if (isCanceled) {
        // Swallow cancellation to avoid noisy errors during rapid updates
        throw error;
      }
      const errorMessage =
        error.response?.data?.error || error.message || "Failed to fetch game";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  const callNumber = useCallback(async (gameId, data = {}) => {
    if (!gameId) {
      setError("Invalid game ID");
      throw new Error("Invalid game ID");
    }
    try {
      // Ensure only the latest callNumber can update state; cancel prior in-flight
      const { seq, signal } = startAction("callNumber");
      // Forward AbortSignal and control flags; prefer internal signal to guard race
      const response = await gameService.callNumber(gameId, data.number, {
        signal,
        requestId: data?.requestId,
        enforce: data?.enforce === true,
        minIntervalMs: data?.minIntervalMs,
        playAtEpoch: data?.playAtEpoch,
      });
      if (!response || !response.game) {
        throw new Error("No game data in response from call number");
      }
      if (seq === seqRef.current.callNumber) {
        setGame(response.game);
        setError(null);
      }
      return response;
    } catch (error) {
      // Preserve original error so callers can detect abort/cancel (e.g. ERR_CANCELED)
      const isCanceled =
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        /aborted|canceled/i.test(error?.message || "");
      if (isCanceled) {
        throw error;
      }
      const errorMessage =
        error.response?.data?.error || error.message || "Failed to call number";
      setError(errorMessage);
      throw error; // rethrow original error (do not wrap)
    }
  }, []);

  const checkBingo = useCallback(
    async (gameId, cardId, preferredPattern = null) => {
      if (!gameId || !cardId) {
        const errorMessage = "Invalid game ID or card ID";
        setError(errorMessage);
        throw new Error(errorMessage);
      }
      try {
        const { seq } = startAction("checkBingo");
        const response = await gameService.checkBingo(
          gameId,
          cardId,
          preferredPattern
        );
        console.log(`[useBingoGame.checkBingo] Response:`, {
          isBingo: response.isBingo,
          winningPattern: response.winningPattern,
          validBingoPatterns: response.validBingoPatterns,
          winner: response.winner,
          previousWinner: response.previousWinner,
          game: response.game,
        });
        if (!response || !response.game) {
          throw new Error("No game data in response from check bingo");
        }
        if (seq === seqRef.current.checkBingo) {
          setGame(response.game);
          setBingoStatus({
            isBingo: response.isBingo,
            winningPattern: response.winningPattern,
            validBingoPatterns: response.validBingoPatterns,
            winner: response.winner,
            previousWinner: response.previousWinner,
          });
          setError(null);
        }
        return response;
      } catch (error) {
        const errorMessage =
          error.response?.data?.error ||
          error.message ||
          "Failed to check bingo";
        console.error(`[useBingoGame.checkBingo] Error:`, {
          message: errorMessage,
          response: error.response?.data,
          status: error.response?.status,
        });
        setError(errorMessage);
        setBingoStatus(null);
        throw new Error(errorMessage);
      }
    },
    []
  );

  const selectWinner = useCallback(async (gameId, data) => {
    if (!gameId) {
      setError("Invalid game ID");
      throw new Error("Invalid game ID");
    }
    try {
      const { seq } = startAction("selectWinner");
      const response = await gameService.selectWinner(gameId, data);
      if (!response || !response.game) {
        throw new Error("No game data in response from select winner");
      }
      if (seq === seqRef.current.selectWinner) {
        setGame(response.game);
        setError(null);
      }
      return response;
    } catch (error) {
      const errorMessage =
        error.response?.data?.error ||
        error.message ||
        "Failed to select winner";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  const finishGame = useCallback(async (gameId) => {
    if (!gameId) {
      setError("Invalid game ID");
      throw new Error("Invalid game ID");
    }
    try {
      const { seq } = startAction("finishGame");
      const response = await gameService.finishGame(gameId);
      console.log("useBingoGame.finishGame response:", response);
      if (!response) {
        throw new Error("No response data from finish game");
      }
      const gameData = response.game || response;
      if (!gameData || !gameData._id) {
        throw new Error("No valid game data in response from finish game");
      }
      if (seq === seqRef.current.finishGame) {
        setGame(gameData);
        setError(null);
      }
      return { game: gameData };
    } catch (error) {
      const errorMessage =
        error.response?.data?.error || error.message || "Failed to finish game";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  }, []);

  return {
    game,
    fetchGame,
    callNumber,
    checkBingo,
    selectWinner,
    finishGame,
    error,
    bingoStatus,
  };
};
