import { useState, useCallback } from "react";
import gameService from "../services/game";

export const useBingoGame = () => {
  const [game, setGame] = useState(null);
  const [error, setError] = useState(null);
  const [bingoStatus, setBingoStatus] = useState(null);

  const fetchGame = useCallback(async (id) => {
    if (!id) {
      setError("Invalid game ID");
      throw new Error("Invalid game ID");
    }
    try {
      const response = await gameService.getGame(id);
      if (!response) {
        throw new Error("No game data returned");
      }
      setGame(response);
      setError(null);
      return response;
    } catch (error) {
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
      // Forward optional AbortSignal and control flags to the service so callers can cancel and enforce
      const response = await gameService.callNumber(gameId, data.number, {
        signal: data?.signal,
        requestId: data?.requestId,
        enforce: data?.enforce === true,
      });
      if (!response || !response.game) {
        throw new Error("No game data in response from call number");
      }
      setGame(response.game);
      setError(null);
      return response;
    } catch (error) {
      // Preserve original error so callers can detect abort/cancel (e.g. ERR_CANCELED)
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
        setGame(response.game);
        setBingoStatus({
          isBingo: response.isBingo,
          winningPattern: response.winningPattern,
          validBingoPatterns: response.validBingoPatterns,
          winner: response.winner,
          previousWinner: response.previousWinner,
        });
        setError(null);
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
      const response = await gameService.selectWinner(gameId, data);
      if (!response || !response.game) {
        throw new Error("No game data in response from select winner");
      }
      setGame(response.game);
      setError(null);
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
      const response = await gameService.finishGame(gameId);
      console.log("useBingoGame.finishGame response:", response);
      if (!response) {
        throw new Error("No response data from finish game");
      }
      const gameData = response.game || response;
      if (!gameData || !gameData._id) {
        throw new Error("No valid game data in response from finish game");
      }
      setGame(gameData);
      setError(null);
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
