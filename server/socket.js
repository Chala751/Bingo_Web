import { Server } from "socket.io";
import { callNumber as httpCallNumber } from "./controllers/bingoController.js";

let io;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      // Align with frontend origin; adjust as needed for environments
      origin: [
        "https://jokerbingo.xyz",
        "http://localhost:5173",
        "http://localhost:3000",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log(`[socket] Client connected: ${socket.id}`);

    socket.on("joinCashierRoom", (cashierId) => {
      const room = String(cashierId);
      // Avoid duplicate joins/logs if already in the room
      if (socket.rooms?.has(room)) return;
      socket.join(room);
      console.log(`[socket] Client ${socket.id} joined cashier room: ${room}`);
    });

    socket.on("disconnect", () => {
      console.log(`[socket] Client disconnected: ${socket.id}`);
    });

    // Client requests the server to perform the next number call
    // Payload: { gameId: string, playAtEpoch?: number, playAfterMs?: number }
    // Use a per-game in-flight request flag to prevent race conditions.
    const callInProgress =
      io._callInProgress || (io._callInProgress = new Map());
    socket.on("requestNextCall", async (payload = {}) => {
      try {
        const { gameId } = payload || {};
        if (!gameId) return;

        // Deferred scheduling support: if a future playAtEpoch is provided, queue a single
        // execution for that time to avoid bursts and race conditions.
        const playAtEpoch = Number.isFinite(payload?.playAtEpoch)
          ? payload.playAtEpoch
          : null;
        const nowEpoch = Date.now();
        const isFuture = playAtEpoch && playAtEpoch - nowEpoch > 400; // treat >400ms as deferred

        // Shared maps (persisted on io)
        const deferred = io._deferredCalls || (io._deferredCalls = new Map());
        const callInProgressMap =
          io._callInProgress || (io._callInProgress = new Map());

        // If already in-flight, reject immediately
        if (callInProgressMap.get(gameId)) {
          console.warn(
            `[socket:requestNextCall] Rejected duplicate request for game ${gameId}: call already in progress.`
          );
          socket.emit("requestNextCallResult", {
            gameId,
            status: "ERROR",
            httpStatus: 429,
            message: "Call already in progress. Please wait.",
            errorCode: "CALL_IN_PROGRESS",
          });
          return;
        }

        // If a deferred call already exists, acknowledge and do nothing
        const existingDeferred = deferred.get(gameId);
        if (existingDeferred) {
          socket.emit("requestNextCallResult", {
            gameId,
            status: "ALREADY_SCHEDULED",
            nextPlayAt: playAtEpoch || null,
            message: "A deferred call is already scheduled.",
          });
          return;
        }

        if (isFuture) {
          const delay = Math.max(0, playAtEpoch - nowEpoch);
          const timeoutId = setTimeout(async () => {
            // Clear marker first to allow rescheduling if needed
            deferred.delete(gameId);
            if (callInProgressMap.get(gameId)) return;
            callInProgressMap.set(gameId, true);
            try {
              const req = {
                params: { gameId },
                body: {
                  playAtEpoch,
                  minIntervalMs: Number.isFinite(payload?.minIntervalMs)
                    ? payload.minIntervalMs
                    : undefined,
                },
                headers: {},
              };
              const result = await new Promise((resolve, reject) => {
                const res = {
                  status(code) {
                    this._status = code;
                    return this;
                  },
                  json(obj) {
                    resolve({ status: this._status || 200, data: obj });
                  },
                };
                httpCallNumber(req, res, (err) => {
                  if (err) reject(err);
                }).catch(reject);
              });
              if (result?.status >= 400) {
                const code = result?.data?.errorCode;
                if (
                  code === "TOO_EARLY" &&
                  Number.isFinite(result?.data?.nextAllowedAt)
                ) {
                  socket.emit("requestNextCallResult", {
                    gameId,
                    status: "TOO_EARLY",
                    nextAllowedAt: Number(result.data.nextAllowedAt),
                  });
                } else {
                  socket.emit("requestNextCallResult", {
                    gameId,
                    status: "ERROR",
                    httpStatus: result?.status || 500,
                    message: result?.data?.message || "Failed",
                    errorCode: code || null,
                  });
                }
              }
            } catch (e) {
              console.warn(
                "[socket:requestNextCall] Deferred call failed:",
                e?.message || e
              );
              socket.emit("requestNextCallResult", {
                gameId,
                status: "ERROR",
                message: "Deferred call failed",
              });
            } finally {
              callInProgressMap.set(gameId, false);
            }
          }, delay);
          deferred.set(gameId, timeoutId);
          socket.emit("requestNextCallResult", {
            gameId,
            status: "SCHEDULED",
            playAtEpoch,
            delayMs: delay,
          });
          return;
        }

        // If a call for this game is already in progress, reject the new request.
        if (callInProgress.get(gameId)) {
          console.warn(
            `[socket:requestNextCall] Rejected duplicate request for game ${gameId}: call already in progress.`
          );
          socket.emit("requestNextCallResult", {
            gameId,
            status: "ERROR",
            httpStatus: 429, // Too Many Requests
            message: "Call already in progress. Please wait.",
            errorCode: "CALL_IN_PROGRESS",
          });
          return;
        }

        // Set the in-flight flag for this game.
        callInProgress.set(gameId, true);

        // Wrap the existing HTTP controller to reuse all logic (locking, logs, forced sequence, etc.)
        const req = {
          params: { gameId },
          body: {
            playAtEpoch: Number.isFinite(payload?.playAtEpoch)
              ? payload.playAtEpoch
              : undefined,
            playAfterMs: Number.isFinite(payload?.playAfterMs)
              ? payload.playAfterMs
              : undefined,
            minIntervalMs: Number.isFinite(payload?.minIntervalMs)
              ? payload.minIntervalMs
              : undefined,
          },
          headers: {},
        };

        const result = await new Promise((resolve, reject) => {
          const res = {
            status(code) {
              this._status = code;
              return this;
            },
            json(obj) {
              resolve({ status: this._status || 200, data: obj });
            },
          };
          httpCallNumber(req, res, (err) => {
            if (err) reject(err);
          }).catch(reject);
        });

        // The controller itself emits the numberCalled event on success.
        // On errors, inform ONLY the requesting socket and do not auto-call.
        if (result?.status >= 400) {
          const code = result?.data?.errorCode;
          if (
            code === "TOO_EARLY" &&
            Number.isFinite(result?.data?.nextAllowedAt)
          ) {
            socket.emit("requestNextCallResult", {
              gameId,
              status: "TOO_EARLY",
              nextAllowedAt: Number(result.data.nextAllowedAt),
            });
          } else {
            socket.emit("requestNextCallResult", {
              gameId,
              status: "ERROR",
              httpStatus: result?.status || 500,
              message: result?.data?.message || "Failed",
              errorCode: code || null,
            });
            console.warn(
              `[socket:requestNextCall] Controller returned ${result.status}`
            );
          }
        }
      } catch (e) {
        console.warn(
          "[socket:requestNextCall] Failed to process request:",
          e?.message || e
        );
      } finally {
        // IMPORTANT: Always clear the in-flight flag when the operation is complete.
        const { gameId } = payload || {};
        if (gameId) {
          callInProgress.set(gameId, false);
        }
      }
    });

    // Allow clients to cancel any pending deferred next-call for a game
    socket.on("cancelNextCall", (payload = {}) => {
      try {
        const gameId = payload?.gameId;
        if (!gameId) return;
        const deferred = io._deferredCalls || (io._deferredCalls = new Map());
        const existing = deferred.get(gameId);
        if (existing) {
          clearTimeout(existing);
          deferred.delete(gameId);
          console.log(
            `[socket:cancelNextCall] Cleared deferred next call for game ${gameId}`
          );
        }
      } catch (e) {
        console.warn(
          "[socket:cancelNextCall] Failed to cancel:",
          e?.message || e
        );
      }
    });
  });
};

export const emitJackpotAwarded = (cashierId, data) => {
  if (io) {
    console.log(
      `[socket] Emitting jackpotAwarded to cashier room ${cashierId}:`,
      data
    );
    io.to(cashierId).emit("jackpotAwarded", data);
  }
};

export const emitNumberCalled = (cashierId, payload) => {
  if (io) {
    console.log(
      `[socket] Emitting numberCalled to cashier room ${cashierId}:`,
      { gameId: payload?.gameId, calledNumber: payload?.calledNumber }
    );
    io.to(cashierId).emit("numberCalled", payload);
  }
};

// Utility: get number of connected clients in a room (cashierId)
export const getRoomClientCount = (roomId) => {
  try {
    const room = io?.sockets?.adapter?.rooms?.get(String(roomId));
    return room ? room.size : 0;
  } catch {
    return 0;
  }
};

export const roomHasClients = (roomId) => getRoomClientCount(roomId) > 0;

// Allow controllers to clear any deferred next-call timeouts for a given game
export const clearDeferredForGame = (gameId) => {
  try {
    if (!io) return;
    const deferred = io._deferredCalls || null;
    if (!deferred) return;
    const existing = deferred.get(String(gameId));
    if (existing) {
      clearTimeout(existing);
      deferred.delete(String(gameId));
      console.log(`[socket] Cleared deferred next call for game ${gameId}`);
    }
  } catch (e) {
    console.warn(
      "[socket.clearDeferredForGame] Failed to clear:",
      e?.message || e
    );
  }
};
