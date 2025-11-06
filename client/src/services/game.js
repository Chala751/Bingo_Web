import API from "./axios";

const gameService = {
  // === CREATE SINGLE GAME ===
  createGame: async (data) => {
    try {
      const sequentialData = {
        ...data,
        count: 1, // Always single game
      };
      console.log(
        "gameService.createGame - Using sequential endpoint:",
        JSON.stringify(sequentialData, null, 2)
      );

      const response = await API.post("/games/sequential", sequentialData);
      console.log("gameService.createGame raw response:", response.data);

      const gamesArray = response.data.data || [];
      if (!Array.isArray(gamesArray) || gamesArray.length === 0) {
        throw new Error("No games created in response");
      }

      const game = gamesArray[0];
      console.log("gameService.createGame - Extracted game:", game);
      return game; // Return single game object
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

  // === GET GAME BY ID ===
  getGame: async (id, options = {}) => {
    try {
      if (!id) throw new Error("Game ID is required");
      console.log("gameService.getGame - Fetching game ID:", id);
      const config = {};
      if (options?.signal) config.signal = options.signal;
      const response = await API.get(`/games/${id}`, config);
      console.log("gameService.getGame response:", response.data);
      if (!response.data.game) throw new Error("No game data returned");
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

  // === GET ALL GAMES ===
  getAllGames: async () => {
    try {
      console.log("gameService.getAllGames - Fetching all games");
      const response = await API.get("/games");
      return response.data.games || [];
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

  // === GET NEXT PENDING GAME ===
  getNextPendingGame: async () => {
    try {
      console.log(
        "gameService.getNextPendingGame - Fetching next pending game"
      );
      const response = await API.get("/games/next-pending");
      return response.data.game || null;
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

  // === GET ALL CARDS ===
  getAllCards: async () => {
    try {
      console.log("gameService.getAllCards - Fetching all cards");
      const response = await API.get("/games/cards");
      console.log("gameService.getAllCards response:", response.data.data);
      return response.data.data || [];
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

  // === CALL NUMBER (FULLY FIXED & SAFE) ===
  callNumber: async (gameId, number, options = {}) => {
    let parsedNumber;

    try {
      // === INPUT VALIDATION ===
      if (!gameId || typeof gameId !== "string" || gameId.length !== 24) {
        throw new Error(`Invalid game ID: ${gameId}`);
      }

      parsedNumber = Number(number);
      if (
        isNaN(parsedNumber) ||
        parsedNumber < 1 ||
        parsedNumber > 75 ||
        !Number.isInteger(parsedNumber)
      ) {
        throw new Error(`Invalid number: ${number} (must be integer 1–75)`);
      }

      console.log(`[callNumber] Calling ${parsedNumber} for game ${gameId}`, {
        requestId: options.requestId,
        enforce: options.enforce,
      });

      // === REQUEST CONFIG ===
      const requestId = options.requestId || null;
      const enforce = options.enforce === true;
      const config = {
        signal: options.signal,
        headers: requestId ? { "x-request-id": requestId } : undefined,
      };

      const body = { number: parsedNumber, requestId, enforce };
      if (Number.isFinite(options?.minIntervalMs)) {
        body.minIntervalMs = options.minIntervalMs;
      }
      if (Number.isFinite(options?.playAtEpoch)) {
        body.playAtEpoch = options.playAtEpoch;
      }

      let response;
      if (API.requestWithRetry) {
        response = await API.requestWithRetry(
          {
            method: "post",
            url: `/games/${gameId}/call-number`,
            data: body,
          },
          {
            retries: 2,
            backoff: 300,
            timeout: 10000,
            signal: options.signal,
          }
        );
      } else {
        response = await API.post(`/games/${gameId}/call-number`, body, config);
      }

      console.log("[callNumber] Success:", {
        calledNumber: response.data.calledNumber,
        gameStatus: response.data.game?.status,
        totalCalled: response.data.game?.calledNumbers?.length,
      });

      return response.data; // { message, game, calledNumber, callType }
    } catch (error) {
      // === HANDLE CANCELLATION ===
      const isCanceled =
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        error?.message?.toLowerCase().includes("canceled") ||
        error?.message?.toLowerCase().includes("aborted");

      if (isCanceled) {
        console.log(
          `[callNumber] Canceled: ${parsedNumber ?? number} (game: ${gameId})`
        );
        throw error;
      }

      // === HANDLE CONCURRENCY (409) ===
      if (error?.response?.status === 409) {
        const err = new Error(
          error.response.data?.message || "Call in progress"
        );
        err.code = "CALL_IN_PROGRESS";
        err.response = error.response;
        throw err;
      }

      // === HANDLE ALREADY CALLED (412) ===
      if (
        error?.response?.status === 412 &&
        error.response.data?.reason === "ALREADY_CALLED"
      ) {
        console.log(
          "[callNumber] Number already called:",
          parsedNumber ?? number
        );
        return error.response.data; // Let caller sync state
      }

      // === SAFE LOGGING (parsedNumber may not exist if validation failed early) ===
      console.error(
        "[callNumber] Error:",
        JSON.stringify(
          {
            gameId,
            number: parsedNumber ?? number,
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
          },
          null,
          2
        )
      );
      throw error;
    }
  },

  // === CALL NEXT NUMBER (SERVER-DECIDES) ===
  callNextNumber: async (gameId, options = {}) => {
    try {
      if (!gameId || typeof gameId !== "string" || gameId.length !== 24) {
        throw new Error(`Invalid game ID: ${gameId}`);
      }

      const requestId = options.requestId || null;
      const config = {
        signal: options.signal,
        headers: requestId ? { "x-request-id": requestId } : undefined,
      };

      // Body does NOT include number; server will choose forced/manual/random
      const body = { requestId };
      if (Number.isFinite(options?.minIntervalMs)) {
        body.minIntervalMs = options.minIntervalMs;
      }
      if (Number.isFinite(options?.playAtEpoch)) {
        body.playAtEpoch = options.playAtEpoch;
      }
      if (options?.playNow === true) {
        body.playNow = true;
      }
      if (options?.manual === true) {
        body.manual = true;
      }

      let response;
      if (API.requestWithRetry) {
        response = await API.requestWithRetry(
          {
            method: "post",
            url: `/games/${gameId}/call-number`,
            data: body,
          },
          {
            retries: 2,
            backoff: 300,
            timeout: 10000,
            signal: options.signal,
          }
        );
      } else {
        response = await API.post(`/games/${gameId}/call-number`, body, config);
      }

      // Expect { game, calledNumber, ... }
      return response.data;
    } catch (error) {
      // Pass through known 409 gracefully so caller can retry
      if (error?.response?.status === 409) {
        const err = new Error(
          error.response.data?.message || "Call in progress"
        );
        err.code = "CALL_IN_PROGRESS";
        err.response = error.response;
        throw err;
      }
      throw error;
    }
  },

  // === CHECK BINGO ===
  // options: { signal?, retries?, backoff?, timeout? }
  checkBingo: async (gameId, cardId, preferredPattern = null, options = {}) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      if (!cardId || isNaN(cardId))
        throw new Error("Valid card ID is required");

      const body = { cardId: Number(cardId) };
      if (preferredPattern) body.preferredPattern = preferredPattern;

      console.log(
        `[checkBingo] Checking card ${cardId} (game: ${gameId})`,
        body
      );

      let response;
      if (API.requestWithRetry) {
        response = await API.requestWithRetry(
          {
            method: "post",
            url: `/games/${gameId}/check-bingo`,
            data: body,
          },
          {
            retries: Number.isFinite(options.retries) ? options.retries : 1,
            backoff: Number.isFinite(options.backoff) ? options.backoff : 250,
            timeout: Number.isFinite(options.timeout) ? options.timeout : 6000,
            signal: options.signal,
          }
        );
      } else {
        const config = options.signal ? { signal: options.signal } : {};
        response = await API.post(`/games/${gameId}/check-bingo`, body, config);
      }

      console.log("[checkBingo] Result:", {
        isBingo: response.data.isBingo,
        pattern: response.data.winningPattern,
        gameStatus: response.data.game?.status,
      });

      return response.data;
    } catch (error) {
      console.error(
        "[checkBingo] Error:",
        JSON.stringify(
          {
            gameId,
            cardId,
            message: error.message,
            status: error.response?.status,
            data: error.response?.data,
          },
          null,
          2
        )
      );
      throw error;
    }
  },

  // === SELECT WINNER ===
  selectWinner: async (gameId, data) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.post(`/games/${gameId}/select-winner`, data);
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "selectWinner error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  // === SELECT JACKPOT WINNER ===
  selectJackpotWinner: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.post(`/games/${gameId}/select-jackpot-winner`);
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "selectJackpotWinner error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  // === PAUSE GAME ===
  pauseGame: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.post(`/games/${gameId}/pause`);
      return response.data;
    } catch (error) {
      console.error("pauseGame error:", error.response?.data || error.message);
      throw error;
    }
  },

  // === FINISH GAME ===
  finishGame: async (gameId, moderatorCardId = null) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.post(`/games/${gameId}/finish`, {
        moderatorCardId,
      });
      return response.data?.game || null;
    } catch (error) {
      const errMsg =
        error.response?.data?.message ||
        error.message ||
        "Failed to finish game";
      console.error("finishGame error:", errMsg);
      throw new Error(errMsg);
    }
  },

  // === START GAME ===
  startGame: async (gameId) => {
    try {
      if (!gameId || !/^[0-9a-fA-F]{24}$/.test(gameId)) {
        throw new Error("Invalid game ID format");
      }
      const response = await API.post(`/games/${gameId}/start`);
      return response.data;
    } catch (error) {
      console.error("startGame error:", error.response?.data || error.message);
      throw error;
    }
  },

  // === UPDATE GAME ===
  updateGame: async (gameId, data) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.patch(`/games/${gameId}`, data);
      return response.data.data || response.data;
    } catch (error) {
      console.error("updateGame error:", error.response?.data || error.message);
      throw error;
    }
  },

  // === JACKPOT ENDPOINTS ===
  getJackpot: async (cashierId) => {
    try {
      if (!cashierId) throw new Error("Cashier ID is required");
      const response = await API.get(`/games/jackpot?cashierId=${cashierId}`);
      return response.data.data || response.data;
    } catch (error) {
      console.error("getJackpot error:", error.response?.data || error.message);
      throw error;
    }
  },

  addJackpotContribution: async (gameId, contributionAmount) => {
    try {
      if (!gameId || !contributionAmount || contributionAmount <= 0) {
        throw new Error("Valid gameId and amount required");
      }
      const response = await API.post("/games/jackpot/contribute", {
        gameId,
        contributionAmount,
      });
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "addJackpotContribution error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  updateJackpot: async (amount) => {
    try {
      if (typeof amount !== "number" || amount < 0) {
        throw new Error("Valid amount required");
      }
      const response = await API.patch("/games/jackpot", { amount });
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "updateJackpot error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  // === UTILS ===
  resetGameCounter: async () => {
    try {
      const response = await API.post("/games/reset-game-counter");
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "resetGameCounter error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  createSequentialGames: async (data) => {
    try {
      const response = await API.post("/games/sequential", data);
      const gamesArray = Array.isArray(response.data.data)
        ? response.data.data
        : response.data.game
        ? [response.data.game]
        : [];
      if (!gamesArray.length) throw new Error("No games created");
      return gamesArray;
    } catch (error) {
      console.error(
        "createSequentialGames error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  configureFutureWinners: async (winners) => {
    try {
      const response = await API.post("/games/configure-future-winners", {
        winners,
      });
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "configureFutureWinners error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  configureNextGameNumber: async (startNumber) => {
    try {
      const response = await API.post("/games/configure-next", { startNumber });
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "configureNextGameNumber error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  createFutureGames: async (data) => {
    try {
      const response = await API.post("/games/future", data);
      return response.data.data || response.data;
    } catch (error) {
      console.error(
        "createFutureGames error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  getCashierReport: async (cashierId, filters = {}) => {
    try {
      if (!cashierId) throw new Error("Cashier ID is required");
      const params = new URLSearchParams({ cashierId });
      Object.entries(filters).forEach(([k, v]) => v && params.append(k, v));
      const response = await API.get(`/games/report?${params.toString()}`);
      return response.data;
    } catch (error) {
      console.error(
        "getCashierReport error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  updateGameStatus: async (gameId, status) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.put(`/games/${gameId}/status`, { status });
      return response.data.game || response.data;
    } catch (error) {
      console.error(
        "updateGameStatus error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  // === TOGGLE AUTO-CALL ===
  setAutoCallEnabled: async (gameId, enabled) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.patch(`/games/${gameId}/auto-call`, {
        enabled: !!enabled,
      });
      return response.data.game || response.data;
    } catch (error) {
      console.error(
        "setAutoCallEnabled error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  // === RESTART GAME FROM NEW (CLEAR CALLED NUMBERS) ===
  restartGame: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.post(`/games/${gameId}/restart`);
      return response.data.game || response.data;
    } catch (error) {
      console.error(
        "restartGame error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },

  getJackpotStatus: async (gameId) => {
    try {
      if (!gameId) throw new Error("Game ID is required");
      const response = await API.get(`/games/${gameId}/jackpot-status`);
      return {
        enabled: !!response.data.jackpotEnabled,
        ...response.data,
      };
    } catch (error) {
      console.error(
        "getJackpotStatus error:",
        error.response?.data || error.message
      );
      throw error;
    }
  },
};

export default gameService;
