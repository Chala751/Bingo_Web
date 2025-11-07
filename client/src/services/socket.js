// src/services/socket.js
import { io } from "socket.io-client";
import API from "./axios";

// Derive socket base URL from axios baseURL (strip trailing /api)
const deriveSocketUrl = () => {
  const base = API?.defaults?.baseURL || "";
  try {
    const u = new URL(base);
    return `${u.protocol}//${u.host}`; // origin without path
  } catch {
    return base.replace(/\/?api\/?$/, "");
  }
};

const SOCKET_URL = deriveSocketUrl();

let socketInstance = null;
// Track rooms we've requested to join for this client session
const joinedRooms = new Set();
let connectHooked = false;

export const getSocket = () => {
  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket"],
      autoConnect: false,
    });

    // Ensure we re-join rooms after reconnects
    if (!connectHooked) {
      connectHooked = true;
      socketInstance.on("connect", () => {
        // Re-emit join for all tracked rooms on each new connection
        joinedRooms.forEach((roomId) => {
          socketInstance.emit("joinCashierRoom", String(roomId));
        });
      });
    }
  }
  return socketInstance;
};

export const connectSocket = () => {
  const socket = getSocket();
  if (!socket.connected) socket.connect();
  return socket;
};

export const disconnectSocket = () => {
  const socket = getSocket();
  if (socket.connected) socket.disconnect();
};

export const joinCashierRoom = (cashierId) => {
  if (!cashierId) return;
  const room = String(cashierId);
  const socket = connectSocket();
  // Add to tracked rooms; emit only if newly added to avoid duplicates
  const isNew = !joinedRooms.has(room);
  joinedRooms.add(room);
  if (isNew && socket.connected) {
    socket.emit("joinCashierRoom", room);
  }
};

// Throttle next-call requests per game to avoid bursts on reconnect
const nextCallGate = new Map();

export const requestNextCall = ({
  gameId,
  playAtEpoch,
  playAfterMs,
  minIntervalMs,
} = {}) => {
  const socket = getSocket();
  if (!socket || !socket.connected) return false;
  if (!gameId) return false;
  const now = Date.now();
  const last = nextCallGate.get(gameId) || 0;
  const guard = Number.isFinite(minIntervalMs)
    ? Math.max(600, Math.min(minIntervalMs - 300, minIntervalMs))
    : 1200;
  if (now - last < guard) {
    return false;
  }
  nextCallGate.set(gameId, now);
  socket.emit("requestNextCall", {
    gameId,
    ...(Number.isFinite(playAtEpoch) ? { playAtEpoch } : {}),
    ...(Number.isFinite(playAfterMs) ? { playAfterMs } : {}),
    ...(Number.isFinite(minIntervalMs) ? { minIntervalMs } : {}),
  });
  return true;
};

export const cancelNextCall = (gameId) => {
  const socket = getSocket();
  if (!socket || !socket.connected) return false;
  if (!gameId) return false;
  socket.emit("cancelNextCall", { gameId });
  return true;
};

export default getSocket;
