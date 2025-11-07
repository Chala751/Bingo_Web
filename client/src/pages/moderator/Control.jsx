import React, { useState, useEffect, useRef, useCallback } from "react";
// import { useNavigate } from "react-router-dom";
import ModeratorLayout from "../../components/moderator/ModeratorLayout";
import moderatorService from "../../services/moderator";
import { toast } from "react-toastify";

export default function ModeratorDashboard() {
  // Removed unused navigate for performance cleanup

  const [activeGames, setActiveGames] = useState([]);
  const [finishedGames, setFinishedGames] = useState([]);
  const [pendingGames, setPendingGames] = useState([]);
  const [configuredWinnerGames, setConfiguredWinnerGames] = useState([]);
  const [selectedNextGame, setSelectedNextGame] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalGameId, setModalGameId] = useState(null);
  const [selectedWinnerId, setSelectedWinnerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modalError, setModalError] = useState(null);
  const [callNumberModalOpen, setCallNumberModalOpen] = useState(false);
  const [callNumberGameId, setCallNumberGameId] = useState(null);
  const [selectedNumber, setSelectedNumber] = useState("");
  const [callNumberError, setCallNumberError] = useState(null);
  const [callNumberLoading, setCallNumberLoading] = useState(false);
  // Removed heavy allCards usage (was dropdown); numeric input now used.
  const [cashierId, setCashierId] = useState(null);
  const [futureWinnerModalOpen, setFutureWinnerModalOpen] = useState(false);
  const [futureWinners, setFutureWinners] = useState([
    { gameNumber: "", cardId: "", jackpotEnabled: true, pattern: "all" },
  ]);
  const [cashierInfo, setCashierInfo] = useState(null);
  const [reconfigureModalOpen, setReconfigureModalOpen] = useState(false);
  const [reconfigureWinner, setReconfigureWinner] = useState(null);
  const [reconfigureForm, setReconfigureForm] = useState({
    gameNumber: "",
    cardId: "",
    jackpotEnabled: true,
    pattern: "all",
  });

  // Cache cashier info/id to avoid re-fetching every poll
  const fetchingRef = useRef(false);
  const fetchCashierInfo = async () => {
    try {
      const response = await moderatorService.getPairedCashier();
      setCashierInfo(response);
      setCashierId(response.cashierId);
      return response.cashierId;
    } catch (err) {
      console.error("[fetchCashierInfo] Error:", err);
      setError("Failed to fetch cashier information. Please try again.");
      throw err; // propagate so caller can decide to abort fetchGames
    }
  };

  // Lightweight deep compare via stable JSON; memoize last snapshot to avoid stringifying on every poll
  const lastSnapshotRef = useRef({
    active: null,
    finished: null,
    pending: null,
    configured: null,
  });
  const stableStringify = (obj) => {
    try {
      return JSON.stringify(obj);
    } catch {
      return "";
    }
  };

  const applyGameLists = useCallback((allGames, futureWinnersResp) => {
    const nextActive = allGames.filter((g) => g.status === "active");
    const nextFinished = allGames.filter(
      (g) => g.status === "finished" || g.status === "completed"
    );
    const nextPending = allGames.filter((g) => g.status === "pending");

    const futureWinners = Array.isArray(futureWinnersResp)
      ? futureWinnersResp
      : [];
    const configuredFutureWinners = futureWinners.filter((winner) => {
      const game = allGames.find((g) => g.gameNumber === winner.gameNumber);
      return !game || game.status === "pending";
    });
    const nextConfigured = configuredFutureWinners.map((winner) => ({
      _id: winner._id,
      gameNumber: winner.gameNumber,
      cardId: winner.cardId,
      pattern: winner.pattern || "Not set",
      jackpotEnabled: winner.jackpotEnabled,
      status: allGames.find((g) => g.gameNumber === winner.gameNumber)
        ? "pending"
        : "not created",
    }));

    const snapshot = {
      active: stableStringify(nextActive),
      finished: stableStringify(nextFinished),
      pending: stableStringify(nextPending),
      configured: stableStringify(nextConfigured),
    };
    const last = lastSnapshotRef.current;
    if (last.active !== snapshot.active) setActiveGames(nextActive);
    if (last.finished !== snapshot.finished) setFinishedGames(nextFinished);
    if (last.pending !== snapshot.pending) setPendingGames(nextPending);
    if (last.configured !== snapshot.configured)
      setConfiguredWinnerGames(nextConfigured);
    lastSnapshotRef.current = snapshot;
  }, []);

  const fetchGames = useCallback(
    async (background = false) => {
      if (!background) {
        setLoading(true);
      }
      setError(null);
      try {
        if (background && fetchingRef.current) {
          // Skip if a background fetch is still in-flight
          return;
        }
        fetchingRef.current = true;
        // Only fetch cashier once; reuse cached id afterwards
        let cId = cashierId;
        if (!cId) {
          cId = await fetchCashierInfo();
        }
        if (!cId) {
          throw new Error("No cashierId returned from fetchCashierInfo");
        }
        // Abort controller to cancel slow overlapping polls
        if (!fetchGames.abortRef) fetchGames.abortRef = { controller: null };
        try {
          fetchGames.abortRef.controller?.abort?.();
        } catch (e) {
          // ignore abort errors
        }
        const controller = new AbortController();
        fetchGames.abortRef.controller = controller;

        const reportPromise = moderatorService.getCashierReport(cId);
        const futurePromise = (async () => {
          try {
            return await moderatorService.getFutureWinners(cId);
          } catch (err) {
            console.warn(
              "[fetchGames] Failed to fetch future winners, using empty array:",
              { message: err.message, response: err.response?.data }
            );
            return [];
          }
        })();
        const [report, futureWinnersResp] = await Promise.all([
          reportPromise,
          futurePromise,
        ]);

        const allGames = report.games || [];
        if (!Array.isArray(allGames)) {
          throw new Error("No valid games data returned from service");
        }
        applyGameLists(allGames, futureWinnersResp);
      } catch (err) {
        const errorMessage =
          err.message ||
          "Failed to fetch games or future winners. Please try again.";
        setError(errorMessage);
        console.error("[fetchGames] Detailed Error:", {
          message: err.message,
          stack: err.stack,
          response: err.response
            ? { status: err.response.status, data: err.response.data }
            : null,
        });
      } finally {
        if (!background) {
          setLoading(false);
        }
      }
      fetchingRef.current = false;
    },
    [cashierId, applyGameLists]
  );

  useEffect(() => {
    let mounted = true;
    // initial load
    fetchGames(false);
    // Adaptive polling: slow when hidden, fast when focused
    const baseInterval = 5000;
    let intervalMs = baseInterval;
    const tick = () => {
      if (!mounted) return;
      if (!document.hidden) {
        fetchGames(true);
        intervalMs = baseInterval; // reset to normal when visible
      } else {
        intervalMs = 15000; // slow polling in background
      }
      schedule();
    };
    let intervalId;
    const schedule = () => {
      clearTimeout(intervalId);
      intervalId = setTimeout(tick, intervalMs);
    };
    schedule();
    const onVisible = () => {
      if (!document.hidden) {
        intervalMs = baseInterval;
        fetchGames(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted = false;
      clearTimeout(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchGames]);

  const handleToggleJackpot = async (gameId, currentEnabled) => {
    setLoading(true);
    setError(null);
    try {
      const updatedGame = await moderatorService.updateGame(gameId, {
        jackpotEnabled: !currentEnabled,
      });
      setActiveGames((prev) =>
        prev.map((g) =>
          g._id === gameId
            ? { ...g, jackpotEnabled: updatedGame.jackpotEnabled }
            : g
        )
      );
      setFinishedGames((prev) =>
        prev.map((g) =>
          g._id === gameId
            ? { ...g, jackpotEnabled: updatedGame.jackpotEnabled }
            : g
        )
      );
      setConfiguredWinnerGames((prev) =>
        prev.map((g) =>
          g._id === gameId
            ? { ...g, jackpotEnabled: updatedGame.jackpotEnabled }
            : g
        )
      );
    } catch (err) {
      setError("Failed to toggle jackpot. Please try again.");
      console.error("[handleToggleJackpot] Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartNextGame = async () => {
    if (!selectedNextGame) {
      setError("Please select a game to start.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const updatedGame = await moderatorService.startGame(selectedNextGame);
      setPendingGames((prev) => prev.filter((g) => g._id !== selectedNextGame));
      setActiveGames((prev) => [updatedGame, ...prev]);
      if (updatedGame.moderatorWinnerCardId) {
        setConfiguredWinnerGames((prev) => [
          updatedGame,
          ...prev.filter((g) => g._id !== updatedGame._id),
        ]);
      }
      setSelectedNextGame("");
    } catch (err) {
      setError("Failed to start game. Please try again.");
      console.error("[handleStartNextGame] Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const openWinnerModal = (gameId, currentWinnerId) => {
    setModalGameId(gameId);
    setSelectedWinnerId(currentWinnerId || "");
    setModalError(null);
    setModalOpen(true);
  };

  const handleSetWinner = async () => {
    if (!modalGameId || !selectedWinnerId) {
      setModalError("Please select a winning card ID.");
      return;
    }
    const cardId = parseInt(selectedWinnerId, 10);
    if (isNaN(cardId) || cardId < 1) {
      setModalError("Invalid card ID.");
      return;
    }
    setModalLoading(true);
    setModalError(null);
    try {
      const updatedGame = await moderatorService.setWinnerById(
        modalGameId,
        cardId
      );
      setPendingGames((prev) =>
        prev.map((g) =>
          g._id === modalGameId ? { ...g, moderatorWinnerCardId: cardId } : g
        )
      );
      setConfiguredWinnerGames((prev) => [
        { ...updatedGame, moderatorWinnerCardId: cardId },
        ...prev.filter((g) => g._id !== modalGameId),
      ]);
      setModalOpen(false);
      setSelectedWinnerId("");
    } catch (err) {
      setModalError("Failed to set winner. Please try again.");
      console.error("[handleSetWinner] Error:", err);
    } finally {
      setModalLoading(false);
    }
  };

  const handleFinishGame = async (gameId) => {
    setLoading(true);
    setError(null);
    try {
      const updatedGame = await moderatorService.finishGame(gameId);
      setActiveGames((prev) => prev.filter((g) => g._id !== gameId));
      setFinishedGames((prev) => [
        ...prev,
        { ...updatedGame, status: "finished" },
      ]);
      setConfiguredWinnerGames((prev) => prev.filter((g) => g._id !== gameId));
    } catch (err) {
      setError("Failed to finish game. Please try again.");
      console.error("[handleFinishGame] Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const openCallNumberModal = (gameId) => {
    setCallNumberGameId(gameId);
    setSelectedNumber("");
    setCallNumberError(null);
    setCallNumberModalOpen(true);
  };

  const handleCallNumber = async () => {
    if (callNumberLoading) return;
    let numToCall = selectedNumber ? parseInt(selectedNumber, 10) : null;
    if (
      selectedNumber &&
      (isNaN(numToCall) || numToCall < 1 || numToCall > 75)
    ) {
      setCallNumberError("Invalid number. Must be between 1 and 75.");
      return;
    }
    setCallNumberLoading(true);
    setCallNumberError(null);
    try {
      const response = await moderatorService.callNumber(
        callNumberGameId,
        numToCall
      );
      setActiveGames((prev) =>
        prev.map((g) =>
          g._id === callNumberGameId
            ? { ...g, calledNumbers: response.game.calledNumbers }
            : g
        )
      );
      setCallNumberModalOpen(false);
      setSelectedNumber("");
    } catch (err) {
      setCallNumberError("Failed to call number. Please try again.");
      console.error("[handleCallNumber] Error:", err);
    } finally {
      setCallNumberLoading(false);
    }
  };

  const openFutureWinnerModal = () => {
    setFutureWinners([
      { gameNumber: "", cardId: "", jackpotEnabled: true, pattern: "all" },
    ]);
    setModalError(null);
    setFutureWinnerModalOpen(true);
  };

  const handleAddWinner = () => {
    setFutureWinners([
      ...futureWinners,
      { gameNumber: "", cardId: "", jackpotEnabled: true, pattern: "all" },
    ]);
  };

  const handleRemoveWinner = (index) => {
    setFutureWinners(futureWinners.filter((_, i) => i !== index));
  };

  const handleWinnerChange = (index, field, value) => {
    const updatedWinners = [...futureWinners];
    updatedWinners[index][field] = value;
    setFutureWinners(updatedWinners);
    console.log("[handleWinnerChange] Updated futureWinners:", updatedWinners);
  };

  const handleConfigureFutureWinner = async () => {
    setModalError(null);
    console.log(
      "[handleConfigureFutureWinner] Starting with futureWinners:",
      futureWinners
    );

    if (!Array.isArray(futureWinners) || futureWinners.length === 0) {
      setModalError("No valid winner configurations provided.");
      console.error(
        "[handleConfigureFutureWinner] futureWinners is invalid:",
        futureWinners
      );
      return;
    }

    const invalidWinner = futureWinners.find(
      (winner) => !winner.gameNumber || !winner.cardId
    );
    if (invalidWinner) {
      setModalError(
        "Please enter a game number and select a winning card for all entries."
      );
      console.error(
        "[handleConfigureFutureWinner] Invalid winner entry:",
        invalidWinner
      );
      return;
    }

    const formattedWinners = futureWinners.map((winner, index) => {
      const gameNumber = parseInt(winner.gameNumber, 10);
      const cardId = parseInt(winner.cardId, 10);
      console.log(
        `[handleConfigureFutureWinner] Formatting winner ${index + 1}:`,
        {
          gameNumber,
          cardId,
          jackpotEnabled: winner.jackpotEnabled,
          pattern: winner.pattern,
        }
      );
      return {
        gameNumber,
        cardId,
        jackpotEnabled: winner.jackpotEnabled,
        pattern: winner.pattern,
      };
    });

    for (const [index, winner] of formattedWinners.entries()) {
      if (isNaN(winner.gameNumber) || winner.gameNumber < 1) {
        setModalError(
          `Invalid game number for entry ${
            index + 1
          }. Must be a positive number.`
        );
        console.error(
          "[handleConfigureFutureWinner] Invalid gameNumber:",
          winner
        );
        return;
      }
      if (isNaN(winner.cardId) || winner.cardId < 1) {
        setModalError(
          `Invalid card ID for entry ${index + 1}. Must be a positive number.`
        );
        console.error("[handleConfigureFutureWinner] Invalid cardId:", winner);
        return;
      }
    }

    const payload = { games: formattedWinners };
    console.log(
      "[handleConfigureFutureWinner] Final payload to send:",
      JSON.stringify(payload)
    );

    setModalLoading(true);
    try {
      const response = await moderatorService.configureFutureWinners(payload);
      console.log("[handleConfigureFutureWinner] Backend response:", response);
      toast.success("Future winners configured successfully");
      await fetchGames();
      setFutureWinnerModalOpen(false);
      setFutureWinners([
        { gameNumber: "", cardId: "", jackpotEnabled: true, pattern: "all" },
      ]);
    } catch (err) {
      const errorMessage =
        err.response?.data?.message ||
        "Failed to configure future winners. Please try again.";
      setModalError(errorMessage);
      console.error("[handleConfigureFutureWinner] Error:", err, {
        response: err.response?.data,
        status: err.response?.status,
        payloadSent: payload,
      });
    } finally {
      setModalLoading(false);
    }
  };

  const handleDeleteFutureWinner = async (futureWinnerId) => {
    if (!window.confirm("Are you sure you want to delete this future winner?"))
      return;
    try {
      await moderatorService.deleteFutureWinner(futureWinnerId);
      toast.success("Future winner deleted successfully");
      await fetchGames();
    } catch (error) {
      toast.error("Failed to delete future winner");
      console.error("[handleDeleteFutureWinner] Error:", error);
    }
  };

  const handleOpenReconfigureModal = (winner) => {
    setReconfigureWinner(winner);
    setReconfigureForm({
      gameNumber: winner.gameNumber.toString(),
      cardId: winner.cardId.toString(),
      jackpotEnabled: winner.jackpotEnabled,
      pattern: winner.pattern || "all",
    });
    setModalError(null);
    setReconfigureModalOpen(true);
  };

  const handleReconfigureSubmit = async () => {
    if (!reconfigureWinner) {
      setModalError("No winner selected for reconfiguration.");
      return;
    }
    const payload = {
      gameNumber: parseInt(reconfigureForm.gameNumber, 10),
      cardId: parseInt(reconfigureForm.cardId, 10),
      jackpotEnabled: reconfigureForm.jackpotEnabled,
      pattern: reconfigureForm.pattern,
    };
    if (isNaN(payload.gameNumber) || payload.gameNumber < 1) {
      setModalError("Invalid game number. Must be a positive number.");
      return;
    }
    if (isNaN(payload.cardId) || payload.cardId < 1) {
      setModalError("Invalid card ID. Must be a positive number.");
      return;
    }
    setModalLoading(true);
    setModalError(null);
    try {
      await moderatorService.reconfigureFutureWinner(
        reconfigureWinner._id,
        payload
      );
      toast.success("Future winner reconfigured successfully");
      await fetchGames();
      setReconfigureModalOpen(false);
      setReconfigureWinner(null);
      setReconfigureForm({
        gameNumber: "",
        cardId: "",
        jackpotEnabled: true,
        pattern: "all",
      });
    } catch (error) {
      setModalError("Failed to reconfigure future winner.");
      console.error("[handleReconfigureSubmit] Error:", error);
      toast.error("Failed to reconfigure future winner");
    } finally {
      setModalLoading(false);
    }
  };

  return (
    <ModeratorLayout>
      <div className="container mx-auto p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl">
        <div className="flex justify-between items-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 dark:text-white tracking-tight">
            Moderator Dashboard
          </h2>
        </div>

        {cashierInfo && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
            <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
              Managed Cashier
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <p className="text-gray-600 dark:text-gray-300">
                <strong className="font-medium">Name:</strong>{" "}
                {cashierInfo.name}
              </p>
              <p className="text-gray-600 dark:text-gray-300">
                <strong className="font-medium">Email:</strong>{" "}
                {cashierInfo.email}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-lg shadow-md">
            <div className="flex items-center">
              <svg
                className="w-5 h-5 mr-2"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{error}</span>
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-6">
            <div className="animate-spin rounded-full h-10 w-10 border-t-4 border-b-4 border-indigo-600 mx-auto"></div>
            <p className="text-gray-600 dark:text-gray-300 mt-3 font-medium">
              Loading...
            </p>
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
            Configure Next Game
          </h3>
          <button
            onClick={openFutureWinnerModal}
            className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-6 py-3 rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all duration-200 font-medium"
          >
            Configure Future Winners
          </button>
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <h3 className="text-xl font-semibold text-blue-600 dark:text-blue-400 mb-4">
            Pending Games
          </h3>
          {pendingGames.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 italic">
              No pending games available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Game #
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Pattern
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Cards
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Winner
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pendingGames.map((game) => (
                    <tr
                      key={game._id}
                      className="border-b border-gray-200 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.gameNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.pattern}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.selectedCards?.length || 0}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.moderatorWinnerCardId || "Not set"}
                        <button
                          onClick={() =>
                            openWinnerModal(
                              game._id,
                              game.moderatorWinnerCardId
                            )
                          }
                          className="ml-2 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
                        >
                          Set
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => {
                            setSelectedNextGame(game._id);
                            handleStartNextGame();
                          }}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-all duration-200 text-sm font-medium"
                        >
                          Start
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <h3 className="text-xl font-semibold text-purple-600 dark:text-purple-400 mb-4">
            Future Configured Winner Games
          </h3>
          {configuredWinnerGames.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 italic">
              No future games with configured winners.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Game #
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Pattern
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Winner Card ID
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Jackpot
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {configuredWinnerGames.map((game) => (
                    <tr
                      key={game._id}
                      className="border-b border-gray-200 dark:border-gray-700 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.gameNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.pattern}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.cardId}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.jackpotEnabled ? (
                          <span className="text-green-600 dark:text-green-400">
                            Enabled
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">
                            Disabled
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        <span
                          className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${
                            game.status === "pending"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                              : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                          }`}
                        >
                          {game.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 flex space-x-2">
                        <button
                          onClick={() => handleOpenReconfigureModal(game)}
                          className="bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition-all duration-200 text-sm font-medium"
                        >
                          Reconfigure
                        </button>
                        <button
                          onClick={() => handleDeleteFutureWinner(game._id)}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-all duration-200 text-sm font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <h3 className="text-xl font-semibold text-green-600 dark:text-green-400 mb-4">
            Active Games
          </h3>
          {activeGames.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 italic">
              No active games available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Game #
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Pattern
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Cards
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Called Numbers
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Jackpot
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeGames.map((game) => (
                    <tr
                      key={game._id}
                      className="border-b border-gray-200 dark:border-gray-700 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.gameNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.pattern}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.selectedCards?.length || 0}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.calledNumbers?.length || 0}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.jackpotEnabled ? (
                          <span className="text-green-600 dark:text-green-400">
                            Enabled
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400">
                            Disabled
                          </span>
                        )}
                        <button
                          onClick={() =>
                            handleToggleJackpot(game._id, game.jackpotEnabled)
                          }
                          className="ml-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium"
                        >
                          Toggle
                        </button>
                      </td>
                      <td className="px-4 py-3 flex space-x-2">
                        <button
                          onClick={() => openCallNumberModal(game._id)}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-all duration-200 text-sm font-medium"
                        >
                          Call Number
                        </button>
                        <button
                          onClick={() => handleFinishGame(game._id)}
                          className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-all duration-200 text-sm font-medium"
                        >
                          Finish
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <h3 className="text-xl font-semibold text-gray-600 dark:text-gray-400 mb-4">
            Finished Games
          </h3>
          {finishedGames.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400 italic">
              No finished games available.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Game #
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Pattern
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Cards
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">
                      Winner
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {finishedGames.map((game) => (
                    <tr
                      key={game._id}
                      className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.gameNumber}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.pattern}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.selectedCards?.length || 0}
                      </td>
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                        {game.moderatorWinnerCardId || "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {modalOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 transition-opacity duration-300">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full transform transition-all duration-300 scale-100">
              <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-6">
                Set Winner
              </h3>
              {modalError && (
                <div className="bg-red-50 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-lg mb-6">
                  {modalError}
                </div>
              )}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Winning Card ID
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={selectedWinnerId}
                    onChange={(e) => setSelectedWinnerId(e.target.value)}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    disabled={modalLoading}
                    placeholder="Enter winning card number"
                  />
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    onClick={() => setModalOpen(false)}
                    className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition-all duration-200 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSetWinner}
                    disabled={modalLoading || !selectedWinnerId}
                    className="bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center font-medium cursor-pointer"
                  >
                    {modalLoading && (
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {callNumberModalOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 transition-opacity duration-300">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full transform transition-all duration-300 scale-100">
              <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-6">
                Call Number
              </h3>
              {callNumberError && (
                <div className="bg-red-50 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-lg mb-6">
                  {callNumberError}
                </div>
              )}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Number to Call (1-75) or leave blank for auto
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="75"
                    value={selectedNumber}
                    onChange={(e) => setSelectedNumber(e.target.value)}
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    disabled={callNumberLoading}
                    placeholder="Enter number or leave for auto-rigged call"
                  />
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    onClick={() => setCallNumberModalOpen(false)}
                    className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition-all duration-200 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCallNumber}
                    disabled={callNumberLoading}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center font-medium"
                  >
                    {callNumberLoading && (
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    {selectedNumber ? "Call Selected" : "Auto Call Next"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {futureWinnerModalOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 transition-opacity duration-300">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-lg w-full transform transition-all duration-300 scale-100">
              <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-6">
                Configure Future Game Winners
              </h3>
              {modalError && (
                <div className="bg-red-50 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-lg mb-6">
                  {modalError}
                </div>
              )}
              <div className="space-y-6 max-h-[60vh] overflow-y-auto">
                {futureWinners.map((winner, index) => (
                  <div
                    key={index}
                    className="border-b border-gray-200 dark:border-gray-600 pb-4 mb-4"
                  >
                    <div className="flex justify-between items-center mb-4">
                      <h4 className="text-lg font-medium text-gray-700 dark:text-gray-300">
                        Winner {index + 1}
                      </h4>
                      {futureWinners.length > 1 && (
                        <button
                          onClick={() => handleRemoveWinner(index)}
                          className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm font-medium"
                          disabled={modalLoading}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Game Number
                        </label>
                        <input
                          type="number"
                          value={winner.gameNumber}
                          onChange={(e) =>
                            handleWinnerChange(
                              index,
                              "gameNumber",
                              e.target.value
                            )
                          }
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          placeholder="Enter game number (e.g., 10)"
                          min="1"
                          disabled={modalLoading}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Winning Card Number
                        </label>
                        <input
                          type="number"
                          value={winner.cardId}
                          onChange={(e) =>
                            handleWinnerChange(index, "cardId", e.target.value)
                          }
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          disabled={modalLoading}
                          min="1"
                          placeholder="Enter card number"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Pattern
                        </label>
                        <select
                          value={winner.pattern}
                          onChange={(e) =>
                            handleWinnerChange(index, "pattern", e.target.value)
                          }
                          className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          disabled={modalLoading}
                        >
                          <option value="all">Random</option>
                          <option value="horizontal_line">
                            Horizontal Line
                          </option>
                          <option value="vertical_line">Vertical Line</option>
                          <option value="main_diagonal">Main Diagonal</option>
                          <option value="other_diagonal">Other Diagonal</option>
                          <option value="four_corners_center">
                            Four Corners + Center
                          </option>
                          <option value="inner_corners">inner corners</option>
                        </select>
                      </div>
                      <div>
                        <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          <input
                            type="checkbox"
                            checked={winner.jackpotEnabled}
                            onChange={(e) =>
                              handleWinnerChange(
                                index,
                                "jackpotEnabled",
                                e.target.checked
                              )
                            }
                            disabled={modalLoading}
                            className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 mr-2 rounded"
                          />
                          Enable Jackpot
                        </label>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={handleAddWinner}
                  className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-all duration-200 font-medium"
                  disabled={modalLoading}
                >
                  Add Another Winner
                </button>
              </div>
              <div className="flex justify-end space-x-4 mt-6">
                <button
                  onClick={() => setFutureWinnerModalOpen(false)}
                  className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition-all duration-200 font-medium"
                  disabled={modalLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfigureFutureWinner}
                  disabled={modalLoading}
                  className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center font-medium"
                >
                  {modalLoading && (
                    <svg
                      className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  )}
                  Save All
                </button>
              </div>
            </div>
          </div>
        )}

        {reconfigureModalOpen && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 transition-opacity duration-300">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl max-w-md w-full transform transition-all duration-300 scale-100">
              <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-6">
                Reconfigure Future Winner
              </h3>
              {modalError && (
                <div className="bg-red-50 dark:bg-red-900/50 border-l-4 border-red-500 text-red-700 dark:text-red-300 p-4 rounded-lg mb-6">
                  {modalError}
                </div>
              )}
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Game Number
                  </label>
                  <input
                    type="number"
                    value={reconfigureForm.gameNumber}
                    onChange={(e) =>
                      setReconfigureForm({
                        ...reconfigureForm,
                        gameNumber: e.target.value,
                      })
                    }
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    placeholder="Enter game number (e.g., 10)"
                    min="1"
                    disabled={modalLoading}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Winning Card Number
                  </label>
                  <input
                    type="number"
                    value={reconfigureForm.cardId}
                    onChange={(e) =>
                      setReconfigureForm({
                        ...reconfigureForm,
                        cardId: e.target.value,
                      })
                    }
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    disabled={modalLoading}
                    min="1"
                    placeholder="Enter card number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Pattern
                  </label>
                  <select
                    value={reconfigureForm.pattern}
                    onChange={(e) =>
                      setReconfigureForm({
                        ...reconfigureForm,
                        pattern: e.target.value,
                      })
                    }
                    className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    disabled={modalLoading}
                  >
                    <option value="all">Random</option>
                    <option value="horizontal_line">Horizontal Line</option>
                    <option value="vertical_line">Vertical Line</option>
                    <option value="main_diagonal">Main Diagonal</option>
                    <option value="other_diagonal">Other Diagonal</option>
                    <option value="inner_corners">inner corners</option>
                    <option value="four_corners_center">
                      Four Corners + Center
                    </option>
                  </select>
                </div>
                <div>
                  <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    <input
                      type="checkbox"
                      checked={reconfigureForm.jackpotEnabled}
                      onChange={(e) =>
                        setReconfigureForm({
                          ...reconfigureForm,
                          jackpotEnabled: e.target.checked,
                        })
                      }
                      disabled={modalLoading}
                      className="h-5 w-5 text-indigo-600 focus:ring-indigo-500 mr-2 rounded"
                    />
                    Enable Jackpot
                  </label>
                </div>
                <div className="flex justify-end space-x-4">
                  <button
                    onClick={() => setReconfigureModalOpen(false)}
                    className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 transition-all duration-200 font-medium"
                    disabled={modalLoading}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReconfigureSubmit}
                    disabled={modalLoading}
                    className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center font-medium"
                  >
                    {modalLoading && (
                      <svg
                        className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ModeratorLayout>
  );
}
