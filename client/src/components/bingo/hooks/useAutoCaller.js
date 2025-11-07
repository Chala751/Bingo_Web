// src/components/bingo/hooks/useAutoCaller.js
import { useState, useEffect, useRef, useCallback } from "react";
import API from "../../../services/axios";
import gameService from "../../../services/game";
import SoundService from "../../../services/sound";
import {
  getSocket,
  requestNextCall,
  cancelNextCall,
} from "../../../services/socket";

export default function useAutoCaller({
  gameData,
  isPlaying,
  isGameOver,
  generateNextNumber,
  callNumber,
  callNextFromServer,
  pendingCall,
  startAutoCall: externalStartAutoCall, // keep for backward compatibility
  stopAutoCall: externalStopAutoCall,
  onCallSuccess,
  onCallError,
  setIsPlaying, // optional: allow enabling play when toggling auto on
}) {
  const [isAutoCall, setIsAutoCall] = useState(false);
  const [localSpeed, setLocalSpeed] = useState(
    () => parseInt(localStorage.getItem("bingoAutoCallSpeed")) || 8
  );

  const timerRef = useRef(null);
  const modeRef = useRef(false); // true → loop is allowed to run
  const callInFlight = useRef(false);
  const inFlightPublicRef = useRef(false); // mirror for external visibility
  const wasOffline = useRef(false);
  const abortCtrlRef = useRef(null); // <-- abort controller for the current request
  const anchorMsRef = useRef(null); // fixed start time (performance.now)
  const tickRef = useRef(1); // 1-based tick counter
  const leadMsRef = useRef(2000); // initial lead before target audio time (ms) – pre-initialize ~2s early
  const rttSamplesRef = useRef([]); // store recent round-trip latencies (ms)
  const sendStartRef = useRef(null);
  const preppedTickRef = useRef(0); // track if we pre-warmed audio for a tick
  const lastPlayAtMsRef = useRef(null); // last acknowledged play time (performance.now clock)

  /* ------------------------------------------------------------------ *
   *  Toggle – start / stop the internal loop
   * ------------------------------------------------------------------ */
  const toggleAutoCall = useCallback(async () => {
    const next = !isAutoCall;
    setIsAutoCall(next);

    // Optimistically toggle server auto-call; rollback on failure
    const gameId = gameData?._id;
    if (gameId) {
      try {
        await gameService.setAutoCallEnabled(gameId, next);
      } catch (e) {
        console.warn(
          "[AutoCall] Failed to set auto-call server-side:",
          e?.response?.data || e?.message || e
        );
        // Rollback local toggle on failure
        setIsAutoCall(!next);
        return;
      }
    }

    if (next) {
      // Ensure local playing flag is on
      setIsPlaying?.(true);
      // Try to ensure game is active server-side for authoritative flow
      try {
        if (gameData?._id && gameData?.status !== "active") {
          await gameService.updateGameStatus(gameData._id, "active");
        }
      } catch (e) {
        // non-fatal: UI can still function and retry later
        console.warn("[AutoCall] Failed to set game active:", e?.message || e);
      }
      externalStartAutoCall?.();
    } else {
      externalStopAutoCall?.();
      // Cancel any pending deferred server calls for this game
      try {
        if (gameData?._id) {
          cancelNextCall(gameData._id);
        }
      } catch {
        /* noop */
      }
    }
  }, [
    isAutoCall,
    externalStartAutoCall,
    externalStopAutoCall,
    setIsPlaying,
    gameData?._id,
    gameData?.status,
  ]);

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
      timerRef.current = setTimeout(scheduleNext, 100);
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

    const intervalMs = Math.max(500, localSpeed * 1000);
    const now = performance.now();
    if (anchorMsRef.current == null) anchorMsRef.current = now;
    const targetMs = anchorMsRef.current + tickRef.current * intervalMs;

    // Early pre-initialization window (warm up audio/context a few seconds before)
    const preInitLead = 3000; // try to prep ~3s before the actual target
    if (
      preppedTickRef.current !== tickRef.current &&
      now < targetMs - preInitLead
    ) {
      preppedTickRef.current = tickRef.current;
      // Best-effort: resume audio context to avoid first-play latency
      try {
        SoundService.ensureContext();
      } catch {
        /* noop */
      }
    }

    // Wait until send time (target - lead)
    const sendAt = Math.max(0, targetMs - leadMsRef.current);
    if (now < sendAt) {
      const coarse = Math.max(0, sendAt - now - 30);
      if (coarse > 0) {
        timerRef.current = setTimeout(() => {
          // fine wait with rAF for precision
          const spin = () => {
            if (!modeRef.current) return;
            const t = performance.now();
            if (t >= sendAt - 1) {
              scheduleNext();
            } else {
              requestAnimationFrame(spin);
            }
          };
          requestAnimationFrame(spin);
        }, coarse);
      } else {
        // immediate fine wait
        const spin = () => {
          if (!modeRef.current) return;
          const t = performance.now();
          if (t >= sendAt - 1) {
            scheduleNext();
          } else {
            requestAnimationFrame(spin);
          }
        };
        requestAnimationFrame(spin);
      }
      return;
    }

    // ---- fire the call just before the target time ---------------------------
    callInFlight.current = true;
    inFlightPublicRef.current = true;
    sendStartRef.current = performance.now();

    // Prefer socket request so backend initiates the call and emits a synchronized playAt
    let usedSocket = false;
    try {
      const socket = getSocket();
      if (socket && socket.connected && gameData?._id) {
        const playAtEpoch =
          Date.now() + Math.max(0, targetMs - performance.now());
        const intervalMs = Math.max(500, localSpeed * 1000);
        requestNextCall({
          gameId: gameData._id,
          playAtEpoch,
          minIntervalMs: intervalMs,
        });
        usedSocket = true;
      }
    } catch {
      /* noop */
    }

    let promise;
    if (usedSocket) {
      // Do not advance tick yet; wait for server 'numberCalled' ack
      promise = Promise.resolve(false);
    } else {
      // If socket is not connected, do not retry aggressively; wait for network/socket
      if (!API.isOnline()) {
        // Wait until online, then try again by rescheduling near-future
        const resume = async () => {
          while (modeRef.current && !API.isOnline()) {
            await new Promise((r) => setTimeout(r, 500));
          }
          // when back online, nudge the loop
          if (modeRef.current) scheduleNext();
        };
        resume();
        promise = Promise.resolve(false);
      } else {
        // As a fallback, use HTTP once (no retries); still schedule sound at targetMs
        abortCtrlRef.current = new AbortController();
        promise = callNextFromServer
          ? callNextFromServer({
              signal: abortCtrlRef.current.signal,
              atMs: targetMs,
              minIntervalMs: intervalMs,
              playAtEpoch:
                Date.now() + Math.max(0, targetMs - performance.now()),
            })
          : (() => {
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
      }
    }

    promise
      .then((success) => {
        if (!modeRef.current) return;
        // Measure RTT and adapt lead time for next calls
        try {
          const start = sendStartRef.current || performance.now();
          const rtt = Math.max(0, performance.now() - start);
          const arr = rttSamplesRef.current;
          arr.push(rtt);
          if (arr.length > 10) arr.shift();
          const sorted = [...arr].sort((a, b) => a - b);
          const idx = Math.max(0, Math.floor(sorted.length * 0.95) - 1);
          const p95 = sorted[idx] ?? sorted[sorted.length - 1] ?? rtt;
          const intervalMs = Math.max(500, localSpeed * 1000);
          // Adapt lead: ensure we send sufficiently early to hit exact tick
          const minLead = Math.max(2000, (p95 || 0) + 500); // at least ~2s, more if RTT observed
          const maxLead = Math.max(1000, intervalMs - 800); // keep a safe margin from previous tick
          const newLead = Math.min(maxLead, minLead);
          if (isFinite(newLead) && newLead > 0) {
            leadMsRef.current = newLead;
          }
        } catch {
          /* noop */
        }
        if (success) {
          onCallSuccess?.();
          // advance tick and schedule next loop aligned to anchor
          tickRef.current += 1;
          // We scheduled playback for this call at targetMs; remember it to enforce equal interval
          lastPlayAtMsRef.current = targetMs;
          let nextTarget = anchorMsRef.current + tickRef.current * intervalMs;
          // Enforce constant gap: next >= lastPlay + interval
          const lastPlayed = lastPlayAtMsRef.current;
          if (typeof lastPlayed === "number" && isFinite(lastPlayed)) {
            nextTarget = Math.max(nextTarget, lastPlayed + intervalMs);
          }
          const delay = Math.max(
            50,
            nextTarget - performance.now() - leadMsRef.current
          );
          timerRef.current = setTimeout(scheduleNext, delay);
        } else {
          // Do not advance tick; wait for connectivity and retry scheduling
          const retryDelay = 500;
          timerRef.current = setTimeout(scheduleNext, retryDelay);
        }
      })
      .catch((e) => {
        if (e?.name !== "CanceledError") {
          console.error("[AutoCall] callNumber error:", e);
          onCallError?.(e);
        }
        // On error, do not advance tick; retry soon or upon connectivity
        const retryDelay = 800;
        timerRef.current = setTimeout(scheduleNext, retryDelay);
      })
      .finally(() => {
        // If we used socket path, keep callInFlight true until server ack arrives
        if (!usedSocket) {
          callInFlight.current = false;
          inFlightPublicRef.current = false;
        }
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
    inFlightPublicRef.current = false;
    pendingCall.current = null;

    const shouldRun =
      isAutoCall && isPlaying && !isGameOver && gameData?.status === "active";

    if (!shouldRun) {
      externalStopAutoCall?.();
      return;
    }

    modeRef.current = true;
    // initialize anchor and first tick
    anchorMsRef.current = performance.now();
    tickRef.current = 1;
    const intervalMs = Math.max(500, localSpeed * 1000);
    const firstSendDelay = Math.max(
      50,
      anchorMsRef.current + intervalMs - performance.now() - leadMsRef.current
    );
    timerRef.current = setTimeout(scheduleNext, firstSendDelay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortCtrlRef.current) abortCtrlRef.current.abort();
      modeRef.current = false;
      callInFlight.current = false;
      inFlightPublicRef.current = false;
      // When loop stops, ensure server has no deferred pending
      try {
        if (gameData?._id) {
          cancelNextCall(gameData._id);
        }
      } catch {
        /* noop */
      }
      externalStopAutoCall?.();
    };
  }, [
    isAutoCall,
    isPlaying,
    isGameOver,
    gameData?.status,
    gameData?._id,
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
   *  Socket ACKs – handle TOO_EARLY for requestNextCall
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onResult = (payload) => {
      try {
        if (!modeRef.current) return; // auto off
        if (!payload || payload.gameId !== gameData?._id) return;
        if (
          payload.status === "TOO_EARLY" &&
          Number.isFinite(payload.nextAllowedAt)
        ) {
          // Release in-flight and reschedule our next send aligned to nextAllowedAt
          callInFlight.current = false;
          inFlightPublicRef.current = false;
          const intervalMs = Math.max(500, localSpeed * 1000);
          const atEpoch = Number(payload.nextAllowedAt);
          const atMs = performance.now() + Math.max(0, atEpoch - Date.now());
          // Re-anchor so that current tick target equals nextAllowedAt
          anchorMsRef.current = atMs - tickRef.current * intervalMs;
          // Assume last play happened exactly one interval before the next allowed time
          lastPlayAtMsRef.current = atMs - intervalMs;
          const delay = Math.max(
            50,
            atMs - performance.now() - leadMsRef.current
          );
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(scheduleNext, delay);
        } else if (payload.status === "ERROR") {
          // Release in-flight and retry later; do not advance tick
          callInFlight.current = false;
          inFlightPublicRef.current = false;
          const retryDelay = 1500;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(scheduleNext, retryDelay);
        }
      } catch {
        /* noop */
      }
    };
    socket.on("requestNextCallResult", onResult);
    return () => {
      socket.off("requestNextCallResult", onResult);
    };
  }, [gameData?._id, localSpeed, scheduleNext]);

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
      inFlightPublicRef.current = false;
      if (pendingCall?.current !== undefined) pendingCall.current = null;
      setIsAutoCall(false);
      externalStopAutoCall?.();
      // cancel any deferred server-side call
      try {
        if (gameData?._id) {
          cancelNextCall(gameData._id);
        }
      } catch {
        /* noop */
      }
    },
    // Expose schedule info for external sync (e.g., sockets)
    getNextTickMs: () =>
      anchorMsRef.current != null
        ? anchorMsRef.current +
          tickRef.current * Math.max(500, localSpeed * 1000)
        : null,
    getLeadMs: () => leadMsRef.current,
    // Expose in-flight status and an acknowledgment hook for socket events
    isCallInFlight: () => inFlightPublicRef.current,
    ackServerCall: (atMs = null) => {
      try {
        // Mark in-flight complete
        callInFlight.current = false;
        inFlightPublicRef.current = false;
        if (!modeRef.current) return;

        const intervalMs = Math.max(500, localSpeed * 1000);
        // Advance tick now that server confirmed
        tickRef.current += 1;

        // Optionally re-anchor to the acknowledged play time to avoid catch-up bursts.
        // IMPORTANT: If the acknowledged scheduled time (atMs) is significantly
        // in the past relative to now (i.e. network / server delay), we DO NOT
        // try to "catch up" by shortening the next interval. Instead we treat
        // the actual arrival time (now) as the play time to preserve a stable cadence.
        const now = performance.now();
        let effectivePlayAtMs = now;
        if (typeof atMs === "number" && isFinite(atMs)) {
          // If the provided atMs is only slightly earlier (<=100ms), trust it for precision.
          // Otherwise, ignore stale schedule to avoid compressed next interval.
          const lateness = now - atMs;
          if (lateness <= 100) {
            effectivePlayAtMs = atMs;
          }
        }
        // Recompute anchor based on the EFFECTIVE play time of the tick we just finished.
        anchorMsRef.current =
          effectivePlayAtMs - (tickRef.current - 1) * intervalMs;
        lastPlayAtMsRef.current = effectivePlayAtMs;

        let nextTarget = anchorMsRef.current + tickRef.current * intervalMs;
        // Enforce constant interval spacing: next target must be at least lastPlay + interval
        const lastPlayed = lastPlayAtMsRef.current;
        if (typeof lastPlayed === "number" && isFinite(lastPlayed)) {
          nextTarget = Math.max(nextTarget, lastPlayed + intervalMs);
        }
        const delay = Math.max(
          50,
          nextTarget - performance.now() - leadMsRef.current
        );
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(scheduleNext, delay);
      } catch {
        /* noop */
      }
    },
  };
}
