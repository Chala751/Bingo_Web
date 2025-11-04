import React, { useEffect, useRef, useState } from "react";
import gameService from "../../../services/game";
import SoundService from "../../../services/sound";
import JackpotPanel from "./JackpotPanel";

/**
 * JackpotContainer - encapsulates jackpot state, effects, and UI.
 * 
 * Props:
 * - gameId: string
 * - userId: string
 * - setCallError: fn (from parent)
 * - setIsErrorModalOpen: fn (from parent)
 */
const JackpotContainer = ({ gameId, userId, setCallError, setIsErrorModalOpen }) => {
  const [jackpotAmount, setJackpotAmount] = useState(0);
  const [jackpotWinnerData, setJackpotWinnerData] = useState(null);
  const [isJackpotTimeReached, setIsJackpotTimeReached] = useState(false);
  const [jackpotWinnerShuffleInterval, setJackpotWinnerShuffleInterval] = useState(null);
  const jackpotCountdownIntervalRef = useRef(null);
  const [runJackpotBtnText, setRunJackpotBtnText] = useState("Run Jackpot");
  const [jackpotWinnerId, setJackpotWinnerId] = useState("---");
  const [jackpotPrizeAmount, setJackpotPrizeAmount] = useState("--- BIRR");
  const [jackpotDrawDate, setJackpotDrawDate] = useState("----");
  const [isJackpotDrawn, setIsJackpotDrawn] = useState(false);
  const [isJackpotEnabled, setIsJackpotEnabled] = useState(false);
  const [isJackpotAnimating, setIsJackpotAnimating] = useState(false);
  // local visual flags removed (unused)
  const [showJackpotMessage, setShowJackpotMessage] = useState(false);

  const confettiContainerRef = useRef(null);
  const fireworksContainerRef = useRef(null);

  const formattedWinnerId = jackpotWinnerId === "---" ? "---" : parseInt(jackpotWinnerId, 10).toString();

  const fetchJackpotAmount = async () => {
    if (!userId) return 0;
    try {
      const jackpotData = await gameService.getJackpot(userId);
      const amount = parseInt(jackpotData?.amount, 10) || 0;
      return amount;
    } catch (error) {
      console.error("[Jackpot] Error fetching jackpot:", error);
      return 0;
    }
  };

  const fetchJackpotWinnerData = async (gid) => {
    if (!gid) return null;
    try {
      const game = await gameService.getGame(gid);
      if (game.jackpotEnabled && game.jackpotWinnerCardId) {
        const drawDate = game.jackpotDrawTimestamp ? new Date(game.jackpotDrawTimestamp) : new Date();
        return {
          winning_number: String(game.jackpotWinnerCardId),
          payout_amount: game.jackpotAwardedAmount || 0,
          win_date: drawDate.toISOString(),
          winner_message: game.jackpotWinnerMessage || `Jackpot won by card ${game.jackpotWinnerCardId}`,
        };
      }
      return null;
    } catch (error) {
      console.error("[Jackpot] Error fetching jackpot winner:", error);
      return null;
    }
  };

  const updateJackpotDisplay = async () => {
    if (!userId) return;
    try {
      const amount = await fetchJackpotAmount();
      setJackpotAmount(amount);
    } catch (error) {
      console.error("[Jackpot] Error updating jackpot amount:", error);
    }
  };

  const startJackpotDrawCountdown = (drawDate) => {
    if (jackpotCountdownIntervalRef.current) {
      clearInterval(jackpotCountdownIntervalRef.current);
    }
    const updateCountdown = () => {
      const timeRemaining = drawDate - new Date();
      if (timeRemaining <= 0) {
        clearInterval(jackpotCountdownIntervalRef.current);
        setIsJackpotTimeReached(true);
        setRunJackpotBtnText("Run Jackpot");
        return;
      }
      const days = Math.floor(timeRemaining / (1000 * 60 * 60 * 24));
      const hours = Math.floor((timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
      let text = "Run Jackpot (";
      if (days > 0) text += `${days}d `;
      text += `${hours}h ${minutes}m ${seconds}s)`;
      setRunJackpotBtnText(text);
    };
    updateCountdown();
    jackpotCountdownIntervalRef.current = setInterval(updateCountdown, 1000);
  };

  const updateJackpotWinnerDisplay = async () => {
    if (!gameId) return;
    const winnerData = await fetchJackpotWinnerData(gameId);
    if (winnerData) {
      setIsJackpotEnabled(true);
      setJackpotWinnerData(winnerData);
      const actualPrize = `${winnerData.payout_amount || 0} BIRR`;
      const drawDate = new Date(winnerData.win_date);
      const formattedDate = drawDate.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const actualId = String(winnerData.winning_number);
      setJackpotPrizeAmount(isJackpotDrawn ? actualPrize : "--- BIRR");
      setJackpotDrawDate(isJackpotDrawn ? formattedDate : "----");
      setJackpotWinnerId(isJackpotDrawn ? actualId : "---");
      const isPastDraw = drawDate <= new Date();
      setIsJackpotTimeReached(isPastDraw);
      setIsJackpotDrawn(false);
      if (isPastDraw) {
        setRunJackpotBtnText("Run Jackpot");
      } else {
        startJackpotDrawCountdown(drawDate);
      }
    } else {
      setIsJackpotEnabled(false);
      setJackpotPrizeAmount("--- BIRR");
      setJackpotDrawDate("----");
      setJackpotWinnerId("---");
      setIsJackpotTimeReached(false);
      setIsJackpotDrawn(false);
      setRunJackpotBtnText("Run Jackpot");
    }
    await updateJackpotDisplay();
  };

  const createConfetti = () => {
    const container = confettiContainerRef.current;
    if (!container) return;
    container.style.display = "block";
    container.innerHTML = "";
    const colors = ["#f0e14a", "#e9a64c", "#e02d2d", "#4caf50", "#5D5CDE", "#3498db", "#ff69b4", "#ffd700"];
    for (let i = 0; i < 300; i++) {
      const confetti = document.createElement("div");
      const size = Math.random() * 10 + 5;
      confetti.style.position = "absolute";
      confetti.style.width = `${size}px`;
      confetti.style.height = size / 2;
      if (Math.random() > 0.5) confetti.style.borderRadius = "50%";
      else confetti.style.clipPath = "polygon(50% 0%, 0% 100%, 100% 100%)";
      confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.left = `${Math.random() * 100}%`;
      confetti.style.top = "-10px";
      confetti.style.animation = `confetti-fall ${Math.random() * 3 + 3}s ease-in-out forwards`;
      confetti.style.opacity = "0.8";
      confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(confetti);
    }
    setTimeout(() => {
      container.style.display = "none";
      container.innerHTML = "";
    }, 7000);
  };

  const createFireworks = () => {
    const container = fireworksContainerRef.current;
    if (!container) return;
    container.style.display = "block";
    container.innerHTML = "";
    const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff", "#ff1493", "#ffd700", "#32cd32", "#ff4500"];
    for (let f = 0; f < 15; f++) {
      setTimeout(() => {
        const fwContainer = document.createElement("div");
        fwContainer.style.position = "absolute";
        fwContainer.style.left = `${Math.random() * 100}%`;
        fwContainer.style.top = `${Math.random() * 50 + 20}%`;
        fwContainer.style.width = "0";
        fwContainer.style.height = "0";
        fwContainer.style.pointerEvents = "none";
        container.appendChild(fwContainer);

        const rocket = document.createElement("div");
        rocket.style.position = "absolute";
        rocket.style.width = "6px";
        rocket.style.height = "6px";
        rocket.style.backgroundColor = "#fff";
        rocket.style.borderRadius = "50%";
        rocket.style.left = "50%";
        rocket.style.top = "0";
        rocket.style.transform = "translateX(-50%)";
        rocket.style.boxShadow = "0 0 20px #fff, 0 0 30px #fff";
        fwContainer.appendChild(rocket);

        rocket.animate(
          [
            { transform: "translateY(0) translateX(-50%)", opacity: 1 },
            { transform: "translateY(-200px) translateX(-50%)", opacity: 0 },
          ],
          { duration: 1000, easing: "ease-out" }
        );

        setTimeout(() => {
          rocket.remove();
          for (let p = 0; p < 200; p++) {
            const particle = document.createElement("div");
            const angle = (p / 200) * Math.PI * 2;
            const velocity = 150 + Math.random() * 100;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            particle.style.position = "absolute";
            particle.style.width = `${Math.random() * 8 + 4}px`;
            particle.style.height = particle.style.width;
            particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            particle.style.borderRadius = "50%";
            particle.style.left = "50%";
            particle.style.top = "50%";
            particle.style.transform = "translate(-50%, -50%)";
            particle.style.opacity = "1";
            particle.style.boxShadow = `0 0 20px currentColor, 0 0 40px currentColor`;
            fwContainer.appendChild(particle);
            particle
              .animate(
                [
                  { transform: `translate(-50%, -50%) scale(1)`, opacity: 1 },
                  { transform: `translate(${vx}px, ${vy}px) scale(0)`, opacity: 0 },
                ],
                { duration: 3000 + Math.random() * 2000, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)" }
              )
              .onfinish = () => particle.remove();
          }
        }, 1000);

        setTimeout(() => fwContainer.remove(), 5000);
      }, f * 200);
    }

    setTimeout(() => {
      container.style.display = "none";
      container.innerHTML = "";
    }, 8000);
  };

  const startCelebration = () => {
    createConfetti();
    setTimeout(() => createConfetti(), 500);
    setTimeout(() => createConfetti(), 1000);
    setTimeout(() => createConfetti(), 1500);
    createFireworks();
    setTimeout(() => createFireworks(), 2000);
    setTimeout(() => createFireworks(), 3500);
  };

  const shuffleWinnerIdAnimation = () => {
    if (jackpotWinnerShuffleInterval) clearInterval(jackpotWinnerShuffleInterval);
    if (!jackpotWinnerData) {
      setJackpotWinnerId("---");
      return;
    }
    setIsJackpotAnimating(true);
  // start local visual effects only via confetti/fireworks
    SoundService.playSound("jackpot-running", { loop: true });
    setJackpotWinnerId("0000");
    let counter = 0;
    const interval = setInterval(() => {
      const randomId = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
      setJackpotWinnerId(randomId);
      counter++;
      if (counter >= 20) {
        clearInterval(interval);
        const finalId = parseInt(jackpotWinnerData.winning_number).toString();
        setJackpotWinnerId(finalId);
        const actualPrize = `${jackpotWinnerData.payout_amount || 0} BIRR`;
        setJackpotPrizeAmount(actualPrize);
        const drawDate = new Date(jackpotWinnerData.win_date);
        const formattedDate = drawDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        setJackpotDrawDate(formattedDate);
        setIsJackpotDrawn(true);
        SoundService.playSound("jackpot-running", { stop: true });
        SoundService.playSound("jackpot-congrats");
        startCelebration();
        setShowJackpotMessage(true);
        setTimeout(() => {
          setIsJackpotAnimating(false);
    // end visual effects
          setShowJackpotMessage(false);
        }, 10000);
      }
    }, 100);
    setJackpotWinnerShuffleInterval(interval);
  };

  const handleRunJackpot = async () => {
    if (!isJackpotTimeReached || !gameId || !userId || isJackpotDrawn || !isJackpotEnabled) {
      setCallError?.(
        "Cannot run jackpot: Invalid game or user, or already drawn, or not time yet, or not enabled"
      );
      setIsErrorModalOpen?.(true);
      return;
    }
    shuffleWinnerIdAnimation();
    setRunJackpotBtnText("Jackpot Drawn");
    await updateJackpotDisplay();
  };

  useEffect(() => {
    if (!userId) return;
    updateJackpotDisplay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    if (!userId || !gameId) return;
    updateJackpotDisplay();
    updateJackpotWinnerDisplay();
    // cleanup
    return () => {
      if (jackpotCountdownIntervalRef.current) clearInterval(jackpotCountdownIntervalRef.current);
      if (jackpotWinnerShuffleInterval) clearInterval(jackpotWinnerShuffleInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, gameId]);

  return (
    <>
      {/* Jackpot Winner Message */}
      {showJackpotMessage && jackpotWinnerData?.winner_message && (
        <div className="fixed top-20 left-0 right-0 z-50 flex justify-center items-center p-4 animate-fadeIn">
          <div className="bg-[#0a1235] border-4 border-[#f0e14a] rounded-xl p-6 shadow-2xl max-w-4xl mx-4">
            <h2 className="text-6xl font-black text-[#f0e14a] text-center uppercase tracking-wider">
              {jackpotWinnerData.winner_message}
            </h2>
          </div>
        </div>
      )}

      <JackpotPanel
        isAnimating={isJackpotAnimating}
        jackpotAmount={jackpotAmount}
        displayWinnerId={formattedWinnerId}
        jackpotPrizeAmount={jackpotPrizeAmount}
        jackpotDrawDate={jackpotDrawDate}
        onRunJackpot={handleRunJackpot}
        canRun={Boolean(gameId && userId && !isJackpotDrawn && isJackpotEnabled)}
        runJackpotBtnText={runJackpotBtnText}
      />

      {/* Confetti Container */}
      <div ref={confettiContainerRef} className="fixed inset-0 pointer-events-none z-50 overflow-hidden" style={{ display: "none" }} />

      {/* Fireworks Container */}
      <div ref={fireworksContainerRef} className="fixed inset-0 pointer-events-none z-50 overflow-hidden" style={{ display: "none" }} />

      <style jsx>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        @keyframes bounce { 0%, 20%, 60%, 100% { transform: translateY(0); } 40% { transform: translateY(-10px);} 80% { transform: translateY(-5px);} }
      `}</style>
    </>
  );
};

export default JackpotContainer;
