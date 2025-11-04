// src/components/bingo/hooks/useJackpot.js
import { useState, useRef } from "react";
import gameService from "../../../services/game";
import SoundService from "../../../services/sound";

export default function useJackpot({ gameData, user }) {
  const [jackpotAmount, setJackpotAmount] = useState(0);
  const [jackpotWinnerData, setJackpotWinnerData] = useState(null);
  const [isJackpotTimeReached, setIsJackpotTimeReached] = useState(false);
  const [runJackpotBtnText, setRunJackpotBtnText] = useState("Run Jackpot");
  const [jackpotWinnerId, setJackpotWinnerId] = useState("---");
  const [jackpotPrizeAmount, setJackpotPrizeAmount] = useState("--- BIRR");
  const [jackpotDrawDate, setJackpotDrawDate] = useState("----");
  const [isJackpotDrawn, setIsJackpotDrawn] = useState(false);
  const [isJackpotEnabled, setIsJackpotEnabled] = useState(false);
  const [isJackpotAnimating, setIsJackpotAnimating] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [showJackpotMessage, setShowJackpotMessage] = useState(false);

  const jackpotCountdownIntervalRef = useRef(null);
  const jackpotWinnerShuffleInterval = useRef(null);

  const fetchJackpotAmount = async () => {
    if (!user?.id) return 0;
    try {
      const data = await gameService.getJackpot(user.id);
      return parseInt(data?.amount, 10) || 0;
    } catch {
      return 0;
    }
  };

  const updateJackpotDisplay = async () => {
    const amount = await fetchJackpotAmount();
    setJackpotAmount(amount);
  };

  const shuffleWinnerIdAnimation = () => {
    if (!jackpotWinnerData) return;
    setIsJackpotAnimating(true);
    setIsShaking(true);
    setIsCelebrating(true);
    SoundService.playSound("jackpot-running", { loop: true });
    setJackpotWinnerId("0000");

    let counter = 0;
    const interval = setInterval(() => {
      setJackpotWinnerId(Math.floor(Math.random() * 10000).toString().padStart(4, "0"));
      if (++counter >= 20) {
        clearInterval(interval);
        const final = String(jackpotWinnerData.winning_number);
        setJackpotWinnerId(final);
        setJackpotPrizeAmount(`${jackpotWinnerData.payout_amount} BIRR`);
        const date = new Date(jackpotWinnerData.win_date);
        setJackpotDrawDate(date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
        setIsJackpotDrawn(true);
        SoundService.playSound("jackpot-running", { stop: true });
        SoundService.playSound("jackpot-congrats");
        setTimeout(() => {
          setIsJackpotAnimating(false);
          setIsShaking(false);
          setIsCelebrating(false);
          setShowJackpotMessage(false);
        }, 10000);
      }
    }, 100);
    jackpotWinnerShuffleInterval.current = interval;
  };

  const handleRunJackpot = () => {
    if (!isJackpotTimeReached || isJackpotDrawn) return;
    shuffleWinnerIdAnimation();
    setRunJackpotBtnText("Jackpot Drawn");
  };

  return {
    jackpotAmount,
    setJackpotAmount,
    jackpotWinnerData,
    setJackpotWinnerData,
    isJackpotTimeReached,
    setIsJackpotTimeReached,
    runJackpotBtnText,
    setRunJackpotBtnText,
    jackpotWinnerId,
    setJackpotWinnerId,
    jackpotPrizeAmount,
    setJackpotPrizeAmount,
    jackpotDrawDate,
    setJackpotDrawDate,
    isJackpotDrawn,
    setIsJackpotDrawn,
    isJackpotEnabled,
    setIsJackpotEnabled,
    isJackpotAnimating,
    isShaking,
    isCelebrating,
    showJackpotMessage,
    updateJackpotDisplay,
    handleRunJackpot,
    shuffleWinnerIdAnimation,
  };
}