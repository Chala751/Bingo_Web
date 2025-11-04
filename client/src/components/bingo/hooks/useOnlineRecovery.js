// src/components/bingo/hooks/useOnlineRecovery.js
import { useEffect, useRef } from "react";

export default function useOnlineRecovery(gameState, numberCalling) {
  const { gameData, isAutoCall, isPlaying, isGameOver } = gameState;
  const { handleCallNumber } = numberCalling;
  const interruptedNumberRef = useRef(null);

  useEffect(() => {
    const onOnline = () => {
      const gid = gameData?._id;
      if (!gid || !isAutoCall || !isPlaying || isGameOver) return;
      const pending = sessionStorage.getItem(`bingo_pending_call_${gid}`);
      const num = pending ? JSON.parse(pending).number : interruptedNumberRef.current;
      if (num) {
        interruptedNumberRef.current = num;
        setTimeout(() => handleCallNumber(), 0);
      }
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [gameData?._id, isAutoCall, isPlaying, isGameOver, handleCallNumber]);
}