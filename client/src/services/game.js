import API from "./axios";

const gameService = {
  createGame: async (data) => {
    try {
      // ✅ Map to sequential format for single game (count: 1)
      const sequentialData = {
        ...data,
        count: 1, // Always create single game
      };
      console.log(
        "gameService.createGame - Using sequential endpoint with data:",
        JSON.stringify(sequentialData, null, 2)
      );
      const response = await API.post("/games/sequential", sequentialData);
      console.log("gameService.createGame raw response:", response.data);

      // ✅ Extract the first game from data array
      const gamesArray = response.data.data || [];
      if (!Array.isArray(gamesArray) || gamesArray.length === 0) {
        throw new Error("No games created in response");
      }

      const game = gamesArray[0]; // Single game from array
      console.log("gameService.createGame - Extracted game:", game);
      return game; // Return the game object directly (not wrapped)
    } catch (error) {
      console.error(
        "gameService.createGame error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  getGame: async (id) => {
    try {
      if (!id) throw new Error("Game ID is required");
      console.log("gameService.getGame - Fetching game ID:", id);
      const response = await API.get(`/games/${id}`);
      console.log("gameService.getGame response:", response.data);
      if (!response.data.game) {
        throw new Error("No game data returned");
      }
      return response.data.game;
    } catch (error) {
      console.error(
        "gameService.getGame error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  getAllGames: async () => {
    try {
      console.log("gameService.getAllGames - Fetching all games");
      const response = await API.get("/games");
      return response.data.games;
    } catch (error) {
      console.error(
        "gameService.getAllGames error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  getNextPendingGame: async () => {
    try {
      console.log(
        "gameService.getNextPendingGame - Fetching next pending game"
      );
      const response = await API.get("/games/next-pending");
      return response.data.game;
    } catch (error) {
      console.error(
        "gameService.getNextPendingGame error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  getAllCards: async () => {
    try {
      console.log("gameService.getAllCards - Fetching all cards");
      const response = await API.get("/games/cards");
      console.log("gameService.getAllCards response:", response.data.data);
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.getAllCards error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  // ✅ FIXED: Enhanced validation and debugging for callNumber
  callNumber: async (gameId, number, signal) => {
    try {
      // ✅ Enhanced validation with detailed logging
      console.log(`[gameService.callNumber] Input validation:`, {
        gameId,
        number,
        gameIdType: typeof gameId,
        numberType: typeof number,
        numberValue: number,
      });

      // ✅ Validate gameId
      if (!gameId) {
        throw new Error("Game ID is required");
      }
      if (typeof gameId !== "string" || gameId.length !== 24) {
        throw new Error(`Invalid game ID format: ${gameId}`);
      }

      // ✅ Validate number with detailed checks
      if (number === null || number === undefined) {
        console.error(
          "[gameService.callNumber] Number is null/undefined:",
          number
        );
        throw new Error("Number cannot be null or undefined");
      }

      const parsedNumber = Number(number);
      console.log("[gameService.callNumber] Parsed number:", {
        original: number,
        parsed: parsedNumber,
        isNaN: isNaN(parsedNumber),
      });

      if (isNaN(parsedNumber)) {
        throw new Error(`Invalid number format: ${number} (parsed as NaN)`);
      }

      if (parsedNumber < 1 || parsedNumber > 75) {
        throw new Error(
          `Number must be between 1 and 75, got: ${parsedNumber}`
        );
      }

      if (!Number.isInteger(parsedNumber)) {
        throw new Error(`Number must be an integer, got: ${parsedNumber}`);
      }

      console.log(
        `[gameService.callNumber] Validated - Calling number ${parsedNumber} for game ${gameId}`
      );

      // Pass abort signal through axios config so the request can be cancelled
      // Use requestWithRetry if available to survive transient network issues
      const requestConfig = {
        method: "post",
        url: `/games/${gameId}/call-number`,
        data: { number: parsedNumber },
      };
      const retryOptions = {
        retries: 2,
        backoff: 300,
        timeout: 10000,
        signal,
      };
      let response;
      if (API.requestWithRetry) {
        response = await API.requestWithRetry(requestConfig, retryOptions);
      } else {
        response = await API.post(
          `/games/${gameId}/call-number`,
          { number: parsedNumber },
          signal ? { signal } : undefined
        );
      }

      console.log("[gameService.callNumber] Success response:", {
        message: response.data.message,
        gameId: response.data.game?._id,
        calledNumber:
          response.data.game?.calledNumbers?.[
            response.data.game.calledNumbers.length - 1
          ],
        status: response.data.game?.status,
      });

      // The backend returns: { message, game, calledNumber, callType }
      // Return the full response data so the component can access all fields
      return response.data;
    } catch (error) {
      // Check if the request was canceled (aborted).
      // Different axios/browser combinations may surface this as
      // error.code, error.name or simply error.message === 'canceled'
      const msg = (error && error.message) || "";
      const isCanceled =
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        (typeof msg === "string" && msg.toLowerCase().includes("cancel")) ||
        (typeof msg === "string" && msg.toLowerCase().includes("aborted"));

      if (isCanceled) {
        // Don't treat canceled/aborted requests as errors — they're expected
        // when the UI intentionally aborts an in-flight call (e.g. toggling
        // auto-call off). Log at debug level and rethrow the original error
        // so upstream callers that inspect `error.code` can detect it.
        console.log(
          `[gameService.callNumber] Request canceled for game ${gameId}, number ${Number(
            number
          )}`
        );
        throw error; // rethrow to allow caller to handle/ignore
      }

      console.error(
        "[gameService.callNumber] Detailed error:",
        JSON.stringify(
          {
            message: error.message,
            gameId,
            number,
            parsedNumber: Number(number),
            response: error.response?.data,
            status: error.response?.status,
            config: error.config?.url,
          },
          null,
          2
        )
      );
      throw error;
    }
  },

  // ✅ UPDATED: Support preferredPattern and enhanced logging for completed games
  checkBingo: async (gameId, cardId, preferredPattern = null) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      if (!cardId || isNaN(cardId))
        throw new Error("Valid card ID is required");

      console.log(`[gameService.checkBingo] Input validation:`, {
        gameId,
        cardId: Number(cardId),
        preferredPattern,
        gameIdType: typeof gameId,
        cardIdType: typeof cardId,
      });

      // Prepare request body
      const requestBody = {
        cardId: Number(cardId),
      };
      if (preferredPattern) {
        requestBody.preferredPattern = preferredPattern;
      }

      console.log(
        `[gameService.checkBingo] Calling API with body:`,
        JSON.stringify(requestBody, null, 2)
      );

      const response = await API.post(
        `/games/${gameId}/check-bingo`,
        requestBody
      );

      console.log(`[gameService.checkBingo] Success response:`, {
        isBingo: response.data.isBingo,
        winningPattern: response.data.winningPattern,
        validBingoPatterns: response.data.validBingoPatterns,
        winner: response.data.winner,
        previousWinner: response.data.previousWinner,
        gameStatus: response.data.game?.status,
      });

      // Return response.data directly (includes isBingo, winningPattern, winner, previousWinner, etc.)
      // This supports checks for completed games without modification
      return response.data;
    } catch (error) {
      console.error(
        "[gameService.checkBingo] Detailed error:",
        JSON.stringify(
          {
            message: error.message,
            gameId,
            cardId,
            preferredPattern,
            response: error.response?.data,
            status: error.response?.status,
            config: error.config?.url,
          },
          null,
          2
        )
      );
      throw error;
    }
  },

  selectWinner: async (gameId, data) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      console.log(
        `gameService.selectWinner - Selecting winner for game ${gameId}`
      );
      const response = await API.post(`/games/${gameId}/select-winner`, data);
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.selectWinner error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  selectJackpotWinner: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      console.log(
        `gameService.selectJackpotWinner - Selecting jackpot winner for game ${gameId}`
      );
      const response = await API.post(`/games/${gameId}/select-jackpot-winner`);
      console.log("gameService.selectJackpotWinner response:", response);
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.selectJackpotWinner error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },
  pauseGame: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");

      console.log(`gameService.pauseGame - Pausing game ${gameId}`);

      const response = await API.post(`/games/${gameId}/pause`);
      console.log("gameService.pauseGame response:", response.data);

      return response.data;
    } catch (error) {
      console.error(
        "gameService.pauseGame error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  finishGame: async (gameId, moderatorCardId = null) => {
    if (!gameId) throw new Error("Game ID is required");

    console.log(
      `gameService.finishGame - Finishing game ${gameId}, moderatorCardId: ${moderatorCardId}`
    );

    try {
      const response = await API.post(`/games/${gameId}/finish`, {
        moderatorCardId,
      });

      // Log full response safely
      console.log(
        "gameService.finishGame full response:",
        response?.data ? JSON.stringify(response.data, null, 2) : response
      );

      // Return game object directly
      return response.data?.game || null;
    } catch (error) {
      // Safely handle errors whether JSON exists or not
      const errData = error.response?.data || {
        message: error.message || "Unknown error",
      };

      console.error(
        "gameService.finishGame error:",
        JSON.stringify(errData, null, 2)
      );

      // Throw a more structured error for the UI
      throw new Error(errData.message || "Failed to finish game");
    }
  },

  startGame: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      if (typeof gameId !== "string" || !/^[0-9a-fA-F]{24}$/.test(gameId)) {
        throw new Error("Invalid game ID format");
      }
      console.log("gameService.startGame - Starting game with ID:", gameId);
      const response = await API.post(`/games/${gameId}/start`);
      console.log("gameService.startGame response:", response.data);
      // Adjusted to return response.data directly, as per backend response structure
      // (e.g., { message: "Game X started successfully", status: "active" } or full game object)
      return response.data;
    } catch (error) {
      console.error(
        "gameService.startGame error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  updateGame: async (gameId, data) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      console.log(
        `gameService.updateGame - Updating game ${gameId} with data:`,
        JSON.stringify(data, null, 2)
      );
      const response = await API.patch(`/games/${gameId}`, data);
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.updateGame error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  // ✅ FIXED: Route matches your backend - /jackpot (no /games/)
  getJackpot: async (cashierId) => {
    try {
      if (!cashierId) throw new Error("Cashier ID is required");
      console.log(
        "gameService.getJackpot - Fetching jackpot for cashierId:",
        cashierId
      );
      // FIXED: Removed /games/ prefix - your route is just /jackpot
      const response = await API.get(`/games/jackpot?cashierId=${cashierId}`);
      console.log(
        "gameService.getJackpot response:",
        JSON.stringify(response.data, null, 2)
      );
      // Handle both response.data.data and response.data formats
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "gameService.getJackpot error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  // ✅ FIXED: Route matches your backend - /jackpot/contribute (with 'e')
  addJackpotContribution: async (gameId, contributionAmount) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      if (!contributionAmount || contributionAmount <= 0)
        throw new Error("Valid contribution amount required");

      console.log(
        `gameService.addJackpotContribution - Adding ${contributionAmount} for game ${gameId}`
      );
      // FIXED: Route should be /jackpot/contribute (with 'e') to match your backend
      const response = await API.post("/games/jackpot/contribute", {
        contributionAmount,
        gameId,
      });

      console.log(
        "gameService.addJackpotContribution response:",
        JSON.stringify(response.data, null, 2)
      );
      // Handle both response.data.data and response.data formats
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "gameService.addJackpotContribution error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  // ✅ This one already matches your route - /jackpot
  updateJackpot: async (amount) => {
    try {
      if (typeof amount !== "number" || amount < 0)
        throw new Error("Valid amount required");

      console.log(`gameService.updateJackpot - Updating to ${amount}`);
      // Route already correct: PATCH /jackpot
      const response = await API.patch("/games/jackpot", { amount });

      console.log(
        "gameService.updateJackpot response:",
        JSON.stringify(response.data, null, 2)
      );
      // Handle both response.data.data and response.data formats
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "gameService.updateJackpot error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  resetGameCounter: async () => {
    try {
      console.log("gameService.resetGameCounter - Resetting counter");
      const response = await API.post("/games/reset-game-counter");
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.resetGameCounter error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  createSequentialGames: async (data) => {
    try {
      console.log(
        "gameService.createSequentialGames - Creating sequential games:",
        JSON.stringify(data, null, 2)
      );

      const response = await API.post("/games/sequential", data);
      console.log(
        "gameService.createSequentialGames raw response:",
        response.data
      );

      // Handle backend returning { game: {...} } or { data: [ ... ] }
      let gamesArray = [];
      if (Array.isArray(response.data.data)) {
        gamesArray = response.data.data;
      } else if (response.data.game) {
        gamesArray = [response.data.game];
      }

      if (!gamesArray.length) {
        throw new Error("No games created in response");
      }

      // Return array of games
      console.log(
        "gameService.createSequentialGames - Extracted games:",
        gamesArray
      );
      return gamesArray;
    } catch (error) {
      console.error(
        "gameService.createSequentialGames error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  configureFutureWinners: async (winners) => {
    try {
      console.log(
        "gameService.configureFutureWinners - Configuring winners:",
        JSON.stringify({ winners }, null, 2)
      );
      const response = await API.post("/games/configure-future-winners", {
        winners,
      });
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.configureFutureWinners error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  configureNextGameNumber: async (startNumber) => {
    try {
      console.log(
        "gameService.configureNextGameNumber - Configuring next number:",
        startNumber
      );
      const response = await API.post("/games/configure-next", { startNumber });
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.configureNextGameNumber error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  createFutureGames: async (data) => {
    try {
      console.log(
        "gameService.createFutureGames - Creating future games:",
        JSON.stringify(data, null, 2)
      );
      const response = await API.post("/games/future", data);
      return response.data.data;
    } catch (error) {
      console.error(
        "gameService.createFutureGames error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  getCashierReport: async (cashierId, filters = {}) => {
    try {
      if (!cashierId) throw new Error("Cashier ID is required");
      console.log(
        "gameService.getCashierReport - Fetching cashier report for cashierId:",
        cashierId,
        "with filters:",
        filters
      );
      // Build query params including filters
      const params = new URLSearchParams({ cashierId });
      Object.entries(filters).forEach(([key, value]) => {
        if (value) {
          params.append(key, value);
        }
      });
      const response = await API.get(`/games/report?${params.toString()}`);
      console.log("gameService.getCashierReport response:", response.data);
      return response.data;
    } catch (error) {
      console.error(
        "gameService.getCashierReport error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },

  updateGameStatus: async (gameId, status) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      console.log(
        `gameService.updateGameStatus - Updating game ${gameId} to status: ${status}`
      );
      const response = await API.put(`/games/${gameId}/status`, { status });
      console.log("gameService.updateGameStatus response:", response.data);
      return response.data.game;
    } catch (error) {
      console.error(
        "gameService.updateGameStatus error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },
  // game.js
  getJackpotStatus: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      console.log(
        "gameService.getJackpotStatus - Fetching status for game:",
        gameId
      );
      const response = await API.get(`/games/${gameId}/jackpot-status`);
      console.log("gameService.getJackpotStatus response:", response.data);
      return {
        enabled: response.data.jackpotEnabled || false,
        // Include additional fields if needed
      };
    } catch (error) {
      console.error(
        "gameService.getJackpotStatus error:",
        JSON.stringify(
          error.response?.data || { message: error.message },
          null,
          2
        )
      );
      throw error;
    }
  },
};

export default gameService;
