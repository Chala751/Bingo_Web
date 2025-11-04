// src/components/bingo/hooks/useNumberCalling.js
import { useState, useRef, useEffect, useCallback } from "react";
import gameService from "../../../services/game";
import SoundService from "../../../services/sound";

export default function useNumberCalling(gameState, autoCallerOptions = {}) {
  const {
    gameData,
    setGameData,
    calledNumbers = [],
    setCalledNumbers,
    calledNumbersSetRef,
    appliedNumbersRef,
    lastHeardRef,
    isPlaying,
    isGameOver,
  } = gameState;

  const { speed = 8 } = autoCallerOptions;

  const [currentNumber, setCurrentNumber] = useState(null);
  const [lastCalledNumbers, setLastCalledNumbers] = useState([]);
  const [isCallingNumber, setIsCallingNumber] = useState(false);
  const [manualNumber, setManualNumber] = useState("");

  const inFlightCallRef = useRef(false);
  const pendingCallRef = useRef(null); // Tracks number we're trying to call
  const autoCallTimerRef = useRef(null);
  const lastConfirmedCallTimeRef = useRef(0); // Only updated on success
  const autoEnabledRef = useRef(false); // explicit on/off gate for internal scheduler

  // -----------------------------------------------------------------
  // Pre-load sounds
  // -----------------------------------------------------------------
  useEffect(() => {
    if (gameData?._id && gameData?.language) {
      SoundService.preloadSounds(gameData.language).catch((err) => {
        console.error("[useNumberCalling] Preload failed:", err);
      });
    }
  }, [gameData?._id, gameData?.language]);

  // -----------------------------------------------------------------
  // 1. Apply number – only after server confirmation
  // -----------------------------------------------------------------
  const applyCalledNumber = useCallback(
    (num) => {
      const n = Number(num);
      if (isNaN(n) || appliedNumbersRef.current.has(n)) return false;

      calledNumbersSetRef.current.add(n);
      appliedNumbersRef.current.add(n);

      setCalledNumbers((prev) => [...prev, n]);
      setLastCalledNumbers((prev) => [...new Set([n, ...prev])].slice(0, 5));
      setCurrentNumber(n);

      const lang = gameData?.language || "am";
      SoundService.playSound(`number_${n}`, { language: lang });

      const gid = gameData?._id;
      if (gid) {
        sessionStorage.setItem(
          `bingo_last_heard_${gid}`,
          JSON.stringify({ number: n, ts: Date.now() })
        );
        lastHeardRef.current = { gameId: gid, number: n };
      }

      return true;
    },
    [
      gameData,
      appliedNumbersRef,
      calledNumbersSetRef,
      lastHeardRef,
      setCalledNumbers,
    ]
  );

  // -----------------------------------------------------------------
  // 2. Call number – **waits for server**, **returns success/failure**
  // -----------------------------------------------------------------
  const callNumber = useCallback(
    async (number = null, { enforce = false } = {}) => {
      if (!gameData?._id || inFlightCallRef.current) return false;
      if (isGameOver || !isPlaying || gameData.status !== "active")
        return false;

      const numToCall = number ?? pendingCallRef.current;
      if (!numToCall) return false;

      setIsCallingNumber(true);
      inFlightCallRef.current = true;
      pendingCallRef.current = null;

      try {
        const resp = await gameService.callNumber(gameData._id, numToCall, {
          enforce,
          signal: autoCallerOptions.signal,
        });

        const called = resp.calledNumber;
        if (called) {
          // === SERVER CONFIRMED: Apply & update ===
          applyCalledNumber(called);
          setGameData((prev) => ({
            ...prev,
            ...resp.game,
            calledNumbers: resp.game?.calledNumbers || prev.calledNumbers,
            calledNumbersLog:
              resp.game?.calledNumbersLog || prev.calledNumbersLog,
          }));

          lastConfirmedCallTimeRef.current = performance.now();
          console.log(`[callNumber] Confirmed: ${called}`);
          return true;
        }

        // If no calledNumber returned, do not throw. Sync state if available and return false
        if (resp?.game) {
          setGameData((prev) => ({
            ...prev,
            ...resp.game,
            calledNumbers: resp.game?.calledNumbers || prev.calledNumbers,
            calledNumbersLog:
              resp.game?.calledNumbersLog || prev.calledNumbersLog,
          }));
        }
        console.warn(
          `[callNumber] No calledNumber in response (reason: ${
            resp?.reason || "unknown"
          })`
        );
        return false;
      } catch (err) {
        console.error(`[callNumber] Failed to call ${numToCall}:`, err.message);

        // === FAILURE: DO NOT APPLY, DO NOT ADVANCE ===
        // Let caller retry
        if (err.name !== "CanceledError") {
          const status = err?.response?.status;
          const reason = err?.response?.data?.reason;
          if (status === 412 || reason === "ALREADY_CALLED") {
            // Drop it and let server choose next number
            pendingCallRef.current = null;
          } else {
            pendingCallRef.current = numToCall; // retry same number
          }
        }
        return false;
      } finally {
        setIsCallingNumber(false);
        inFlightCallRef.current = false;
      }
    },
    [
      gameData,
      isPlaying,
      isGameOver,
      applyCalledNumber,
      setGameData,
      pendingCallRef,
      autoCallerOptions?.signal,
    ]
  );

  // -----------------------------------------------------------------
  // 2b. Server-decided call – no client-side number selection
  // -----------------------------------------------------------------
  const callNextFromServer = useCallback(async () => {
    if (!gameData?._id || inFlightCallRef.current) return false;
    if (isGameOver || !isPlaying || gameData.status !== "active") return false;

    setIsCallingNumber(true);
    inFlightCallRef.current = true;
    pendingCallRef.current = null;
    try {
      const resp = await gameService.callNextNumber(gameData._id, {
        signal: autoCallerOptions.signal,
      });
      const called = resp.calledNumber;
      if (!called) {
        if (resp?.game)
          setGameData((prev) => ({
            ...prev,
            ...resp.game,
            calledNumbers: resp.game?.calledNumbers || prev.calledNumbers,
            calledNumbersLog:
              resp.game?.calledNumbersLog || prev.calledNumbersLog,
          }));
        return false;
      }

      applyCalledNumber(called);
      setGameData((prev) => ({
        ...prev,
        ...resp.game,
        calledNumbers: resp.game?.calledNumbers || prev.calledNumbers,
        calledNumbersLog: resp.game?.calledNumbersLog || prev.calledNumbersLog,
      }));

      lastConfirmedCallTimeRef.current = performance.now();
      return true;
    } catch (err) {
      console.error(`[callNextFromServer] Failed:`, err?.message || err);
      return false;
    } finally {
      setIsCallingNumber(false);
      inFlightCallRef.current = false;
    }
  }, [
    gameData,
    isPlaying,
    isGameOver,
    applyCalledNumber,
    setGameData,
    autoCallerOptions?.signal,
  ]);

  // -----------------------------------------------------------------
  // 3. Generate next random number (client-side only)
  // -----------------------------------------------------------------
  const generateNextNumber = useCallback(() => {
    // Prefer the next number after the last currentNumber to avoid big jumps.
    // Fallback to the smallest available number.
    const calledSet = new Set(calledNumbers || []);
    if (currentNumber && Number.isFinite(currentNumber)) {
      for (let n = Number(currentNumber) + 1; n <= 75; n++) {
        if (!calledSet.has(n)) return n;
      }
      // wrap-around: try from 1..currentNumber
      for (let n = 1; n <= 75; n++) {
        if (!calledSet.has(n)) return n;
      }
      return null;
    }

    // No previous number: pick the smallest unused to be predictable
    for (let n = 1; n <= 75; n++) {
      if (!calledSet.has(n)) return n;
    }
    return null;
  }, [calledNumbers, currentNumber]);

  // -----------------------------------------------------------------
  // 4. Public: Manual call
  // -----------------------------------------------------------------
  const handleCallNumber = useCallback(
    async (manualNum = null) => {
      if (isCallingNumber || inFlightCallRef.current) return false;

      const num = manualNum ?? generateNextNumber();
      if (!num) return false;

      pendingCallRef.current = num;
      return await callNumber(num, { enforce: true });
    },
    [isCallingNumber, generateNextNumber, callNumber]
  );

  // -----------------------------------------------------------------
  // 5. Auto-caller: Precise cadence, waits for confirmation
  // -----------------------------------------------------------------
  const scheduleNextAutoCall = useCallback(() => {
    if (!isPlaying || isGameOver || !gameData?._id || !autoEnabledRef.current)
      return;
    // Clear any existing auto timer to avoid overlaps
    if (autoCallTimerRef.current) {
      clearTimeout(autoCallTimerRef.current);
      autoCallTimerRef.current = null;
    }

    const intervalMs = Math.max(1000, speed * 1000);
    const now = performance.now();
    const timeSinceLast = now - lastConfirmedCallTimeRef.current;
    const delay = Math.max(100, intervalMs - timeSinceLast);

    autoCallTimerRef.current = setTimeout(async () => {
      if (!autoEnabledRef.current) return; // stop if turned off while waiting
      // If there's a pending retry from a previous failure, prefer it.
      if (inFlightCallRef.current) {
        // another call is running; reschedule after interval
        autoCallTimerRef.current = setTimeout(scheduleNextAutoCall, intervalMs);
        return;
      }

      // Prefer server-decided next number for authoritative sequence
      let success = false;
      if (typeof callNextFromServer === "function") {
        success = await callNextFromServer();
      } else {
        const nextNum = pendingCallRef.current ?? generateNextNumber();
        if (!nextNum) {
          console.log("[AutoCall] No numbers left");
          return;
        }
        pendingCallRef.current = nextNum;
        success = await callNumber(nextNum, { enforce: true });
      }

      if (success) {
        // only schedule the next call after a successful confirmation
        scheduleNextAutoCall();
      } else {
        // if the pending number is still the same, retry it after interval
        autoCallTimerRef.current = setTimeout(scheduleNextAutoCall, intervalMs);
      }
    }, delay);
  }, [
    isPlaying,
    isGameOver,
    gameData?._id,
    speed,
    generateNextNumber,
    callNumber,
    callNextFromServer,
  ]);

  // -----------------------------------------------------------------
  // 6. Start/Stop Auto
  // -----------------------------------------------------------------
  const startAutoCall = useCallback(() => {
    if (autoCallTimerRef.current) clearTimeout(autoCallTimerRef.current);
    autoEnabledRef.current = true;
    lastConfirmedCallTimeRef.current = performance.now();
    scheduleNextAutoCall();
  }, [scheduleNextAutoCall]);

  const stopAutoCall = useCallback(() => {
    if (autoCallTimerRef.current) clearTimeout(autoCallTimerRef.current);
    autoCallTimerRef.current = null;
    autoEnabledRef.current = false;
    pendingCallRef.current = null;
  }, []);

  // -----------------------------------------------------------------
  // 7. Cleanup
  // -----------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (autoCallTimerRef.current) clearTimeout(autoCallTimerRef.current);
    };
  }, []);

  // -----------------------------------------------------------------
  // 8. Public API
  // -----------------------------------------------------------------
  return {
    currentNumber,
    lastCalledNumbers,
    isCallingNumber,
    manualNumber,
    setManualNumber,

    handleCallNumber, // Manual call
    applyCalledNumber, // For external sync

    startAutoCall,
    stopAutoCall,

    // For useAutoCaller integration
    callNumber, // Direct access
    callNextFromServer,
    generateNextNumber,
    pendingCall: pendingCallRef,
  };
}
