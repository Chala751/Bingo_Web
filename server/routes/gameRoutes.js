import express from "express";
import { verifyToken } from "../middlewares/auth.js";
import { validate } from "../middlewares/validate.js";
import {
  getJackpot,
  getPairedCashier,
  updateJackpot,
  setJackpotAmount,
  addJackpotContribution,
  toggleJackpot,
  awardJackpot,
  getJackpotHistory,
  getJackpotStatus,
} from "../controllers/jackpotController.js";
import { getCashierReport } from "../controllers/reportController.js";
import {
  configureFutureWinners,
  createSequentialGames,
  getAllCards,
  getAllGames,
  getNextPendingGame,
  moderatorConfigureNextGameNumber,
} from "../controllers/adminController.js";
import {
  createGame,
  getGameById,
  getGames,
  resetGameCounter,
  selectWinner,
  startGame,
  updateGame,
} from "../controllers/gameController.js";
import {
  callNumber,
  checkBingo,
  finishGame,
  getCard,
  pauseGame,
  updateGameStatus,
  setAutoCallEnabled,
  restartGame,
} from "../controllers/bingoController.js";
import FutureWinner from "../models/FutureWinner.js";
import Card from "../models/Card.js"; // Added for reconfigureFutureWinner
import {
  getNumbersForPattern,
  generateQuickWinSequence,
} from "../utils/bingoUtils.js"; // Added for reconfigureFutureWinner
import mongoose from "mongoose";
import User from "../models/User.js";
import Game from "../models/Game.js";

const router = express.Router();

// ----------------- Game Routes -----------------
router.get("/paired-cashier", verifyToken, getPairedCashier);

// Specific jackpot routes
router.get("/jackpot", verifyToken, getJackpot);
router.post("/jackpot/set", verifyToken, validate, setJackpotAmount);
router.post("/jackpot/contribute", verifyToken, addJackpotContribution);
router.patch("/jackpot/toggle", verifyToken, validate, toggleJackpot);
router.post("/jackpot/award", verifyToken, validate, awardJackpot);
router.get("/jackpot/history", verifyToken, getJackpotHistory);
router.patch("/jackpot", verifyToken, updateJackpot);
router.get("/:id/jackpot-status", verifyToken, getJackpotStatus);

// ----------------- Admin Report Routes -----------------
router.get("/admin/cashier-report", verifyToken, async (req, res, next) => {
  // Admin-only route for getting cashier report
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Admin access required",
        errorCode: "ADMIN_ONLY",
      });
    }

    const { cashierId } = req.query;

    if (!cashierId) {
      return res.status(400).json({
        message: "cashierId query parameter is required",
        errorCode: "CASHIER_ID_REQUIRED",
      });
    }

    if (!mongoose.isValidObjectId(cashierId)) {
      return res.status(400).json({
        message: "Invalid cashier ID format",
        errorCode: "INVALID_CASHIER_ID",
      });
    }

    const response = await getCashierReport(req, res, next);
    return response;
  } catch (error) {
    console.error("[admin/cashier-report] Error:", error);
    next(error);
  }
});

router.get("/admin/cashiers", verifyToken, async (req, res, next) => {
  // Admin-only route for getting all cashiers
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({
        message: "Admin access required",
        errorCode: "ADMIN_ONLY",
      });
    }

    const cashiers = await User.find({ role: "cashier" })
      .select("name email _id createdAt")
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      message: "Cashiers retrieved successfully",
      count: cashiers.length,
      cashiers,
    });
  } catch (error) {
    console.error("[admin/cashiers] Error:", error);
    next(error);
  }
});

router.get(
  "/admin/cashier-summary/:cashierId",
  verifyToken,
  async (req, res, next) => {
    // Admin-only route for getting cashier summary stats
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          message: "Admin access required",
          errorCode: "ADMIN_ONLY",
        });
      }

      const { cashierId } = req.params;

      if (!mongoose.isValidObjectId(cashierId)) {
        return res.status(400).json({
          message: "Invalid cashier ID format",
          errorCode: "INVALID_CASHIER_ID",
        });
      }

      // Get cashier details
      const cashier = await User.findById(cashierId).select(
        "name email role createdAt"
      );
      if (!cashier || cashier.role !== "cashier") {
        return res.status(404).json({
          message: "Cashier not found",
          errorCode: "CASHIER_NOT_FOUND",
        });
      }

      // Get game statistics
      const games = await Game.find({ cashierId })
        .select(
          "gameNumber status betAmount houseFee prizePool createdAt winner"
        )
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      const totalGames = games.length;
      const completedGames = games.filter(
        (g) => g.status === "completed"
      ).length;
      const activeGames = games.filter((g) => g.status === "active").length;
      const pendingGames = games.filter((g) => g.status === "pending").length;

      const totalPrizePool = games.reduce(
        (sum, g) => sum + (g.prizePool || 0),
        0
      );
      const totalHouseFee = games.reduce(
        (sum, g) => sum + (parseFloat(g.houseFee) || 0),
        0
      );
      const totalWinnings = games.reduce(
        (sum, g) => sum + (g.winner?.prize || 0),
        0
      );

      res.json({
        success: true,
        message: "Cashier summary retrieved successfully",
        cashier: {
          id: cashier._id,
          name: cashier.name,
          email: cashier.email,
          createdAt: cashier.createdAt,
        },
        summary: {
          totalGames,
          completedGames,
          activeGames,
          pendingGames,
          totalPrizePool: parseFloat(totalPrizePool).toFixed(2),
          totalHouseFee: parseFloat(totalHouseFee).toFixed(2),
          totalWinnings: parseFloat(totalWinnings).toFixed(2),
          profit: parseFloat(totalHouseFee - totalWinnings).toFixed(2),
          winRate:
            totalGames > 0
              ? ((completedGames / totalGames) * 100).toFixed(1)
              : 0,
        },
        recentGames: games.slice(0, 10),
      });
    } catch (error) {
      console.error("[admin/cashier-summary] Error:", error);
      next(error);
    }
  }
);
// Add this route to your games routes file (after the existing admin routes)
router.get(
  "/admin/all-cashier-summaries",
  verifyToken,
  async (req, res, next) => {
    // Admin-only route for getting all cashiers' summary stats
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          message: "Admin access required",
          errorCode: "ADMIN_ONLY",
        });
      }

      // Get all cashiers
      const cashiers = await User.find({ role: "cashier" })
        .select("name email _id createdAt")
        .sort({ createdAt: -1 })
        .lean();

      // Get summary data for each cashier
      const cashierSummaries = await Promise.all(
        cashiers.map(async (cashier) => {
          // Get all games for summary calculation
          const allGames = await Game.find({ cashierId: cashier._id })
            .select(
              "gameNumber status betAmount houseFee prizePool createdAt winner"
            )
            .lean();

          const totalGames = allGames.length;
          const completedGames = allGames.filter(
            (g) => g.status === "completed"
          ).length;
          const activeGames = allGames.filter(
            (g) => g.status === "active"
          ).length;
          const pendingGames = allGames.filter(
            (g) => g.status === "pending"
          ).length;

          const totalPrizePool = allGames.reduce(
            (sum, g) => sum + (g.prizePool || 0),
            0
          );
          const totalHouseFee = allGames.reduce(
            (sum, g) => sum + (parseFloat(g.houseFee) || 0),
            0
          );
          const totalWinnings = allGames.reduce(
            (sum, g) => sum + (g.winner?.prize || 0),
            0
          );

          // Get recent games (limit 10 for display)
          const recentGames = allGames.slice(0, 10);

          return {
            cashier: {
              id: cashier._id,
              name: cashier.name,
              email: cashier.email,
              createdAt: cashier.createdAt,
            },
            summary: {
              totalGames,
              completedGames,
              activeGames,
              pendingGames,
              totalPrizePool: parseFloat(totalPrizePool),
              totalHouseFee: parseFloat(totalHouseFee),
              totalWinnings: parseFloat(totalWinnings),
            },
            recentGames,
          };
        })
      );

      res.json({
        success: true,
        message: "All cashier summaries retrieved successfully",
        count: cashierSummaries.length,
        cashiers: cashierSummaries,
      });
    } catch (error) {
      console.error("[admin/all-cashier-summaries] Error:", error);
      next(error);
    }
  }
);

// Other static routes
router.get("/report", verifyToken, getCashierReport);
router.get("/cards", verifyToken, getAllCards);
router.get("/", verifyToken, getAllGames);
router.get("/next-pending", verifyToken, getNextPendingGame);
router.post("/reset-game-counter", verifyToken, resetGameCounter);
router.post("/sequential", verifyToken, validate, createSequentialGames);

// Moderator routes
router.post("/select-winner", verifyToken, validate, selectWinner);
router.post(
  "/configure-next",
  verifyToken,
  validate,
  moderatorConfigureNextGameNumber
);
router.post(
  "/configure-future-winners",
  verifyToken,
  validate,
  configureFutureWinners
);

// Create a new game
router.post("/", verifyToken, validate, (req, res, next) => {
  console.log("Hit /api/games POST route with payload:", req.body);
  createGame(req, res, next);
});
router.put("/:gameId/status", verifyToken, validate, updateGameStatus);

// Specific game ID routes
router.get("/:id", verifyToken, (req, res, next) => {
  console.log("Hit /api/games/:id route with id:", req.params.id);
  getGames(req, res, next);
});
router.post("/:id/check-bingo", verifyToken, validate, checkBingo);
router.get("/cards/:id", verifyToken, getCard);
router.get("/games/:id", verifyToken, validate, getGameById);
router.post("/:gameId/call-number", verifyToken, validate, callNumber);

router.post("/:id/select-winner", verifyToken, validate, selectWinner);
router.post("/:id/finish", verifyToken, validate, finishGame);
router.post("/:id/start", verifyToken, startGame);
router.post("/:id/pause", verifyToken, pauseGame);
router.patch("/:id/auto-call", verifyToken, validate, setAutoCallEnabled);
router.post("/:id/restart", verifyToken, validate, restartGame);
router.patch("/:id", verifyToken, validate, updateGame);

// Future winners routes
router.post("/future-winners", verifyToken, async (req, res, next) => {
  try {
    const { cashierId } = req.body;
    console.log(
      "[getFutureWinners] Received POST request with cashierId:",
      cashierId
    );

    if (!cashierId) {
      console.error("[getFutureWinners] Missing cashierId");
      return res.status(400).json({ message: "cashierId is required" });
    }

    if (!mongoose.isValidObjectId(cashierId)) {
      console.error("[getFutureWinners] Invalid cashierId format:", cashierId);
      return res.status(400).json({ message: "Invalid cashierId format" });
    }

    if (
      req.user.role !== "moderator" ||
      req.user.managedCashier.toString() !== cashierId
    ) {
      console.error("[getFutureWinners] Unauthorized cashierId:", cashierId);
      return res.status(403).json({
        message: "Unauthorized: Cashier not managed by this moderator",
      });
    }

    const futureWinners = await FutureWinner.find({ cashierId, used: false })
      .select("_id gameNumber cardId pattern jackpotEnabled")
      .sort({ gameNumber: 1 });

    console.log("[getFutureWinners] Retrieved future winners:", futureWinners);

    res.status(200).json({
      message: "Future winners retrieved successfully",
      winners: futureWinners,
    });
  } catch (error) {
    console.error("[getFutureWinners] Error:", {
      message: error.message,
      stack: error.stack,
    });
    next(error);
  }
});

router.delete(
  "/future-winners/:futureWinnerId",
  verifyToken,
  async (req, res, next) => {
    try {
      const { futureWinnerId } = req.params;
      console.log(
        "[deleteFutureWinner] Received DELETE request for futureWinnerId:",
        futureWinnerId
      );

      if (!mongoose.isValidObjectId(futureWinnerId)) {
        console.error(
          "[deleteFutureWinner] Invalid futureWinnerId format:",
          futureWinnerId
        );
        return res
          .status(400)
          .json({ message: "Invalid futureWinnerId format" });
      }

      const futureWinner = await FutureWinner.findById(futureWinnerId);
      if (!futureWinner) {
        console.error(
          "[deleteFutureWinner] Future winner not found:",
          futureWinnerId
        );
        return res.status(404).json({ message: "Future winner not found" });
      }

      if (
        req.user.role !== "moderator" ||
        req.user.managedCashier.toString() !== futureWinner.cashierId.toString()
      ) {
        console.error(
          "[deleteFutureWinner] Unauthorized for cashierId:",
          futureWinner.cashierId
        );
        return res.status(403).json({
          message: "Unauthorized: Cashier not managed by this moderator",
        });
      }

      await FutureWinner.findByIdAndDelete(futureWinnerId);
      console.log(
        "[deleteFutureWinner] Deleted future winner:",
        futureWinnerId
      );

      res.status(200).json({
        message: "Future winner deleted successfully",
      });
    } catch (error) {
      console.error("[deleteFutureWinner] Error:", {
        message: error.message,
        stack: error.stack,
      });
      next(error);
    }
  }
);

router.put(
  "/future-winners/:futureWinnerId",
  verifyToken,
  async (req, res, next) => {
    try {
      const { futureWinnerId } = req.params;
      const { gameNumber, cardId, jackpotEnabled, pattern = "all" } = req.body;
      console.log(
        "[reconfigureFutureWinner] Received PUT request for futureWinnerId:",
        futureWinnerId,
        "Payload:",
        req.body
      );

      if (!mongoose.isValidObjectId(futureWinnerId)) {
        console.error(
          "[reconfigureFutureWinner] Invalid futureWinnerId format:",
          futureWinnerId
        );
        return res
          .status(400)
          .json({ message: "Invalid futureWinnerId format" });
      }

      const futureWinner = await FutureWinner.findById(futureWinnerId);
      if (!futureWinner) {
        console.error(
          "[reconfigureFutureWinner] Future winner not found:",
          futureWinnerId
        );
        return res.status(404).json({ message: "Future winner not found" });
      }

      if (
        req.user.role !== "moderator" ||
        req.user.managedCashier.toString() !== futureWinner.cashierId.toString()
      ) {
        console.error(
          "[reconfigureFutureWinner] Unauthorized for cashierId:",
          futureWinner.cashierId
        );
        return res.status(403).json({
          message: "Unauthorized: Cashier not managed by this moderator",
        });
      }

      if (!Number.isInteger(gameNumber) || gameNumber < 1) {
        throw new Error(`Invalid game number: ${gameNumber}`);
      }
      if (!Number.isInteger(cardId) || cardId < 1) {
        throw new Error(`Invalid card ID: ${cardId}`);
      }

      const card = await Card.findOne({ card_number: cardId });
      if (!card) {
        throw new Error(`Card not found for ID: ${cardId}`);
      }
      console.log("[reconfigureFutureWinner] Fetched card:", {
        cardId,
        numbers: card.numbers,
      });

      let chosenPattern = pattern;
      if (pattern === "all") {
        const easyPatterns = [
          "horizontal_line",
          "vertical_line",
          "main_diagonal",
          "other_diagonal",
          "four_corners_center",
        ];
        chosenPattern =
          easyPatterns[Math.floor(Math.random() * easyPatterns.length)];
        console.log(
          `[reconfigureFutureWinner] 🎯 "all" → converted to: ${chosenPattern}`
        );
      }

      const { selectedNumbers, selectedIndices } = getNumbersForPattern(
        card.numbers,
        chosenPattern,
        [],
        true
      );

      console.log(
        `[reconfigureFutureWinner] ✅ Numbers for pattern "${chosenPattern}": [${selectedNumbers.join(
          ", "
        )}]`
      );

      if (!selectedNumbers || selectedNumbers.length === 0) {
        throw new Error(`No numbers returned for pattern "${chosenPattern}"`);
      }

      const forcedCallSequence = generateQuickWinSequence(
        selectedNumbers.map(Number),
        selectedNumbers.length,
        10,
        14
      );

      console.log(
        `[reconfigureFutureWinner] 🚀 Generated forcedCallSequence (${forcedCallSequence.length} calls):`,
        forcedCallSequence
      );

      const updatedWinner = await FutureWinner.findByIdAndUpdate(
        futureWinnerId,
        {
          gameNumber,
          cardId,
          moderatorId: req.user.id,
          cashierId: futureWinner.cashierId,
          fullCardNumbers: card.numbers.map((row) =>
            row.map((v) => (v === "FREE" ? null : v))
          ),
          playableNumbers: selectedNumbers,
          forcedCallSequence,
          pattern: chosenPattern,
          jackpotEnabled,
          selectedWinnerRowIndices: selectedIndices,
          used: false,
        },
        { new: true }
      );

      console.log(
        "[reconfigureFutureWinner] Updated future winner:",
        updatedWinner
      );

      res.status(200).json({
        message: "Future winner reconfigured successfully",
        winner: updatedWinner,
      });
    } catch (error) {
      console.error("[reconfigureFutureWinner] Error:", {
        message: error.message,
        stack: error.stack,
      });
      next(error);
    }
  }
);

export default router;
