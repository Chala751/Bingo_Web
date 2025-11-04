// src/components/bingo/hooks/useGameLifecycle.js
import gameService from "../../../services/game";
import SoundService from "../../../services/sound";

export default function useGameLifecycle(gameState, jackpot) {
  const { gameData, setGameData, isPlaying, setIsPlaying, setIsGameOver, hasStarted, setHasStarted } = gameState;
  const { updateJackpotAfterGame } = jackpot;

  const handlePlayPause = async () => {
    const willPause = isPlaying;
    SoundService.playSound(willPause ? "game_pause" : "game_start");
    const newPlaying = !willPause;
    setIsPlaying(newPlaying);
    if (newPlaying && !hasStarted) {
      setHasStarted(true);
      localStorage.setItem(`bingoGameStarted_${gameData._id}`, "true");
    }

    const newStatus = willPause ? "paused" : "active";
    if (gameData.status === newStatus) return;

    try {
      await gameService.updateGameStatus(gameData._id, newStatus);
      setGameData(prev => ({ ...prev, status: newStatus }));
    } catch {
      setIsPlaying(willPause);
    }
  };

  const handleFinish = async () => {
    setIsGameOver(true);
    setIsPlaying(false);
    try {
      const resp = await gameService.finishGame(gameData._id);
      setGameData(prev => ({ ...prev, ...resp.game }));
      await updateJackpotAfterGame(gameData.prizePool);
    } catch (err) {
      console.error("Finish failed:", err);
    }
  };

  return { handlePlayPause, handleFinish };
}