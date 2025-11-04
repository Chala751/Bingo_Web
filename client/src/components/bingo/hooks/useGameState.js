// src/components/bingo/hooks/useGameState.js
import { useState, useEffect, useRef } from "react";
import { useBingoGame } from "../../../hooks/useBingoGame";

export default function useGameState({ searchParams, navigate }) {
  const { fetchGame, game } = useBingoGame();
  const [gameData, setGameData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGameOver, setIsGameOver] = useState(false);
  const [winningPattern, setWinningPattern] = useState("line");
  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [calledNumbers, setCalledNumbers] = useState([]); // ADD THIS

  const [user] = useState(() => {
    const stored = localStorage.getItem("user");
    return stored ? JSON.parse(stored) : null;
  });

  const calledNumbersSetRef = useRef(new Set());
  const appliedNumbersRef = useRef(new Set());
  const numberIndexRef = useRef(new Map());
  const lastHeardRef = useRef({ gameId: null, number: null });

  useEffect(() => {
    const gameId = searchParams.get("id") || sessionStorage.getItem("currentGameId");
    if (!gameId) {
      navigate("/cashier-dashboard");
      setIsLoading(false);
      return;
    }

    sessionStorage.setItem("currentGameId", gameId);
    const load = async () => {
      try {
        setIsLoading(true);
        const fetched = await fetchGame(gameId);
        setGameData(fetched);
        const started = localStorage.getItem(`bingoGameStarted_${gameId}`) === "true";
        setHasStarted(started);

        // Restore called numbers from game data
        const called = fetched?.calledNumbers || [];
        setCalledNumbers(called);
        called.forEach(n => {
          calledNumbersSetRef.current.add(n);
          appliedNumbersRef.current.add(n);
        });
      } catch {
        navigate("/cashier-dashboard");
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [searchParams, fetchGame, navigate]);

  useEffect(() => {
    if (game) {
      setGameData(prev => ({ ...prev, ...game }));
      setWinningPattern(game.pattern?.replace("_", " ") || "line");
      setIsGameOver(game.status === "completed");

      // Sync called numbers from server
      const serverCalled = game.calledNumbers || [];
      setCalledNumbers(serverCalled);
      calledNumbersSetRef.current = new Set(serverCalled);
      appliedNumbersRef.current = new Set(serverCalled);
    }
  }, [game]);

  return {
    user,
    gameData,
    setGameData,
    isLoading,
    isGameOver,
    setIsGameOver,
    winningPattern,
    setWinningPattern,
    hasStarted,
    setHasStarted,
    isPlaying,
    setIsPlaying,
    calledNumbers,        // RETURN IT
    setCalledNumbers,     // RETURN IT
    calledNumbersSetRef,
    appliedNumbersRef,
    numberIndexRef,
    lastHeardRef,
  };
}