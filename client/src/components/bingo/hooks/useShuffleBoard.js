// src/components/bingo/hooks/useShuffleBoard.js
import { useState, useRef } from "react";
import SoundService from "../../../services/sound";

export default function useShuffleBoard({
  setCalledNumbers,
  setBingoCards,
  setCards,
}) {
  const boardNumbers = Array.from({ length: 75 }, (_, i) => i + 1);
  const [displayNumbers, setDisplayNumbers] = useState(boardNumbers);
  const [isShuffling, setIsShuffling] = useState(false);
  const shuffleIntervalRef = useRef(null);

  const handleShuffle = () => {
    if (isShuffling) return;
    setIsShuffling(true);
    SoundService.playSound("shuffle");
    const numbers = [...boardNumbers];

    shuffleIntervalRef.current = setInterval(() => {
      for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
      }
      setDisplayNumbers([...numbers]);
    }, 100);

    setTimeout(() => {
      clearInterval(shuffleIntervalRef.current);
      SoundService.playSound("shuffle", { stop: true });
      setDisplayNumbers(boardNumbers);
      if (typeof setCalledNumbers === "function") {
        setCalledNumbers([]);
      }
      if (typeof setBingoCards === "function") {
        setBingoCards((prev) =>
          prev.map((c) => ({
            ...c,
            markedPositions: {
              B: [false, false, false, false, false],
              I: [false, false, false, false, false],
              N: [false, true, false, false, false],
              G: [false, false, false, false, false],
              O: [false, false, false, false, false],
            },
            winningPositions: {
              B: [false, false, false, false, false],
              I: [false, false, false, false, false],
              N: [false, false, false, false, false],
              G: [false, false, false, false, false],
              O: [false, false, false, false, false],
            },
          }))
        );
      }
      if (typeof setCards === "function") {
        setCards((prev) =>
          prev.map((c) => ({
            ...c,
            markedPositions: {
              B: [false, false, false, false, false],
              I: [false, false, false, false, false],
              N: [false, true, false, false, false],
              G: [false, false, false, false, false],
              O: [false, false, false, false, false],
            },
            winningPositions: {
              B: [false, false, false, false, false],
              I: [false, false, false, false, false],
              N: [false, false, false, false, false],
              G: [false, false, false, false, false],
              O: [false, false, false, false, false],
            },
          }))
        );
      }
      setIsShuffling(false);
    }, 5000);
  };

  return { displayNumbers, isShuffling, handleShuffle };
}
