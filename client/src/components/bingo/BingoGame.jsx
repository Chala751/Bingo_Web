import React, { useState, useEffect, useRef, useContext } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { LanguageContext } from "../../context/LanguageProvider";
import { useBingoGame } from "../../hooks/useBingoGame";
import gameService from "../../services/game";
import SoundService from "../../services/sound";
import BingoModals from "./Modals/BingoModals";
import { FaMoneyBillWave } from "react-icons/fa";

const BingoGame = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => {
    const storedUser = localStorage.getItem("user");
    return storedUser ? JSON.parse(storedUser) : null;
  });
  const [isInvalidCardModalOpen, setIsInvalidCardModalOpen] = useState(false);
  const { language, translations, toggleLanguage } =
    useContext(LanguageContext);
  const { game, fetchGame, callNumber, checkBingo, finishGame, error } =
    useBingoGame();
  const [searchParams] = useSearchParams();

  // Game state
  const [gameData, setGameData] = useState(null);
  const [bingoCards, setBingoCards] = useState([]);
  const [calledNumbers, setCalledNumbers] = useState([]);
  const [lastCalledNumbers, setLastCalledNumbers] = useState([]);
  const [currentNumber, setCurrentNumber] = useState(null);
  const [isAutoCall, setIsAutoCall] = useState(false);
  const [speed, setSpeed] = useState(
    () => parseInt(localStorage.getItem("bingoAutoCallSpeed")) || 8
  );
  // Internal lead time (computed): initiate auto-call earlier to mask latency
  // Goal: for 8s interval, start around the 6th–7th second (lead ≈ 1.6–2.0s)
  const computeLeadMs = (s) => {
    const interval = Math.max(1, s) * 1000;
    // Base as 20% of interval
    let base = Math.round(interval * 0.2); // e.g., 8s -> 1600ms lead
    // For longer intervals, ensure a minimum absolute lead window
    if (interval >= 6000) base = Math.max(base, 1200);
    if (interval >= 8000) base = Math.max(base, 1600); // 8s+: at least 1.6s early
    if (interval >= 10000) base = Math.max(base, 2000); // 10s+: at least 2s early

    const safetyMargin = 100; // keep at least 100ms before the exact target
    const maxLead = Math.max(0, interval - safetyMargin);
    // Clamp to [150ms, interval - safety]
    const clamped = Math.min(Math.max(base, 150), maxLead);
    return clamped;
  };
  const getLeadMs = (s) => {
    try {
      const interval = Math.max(1, s) * 1000;
      const safetyMargin = 100;
      // adaptiveLeadMsRef may not exist in older code paths; guard access
      const adaptive =
        typeof adaptiveLeadMsRef !== "undefined" &&
        Number.isFinite(adaptiveLeadMsRef?.current)
          ? adaptiveLeadMsRef.current
          : null;
      const baseLead = computeLeadMs(s);
      // Never go below the base lead; allow adaptive to increase if needed
      const candidate = Math.max(baseLead, adaptive ?? 0);
      const lead = Math.min(candidate, Math.max(0, interval - safetyMargin));
      return Math.max(0, lead);
    } catch (e) {
      return computeLeadMs(s);
    }
  };
  const [isPlaying, setIsPlaying] = useState(false);
  const [cardId, setCardId] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [isGameOver, setIsGameOver] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isCallingNumber, setIsCallingNumber] = useState(false);
  const [callError, setCallError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [winningPattern, setWinningPattern] = useState("line");
  const [bingoStatus, setBingoStatus] = useState(null);
  const [nonWinnerCardData, setNonWinnerCardData] = useState(null);

  // NEW: Add missing states for modals and messages (from handleCheckCard)
  const [showWinModal, setShowWinModal] = useState(false);
  const [winnerData, setWinnerData] = useState(null);
  const [showMessage, setShowMessage] = useState(null);
  const [messageType, setMessageType] = useState(null);
  const [cards, setCards] = useState([]); // NEW: Dedicated state for full cards (replaces bingoCards for check logic)

  // NEW: Track if game has started once
  const [hasStarted, setHasStarted] = useState(false);

  // Shuffle animation states
  const [boardNumbers] = useState(Array.from({ length: 75 }, (_, i) => i + 1));
  const [displayNumbers, setDisplayNumbers] = useState(
    Array.from({ length: 75 }, (_, i) => i + 1)
  );
  const [isShuffling, setIsShuffling] = useState(false);
  const shuffleIntervalRef = useRef(null);

  // Jackpot state
  const [jackpotAmount, setJackpotAmount] = useState(0);
  const [jackpotWinnerData, setJackpotWinnerData] = useState(null);
  const [isJackpotTimeReached, setIsJackpotTimeReached] = useState(false);
  const [jackpotWinnerShuffleInterval, setJackpotWinnerShuffleInterval] =
    useState(null);
  const jackpotCountdownIntervalRef = useRef(null);
  const [runJackpotBtnText, setRunJackpotBtnText] = useState("Run Jackpot");
  const [jackpotWinnerId, setJackpotWinnerId] = useState("---");
  const [jackpotPrizeAmount, setJackpotPrizeAmount] = useState("--- BIRR");
  const [jackpotDrawDate, setJackpotDrawDate] = useState("----");
  const [isJackpotDrawn, setIsJackpotDrawn] = useState(false); // New state to track if jackpot has been drawn
  const [isJackpotEnabled, setIsJackpotEnabled] = useState(false);
  const [isJackpotAnimating, setIsJackpotAnimating] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [showJackpotMessage, setShowJackpotMessage] = useState(false);

  // Modal states
  const [isNonWinnerModalOpen, setIsNonWinnerModalOpen] = useState(false);
  const [isWinnerModalOpen, setIsWinnerModalOpen] = useState(false);
  const [isGameFinishedModalOpen, setIsGameFinishedModalOpen] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  // Refs
  const autoIntervalRef = useRef(null);
  // AbortController for cancelling an in-flight callNumber request
  const callAbortControllerRef = useRef(null);
  // Precise auto-call scheduler (drift-corrected)
  const autoSchedulerRef = useRef({
    timerId: null,
    nextAt: null,
    running: false,
    pending: false,
  });
  // Prevent overlapping network calls and track in-flight number
  const inFlightCallRef = useRef(false);
  const inFlightNumberRef = useRef(null);
  // Map<number, [{ cardId, letter, row }]>
  const numberIndexRef = useRef(new Map());
  // Fast membership cache for called numbers
  const calledNumbersSetRef = useRef(new Set());
  // Guard to prevent overlapping card checks
  const checkInFlightRef = useRef(false);
  // Adaptive network/audio lead time (ms) based on measured RTT
  const adaptiveLeadMsRef = useRef(null);
  const autoModeRef = useRef(false);
  const lastPrizePoolUpdateRef = useRef(0);
  const containerRef = useRef(null);
  const confettiContainerRef = useRef(null);
  const fireworksContainerRef = useRef(null);

  // Abort any in-flight call when auto-call is turned off from anywhere
  useEffect(() => {
    if (!isAutoCall) {
      if (callAbortControllerRef.current) {
        try {
          callAbortControllerRef.current.abort();
        } catch (e) {
          console.warn("Failed to abort call controller on auto-call off:", e);
        }
        callAbortControllerRef.current = null;
      }
      inFlightCallRef.current = false;
      inFlightNumberRef.current = null;
      autoSchedulerRef.current.pending = false;
      setIsCallingNumber(false);
    }
    // no cleanup
  }, [isAutoCall]);

  useEffect(() => {
    localStorage.setItem("bingoAutoCallSpeed", speed);
  }, [speed]);
  // Reset adaptive lead when speed changes
  useEffect(() => {
    if (typeof adaptiveLeadMsRef !== "undefined") {
      adaptiveLeadMsRef.current = null;
    }
  }, [speed]);

  // Keep a Set of called numbers for O(1) membership checks
  useEffect(() => {
    try {
      calledNumbersSetRef.current = new Set(
        Array.isArray(calledNumbers) ? calledNumbers : []
      );
    } catch (e) {
      calledNumbersSetRef.current = new Set();
    }
  }, [calledNumbers]);

  // Real jackpot fetch using service
  const fetchJackpotAmount = async () => {
    if (!user?.id) {
      console.warn("[fetchJackpotAmount] No user ID available");
      return 0;
    }
    try {
      const jackpotData = await gameService.getJackpot(user.id);
      console.log("[fetchJackpotAmount] Fetched jackpot data:", jackpotData);

      // Convert amount to integer safely (use data.amount for current jackpot, not baseAmount)
      const amount = parseInt(jackpotData?.amount, 10) || 0;
      console.log(
        `[fetchJackpotAmount] Using amount: ${amount} (baseAmount was ${jackpotData?.data?.baseAmount})`
      );
      return amount;
    } catch (error) {
      console.error("[fetchJackpotAmount] Error fetching jackpot:", error);
      return 0;
    }
  };

  const fetchJackpotWinnerData = async (gameId) => {
    if (!gameId) {
      console.warn("[fetchJackpotWinnerData] No game ID provided");
      return null;
    }
    try {
      const game = await gameService.getGame(gameId);
      console.log("[fetchJackpotWinnerData] Fetched game data:", {
        gameId,
        gameNumber: game.gameNumber,
        jackpotEnabled: game.jackpotEnabled,
        jackpotWinnerCardId: game.jackpotWinnerCardId,
        jackpotAwardedAmount: game.jackpotAwardedAmount,
        jackpotWinnerMessage: game.jackpotWinnerMessage,
        jackpotDrawTimestamp: game.jackpotDrawTimestamp,
      });

      if (game.jackpotEnabled && game.jackpotWinnerCardId) {
        const drawDate = game.jackpotDrawTimestamp
          ? new Date(game.jackpotDrawTimestamp)
          : new Date();
        return {
          winning_number: String(game.jackpotWinnerCardId),
          payout_amount: game.jackpotAwardedAmount || 0,
          win_date: drawDate.toISOString(),
          winner_message:
            game.jackpotWinnerMessage ||
            `Jackpot won by card ${game.jackpotWinnerCardId}`,
        };
      }

      console.log(
        "[fetchJackpotWinnerData] Jackpot not enabled or no winner card, returning null"
      );
      return null;
    } catch (error) {
      console.error(
        "[fetchJackpotWinnerData] Error fetching jackpot winner data:",
        {
          error: error.message,
          gameId,
          stack: error.stack,
        }
      );
      return null;
    }
  };

  const updateJackpotDisplay = async () => {
    if (!user?.id) {
      console.warn("[updateJackpotDisplay] No user ID, skipping fetch");
      return; // Do nothing if user not ready
    }
    try {
      const amount = await fetchJackpotAmount();
      setJackpotAmount(amount);
    } catch (error) {
      console.error("[updateJackpotDisplay] Error fetching jackpot:", error);
    }
  };

  // Update jackpot winner display
  const updateJackpotWinnerDisplay = async () => {
    const gameId =
      searchParams.get("id") || sessionStorage.getItem("currentGameId");
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

  // Start countdown
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
      const hours = Math.floor(
        (timeRemaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
      );
      const minutes = Math.floor(
        (timeRemaining % (1000 * 60 * 60)) / (1000 * 60)
      );
      const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
      let text = "Run Jackpot (";
      if (days > 0) text += `${days}d `;
      text += `${hours}h ${minutes}m ${seconds}s)`;
      setRunJackpotBtnText(text);
    };
    updateCountdown();
    jackpotCountdownIntervalRef.current = setInterval(updateCountdown, 1000);
  };

  // Shuffle winner ID animation
  const shuffleWinnerIdAnimation = () => {
    if (jackpotWinnerShuffleInterval) {
      clearInterval(jackpotWinnerShuffleInterval);
    }
    if (!jackpotWinnerData) {
      setJackpotWinnerId("---");
      return;
    }
    setIsJackpotAnimating(true);
    setIsShaking(true);
    setIsCelebrating(true);
    SoundService.playSound("jackpot-running", { loop: true });
    setJackpotWinnerId("0000"); // Start animation
    let counter = 0;
    const interval = setInterval(() => {
      const randomId = Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, "0");
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
        // Trigger celebration animations
        startCelebration();
        setShowJackpotMessage(true);
        setTimeout(() => {
          setIsJackpotAnimating(false);
          setIsShaking(false);
          setIsCelebrating(false);
          setShowJackpotMessage(false);
        }, 10000); // Extended for more celebration time and message display
      }
    }, 100);
    setJackpotWinnerShuffleInterval(interval);
  };

  // Start celebration with multiple effects
  const startCelebration = () => {
    // Multiple confetti bursts
    createConfetti();
    setTimeout(() => createConfetti(), 500);
    setTimeout(() => createConfetti(), 1000);
    setTimeout(() => createConfetti(), 1500);
    // Fireworks
    createFireworks();
    setTimeout(() => createFireworks(), 2000);
    setTimeout(() => createFireworks(), 3500);
  };

  // Create confetti
  const createConfetti = () => {
    const container = confettiContainerRef.current;
    if (!container) return;
    container.style.display = "block";
    container.innerHTML = "";
    const colors = [
      "#f0e14a",
      "#e9a64c",
      "#e02d2d",
      "#4caf50",
      "#5D5CDE",
      "#3498db",
      "#ff69b4",
      "#ffd700",
    ];
    for (let i = 0; i < 300; i++) {
      const confetti = document.createElement("div");
      const size = Math.random() * 10 + 5;
      confetti.style.position = "absolute";
      confetti.style.width = `${size}px`;
      confetti.style.height = size / 2;
      if (Math.random() > 0.5) {
        confetti.style.borderRadius = "50%";
      } else {
        confetti.style.clipPath = "polygon(50% 0%, 0% 100%, 100% 100%)";
      }
      confetti.style.backgroundColor =
        colors[Math.floor(Math.random() * colors.length)];
      confetti.style.left = `${Math.random() * 100}%`;
      confetti.style.top = "-10px";
      confetti.style.animation = `confetti-fall ${
        Math.random() * 3 + 3
      }s ease-in-out forwards`;
      confetti.style.opacity = "0.8";
      confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
      container.appendChild(confetti);
    }
    setTimeout(() => {
      container.style.display = "none";
      container.innerHTML = "";
    }, 7000);
  };

  // Create fireworks
  const createFireworks = () => {
    const container = fireworksContainerRef.current;
    if (!container) return;
    container.style.display = "block";
    container.innerHTML = "";
    const colors = [
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffff00",
      "#ff00ff",
      "#00ffff",
      "#ff1493",
      "#ffd700",
      "#32cd32",
      "#ff4500",
    ];
    for (let f = 0; f < 15; f++) {
      // Increased to 15 fireworks
      setTimeout(() => {
        const fwContainer = document.createElement("div");
        fwContainer.style.position = "absolute";
        fwContainer.style.left = `${Math.random() * 100}%`;
        fwContainer.style.top = `${Math.random() * 50 + 20}%`;
        fwContainer.style.width = "0";
        fwContainer.style.height = "0";
        fwContainer.style.pointerEvents = "none";
        container.appendChild(fwContainer);

        // Launch rocket
        const rocket = document.createElement("div");
        rocket.style.position = "absolute";
        rocket.style.width = "6px"; // Increased size
        rocket.style.height = "6px";
        rocket.style.backgroundColor = "#fff";
        rocket.style.borderRadius = "50%";
        rocket.style.left = "50%";
        rocket.style.top = "0";
        rocket.style.transform = "translateX(-50%)";
        rocket.style.boxShadow = "0 0 20px #fff, 0 0 30px #fff"; // Enhanced glow
        fwContainer.appendChild(rocket);

        // Animate rocket launch
        rocket.animate(
          [
            { transform: "translateY(0) translateX(-50%)", opacity: 1 },
            { transform: "translateY(-200px) translateX(-50%)", opacity: 0 },
          ],
          {
            duration: 1000,
            easing: "ease-out",
          }
        );

        // Explode after launch
        setTimeout(() => {
          rocket.remove();
          for (let p = 0; p < 200; p++) {
            // Increased to 200 particles
            const particle = document.createElement("div");
            const angle = (p / 200) * Math.PI * 2;
            const velocity = 150 + Math.random() * 100; // Increased velocity
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;
            particle.style.position = "absolute";
            particle.style.width = `${Math.random() * 8 + 4}px`; // Larger particles
            particle.style.height = particle.style.width;
            particle.style.backgroundColor =
              colors[Math.floor(Math.random() * colors.length)];
            particle.style.borderRadius = "50%";
            particle.style.left = "50%";
            particle.style.top = "50%";
            particle.style.transform = "translate(-50%, -50%)";
            particle.style.opacity = "1";
            particle.style.boxShadow = `0 0 20px currentColor, 0 0 40px currentColor`; // Enhanced glow
            fwContainer.appendChild(particle);

            // Animate particle explosion using JS
            particle.animate(
              [
                {
                  transform: `translate(-50%, -50%) scale(1)`,
                  opacity: 1,
                },
                {
                  transform: `translate(${vx}px, ${vy}px) scale(0)`,
                  opacity: 0,
                },
              ],
              {
                duration: 3000 + Math.random() * 2000,
                easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
              }
            ).onfinish = () => {
              particle.remove();
            };
          }
        }, 1000);

        // Remove fwContainer after
        setTimeout(() => {
          fwContainer.remove();
        }, 5000);
      }, f * 200); // Faster sequencing for more action
    }

    setTimeout(() => {
      container.style.display = "none";
      container.innerHTML = "";
    }, 8000); // Longer duration
  };

  // Run jackpot button handler (connected to service)
  const handleRunJackpot = async () => {
    if (
      !isJackpotTimeReached ||
      !gameData?._id ||
      !user?.id ||
      isJackpotDrawn ||
      !isJackpotEnabled
    ) {
      setCallError(
        "Cannot run jackpot: Invalid game or user, or already drawn, or not time yet, or not enabled"
      );
      setIsErrorModalOpen(true);
      return;
    }

    // Since predefined, just animate reveal
    shuffleWinnerIdAnimation();
    setRunJackpotBtnText("Jackpot Drawn");
    await updateJackpotDisplay();
  };
  // Update jackpot after game using service
  const updateJackpotAfterGame = async (prizePool) => {
    if (!gameData?._id || !user?.id || prizePool <= 0) return;
    const contribution = Math.floor(prizePool * 0.01);
    try {
      await gameService.addJackpotContribution(gameData._id, contribution);
      console.log(
        `[updateJackpotAfterGame] Added contribution: ${contribution}`
      );
      // Refetch updated amount
      await updateJackpotDisplay();
    } catch (error) {
      console.error(
        "[updateJackpotAfterGame] Error adding contribution:",
        error
      );
    }
  };

  // FIXED: Load game data with explicit param pass
  useEffect(() => {
    const gameId =
      searchParams.get("id") || sessionStorage.getItem("currentGameId");
    if (!gameId) {
      console.error("[BingoGame] No game ID found");
      setCallError("No game ID found");
      setIsErrorModalOpen(true);
      setIsLoading(false);
      navigate("/cashier-dashboard");
      return;
    }
    sessionStorage.setItem("currentGameId", gameId);
    const loadGame = async () => {
      try {
        setIsLoading(true);
        const fetchedGame = await fetchGame(gameId);
        console.log(
          "[BingoGame] Fetched game data:",
          JSON.stringify(fetchedGame, null, 2)
        );
        if (!fetchedGame.gameNumber) {
          console.warn("[BingoGame] gameNumber is missing in fetchedGame");
        }
        if (!fetchedGame._id) {
          throw new Error("Fetched game data missing _id");
        }
        setGameData(fetchedGame);
        setCalledNumbers(fetchedGame.calledNumbers || []);

        // Check for started flag
        const startedFlag = localStorage.getItem(`bingoGameStarted_${gameId}`);
        if (startedFlag === "true") {
          setHasStarted(true);
        }

        // FIXED: Pass explicit selectedCards to avoid state lag
        await fetchBingoCards(
          gameId,
          fetchedGame.selectedCards || [],
          fetchedGame.calledNumbers || []
        );

        setGameData((prev) => ({
          ...prev,
          prizePool: fetchedGame.prizePool || 0,
        }));
      } catch (error) {
        console.error("[BingoGame] loadGame error:", error.message);
        setCallError(error.message || "Failed to load game");
        setIsErrorModalOpen(true);
        setGameData(null);
        navigate("/cashier-dashboard");
      } finally {
        setIsLoading(false);
      }
    };
    loadGame();
  }, [searchParams, fetchGame, navigate]);

  // Update prize pool
  useEffect(() => {
    if (gameData?._id) {
      updatePrizePoolDisplay();
    }
  }, [gameData?._id]);

  useEffect(() => {
    if (!user?.id) return;
    updateJackpotDisplay();
    updateJackpotWinnerDisplay();
  }, [user?.id, searchParams]); // Added searchParams to refetch on game ID change

  // FIXED: Full overwrite (restores selectedCards + all fields)
  const updatePrizePoolDisplay = async () => {
    if (!gameData?._id) {
      console.warn(
        "[updatePrizePoolDisplay] No game ID available, skipping update"
      );
      return;
    }
    try {
      console.log(
        `[updatePrizePoolDisplay] Fetching game with ID: ${gameData._id}`
      );
      const game = await gameService.getGame(gameData._id);
      console.log(
        `[updatePrizePoolDisplay] Fetched game.prizePool: ${game.prizePool}, full game:`,
        game
      );
      const newPrizePool = game.prizePool || 0;
      console.log(
        `[updatePrizePoolDisplay] Setting full game (prizePool: ${newPrizePool})`
      );

      // Preserve selectedCards if backend omits it in this response
      setGameData((prev) => ({
        ...prev,
        ...game,
        selectedCards: game.selectedCards ?? prev?.selectedCards ?? [],
      }));

      console.log(
        `[updatePrizePoolDisplay] After setGameData, gameData.selectedCards length: ${
          game.selectedCards?.length || 0
        }`
      );
    } catch (error) {
      console.error(
        "[updatePrizePoolDisplay] Error fetching prize pool:",
        error.message
      );
      setCallError(error.message || "Failed to fetch prize pool");
      setIsErrorModalOpen(true);
    }
  };

  // Game updates - FIXED: Prevent overwriting calledNumbers if backend clears it (e.g., on finish)
  useEffect(() => {
    if (game) {
      setGameData((prev) => {
        const newData = {
          ...prev,
          ...game,
          // Preserve selectedCards if missing from this update
          selectedCards: game.selectedCards ?? prev?.selectedCards ?? [],
        };
        // Preserve prizePool if the game is completed (backend may reset it to 0)
        if (
          game.status === "completed" &&
          prev.prizePool !== undefined &&
          prev.prizePool !== null
        ) {
          newData.prizePool = prev.prizePool;
        }
        return newData;
      });
      setWinningPattern(game.pattern?.replace("_", " ") || "line");
      // Only update calledNumbers if the new list is longer or current is empty (prevents clearing on finish)
      if (
        game.calledNumbers?.length > calledNumbers.length ||
        calledNumbers.length === 0
      ) {
        setCalledNumbers(game.calledNumbers || []);
      }
      setIsGameOver(game.status === "completed");
    }
  }, [game]);

  // Jackpot init
  useEffect(() => {
    updateJackpotDisplay();
    updateJackpotWinnerDisplay();
  }, [user?.id]); // Depend on user.id for refetch

  // Auto-call scheduler (drift-corrected and sequential, schedules before work)
  useEffect(() => {
    const nowMs = () =>
      typeof performance !== "undefined" ? performance.now() : Date.now();

    const canAutoCall =
      isAutoCall &&
      !isGameOver &&
      !!gameData?._id &&
      isPlaying &&
      gameData?.status === "active";

    const stopScheduler = () => {
      autoModeRef.current = false;
      autoSchedulerRef.current.running = false;
      autoSchedulerRef.current.pending = false;
      if (autoSchedulerRef.current.timerId) {
        clearTimeout(autoSchedulerRef.current.timerId);
        autoSchedulerRef.current.timerId = null;
      }
      if (autoIntervalRef.current) {
        clearInterval(autoIntervalRef.current);
        autoIntervalRef.current = null;
      }
    };

    const scheduleNext = (baseNextAt) => {
      autoSchedulerRef.current.nextAt = baseNextAt;
      const lead = getLeadMs ? getLeadMs(speed) : computeLeadMs(speed);
      const delay = Math.max(0, baseNextAt - lead - nowMs());
      autoSchedulerRef.current.timerId = setTimeout(async () => {
        // Pre-checks: if any fail, stop
        if (
          !autoModeRef.current ||
          isGameOver ||
          !gameData?._id ||
          !isPlaying ||
          gameData?.status !== "active"
        ) {
          stopScheduler();
          return;
        }

        // Schedule the following tick BEFORE doing the work, to keep cadence
        const intervalMs = speed * 1000;
        let nextTarget =
          (autoSchedulerRef.current.nextAt || nowMs()) + intervalMs;
        const now = nowMs();
        if (nextTarget < now - intervalMs) {
          // If we fell way behind (tab throttling, etc), reset schedule
          nextTarget = now + intervalMs;
        }
        if (autoModeRef.current) {
          scheduleNext(nextTarget);
        }

        // Now perform the call (non-blocking for the schedule)
        try {
          await handleCallNumber(null, { isAuto: true });
        } catch (e) {
          // Swallow here; handleCallNumber manages its own errors
        }
      }, delay);
    };

    if (canAutoCall) {
      autoModeRef.current = true;
      autoSchedulerRef.current.running = true;
      // Start from now + interval for predictable cadence
      scheduleNext(nowMs() + speed * 1000);
    } else {
      stopScheduler();
    }

    return () => {
      stopScheduler();
    };
  }, [
    isAutoCall,
    speed,
    isGameOver,
    isPlaying,
    gameData?._id,
    gameData?.status,
  ]);

  // Fullscreen handling
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Sound preload
  useEffect(() => {
    SoundService.preloadSounds(language).catch((err) => {
      console.error("Failed to preload sounds:", err);
      setCallError("Failed to load audio files");
      setIsErrorModalOpen(true);
    });
  }, [language]);

  // FIXED: fetchBingoCards with explicit param, fetch all cards and match
  const fetchBingoCards = async (
    gameId,
    selectedCardsParam,
    currentCalledNumbers = []
  ) => {
    if (!gameId) {
      setCallError("Invalid game ID for fetching cards");
      setIsErrorModalOpen(true);
      return;
    }
    try {
      const allCards = await gameService.getAllCards();
      let gameCards =
        selectedCardsParam?.map((selected) => {
          const fullCard = allCards.find((c) => c.card_number == selected.id);
          if (
            !fullCard ||
            !fullCard.numbers ||
            !Array.isArray(fullCard.numbers) ||
            fullCard.numbers.length !== 5
          ) {
            console.warn(
              `[fetchBingoCards] No full card found for selected ID: ${selected.id}`
            );
            return null;
          }
          const flatNumbers = fullCard.numbers
            .flat()
            .map((num) => (num === "FREE" ? "FREE" : Number(num)));
          const grid = [];
          for (let row = 0; row < 5; row++) {
            grid[row] = [];
            for (let col = 0; col < 5; col++) {
              const index = row * 5 + col;
              grid[row][col] = flatNumbers[index];
            }
          }
          // FIXED: Transpose flat (row-major) to column-major {B,I,N,G,O}
          const letters = ["B", "I", "N", "G", "O"];
          const numbers = {};
          letters.forEach((letter, col) => {
            numbers[letter] = [];
            for (let row = 0; row < 5; row++) {
              const index = row * 5 + col;
              const num = flatNumbers[index];
              numbers[letter][row] = num === "FREE" ? num : Number(num);
            }
          });
          const markedPositions = {
            B: new Array(5).fill(false),
            I: new Array(5).fill(false),
            N: new Array(5).fill(false).map((_, i) => (i === 2 ? true : false)),
            G: new Array(5).fill(false),
            O: new Array(5).fill(false),
          };
          const winningPositions = {
            B: new Array(5).fill(false),
            I: new Array(5).fill(false),
            N: new Array(5).fill(false),
            G: new Array(5).fill(false),
            O: new Array(5).fill(false),
          };
          currentCalledNumbers.forEach((calledNum) => {
            for (let row = 0; row < 5; row++) {
              for (let col = 0; col < 5; col++) {
                if (grid[row][col] === calledNum) {
                  const letter = letters[col];
                  markedPositions[letter][row] = true;
                }
              }
            }
          });
          return {
            id: selected.id, // FIXED: Use 'id' for consistency with handleCheckCard
            cardId: selected.id,
            cardNumber: selected.id,
            numbers,
            markedPositions,
            winningPositions,
            isWinner: false,
            checkCount: 0, // NEW: Add defaults for check logic
            disqualified: false,
            lastCheckTime: null,
          };
        }) || [];
      gameCards = gameCards.filter(Boolean); // Remove nulls
      // Build fast lookup index: number -> list of {cardId, letter, row}
      const index = new Map();
      for (const card of gameCards) {
        const letters = ["B", "I", "N", "G", "O"];
        for (let col = 0; col < 5; col++) {
          for (let row = 0; row < 5; row++) {
            const letter = letters[col];
            const num = card.numbers[letter][row];
            if (typeof num === "number") {
              if (!index.has(num)) index.set(num, []);
              index.get(num).push({ cardId: card.id, letter, row });
            }
          }
        }
      }
      numberIndexRef.current = index;
      setBingoCards(gameCards);
      setCards(gameCards); // NEW: Sync to cards state
      console.log(`[fetchBingoCards] Set ${gameCards.length} cards`);
    } catch (error) {
      setCallError(error.message || "Failed to fetch cards");
      setIsErrorModalOpen(true);
    }
  };

  // NEW: Helper function to get numbers for pattern (mirroring backend logic)
  // In BingoGame.jsx — Replace the function with this (adds scanning logic)
  const getNumbersForPatternBackendStyle = (
    numbers, // 2D 5x5 grid
    pattern,
    excludeIndices = [],
    isWinner = false,
    calledNumbers = [], // NEW: Pass from caller (e.g., calledNumbers state)
    includeMarked = true // NEW: For winners, include all in pattern
  ) => {
    console.log(
      "[getNumbersForPatternBackendStyle] Processing pattern:",
      pattern,
      "with numbers:",
      numbers,
      "calledNumbers:",
      calledNumbers
    );

    // Validate input (unchanged)
    if (
      !Array.isArray(numbers) ||
      numbers.length !== 5 ||
      numbers.some((row) => !Array.isArray(row) || row.length !== 5)
    ) {
      throw new Error("Invalid card numbers: must be a 5x5 array");
    }
    if (!pattern) {
      throw new Error("Pattern must be specified");
    }

    // Define fixed patterns (unchanged, but we'll override for lines)
    const patterns = {
      four_corners_center: [0, 4, 20, 24, 12],
      cross: [2, 7, 12, 17, 22, 10, 11, 13, 14],
      main_diagonal: [0, 6, 12, 18, 24],
      other_diagonal: [4, 8, 12, 16, 20],
      // REMOVED: horizontal_line & vertical_line hardcodes — handle dynamically below
      all: Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 12),
      full_card: Array.from({ length: 25 }, (_, i) => i).filter(
        (i) => i !== 12
      ),
      inner_corners: [6, 8, 16, 18],
    };

    let selectedIndices = [];

    if (patterns[pattern]) {
      selectedIndices = patterns[pattern];
    } else if (pattern === "horizontal_line" || pattern === "vertical_line") {
      // NEW: Dynamic scan for actual complete line (mirror backend)
      const safeCalled = Array.isArray(calledNumbers) ? calledNumbers : [];
      const isLineComplete = (line) =>
        line.every(
          (cell) => cell === "FREE" || safeCalled.includes(Number(cell))
        );

      if (pattern === "horizontal_line") {
        let winningRow = -1;
        if (includeMarked) {
          // For winners: Find first complete row
          for (let row = 0; row < 5; row++) {
            if (isLineComplete(numbers[row])) {
              winningRow = row;
              break;
            }
          }
        } else if (!isWinner) {
          // For non-winners: Random row (unchanged)
          winningRow = Math.floor(Math.random() * 5);
        }
        if (winningRow >= 0) {
          selectedIndices = Array.from(
            { length: 5 },
            (_, col) => winningRow * 5 + col
          );
        }
      } else if (pattern === "vertical_line") {
        let winningCol = -1;
        if (includeMarked) {
          for (let col = 0; col < 5; col++) {
            const colLine = numbers.map((row) => row[col]);
            if (isLineComplete(colLine)) {
              winningCol = col;
              break;
            }
          }
        } else if (!isWinner) {
          winningCol = Math.floor(Math.random() * 5);
        }
        if (winningCol >= 0) {
          selectedIndices = Array.from(
            { length: 5 },
            (_, row) => row * 5 + winningCol
          );
        }
      }
    } else {
      throw new Error(`Invalid pattern: ${pattern}`);
    }

    // Filter exclusions & free (unchanged)
    selectedIndices = selectedIndices.filter(
      (idx) => !excludeIndices.includes(idx) && idx !== 12
    );

    // Map to numbers (unchanged)
    const flatNumbers = numbers.flat();
    const selectedNumbers = selectedIndices
      .map((idx) => flatNumbers[idx])
      .filter((num) => typeof num === "number" && num >= 1 && num <= 75);

    console.log("[getNumbersForPatternBackendStyle] Returning:", {
      selectedIndices,
      selectedNumbers,
    });

    return { selectedIndices, selectedNumbers };
  };

  const getNumbersForPattern = (
    cardNumbers,
    pattern,
    calledNumbers = [],
    selectSpecificLine = false,
    targetIndices = [],
    includeMarked = false,
    lastCalledNumber = null
  ) => {
    if (
      !cardNumbers ||
      (!Array.isArray(cardNumbers) && typeof cardNumbers !== "object")
    ) {
      console.warn("[BingoGame] Invalid cardNumbers:", cardNumbers);
      return {
        numbers: [],
        selectedIndices: [],
        rowIndex: null,
        colIndex: null,
        pattern,
      };
    }
    let grid = [];
    try {
      if (Array.isArray(cardNumbers) && Array.isArray(cardNumbers[0])) {
        grid = cardNumbers.map((row) =>
          row.map((cell) => (cell === "FREE" ? "FREE" : Number(cell)))
        );
      } else if (Array.isArray(cardNumbers)) {
        const flatNumbers = cardNumbers.filter(
          (n) => n !== undefined && n !== null
        );
        if (flatNumbers.length >= 25) {
          for (let row = 0; row < 5; row++) {
            grid[row] = [];
            for (let col = 0; col < 5; col++) {
              const index = row * 5 + col;
              const num = flatNumbers[index];
              grid[row][col] =
                num === "FREE" || num === null ? "FREE" : Number(num);
            }
          }
        } else {
          for (let row = 0; row < 5; row++) {
            grid[row] = new Array(5).fill("FREE");
          }
        }
      } else {
        for (let row = 0; row < 5; row++) {
          grid[row] = new Array(5).fill("FREE");
        }
      }
    } catch (error) {
      console.error("[getNumbersForPattern] Error creating grid:", error);
      for (let row = 0; row < 5; row++) {
        grid[row] = new Array(5).fill("FREE");
      }
    }
    let numbers = [];
    let selectedIndices = [];
    let rowIndex = null;
    let colIndex = null;
    const safeCalledNumbers = Array.isArray(calledNumbers) ? calledNumbers : [];
    const filterFn = includeMarked
      ? (n) => n !== "FREE"
      : (n) => {
          const num = Number(n);
          return (
            n !== "FREE" && !isNaN(num) && !safeCalledNumbers.includes(num)
          );
        };
    try {
      const findLineContainingNumber = (lastCalledNumber, grid) => {
        if (!lastCalledNumber) return null;
        const lastCalledStr = String(lastCalledNumber);
        for (let row = 0; row < grid.length; row++) {
          for (let col = 0; col < grid[row].length; col++) {
            if (String(grid[row][col]) === lastCalledStr) {
              return { type: "row", index: row, col: col };
            }
          }
        }
        for (let col = 0; col < grid[0].length; col++) {
          for (let row = 0; row < grid.length; row++) {
            if (String(grid[row][col]) === lastCalledStr) {
              return { type: "col", index: col, row: row };
            }
          }
        }
        return null;
      };
      const isLineComplete = (lineNumbers, calledNumbers) => {
        return lineNumbers.every((num) => {
          if (num === "FREE") return true;
          const numVal = Number(num);
          return !isNaN(numVal) && calledNumbers.includes(numVal);
        });
      };
      switch (pattern) {
        case "horizontal_line":
          let selectedRow = null;
          if (lastCalledNumber) {
            const lineInfo = findLineContainingNumber(lastCalledNumber, grid);
            if (lineInfo && lineInfo.type === "row") {
              selectedRow = lineInfo.index;
            }
          }
          if (!selectedRow) {
            for (let row = 0; row < grid.length; row++) {
              const rowNumbers = grid[row];
              if (isLineComplete(rowNumbers, safeCalledNumbers)) {
                selectedRow = row;
                break;
              }
            }
          }
          if (
            !selectedRow &&
            selectSpecificLine &&
            Array.isArray(targetIndices) &&
            targetIndices.length > 0
          ) {
            selectedRow = Math.max(0, Math.min(4, targetIndices[0]));
          }
          if (selectedRow === null && grid.length > 0) {
            selectedRow = 0;
          }
          if (
            selectedRow !== null &&
            selectedRow >= 0 &&
            selectedRow < grid.length
          ) {
            rowIndex = selectedRow;
            const rowNumbers = grid[selectedRow].filter(filterFn);
            numbers.push(...rowNumbers);
            for (let j = 0; j < 5; j++) {
              if (filterFn(grid[selectedRow][j])) {
                selectedIndices.push(selectedRow * 5 + j);
              }
            }
          }
          break;
        case "vertical_line":
          let selectedCol = null;
          if (lastCalledNumber) {
            const lineInfo = findLineContainingNumber(lastCalledNumber, grid);
            if (lineInfo && lineInfo.type === "col") {
              selectedCol = lineInfo.index;
            }
          }
          if (!selectedCol) {
            for (let col = 0; col < grid[0].length; col++) {
              const colNumbers = [0, 1, 2, 3, 4].map((row) => grid[row][col]);
              if (isLineComplete(colNumbers, safeCalledNumbers)) {
                selectedCol = col;
                break;
              }
            }
          }
          if (
            !selectedCol &&
            selectSpecificLine &&
            Array.isArray(targetIndices) &&
            targetIndices.length > 0
          ) {
            selectedCol = Math.max(0, Math.min(4, targetIndices[0]));
          }
          if (selectedCol === null && grid[0] && grid[0].length > 0) {
            selectedCol = 0;
          }
          if (
            selectedCol !== null &&
            selectedCol >= 0 &&
            selectedCol < grid[0].length
          ) {
            colIndex = selectedCol;
            const colNumbers = [0, 1, 2, 3, 4]
              .map((_, row) => grid[row][selectedCol])
              .filter(filterFn);
            numbers.push(...colNumbers);
            for (let i = 0; i < 5; i++) {
              if (filterFn(grid[i][selectedCol])) {
                selectedIndices.push(i * 5 + selectedCol);
              }
            }
          }
          break;
        case "four_corners_center":
          const cornersAndCenter = [
            grid[0][0],
            grid[0][4],
            grid[4][0],
            grid[4][4],
            grid[2][2],
          ].filter(filterFn);
          numbers.push(...cornersAndCenter);
          selectedIndices.push(0, 4, 20, 24, 12);
          break;
        case "inner_corners":
          const innerCorners = [
            grid[1][1],
            grid[1][3],
            grid[3][1],
            grid[3][3],
          ].filter(filterFn);
          numbers.push(...innerCorners);
          selectedIndices.push(6, 8, 16, 18);
          break;
        case "main_diagonal":
          const mainDiag = [0, 1, 2, 3, 4]
            .map((i) => grid[i][i])
            .filter(filterFn);
          numbers.push(...mainDiag);
          selectedIndices.push(0, 6, 12, 18, 24);
          break;
        case "other_diagonal":
          const otherDiag = [0, 1, 2, 3, 4]
            .map((i) => grid[i][4 - i])
            .filter(filterFn);
          numbers.push(...otherDiag);
          selectedIndices.push(4, 8, 12, 16, 20);
          break;
        case "all":
          for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
              if (filterFn(grid[row][col])) {
                numbers.push(grid[row][col]);
                selectedIndices.push(row * 5 + col);
              }
            }
          }
          break;
        default:
          console.warn(`[getNumbersForPattern] Unknown pattern: "${pattern}"`);
          return {
            numbers: [],
            selectedIndices: [],
            rowIndex: null,
            colIndex: null,
            pattern,
          };
      }
      numbers = numbers
        .filter((n) => {
          if (n === null || n === undefined) return false;
          const num = Number(n);
          return !isNaN(num) && num >= 1 && num <= 75;
        })
        .map(Number);
      return { numbers, selectedIndices, rowIndex, colIndex, pattern };
    } catch (error) {
      console.error("[BingoGame] Error in getNumbersForPattern:", error);
      return {
        numbers: [],
        selectedIndices: [],
        rowIndex: null,
        colIndex: null,
        pattern,
      };
    }
  };

  // Removed optimistic auto-call to keep server authoritative and avoid state mismatches

  const handleCallNumber = async (manualNum = null, options = {}) => {
    const isAuto = options?.isAuto === true;
    // Guard conditions; avoid turning off auto-call if we're simply busy
    if (
      isGameOver ||
      !isPlaying ||
      calledNumbers.length >= 75 ||
      gameData?.status !== "active"
    ) {
      if (calledNumbers.length >= 75) {
        setIsGameFinishedModalOpen(true);
        setIsAutoCall(false);
        await handleFinish();
        return;
      }
      if (!isAuto) {
        setCallError(
          gameData?.status !== "active"
            ? "Cannot call number: Game is paused or finished"
            : "Cannot call number: Game is over or paused"
        );
        setIsErrorModalOpen(true);
      }
      return;
    }
    // Prevent overlapping network calls at a higher level (covers race windows)
    if (isCallingNumber || inFlightCallRef.current) {
      // If auto mode, queue one pending auto-call to be flushed after current call ends
      if (isAuto) {
        autoSchedulerRef.current.pending = true;
        return;
      }
      setCallError("Cannot call number: A call is already in progress");
      setIsErrorModalOpen(true);
      return;
    }
    // Server-authoritative path only (no optimistic UI) to avoid mismatches
    if (!gameData?._id) {
      setCallError("Game ID is missing");
      setIsErrorModalOpen(true);
      setIsAutoCall(false);
      return;
    }
    setIsCallingNumber(true);
    setCallError(null);
    let numberToCall;
    try {
      console.log(
        `[handleCallNumber] Before updatePrizePoolDisplay, current gameData.prizePool: ${gameData?.prizePool}`
      );
      // During auto mode, avoid blocking on prize pool fetch to reduce lag
      if (!isAuto) {
        await updatePrizePoolDisplay();
      } else {
        // Throttle background updates to at most once every 5s during auto
        const now = Date.now();
        if (now - lastPrizePoolUpdateRef.current > 5000) {
          lastPrizePoolUpdateRef.current = now;
          updatePrizePoolDisplay();
        }
      }
      console.log(
        `[handleCallNumber] After updatePrizePoolDisplay, gameData.prizePool: ${gameData?.prizePool}`
      );
      if (manualNum !== null && manualNum !== undefined && manualNum !== "") {
        const num = parseInt(manualNum, 10);
        if (isNaN(num) || num < 1 || num > 75) {
          throw new Error(`Invalid manual number: ${manualNum} (must be 1-75)`);
        }
        if (calledNumbers.includes(num)) {
          throw new Error(`Number ${num} already called`);
        }
        numberToCall = num;
      } else {
        const availableNumbers = Array.from(
          { length: 75 },
          (_, i) => i + 1
        ).filter((n) => !calledNumbers.includes(n));
        if (!availableNumbers.length) {
          setIsGameFinishedModalOpen(true);
          setIsAutoCall(false);
          await handleFinish();
          return;
        }
        // Avoid selecting a number that is currently in-flight
        const inFlight = inFlightNumberRef.current;
        const options = inFlight
          ? availableNumbers.filter((n) => n !== inFlight)
          : availableNumbers;
        numberToCall = options[Math.floor(Math.random() * options.length)];
        // If filter removed all options (rare), fall back
        if (!numberToCall)
          numberToCall =
            availableNumbers[
              Math.floor(Math.random() * availableNumbers.length)
            ];
      }
      console.log(`[handleCallNumber] Calling number: ${numberToCall}`);
      // Mark in-flight and create AbortController to allow cancellation
      inFlightCallRef.current = true;
      inFlightNumberRef.current = numberToCall;
      // Abort previous controller if any (cleanup)
      if (callAbortControllerRef.current) {
        try {
          callAbortControllerRef.current.abort();
        } catch (e) {}
      }
      const controller = new AbortController();
      callAbortControllerRef.current = controller;
      const t0 =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      // pass the signal through to the hook -> service -> axios
      const response = await callNumber(gameData._id, {
        number: numberToCall,
        signal: controller.signal,
      });
      console.log(`[handleCallNumber] Response from callNumber:`, response);
      if (isAuto) {
        const t1 =
          typeof performance !== "undefined" ? performance.now() : Date.now();
        const rtt = Math.max(0, t1 - t0);
        const interval = Math.max(1, speed) * 1000;
        const targetLead = Math.min(interval - 80, Math.max(100, rtt + 60));
        const prev =
          typeof adaptiveLeadMsRef !== "undefined" &&
          adaptiveLeadMsRef?.current != null
            ? adaptiveLeadMsRef.current
            : computeLeadMs(speed);
        const alpha = 0.3;
        const smoothed = prev * (1 - alpha) + targetLead * alpha;
        if (typeof adaptiveLeadMsRef !== "undefined") {
          adaptiveLeadMsRef.current = smoothed;
        }
      }
      const calledNumber =
        response?.calledNumber ||
        numberToCall ||
        response?.game?.calledNumbers?.[
          response?.game?.calledNumbers?.length - 1
        ];
      if (!calledNumber) {
        throw new Error("No called number in response");
      }
      console.log(`[handleCallNumber] Called number: ${calledNumber}`);
      setCalledNumbers((prev) => {
        if (!prev.includes(calledNumber)) {
          return [...prev, calledNumber];
        }
        return prev;
      });
      setLastCalledNumbers((prev) => {
        const newList = [calledNumber, ...prev.slice(0, 4)];
        return [...new Set(newList)].slice(0, 5);
      });
      setCurrentNumber(calledNumber);
      // Preserve the current prizePool to avoid flashing 0 during re-render
      const currentPrizePool = gameData?.prizePool || 0;
      console.log(
        `[handleCallNumber] Current prizePool before update: ${currentPrizePool}`
      );
      console.log(
        `[handleCallNumber] response.game?.prizePool: ${response.game?.prizePool}`
      );
      const updatedGameData = {
        ...gameData,
        ...response.game,
        prizePool: response.game?.prizePool || currentPrizePool,
        // Preserve selectedCards if not returned in response
        selectedCards:
          response.game && response.game.selectedCards !== undefined
            ? response.game.selectedCards
            : gameData?.selectedCards ?? [],
      };
      console.log(
        `[handleCallNumber] updatedGameData.prizePool after fallback: ${updatedGameData.prizePool}`
      );
      setGameData((prev) => ({
        ...prev,
        ...updatedGameData,
        // Double-ensure preservation against race conditions
        selectedCards:
          updatedGameData && updatedGameData.selectedCards !== undefined
            ? updatedGameData.selectedCards
            : prev?.selectedCards ?? [],
      }));
      console.log(
        `[handleCallNumber] After setGameData, gameData.prizePool: ${updatedGameData.prizePool}`
      );
      if (!isAuto) {
        await updatePrizePoolDisplay();
      } else {
        const now2 = Date.now();
        if (now2 - lastPrizePoolUpdateRef.current > 5000) {
          lastPrizePoolUpdateRef.current = now2;
          updatePrizePoolDisplay();
        }
      }
      console.log(
        `[handleCallNumber] After await updatePrizePoolDisplay, gameData.prizePool: ${gameData?.prizePool}`
      );
      setBingoCards((prevCards) =>
        prevCards.map((card) => {
          const newCard = { ...card };
          const letters = ["B", "I", "N", "G", "O"];
          for (let col = 0; col < 5; col++) {
            for (let row = 0; row < 5; row++) {
              const letter = letters[col];
              const number = card.numbers[letter][row];
              if (typeof number === "number" && number === calledNumber) {
                newCard.markedPositions[letter][row] = true;
              }
            }
          }
          return newCard;
        })
      );
      SoundService.playSound(`number_${calledNumber}`);
      if (manualNum) {
        setManualNumber("");
      }
      if (response.game?.winnerPatternComplete) {
        setIsWinnerModalOpen(true);
        setIsGameOver(true);
        setIsPlaying(false);
        setIsAutoCall(false);
        SoundService.playSound("winner");
      }
    } catch (error) {
      // Handle abort/cancel specially: do not show modal or mark number
      const isAborted =
        error &&
        (error.code === "ERR_CANCELED" || error.name === "CanceledError");
      if (isAborted) {
        // Request was cancelled (likely because auto-call was turned off). Clean up and return silently.
        console.log("[handleCallNumber] Call aborted by controller");
        setCallError(null);
        // ensure we don't keep the in-flight number excluded from next picks
        inFlightCallRef.current = false;
        inFlightNumberRef.current = null;
        setIsCallingNumber(false);
        // clear controller
        callAbortControllerRef.current = null;
        return;
      }

      let userMessage = "Failed to call number";
      if (error.message.includes("Invalid number")) {
        userMessage = `Invalid number: ${
          manualNum || "auto-generated"
        }. Please try again.`;
      } else if (error.message.includes("already called")) {
        userMessage = `Number ${numberToCall} already called. Skipping...`;
      } else if (
        error.message.includes("Game is not active") ||
        error.message.includes("Cannot call number: Game is")
      ) {
        userMessage = "Game is paused or finished";
        setIsPlaying(false);
        setIsAutoCall(false);
      } else if (error.response?.status === 400) {
        userMessage = error.response.data?.message || "Invalid game state";
      } else if (error.response?.status === 404) {
        userMessage = "Game not found. Please refresh.";
        navigate("/cashier-dashboard");
      }

      setCallError(userMessage);
      setIsErrorModalOpen(true);
      if (
        error.message.includes("Invalid number") ||
        error.message.includes("Game is over") ||
        error.message.includes("All numbers already called") ||
        error.message.includes("Game is not active") ||
        error.message.includes("Cannot call number: Game is")
      ) {
        setIsAutoCall(false);
        if (error.message.includes("All numbers already called")) {
          setIsGameFinishedModalOpen(true);
          await handleFinish();
        }
      }
    } finally {
      setIsCallingNumber(false);
      // Clear in-flight markers
      inFlightCallRef.current = false;
      inFlightNumberRef.current = null;
      // If an auto tick arrived while busy, fire a pending call immediately
      if (
        autoSchedulerRef.current.pending &&
        isAutoCall &&
        !isGameOver &&
        isPlaying &&
        gameData?.status === "active" &&
        calledNumbers.length < 75 &&
        !isCallingNumber
      ) {
        autoSchedulerRef.current.pending = false;
        // Fire and forget; cadence remains controlled by scheduler
        handleCallNumber(null, { isAuto: true });
      }
    }
  };

  const handleNextClick = async () => {
    if (
      !isPlaying ||
      isGameOver ||
      !gameData?._id ||
      isCallingNumber ||
      gameData?.status !== "active"
    ) {
      setCallError(
        gameData?.status !== "active"
          ? "Game is paused or finished"
          : "Cannot call number: Game is over, paused, or already calling"
      );
      setIsErrorModalOpen(true);
      return;
    }
    await handleCallNumber();
  };

  const handleToggleAutoCall = () => {
    const turningOn = !isAutoCall;
    // If turning off, abort any in-flight call
    if (!turningOn) {
      if (callAbortControllerRef.current) {
        try {
          callAbortControllerRef.current.abort();
        } catch (e) {
          console.warn("Failed to abort controller:", e);
        }
        callAbortControllerRef.current = null;
      }
      inFlightCallRef.current = false;
      // Allow the in-flight number to be considered on next selection
      inFlightNumberRef.current = null;
      autoSchedulerRef.current.pending = false;
      setIsCallingNumber(false);
    }
    setIsAutoCall(turningOn);
  };

  const handlePlayPause = async () => {
    const willPause = isPlaying;
    SoundService.playSound(willPause ? "game_pause" : "game_start");
    setIsPlaying((prev) => {
      const newPlaying = !prev;
      if (newPlaying && !hasStarted) {
        setHasStarted(true);
        const gameId = gameData?._id || sessionStorage.getItem("currentGameId");
        if (gameId) {
          localStorage.setItem(`bingoGameStarted_${gameId}`, "true");
        }
      }
      return newPlaying;
    });
    setIsAutoCall(false);
    if (autoIntervalRef.current) {
      clearInterval(autoIntervalRef.current);
      autoIntervalRef.current = null;
    }
    if (!gameData?._id) {
      setCallError("Cannot pause/play game: Game ID is missing");
      setIsErrorModalOpen(true);
      setIsPlaying(willPause);
      return;
    }
    const newStatus = willPause ? "paused" : "active";
    if (gameData.status === newStatus) {
      return;
    }
    try {
      const updatedGame = await gameService.updateGameStatus(
        gameData._id,
        newStatus
      );
      setGameData((prev) => ({
        ...prev,
        status: newStatus,
      }));
    } catch (error) {
      if (error.response?.data?.errorCode === "STATUS_UNCHANGED") {
        setGameData((prev) => ({
          ...prev,
          status: newStatus,
        }));
        return;
      }
      setCallError(error.message || "Failed to update game status");
      setIsErrorModalOpen(true);
      setIsPlaying(willPause);
    }
  };

  // FIXED: Preserve calledNumbers, marked positions, and prizePool on finish
  const handleFinish = async () => {
    if (!gameData?._id) {
      setCallError("Cannot finish game: Game ID is missing");
      setIsErrorModalOpen(true);
      return;
    }
    if (gameData.status === "completed") {
      setCallError("Game is already completed");
      setIsErrorModalOpen(true);
      setIsGameOver(true);
      setIsAutoCall(false);
      setIsPlaying(false);
      setIsGameFinishedModalOpen(true);
      return;
    }

    // Store current prizePool before finishing
    const currentPrizePool = gameData?.prizePool;

    setIsGameOver(true);
    setIsAutoCall(false);
    setIsPlaying(false);
    try {
      const response = await finishGame(gameData._id);
      // Preserve prizePool and merge updates (backend may clear calledNumbers, but local state is preserved via useEffect condition)
      setGameData((prev) => ({
        ...prev,
        ...response.game,
        prizePool: currentPrizePool, // Preserve current prizePool
        selectedCards:
          response.game && response.game.selectedCards !== undefined
            ? response.game.selectedCards
            : prev?.selectedCards ?? [],
      }));
      // Do NOT call updatePrizePoolDisplay() to avoid overwriting preserved data
      SoundService.playSound("game_finish");

      setIsGameFinishedModalOpen(true);

      // CHANGE: Comment out or remove this line to prevent jackpot increment
      // await updateJackpotAfterGame(currentPrizePool);
    } catch (error) {
      setCallError(error.message || "Failed to finish game");
      setIsErrorModalOpen(true);
    }
  };

  const handleShuffle = () => {
    if (isShuffling) return;
    setIsShuffling(true);
    const numbers = [...boardNumbers];
    SoundService.playSound("shuffle");
    shuffleIntervalRef.current = setInterval(() => {
      for (let i = numbers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
      }
      setDisplayNumbers([...numbers]);
    }, 100);
    setTimeout(() => {
      if (shuffleIntervalRef.current) {
        clearInterval(shuffleIntervalRef.current);
        shuffleIntervalRef.current = null;
      }
      SoundService.playSound("shuffle", { stop: true });
      setDisplayNumbers([...boardNumbers]);
      setCalledNumbers([]);
      setLastCalledNumbers([]);
      setCurrentNumber(null);
      setBingoCards((prev) =>
        prev.map((card) => ({
          ...card,
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
          isWinner: false,
          eligibleForWin: false,
          eligibleAtNumber: null,
        }))
      );
      setCards((prev) =>
        prev.map((card) => ({
          ...card,
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
          isWinner: false,
          eligibleForWin: false,
          eligibleAtNumber: null,
        }))
      );
      // Clear fast lookup index; will be rebuilt on next fetchBingoCards
      numberIndexRef.current = new Map();
      setIsShuffling(false);
      setIsGameOver(false);
    }, 5000);
  };

  // FIXED: Full handleCheckCard with selected card validation and modal trigger
  const handleCheckCard = async (cardIdParam, preferredPattern = undefined) => {
    try {
      console.log(
        `[handleCheckCard] Checking card ${cardIdParam} with pattern ${preferredPattern}`
      );

      // NEW: Validate if card is selected for this game (robust to type/field variations)
      const idNum = Number(String(cardIdParam).trim());
      const selected = Array.isArray(gameData?.selectedCards)
        ? gameData.selectedCards.some((c) => {
            const candidates = [
              c?.id,
              c?.cardRef,
              c?.card_number,
              c?.cardNumber,
            ];
            return candidates.some((v) => Number(v) === idNum);
          })
        : false;
      if (!selected) {
        console.warn(
          `[handleCheckCard] Card ${cardIdParam} is not selected for this game (selectedCards length: ${
            gameData?.selectedCards?.length || 0
          })`
        );
        setCallError(
          `Card ${cardIdParam} is not selected for this game. Please select valid cards.`
        );
        setIsInvalidCardModalOpen(true); // NEW: Trigger invalid card modal
        return; // Early return, no further processing
      }

      // Ensure card exists in state; if not, fetch full card
      let cardInState = cards.find((c) => c.id === parseInt(cardIdParam));
      if (!cardInState) {
        console.log(
          `[handleCheckCard] Card ${cardIdParam} missing in state, fetching...`
        );
        try {
          const response = await fetch(`/api/games/cards/${cardIdParam}`, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          });
          if (response.ok) {
            const fullCard = await response.json();
            // FIXED: Transpose to column-major like in fetchBingoCards
            const flatNumbers = fullCard.numbers
              .flat()
              .map((num) => (num === "FREE" ? "FREE" : Number(num)));
            const letters = ["B", "I", "N", "G", "O"];
            const numbers = {};
            letters.forEach((letter, col) => {
              numbers[letter] = [];
              for (let row = 0; row < 5; row++) {
                const index = row * 5 + col;
                const num = flatNumbers[index];
                numbers[letter][row] = num === "FREE" ? num : Number(num);
              }
            });
            // Add per-game state defaults
            fullCard.checkCount = 0;
            fullCard.disqualified = false;
            fullCard.lastCheckTime = null;
            fullCard.id = parseInt(cardIdParam); // Ensure id is set
            fullCard.numbers = numbers; // Set transposed numbers
            fullCard.markedPositions = {
              B: new Array(5).fill(false),
              I: new Array(5).fill(false),
              N: new Array(5)
                .fill(false)
                .map((_, i) => (i === 2 ? true : false)),
              G: new Array(5).fill(false),
              O: new Array(5).fill(false),
            };
            fullCard.winningPositions = {
              B: new Array(5).fill(false),
              I: new Array(5).fill(false),
              N: new Array(5).fill(false),
              G: new Array(5).fill(false),
              O: new Array(5).fill(false),
            };
            // Add to state
            setCards((prevCards) => [...prevCards, fullCard]);
            // Update fast lookup index for the fetched card
            try {
              const idx = numberIndexRef.current || new Map();
              const letters2 = ["B", "I", "N", "G", "O"];
              for (let col = 0; col < 5; col++) {
                for (let row = 0; row < 5; row++) {
                  const letter = letters2[col];
                  const num = fullCard.numbers[letter][row];
                  if (typeof num === "number") {
                    if (!idx.has(num)) idx.set(num, []);
                    idx.get(num).push({ cardId: fullCard.id, letter, row });
                  }
                }
              }
              numberIndexRef.current = idx;
              console.log(
                `[handleCheckCard] numberIndexRef updated for card ${cardIdParam}`
              );
            } catch (err) {
              console.warn(
                "Failed to update numberIndexRef for fetched card:",
                err
              );
            }
            cardInState = fullCard;
            console.log(
              `[handleCheckCard] Fetched and added card ${cardIdParam}`
            );
          } else {
            console.error(
              `[handleCheckCard] Failed to fetch card ${cardIdParam}: ${response.status}`
            );
            setCallError(`Failed to fetch card ${cardIdParam}`);
            setIsErrorModalOpen(true);
            return; // Bail out
          }
        } catch (err) {
          console.error(
            `[handleCheckCard] Fetch error for card ${cardIdParam}:`,
            err
          );
          setCallError(`Failed to fetch card ${cardIdParam}: ${err.message}`);
          setIsErrorModalOpen(true);
          return;
        }
      }

      // Prevent overlapping checks (speeds up by avoiding duplicate work)
      if (checkInFlightRef.current) {
        console.warn(
          "[handleCheckCard] A check is already in progress; skipping"
        );
        return;
      }
      checkInFlightRef.current = true;

      // EXTRA FAST PATH: instant local detection of any complete row/column (line win)
      const numbersObj = cardInState?.numbers;
      if (numbersObj && typeof numbersObj === "object") {
        const grid = Array.from({ length: 5 }, (_, r) => [
          numbersObj.B?.[r],
          numbersObj.I?.[r],
          numbersObj.N?.[r],
          numbersObj.G?.[r],
          numbersObj.O?.[r],
        ]);
        const calledSet = calledNumbersSetRef.current || new Set();
        const isComplete = (line) =>
          line && line.every((v) => v === "FREE" || calledSet.has(Number(v)));
        let localWin = null;
        for (let r = 0; r < 5; r++) {
          if (isComplete(grid[r])) {
            localWin = {
              pattern: "horizontal_line",
              rowIndex: r,
              colIndex: null,
              indices: Array.from({ length: 5 }, (_, c) => r * 5 + c),
            };
            break;
          }
        }
        if (!localWin) {
          for (let c = 0; c < 5; c++) {
            const colLine = [
              grid[0][c],
              grid[1][c],
              grid[2][c],
              grid[3][c],
              grid[4][c],
            ];
            if (isComplete(colLine)) {
              localWin = {
                pattern: "vertical_line",
                rowIndex: null,
                colIndex: c,
                indices: Array.from({ length: 5 }, (_, r) => r * 5 + c),
              };
              break;
            }
          }
        }
        if (localWin) {
          const flat = grid.flat();
          const winningNumbersLocal = localWin.indices
            .filter((i) => i !== 12)
            .map((i) => Number(flat[i]))
            .filter((n) => Number.isFinite(n));
          setBingoStatus({
            pattern: localWin.pattern,
            lateCall: false,
            winnerCardNumbers: grid,
            winningIndices: localWin.indices,
            winningNumbers: winningNumbersLocal,
            otherCalledNumbers: winningNumbersLocal.filter((n) =>
              calledSet.has(n)
            ),
            prize: gameData?.prizePool || 0,
            patternInfo: {
              rowIndex: localWin.rowIndex,
              colIndex: localWin.colIndex,
              localSelectedIndices: localWin.indices,
              localSelectedNumbers: winningNumbersLocal,
            },
          });
          // Do not open the winner modal yet; wait for backend confirmation to avoid flashing on late calls
        }
      }

      // QUICK PATH: perform a fast local check to compute pattern indices and called numbers
      // This avoids waiting for backend for UI feedback and speeds up modal rendering.
      let localPatternInfo = null;
      try {
        const nums = cardInState.numbers;
        const cardGrid = nums
          ? Array.from({ length: 5 }, (_, r) => [
              nums.B?.[r],
              nums.I?.[r],
              nums.N?.[r],
              nums.G?.[r],
              nums.O?.[r],
            ])
          : null;
        const patternToUse =
          preferredPattern || gameData?.defaultPattern || "horizontal_line";
        // Use backend-style function but pass current calledNumbers for accurate detection
        const { selectedIndices, selectedNumbers } =
          getNumbersForPatternBackendStyle(
            cardGrid,
            patternToUse,
            [],
            false,
            calledNumbers,
            false
          );
        localPatternInfo = {
          selectedIndices,
          selectedNumbers,
          pattern: patternToUse,
        };
      } catch (err) {
        console.warn("[handleCheckCard] Local pattern compute failed:", err);
      }

      // FIXED: Use gameService.checkBingo instead of direct fetch (still call backend for authoritative result)
      const data = await gameService.checkBingo(
        gameData._id,
        cardIdParam,
        preferredPattern
      );

      console.log(`[handleCheckCard] Backend response:`, data);

      // Update game state and preserve selectedCards if omitted
      setGameData((prevGame) => ({
        ...prevGame,
        ...data.game,
        selectedCards:
          data.game && data.game.selectedCards !== undefined
            ? data.game.selectedCards
            : prevGame?.selectedCards ?? [],
      }));

      // Helper to build 2D grid from card numbers (if needed for modals)
      const buildGrid = (numbers) => {
        if (
          !numbers ||
          !numbers.B ||
          !numbers.I ||
          !numbers.N ||
          !numbers.G ||
          !numbers.O
        ) {
          return Array(5)
            .fill()
            .map(() => Array(5).fill("FREE"));
        }
        const grid = [];
        for (let row = 0; row < 5; row++) {
          grid[row] = [
            numbers.B[row],
            numbers.I[row],
            numbers.N[row],
            numbers.G[row],
            numbers.O[row],
          ];
        }
        return grid;
      };

      // Compute called numbers on this card
      const cardCalledNumbers = [];
      const letters = ["B", "I", "N", "G", "O"];
      for (const letter of letters) {
        for (const num of cardInState.numbers[letter]) {
          if (typeof num === "number" && calledNumbers.includes(num)) {
            cardCalledNumbers.push(num);
          }
        }
      }
      const uniqueCardCalledNumbers = [...new Set(cardCalledNumbers)].sort(
        (a, b) => a - b
      );

      // FIXED: Trigger win if isBingo true (even if winner null, e.g., completed game)
      if (data.isBingo) {
        console.log(
          `[handleCheckCard] 🎉 BINGO! (Previous winner if completed)`
        );
        // NEW: Compute winning numbers and indices using backend-style logic
        let winningNumbers = [];
        let winningIndices = [];
        let effectivePattern = data.winningPattern;
        if (data.winners && data.winners.length > 0) {
          const winner = data.winners[0];
          const cardNumbers = winner.numbers; // 5x5 grid from backend
          const pattern = winner.winningPattern;
          try {
            const result = getNumbersForPatternBackendStyle(
              cardNumbers, // 2D grid
              pattern,
              [], // exclude
              true, // isWinner
              calledNumbers, // NEW: Pass state
              true // NEW: includeMarked
            );
            winningNumbers = result.selectedNumbers;
            winningIndices = result.selectedIndices;
          } catch (err) {
            console.error(
              "[handleCheckCard] Error computing winning pattern:",
              err
            );
          }
        }
        // NEW: Log winner card winning numbers
        console.log(
          `[DEBUG] Winner Card ${cardIdParam} Winning Numbers:`,
          winningNumbers
        );
        console.log(
          `[DEBUG] Winner Card ${cardIdParam} Winning Indices:`,
          winningIndices
        );
        console.log(
          `[DEBUG] Winner Card Full Grid:`,
          buildGrid(cardInState.numbers)
        );
        console.log(
          `[DEBUG] All Called on Winner Card:`,
          uniqueCardCalledNumbers
        );
        console.log(
          `[DEBUG] Other Called on Winner Card:`,
          uniqueCardCalledNumbers.filter((n) => !winningNumbers?.includes(n))
        );
        console.log(`[DEBUG] Effective Pattern:`, effectivePattern);
        console.log(`[DEBUG] Completed Patterns:`, data.completedPatterns);
        // Set bingoStatus with API data for winner modal rendering
        setBingoStatus({
          pattern: effectivePattern || data.winningPattern || "line",
          lateCall: data.lateCall || false, // Use backend lateCall
          winnerCardNumbers: buildGrid(cardInState.numbers), // 2D grid for modal
          winningIndices,
          winningNumbers,
          otherCalledNumbers:
            data.otherCalledNumbers ||
            uniqueCardCalledNumbers.filter((n) => !winningNumbers?.includes(n)),
          prize:
            data.prize ||
            data.previousWinner?.prize ||
            gameData?.prizePool ||
            0,
          patternInfo: {
            rowIndex: data.rowIndex || null,
            colIndex: data.colIndex || null,
            // include local pattern info for faster UI (fallback to backend indices)
            localSelectedIndices: localPatternInfo?.selectedIndices || [],
            localSelectedNumbers: localPatternInfo?.selectedNumbers || [],
          },
        });
        setShowWinModal(true);
        setIsWinnerModalOpen(true); // Explicitly set for consistency
        setWinnerData(data.winner || data.previousWinner); // Fallback to previousWinner
        // NEW: Update card state with winning positions for orange marking
        const updatedCard = { ...cardInState, isWinner: true };
        const tempGrid = buildGrid(cardInState.numbers);
        winningIndices.forEach((idx) => {
          if (idx !== 12) {
            // Skip free space
            const row = Math.floor(idx / 5);
            const col = idx % 5;
            const letter = letters[col];
            updatedCard.winningPositions[letter][row] = true;
            // Also ensure marked if called
            if (
              typeof tempGrid[row][col] === "number" &&
              calledNumbers.includes(tempGrid[row][col])
            ) {
              updatedCard.markedPositions[letter][row] = true;
            }
          }
        });
        // Update both states
        setCards((prevCards) =>
          prevCards.map((c) =>
            c.id === parseInt(cardIdParam) ? updatedCard : c
          )
        );
        setBingoCards((prevCards) =>
          prevCards.map((c) =>
            c.id === parseInt(cardIdParam) ? updatedCard : c
          )
        );
        // Optionally disable other cards
        setCards((prevCards) =>
          prevCards.map((c) => ({
            ...c,
            disabled: c.id !== parseInt(cardIdParam),
          }))
        );
        // Trigger celebration (e.g., confetti)
        createConfetti();
        SoundService.playSound("winner");
      } else {
        // Non-bingo/late call handling
        // Ensure any optimistic winner modal is closed
        if (isWinnerModalOpen || showWinModal) {
          setIsWinnerModalOpen(false);
          setShowWinModal(false);
        }
        const winnerInfo = data.winners?.[0];
        const isLateCall = winnerInfo?.lateCall || false;
        const lateCallMessage =
          winnerInfo?.lateCallMessage ||
          data.message ||
          "No bingo found. Try again!";
        const wouldHaveWon = winnerInfo?.wouldHaveWon || {
          pattern: winnerInfo?.winningPattern || data.pattern,
          callIndex: winnerInfo?.callIndex,
          completingNumber: winnerInfo?.completingNumber,
        };

        console.log(`[handleCheckCard] Non-bingo/late:`, {
          isLateCall,
          lateCallMessage,
          wouldHaveWon,
        });

        // FIXED: Safely update card state with response data (no more "missing")
        if (cardInState) {
          const cardGrid = buildGrid(cardInState.numbers);
          let selectedIndices = data.selectedIndices || [];
          if (isLateCall && wouldHaveWon.pattern) {
            try {
              const { selectedIndices: lateIndices } =
                getNumbersForPatternBackendStyle(
                  cardGrid,
                  wouldHaveWon.pattern,
                  [],
                  true
                );
              selectedIndices = lateIndices;
            } catch (err) {
              console.error(
                "[handleCheckCard] Error computing late pattern indices:",
                err
              );
            }
          }

          const updatedCard = {
            ...cardInState,
            cardId: cardIdParam,
            cardNumbers: cardGrid, // 2D grid for modal
            patternInfo: {
              selectedIndices,
              rowIndex: data.rowIndex || null,
              colIndex: data.colIndex || null,
              pattern: isLateCall ? wouldHaveWon.pattern : data.pattern || null,
            },
            calledNumbersInPattern: data.calledNumbersInPattern || [],
            otherCalledNumbers:
              data.otherCalledNumbers ||
              uniqueCardCalledNumbers.filter(
                (n) => !data.calledNumbersInPattern?.includes(n)
              ) ||
              uniqueCardCalledNumbers,
            lateCall: isLateCall,
            lateCallMessage,
            wouldHaveWon,
            // If backend says not a winner, clear any previous winner flags
            isWinner: false,
            winningPositions: {
              B: [false, false, false, false, false],
              I: [false, false, false, false, false],
              N: [false, false, false, false, false],
              G: [false, false, false, false, false],
              O: [false, false, false, false, false],
            },
            checkCount: data.checkCount || cardInState.checkCount || 0,
            disqualified:
              data.disqualified || cardInState.disqualified || false,
            lastCheckTime:
              data.checkCount > cardInState.checkCount
                ? new Date()
                : cardInState.lastCheckTime,
          };

          // If disqualified or late, add visual cue (e.g., shake animation)
          if (data.disqualified || isLateCall) {
            updatedCard.shake = true; // Trigger CSS animation
            setTimeout(() => {
              setCards((prevCards) =>
                prevCards.map((c) => ({ ...c, shake: false }))
              );
            }, 1000);
            if (isLateCall) {
              SoundService.playSound("you_didnt_win"); // Optional sound
            }
          }

          // Update cards state
          setCards((prevCards) =>
            prevCards.map((c) =>
              c.id === parseInt(cardIdParam) ? updatedCard : c
            )
          );

          console.log(
            `[handleCheckCard] Updated card ${cardIdParam}:`,
            updatedCard
          );

          // Trigger non-winner modal
          setNonWinnerCardData(updatedCard);
          setIsNonWinnerModalOpen(true);

          // Optional: Set message for toast (if implemented elsewhere)
          setShowMessage(updatedCard.lateCallMessage);
          setMessageType(updatedCard.lateCall ? "warning" : "info");
        } else {
          console.warn(
            `[handleCheckCard] Card ${cardIdParam} still missing after update attempt`
          );
          setCallError(`Card ${cardIdParam} not found in state`);
          setIsErrorModalOpen(true);
        }
      }

      // Update marked grids for all cards (re-mark based on new called numbers)
      updateMarkedGrids();
    } catch (error) {
      console.error(
        `[handleCheckCard] Error checking card ${cardIdParam}:`,
        error
      );
      setCallError(error.message || "Check failed. Please try again.");
      setIsErrorModalOpen(true);
      // Optional: Set generic message
      setShowMessage("Check failed. Please try again.");
      setMessageType("error");
    } finally {
      checkInFlightRef.current = false;
    }
  };

  // NEW: Define updateMarkedGrids (was missing)
  const updateMarkedGrids = () => {
    // Fast path: use precomputed index of number -> card positions
    const index = numberIndexRef.current;
    if (!index || index.size === 0) {
      // Fallback to previous behavior if index is not built
      setBingoCards((prevCards) =>
        prevCards.map((card) => {
          const newCard = { ...card };
          const letters = ["B", "I", "N", "G", "O"];
          calledNumbers.forEach((calledNum) => {
            for (let col = 0; col < 5; col++) {
              for (let row = 0; row < 5; row++) {
                const letter = letters[col];
                const number = card.numbers[letter][row];
                if (typeof number === "number" && number === calledNum) {
                  newCard.markedPositions[letter][row] = true;
                }
              }
            }
          });
          return newCard;
        })
      );
      setCards((prevCards) => prevCards.map((c) => ({ ...c })));
      return;
    }

    // Only update cards that have newly called numbers
    const affectedCardUpdates = new Map(); // cardId -> updatedCard
    for (const calledNum of calledNumbers) {
      const entries = index.get(calledNum);
      if (!entries) continue;
      for (const pos of entries) {
        const id = pos.cardId;
        if (!affectedCardUpdates.has(id)) {
          // clone from current state (search in bingoCards)
          const base =
            bingoCards.find((c) => c.id === id) ||
            cards.find((c) => c.id === id) ||
            null;
          if (!base) continue;
          affectedCardUpdates.set(id, {
            ...base,
            markedPositions: {
              B: base.markedPositions?.B?.slice() || [
                false,
                false,
                false,
                false,
                false,
              ],
              I: base.markedPositions?.I?.slice() || [
                false,
                false,
                false,
                false,
                false,
              ],
              N: base.markedPositions?.N?.slice() || [
                false,
                false,
                true,
                false,
                false,
              ],
              G: base.markedPositions?.G?.slice() || [
                false,
                false,
                false,
                false,
                false,
              ],
              O: base.markedPositions?.O?.slice() || [
                false,
                false,
                false,
                false,
                false,
              ],
            },
          });
        }
        const upd = affectedCardUpdates.get(id);
        upd.markedPositions[pos.letter][pos.row] = true;
      }
    }

    if (affectedCardUpdates.size > 0) {
      setBingoCards((prev) =>
        prev.map((c) =>
          affectedCardUpdates.has(c.id) ? affectedCardUpdates.get(c.id) : c
        )
      );
      setCards((prev) =>
        prev.map((c) =>
          affectedCardUpdates.has(c.id) ? affectedCardUpdates.get(c.id) : c
        )
      );
    }
  };

  // FIXED: useEffect for loading cards (use gameData instead of this.state.game)
  useEffect(() => {
    const loadCards = async () => {
      if (gameData?.selectedCards) {
        const cardIds = gameData.selectedCards.map((c) => c.id);
        // Batch fetch or loop fetch (simplified; fetch if needed via handleCheckCard)
        console.log(`[loadCards] Pre-loading for IDs:`, cardIds);
        // Optionally fetch missing ones here
      }
    };
    loadCards();
  }, [gameData?.selectedCards]);

  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // UI Generation
  const generateBoard = () => {
    const letters = [
      { letter: "B", color: "bg-[#e9a64c]" },
      { letter: "I", color: "bg-[#e9a64c]" },
      { letter: "N", color: "bg-[#e9a64c]" },
      { letter: "G", color: "bg-[#e9a64c]" },
      { letter: "O", color: "bg-[#e9a64c]" },
    ];
    const board = [];
    let numberIdx = 0;
    for (let row = 0; row < 5; row++) {
      const rowNumbers = [];
      rowNumbers.push(
        <div
          key={`letter-${row}`}
          className={`w-14 h-14 ${letters[row].color} text-black flex justify-center items-center text-xl font-bold border border-[#2a3969]`}
        >
          {letters[row].letter}
        </div>
      );
      for (let j = 0; j < 15; j++) {
        let originalNum;
        if (row === 0) originalNum = j + 1;
        else if (row === 1) originalNum = j + 16;
        else if (row === 2) originalNum = j + 31;
        else if (row === 3) originalNum = j + 46;
        else originalNum = j + 61;
        const displayNum = isShuffling
          ? displayNumbers[numberIdx]
          : originalNum;
        const isCalled = !isShuffling && calledNumbers.includes(originalNum);
        rowNumbers.push(
          <div
            key={originalNum}
            className={`w-14 h-14 flex justify-center items-center text-xl font-bold cursor-default transition-all duration-300 ${
              isCalled
                ? "bg-[#0a1174] text-white border border-[#2a3969]"
                : "bg-[#e02d2d] text-white border border-[#2a3969]"
            }`}
          >
            {displayNum}
          </div>
        );
        numberIdx++;
      }
      board.push(
        <div key={`row-${row}`} className="flex gap-[5px]">
          {rowNumbers}
        </div>
      );
    }
    return board;
  };

  const recentNumbers = lastCalledNumbers.map((num, index) => (
    <div
      key={index}
      className={`w-11 h-11 flex justify-center items-center font-bold text-lg rounded-full ${
        index === 0
          ? "bg-[#d20000]"
          : index === 1
          ? "bg-[rgba(210,0,0,0.8)]"
          : index === 2
          ? "bg-[rgba(210,0,0,0.6)]"
          : index === 3
          ? "bg-[rgba(210,0,0,0.4)]"
          : "bg-[rgba(210,0,0,0.2)]"
      } text-white`}
    >
      {num || "-"}
    </div>
  ));
  console.log("🙌🙌👌👌👌🙌🙌🙌🙌Rendering Jackpot, user:", user);

  // Format winner ID without leading zeros
  const formattedWinnerId =
    jackpotWinnerId === "---"
      ? "---"
      : parseInt(jackpotWinnerId, 10).toString();

  // In the component
  if (!user) return <div>Loading...</div>;

  return (
    <div
      ref={containerRef}
      className={`w-full h-full bg-[#0a1235] flex flex-col items-center p-5 relative ${
        isShaking ? "animate-shake" : ""
      } ${isCelebrating ? "animate-celebrate" : ""}`}
    >
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

      {/* Navigation Header */}
      <div className="flex justify-between items-center w-full max-w-[1200px]">
        <button
          className="bg-transparent border border-gray-600 text-[#f0e14a] hover:border-none w-10 h-10 rounded flex justify-center items-center text-xl cursor-pointer transition-all duration-300"
          onClick={() => navigate("/cashier-dashboard")}
        >
          ↩️
        </button>
        <button
          className="bg-transparent border border-gray-600 text-[#f0e14a] w-10 h-10 rounded flex justify-center items-center text-xl cursor-pointer transition-all duration-300 hover:bg-white/10 hover:scale-105"
          onClick={handleToggleFullscreen}
        >
          {isFullscreen ? "⎋" : "⛶"}
        </button>
        <button
          className="bg-transparent border border-gray-600 text-[#f0e14a] px-3 flex items-center gap-1.5 rounded cursor-pointer transition-all duration-300 hover:bg-white/10 hover:scale-105"
          onClick={toggleLanguage}
        >
          <span className="text-base">🇬🇧</span>
          <span className="text-sm">
            {translations[language]?.language || "Language"}
          </span>
        </button>
      </div>
      {/* Title and Recent Numbers */}
      <div className="w-full flex justify-between px-16 items-center my-8 max-[1100px]:flex-col max-[1100px]:gap-2">
        <h1 className="text-7xl font-black text-[#f0e14a] text-center">
          JOKER BINGO
        </h1>
        <div className="flex justify-center items-center gap-2">
          <span className="text-[#e9a64c] text-2xl font-bold mr-1">
            Last called:
          </span>
          {recentNumbers}
        </div>
      </div>
      {/* Game Info */}
      <div className="flex flex-wrap justify-center gap-2 mb-5 w-full">
        <div className="text-[#f0e14a] text-2xl font-bold mr-2">
          GAME {isLoading ? "Loading..." : gameData?.gameNumber || "Unknown"}
        </div>
        <div className="bg-[#f0e14a] text-black px-3 py-1.5 rounded-full font-bold text-xs whitespace-nowrap">
          Called {calledNumbers.length}/75
        </div>
      </div>
      {/* Bingo Board */}
      <div className="flex flex-col gap-[5px] mb-5 w-full max-w-[1200px] flex-grow justify-center items-center">
        {generateBoard()}
      </div>
      {/* Controls and Last Number */}
      <div className="w-full flex items-center gap-4 max-w-[1000px] max-md:flex-col translate-x-40">
        <div className="flex-1 flex flex-col items-center">
          {/* Control Buttons */}
          <div className="flex flex-wrap justify-center gap-2 mb-4 w-full">
            <button
              className={`bg-[#4caf50] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a] ${
                isPlaying ? "bg-[#e9744c]" : ""
              }`}
              onClick={handlePlayPause}
              disabled={isGameOver}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              className={`${
                isAutoCall
                  ? "bg-[#4caf50] hover:bg-[#43a047]"
                  : "bg-[#e9744c] hover:bg-[#f0b76a]"
              } text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300`}
              onClick={handleToggleAutoCall}
              disabled={!gameData?._id || !isPlaying || isGameOver}
            >
              Auto Call {isAutoCall ? "On" : "Off"}
            </button>
            <button
              className="bg-[#e9a64c] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a]"
              onClick={handleNextClick}
              disabled={
                !gameData?._id || isCallingNumber || !isPlaying || isGameOver
              }
            >
              {isCallingNumber ? "Calling..." : "Next"}
            </button>
            <button
              className="bg-[#e9a64c] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a]"
              onClick={handleFinish}
              disabled={isGameOver}
            >
              Finish
            </button>
            {!isPlaying && !hasStarted && (
              <button
                className="bg-[#e9a64c] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a] disabled:opacity-50"
                onClick={handleShuffle}
                disabled={isShuffling}
              >
                {isShuffling ? "Shuffling..." : "Shuffle"}
              </button>
            )}
          </div>
          {/* Card Check Input */}
          <div className="flex gap-2 mt-2 w-full justify-center">
            <input
              type="text"
              className="p-2 bg-[#e9a64c] border-none rounded text-sm text-black w-40"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              placeholder="Enter Card ID"
              onKeyDown={(e) => {
                if (e.key === "Enter" && gameData?._id) {
                  // Prevent form submission if inside a form
                  e.preventDefault();
                  // Only trigger when not disabled
                  handleCheckCard(cardId, undefined);
                }
              }}
              disabled={!gameData?._id}
            />
            <button
              className="bg-[#e9a64c] text-black border-none px-4 py-4 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a]"
              onClick={() => handleCheckCard(cardId, undefined)} // FIXED: Pass preferredPattern as undefined
              disabled={!gameData?._id}
            >
              Check
            </button>
          </div>

          {/* Speed Control */}
          <div className="flex justify-center items-center gap-2 mt-4 mb-4">
            <span className="text-sm">🕒</span>
            <input
              type="range"
              min="1"
              max="10"
              value={speed}
              onChange={(e) => setSpeed(parseInt(e.target.value))}
              className="w-20 accent-[#f0e14a]"
              disabled={!isPlaying || isGameOver}
            />
            <span className="text-sm">{speed}s</span>
          </div>
        </div>
        {/* Last Number Container */}
        <div className="flex items-center gap-4 ">
          <div className="flex flex-col items-center">
            <p className="w-38 h-38 flex justify-center items-center bg-[#f0e14a] shadow-[inset_0_0_10px_white] rounded-full text-8xl font-black text-black">
              {currentNumber || "-"}
            </p>
          </div>
          <div className=" flex flex-col items-center">
            <div className="flex items-center gap-2">
              <span className="text-5xl font-black text-white">
                {gameData?.prizePool?.toFixed(2) || 0} ብር
              </span>
              <FaMoneyBillWave className="w-14 h-14 text-green-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Jackpot Display (already positioned bottom left) */}
      <div
        className={`fixed bottom-5 left-[0.1%] bg-[#0f1a4a] border-3 border-[#f0e14a] rounded-xl p-4 text-center shadow-lg z-10 min-w-[200px] transition-all duration-300 ${
          isJackpotAnimating ? "scale-105 animate-bounce" : ""
        }`}
      >
        <div className="text-3xl font-bold text-[#e9a64c] uppercase mb-2">
          JACKPOT
        </div>
        <div className="text-4xl font-bold text-[#f0e14a] mb-3">
          {jackpotAmount} BIRR
        </div>
        <div className="bg-[rgba(233,166,76,0.1)] p-3 rounded mb-2 text-xl">
          <div className="text-[#e9a64c] font-bold mb-2">
            Winner ID:{" "}
            <span className="text-[#f0e14a]">{formattedWinnerId}</span>
          </div>
          <div className="text-[#e9a64c] font-bold">
            Prize: <span className="text-[#f0e14a]">{jackpotPrizeAmount}</span>
          </div>
          <div className="text-[#e9a64c] font-bold mt-2">
            Draw Date: <span className="text-[#f0e14a]">{jackpotDrawDate}</span>
          </div>
        </div>
        <button
          className={`w-full py-3 rounded font-bold text-base transition-all duration-300 ${
            gameData?._id && user?.id && !isJackpotDrawn && isJackpotEnabled
              ? "bg-[#e9744c] text-white cursor-pointer hover:bg-[#f0854c] hover:scale-105"
              : "bg-[#a07039] text-white cursor-not-allowed opacity-70"
          }`}
          onClick={handleRunJackpot}
          disabled={
            !(gameData?._id && user?.id && !isJackpotDrawn && isJackpotEnabled)
          }
        >
          {runJackpotBtnText}
        </button>
      </div>

      {/* Confetti Container */}
      <div
        ref={confettiContainerRef}
        className="fixed inset-0 pointer-events-none z-50 overflow-hidden"
        style={{ display: "none" }}
      />

      {/* Fireworks Container */}
      <div
        ref={fireworksContainerRef}
        className="fixed inset-0 pointer-events-none z-50 overflow-hidden"
        style={{ display: "none" }}
      />

      {/* Modals - UPDATED: Pass new props */}
      <BingoModals
        isWinnerModalOpen={isWinnerModalOpen || showWinModal}
        setIsWinnerModalOpen={(val) => {
          setIsWinnerModalOpen(val);
          setShowWinModal(val);
        }}
        bingoStatus={bingoStatus}
        setBingoStatus={setBingoStatus}
        cardId={cardId}
        gameData={gameData}
        isNonWinnerModalOpen={isNonWinnerModalOpen}
        setIsNonWinnerModalOpen={setIsNonWinnerModalOpen}
        nonWinnerCardData={nonWinnerCardData}
        setNonWinnerCardData={setNonWinnerCardData}
        isGameFinishedModalOpen={isGameFinishedModalOpen}
        setIsGameFinishedModalOpen={setIsGameFinishedModalOpen}
        isLoading={isLoading}
        isErrorModalOpen={isErrorModalOpen}
        setIsErrorModalOpen={setIsErrorModalOpen}
        callError={callError}
        setCallError={setCallError}
        navigate={navigate}
        winnerData={winnerData}
        showMessage={showMessage}
        messageType={messageType}
        bingoCards={bingoCards} // NEW: Pass for rendering winner card with orange highlights
        cards={cards} // NEW: Pass for access to winningPositions
        calledNumbers={calledNumbers}
        // NEW: Pass invalid card modal props
        isInvalidCardModalOpen={isInvalidCardModalOpen}
        setIsInvalidCardModalOpen={setIsInvalidCardModalOpen}
      />

      <style jsx>{`
        @keyframes confetti-fall {
          0% {
            transform: translateY(-10px) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        @keyframes shake {
          0%,
          100% {
            transform: translateX(0);
          }
          10%,
          30%,
          50%,
          70%,
          90% {
            transform: translateX(-10px);
          }
          20%,
          40%,
          60%,
          80% {
            transform: translateX(10px);
          }
        }
        .animate-shake {
          animation: shake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
          transform-origin: 50% 50%;
        }
        @keyframes celebrate {
          0%,
          100% {
            filter: hue-rotate(0deg) brightness(1);
          }
          50% {
            filter: hue-rotate(180deg) brightness(1.5);
          }
        }
        .animate-celebrate {
          animation: celebrate 2s ease-in-out infinite;
        }
        @keyframes rocket-launch {
          0% {
            transform: translateY(0) translateX(-50%);
            opacity: 1;
          }
          100% {
            transform: translateY(-200px) translateX(-50%);
            opacity: 0;
          }
        }
        @keyframes bounce {
          0%,
          20%,
          60%,
          100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-10px);
          }
          80% {
            transform: translateY(-5px);
          }
        }
        .animate-bounce {
          animation: bounce 1s infinite;
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out;
        }
      `}</style>
    </div>
  );
};

export default BingoGame;
