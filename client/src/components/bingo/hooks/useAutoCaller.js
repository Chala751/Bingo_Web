// src/components/bingo/hooks/useAutoCaller.js
import { useState, useEffect, useRef, useCallback } from "react";
import API from "../../../services/axios";

export default function useAutoCaller({
  gameData,
  isPlaying,
  isGameOver,
  speed, // not used any more – we keep the persisted value
  generateNextNumber,
  callNumber,
  callNextFromServer,
  pendingCall,
  startAutoCall: externalStartAutoCall, // keep for backward compatibility
  stopAutoCall: externalStopAutoCall,
  onCallSuccess,
  onCallError,
}) {
  const [isAutoCall, setIsAutoCall] = useState(false);
  const [localSpeed, setLocalSpeed] = useState(
    () => parseInt(localStorage.getItem("bingoAutoCallSpeed")) || 8
  );

  const timerRef = useRef(null);
  const modeRef = useRef(false); // true → loop is allowed to run
  const callInFlight = useRef(false);
  const wasOffline = useRef(false);
  const abortCtrlRef = useRef(null); // <-- abort controller for the current request

  /* ------------------------------------------------------------------ *
   *  Toggle – start / stop the internal loop
   * ------------------------------------------------------------------ */
  const toggleAutoCall = useCallback(() => {
    const next = !isAutoCall;
    setIsAutoCall(next);
    if (next) externalStartAutoCall?.();
    else externalStopAutoCall?.();
  }, [isAutoCall, externalStartAutoCall, externalStopAutoCall]);

  /* ------------------------------------------------------------------ *
   *  Online / offline detection (unchanged)
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const goOnline = () => {
      if (API.isOnline()) wasOffline.current = true;
    };
    const goOffline = () => (wasOffline.current = true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  /* ------------------------------------------------------------------ *
   *  MAIN AUTO-CALL LOOP – **single source of truth**
   * ------------------------------------------------------------------ */
  const scheduleNext = useCallback(async () => {
    if (!modeRef.current) return;

    // ---- wait for a free slot ------------------------------------------------
    if (callInFlight.current) {
      timerRef.current = setTimeout(scheduleNext, 150);
      return;
    }

    // ---- wait for network ----------------------------------------------------
    while (!API.isOnline() && modeRef.current) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!modeRef.current) return;

    // ---- optional resync after being offline ---------------------------------
    if (wasOffline.current && gameData?._id) {
      wasOffline.current = false;
      try {
        const fresh = (await API.get(`/games/${gameData._id}`)).data.game;
        if (fresh?.calledNumbers?.length) {
          console.log(
            "[AutoCall] Resynced – last server number:",
            fresh.calledNumbers.slice(-1)[0]
          );
        }
      } catch (e) {
        console.warn("[AutoCall] Resync failed", e?.message ?? e);
      }
    }

    const intervalMs = Math.max(300, localSpeed * 1000);
    // ---- fire the call -------------------------------------------------------
    callInFlight.current = true;

    // create a fresh AbortController for this request
    abortCtrlRef.current = new AbortController();

    const promise = callNextFromServer
      ? callNextFromServer({ signal: abortCtrlRef.current.signal })
      : (() => {
          // Backward compatibility: compute next num and call explicitly
          const nextNum = generateNextNumber?.();
          if (!nextNum) {
            console.log("[AutoCall] No numbers left");
            return Promise.resolve(false);
          }
          pendingCall.current = nextNum;
          return callNumber(nextNum, {
            enforce: true,
            signal: abortCtrlRef.current.signal,
          });
        })();

    promise
      .then((success) => {
        if (!modeRef.current) return;

        if (success) {
          onCallSuccess?.();
          // Schedule next call exactly after the configured interval from NOW,
          // so the audible/visual gap is always equal to the configured seconds.
          timerRef.current = setTimeout(scheduleNext, intervalMs);
        } else {
          // retry SAME number after full interval
          timerRef.current = setTimeout(scheduleNext, intervalMs);
        }
      })
      .catch((e) => {
        // cancellation is *not* an error – just retry
        if (e?.name !== "CanceledError") {
          console.error("[AutoCall] callNumber error:", e);
          onCallError?.(e);
        }
        timerRef.current = setTimeout(scheduleNext, intervalMs);
      })
      .finally(() => {
        callInFlight.current = false;
        if (pendingCall?.current !== undefined) pendingCall.current = null;
        abortCtrlRef.current = null;
      });
  }, [
    gameData?._id,
    localSpeed,
    generateNextNumber,
    callNumber,
    callNextFromServer,
    pendingCall,
    onCallSuccess,
    onCallError,
  ]);

  /* ------------------------------------------------------------------ *
   *  Effect – start / stop the loop when the UI toggle changes
   * ------------------------------------------------------------------ */
  useEffect(() => {
    // ---- clean any stray timer / abort pending request --------------------
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortCtrlRef.current) abortCtrlRef.current.abort();

    modeRef.current = false;
    callInFlight.current = false;
    pendingCall.current = null;

    const shouldRun =
      isAutoCall && isPlaying && !isGameOver && gameData?.status === "active";

    if (!shouldRun) {
      externalStopAutoCall?.();
      return;
    }

    modeRef.current = true;
    // first call fires after the configured interval (so the cadence is exact)
    timerRef.current = setTimeout(
      scheduleNext,
      Math.max(150, localSpeed * 1000)
    );

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortCtrlRef.current) abortCtrlRef.current.abort();
      modeRef.current = false;
      callInFlight.current = false;
      externalStopAutoCall?.();
    };
  }, [
    isAutoCall,
    isPlaying,
    isGameOver,
    gameData?.status,
    localSpeed,
    scheduleNext,
    externalStopAutoCall,
    pendingCall,
  ]);

  /* ------------------------------------------------------------------ *
   *  Persist speed
   * ------------------------------------------------------------------ */
  useEffect(() => {
    localStorage.setItem("bingoAutoCallSpeed", String(localSpeed));
  }, [localSpeed]);

  /* ------------------------------------------------------------------ *
   *  Public API
   * ------------------------------------------------------------------ */
  return {
    isAutoCall,
    setIsAutoCall,
    toggleAutoCall,
    speed: localSpeed,
    setSpeed: setLocalSpeed,
    // Expose an explicit stop function for callers (e.g., when a winner is found)
    stopAutoCall: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortCtrlRef.current) {
        try {
          abortCtrlRef.current.abort();
        } catch {
          // ignore
        }
      }
      modeRef.current = false;
      callInFlight.current = false;
      if (pendingCall?.current !== undefined) pendingCall.current = null;
      setIsAutoCall(false);
      externalStopAutoCall?.();
    },
  };
}
