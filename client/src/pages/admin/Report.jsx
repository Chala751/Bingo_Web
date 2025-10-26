import React, { useState, useEffect } from "react";
import AdminLayout from "../../components/admin/AdminLayout"; // Add this import
import { useNavigate } from "react-router-dom";
import gameService from "../../services/game";
import {
  getAllCashiers,
  getCashierPerformance,
  getCashierReport,
  formatCashierData,
  getAllCashierSummaries,
} from "../../services/admin";
// Note: axios instance is configured in services/axios; no direct API import needed here

const AdminReport = () => {
  const navigate = useNavigate();
  const [cashiers, setCashiers] = useState([]);
  const [activeCashiers, setActiveCashiers] = useState([]);
  const [allCashierSummaries, setAllCashierSummaries] = useState([]);
  const [selectedCashierId, setSelectedCashierId] = useState("");
  const [selectedCashierData, setSelectedCashierData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [controlLoading, setControlLoading] = useState({}); // Per-game loading
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertType, setAlertType] = useState("info");

  // Fetch all cashiers and summaries on component mount
  useEffect(() => {
    const fetchInitialData = async () => {
      setLoading(true);
      try {
        // Fetch all cashiers
        const allCashiersResponse = await getAllCashiers();
        setCashiers(allCashiersResponse.cashiers || []);

        // Fetch all cashier summaries (real metrics per cashier)
        const summariesResponse = await getAllCashierSummaries();
        setAllCashierSummaries(summariesResponse.cashiers || []);

        // Derive "recently active" cashiers from summaries: those with games, sorted by latest game date
        const derivedActive = (summariesResponse.cashiers || [])
          .map((s) => {
            const latestGame = (s.recentGames || []).reduce((acc, g) => {
              const t = new Date(g.createdAt).getTime();
              return !acc || t > acc ? t : acc;
            }, null);
            return {
              id: s.cashier.id,
              name: s.cashier.name,
              email: s.cashier.email,
              totalGames: Number(s.summary?.totalGames || 0),
              totalHouseFee: Number(s.summary?.totalHouseFee || 0),
              latestActivity: latestGame,
            };
          })
          .filter((x) => x.totalGames > 0)
          .sort((a, b) => (b.latestActivity || 0) - (a.latestActivity || 0));
        setActiveCashiers(derivedActive);

        console.log("[AdminReport] Loaded all data:", {
          cashiers: allCashiersResponse,
          summaries: summariesResponse,
        });
      } catch (err) {
        console.error("[AdminReport] Initial load error:", err);
        setError(
          "Failed to load cashiers: " +
            (err.message || err.response?.data?.message)
        );
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, []);

  // Fetch detailed report when cashier is selected
  useEffect(() => {
    if (!selectedCashierId) {
      setSelectedCashierData(null);
      return;
    }

    const fetchCashierReport = async () => {
      setReportLoading(true);
      setError(null);
      try {
        console.log(
          "[AdminReport] Fetching detailed report for cashier:",
          selectedCashierId
        );

        // Fetch both performance summary and detailed report
        const [performanceRaw, detailedReportRaw] = await Promise.all([
          getCashierPerformance(selectedCashierId),
          getCashierReport(selectedCashierId),
        ]);

        // Defensive normalization: backend sometimes nests payload under `data` or uses `games` vs `recentGames`.
        const performance = performanceRaw?.data || performanceRaw || {};
        const detailedReport =
          detailedReportRaw?.data || detailedReportRaw || {};

        // Extract cashier and summary from performance (support multiple shapes)
        const cashierObj =
          performance.cashier || performance.cashier?.cashier || performance;
        const summaryObj =
          performance.summary || performance?.data?.summary || performance;

        // Normalize recent games list from detailed report
        const recentGamesList =
          detailedReport.recentGames ||
          detailedReport.games ||
          detailedReport.recent_games ||
          [];

        const detailedReportNormalized = {
          ...detailedReport,
          recentGames: Array.isArray(recentGamesList) ? recentGamesList : [],
        };

        // Combine into a predictable client shape
        const combinedData = {
          cashier: cashierObj,
          summary: summaryObj,
          performance: performance,
          detailedReport: detailedReportNormalized,
          formatted: formatCashierData(cashierObj, summaryObj),
        };

        // Validate and ensure numeric fields are properly formatted
        const validatedData = {
          ...combinedData,
          summary: {
            ...combinedData.summary,
            profit: Number(combinedData.summary?.profit || 0),
            totalPrizePool: Number(combinedData.summary?.totalPrizePool || 0),
            totalGames: Number(combinedData.summary?.totalGames || 0),
            winRate: Number(combinedData.summary?.winRate || 0),
            totalHouseFee: Number(combinedData.summary?.totalHouseFee || 0),
          },
          performance: {
            ...combinedData.performance,
            totalGames: Number(combinedData.performance?.totalGames || 0),
          },
        };

        setSelectedCashierData(validatedData);
        console.log("[AdminReport] Detailed report loaded:", validatedData);
      } catch (err) {
        console.error("[AdminReport] Detailed report fetch error:", err);
        setError(
          "Failed to fetch detailed report: " +
            (err.message || err.response?.data?.message)
        );
      } finally {
        setReportLoading(false);
      }
    };

    fetchCashierReport();
  }, [selectedCashierId]);

  // Handle cashier selection
  const handleCashierSelect = (cashierId) => {
    setSelectedCashierId(cashierId);
    if (!cashierId) {
      setSelectedCashierData(null);
      setError(null);
    }
  };

  // Handle game control (pause, resume, stop)
  const handleGameControl = async (gameId, action) => {
    const gameIndex = selectedCashierData.detailedReport.recentGames.findIndex(
      (g) => g._id === gameId
    );
    if (gameIndex === -1) {
      showPopup("Game not found", "error");
      return;
    }

    const previousReportData = { ...selectedCashierData };
    const targetGame = {
      ...selectedCashierData.detailedReport.recentGames[gameIndex],
    };

    setControlLoading((prev) => ({ ...prev, [`${gameId}-${action}`]: true }));

    try {
      let newStatus;
      let apiCall;
      let successMessage;

      switch (action) {
        case "play":
          newStatus = "active";
          apiCall = () => gameService.startGame(gameId);
          successMessage =
            targetGame.status === "paused"
              ? "Game resumed successfully!"
              : "Game started successfully!";
          break;
        case "pause":
          newStatus = "paused";
          apiCall = () => gameService.pauseGame(gameId);
          successMessage = "Game paused successfully!";
          break;
        case "stop":
          newStatus = "completed";
          apiCall = () => gameService.finishGame(gameId);
          successMessage = "Game stopped and completed successfully!";
          break;
        default:
          throw new Error(
            `Invalid action: ${action} for status: ${targetGame.status}`
          );
      }

      // Optimistic UI update
      const updatedGames = selectedCashierData.detailedReport.recentGames.map(
        (g, idx) => (idx === gameIndex ? { ...g, status: newStatus } : g)
      );
      setSelectedCashierData((prev) => ({
        ...prev,
        detailedReport: {
          ...prev.detailedReport,
          recentGames: updatedGames,
        },
      }));

      // API call
      const result = await apiCall();
      console.log(`[handleGameControl] ${action} response:`, result);

      // Handle jackpot after stop
      if (action === "stop" && targetGame.jackpotEnabled) {
        try {
          const contribution = parseFloat(targetGame.betAmount) || 0;
          if (contribution > 0) {
            await gameService.addJackpotContribution(gameId, contribution);
          }
        } catch (jackpotError) {
          console.warn(
            `[handleGameControl] Jackpot finalization failed: ${jackpotError.message}`
          );
        }
      }

      // Show success
      showPopup(successMessage, "success");
    } catch (error) {
      // Use structured error from API if exists
      const errMessage =
        error.response?.data?.message || error.message || "Unknown error";

      console.error(
        `[handleGameControl] Error ${action}ing game ${gameId}:`,
        errMessage
      );

      // Rollback UI
      setSelectedCashierData(previousReportData);

      showPopup(`Failed to ${action} game: ${errMessage}`, "error");
    } finally {
      setControlLoading((prev) => {
        const newState = { ...prev };
        delete newState[`${gameId}-${action}`];
        return newState;
      });
    }
  };

  const handleViewGame = (gameId) => {
    navigate(`/bingo-game?id=${gameId}`);
  };

  const showPopup = (message, type = "info") => {
    setAlertMessage(message);
    setAlertType(type);
    setShowAlert(true);
  };

  const hidePopup = () => {
    setShowAlert(false);
  };

  // Filter cashiers based on search term
  const filteredCashiers = cashiers.filter(
    (cashier) =>
      cashier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cashier.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter summaries based on search term
  const filteredSummaries = allCashierSummaries.filter(
    (summary) =>
      summary.cashier.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      summary.cashier.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Safe number formatting helper for Birr
  const formatBirr = (value) => {
    const numValue = Number(value || 0);
    return numValue.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  };

  const formatNumber = (value) => {
    const numValue = Number(value || 0);
    return numValue.toLocaleString();
  };

  // Loading state
  if (loading) {
    return (
      <AdminLayout>
        <div className="flex justify-center items-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading cashier reports...</p>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 text-gray-800">
            Admin Cashier Reports
          </h1>
          <p className="text-gray-600">
            Monitor performance and generate detailed reports for all cashiers
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg
                  className="h-5 w-5 text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-red-800">{error}</p>
              </div>
              <div className="ml-auto pl-3">
                <button
                  onClick={() => setError(null)}
                  className="text-red-800 hover:text-red-900"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg
                className="h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <input
              type="text"
              placeholder="Search cashiers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* All Cashiers Summary Table */}
        <div className="bg-white rounded-lg shadow mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-800">
              All Cashier Reports ({filteredSummaries.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cashier
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Games
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Prize Pool
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total House Fee
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredSummaries.length > 0 ? (
                  filteredSummaries.map((summary) => (
                    <tr
                      key={summary.cashier.id}
                      className={`hover:bg-gray-50 ${
                        selectedCashierId === summary.cashier.id
                          ? "bg-blue-50"
                          : ""
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-10 w-10">
                            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                              <span className="text-sm font-medium text-blue-800">
                                {summary.cashier.name
                                  .split(" ")
                                  .map((n) => n[0])
                                  .join("")}
                              </span>
                            </div>
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">
                              {summary.cashier.name}
                            </div>
                            <div className="text-sm text-gray-500">
                              {summary.cashier.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatNumber(summary.summary.totalGames)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                        <span className="text-green-600 font-medium">
                          {formatBirr(summary.summary.totalPrizePool)} Br
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                        <span
                          className={`${
                            summary.summary.totalHouseFee > 0
                              ? "text-purple-600 font-medium"
                              : "text-gray-500"
                          }`}
                        >
                          {formatBirr(summary.summary.totalHouseFee)} Br
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() =>
                            handleCashierSelect(summary.cashier.id)
                          }
                          className={`${
                            selectedCashierId === summary.cashier.id
                              ? "text-blue-700 hover:text-blue-900"
                              : "text-blue-600 hover:text-blue-900"
                          }`}
                        >
                          View Details
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-12 text-center text-gray-500"
                    >
                      <div className="flex flex-col items-center">
                        <svg
                          className="mx-auto h-12 w-12 text-gray-400 mb-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                        <p className="text-lg">No cashiers found</p>
                        {searchTerm && (
                          <p className="text-sm mt-1">
                            Try adjusting your search terms
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100">
                <svg
                  className="h-6 w-6 text-blue-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">
                  Total Cashiers
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {cashiers.length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100">
                <svg
                  className="h-6 w-6 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">
                  Active Cashiers
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {activeCashiers.length}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-purple-100">
                <svg
                  className="h-6 w-6 text-purple-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">
                  Total House Fees
                </p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatBirr(
                    allCashierSummaries.reduce(
                      (sum, c) => sum + Number(c.summary.totalHouseFee || 0),
                      0
                    )
                  )}{" "}
                  Br
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Cashier Selection Panel */}
          <div className="lg:col-span-1">
            <div className="bg-white p-6 rounded-lg shadow sticky top-6">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">
                Quick Stats
              </h2>

              {/* Cashier Selection Dropdown */}
              <select
                value={selectedCashierId}
                onChange={(e) => handleCashierSelect(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-6"
                disabled={reportLoading}
              >
                <option value="">-- Select Cashier for Details --</option>
                {filteredCashiers.map((cashier) => (
                  <option key={cashier._id} value={cashier._id}>
                    {cashier.name} ({cashier.email})
                  </option>
                ))}
              </select>

              {/* Quick Stats for Selected Cashier */}
              {selectedCashierData && (
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm font-medium text-blue-800 mb-1">
                      Games Played
                    </p>
                    <p className="text-lg font-bold text-blue-600">
                      {formatNumber(selectedCashierData.summary?.totalGames)}
                    </p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-sm font-medium text-green-800 mb-1">
                      Total Prize Pool
                    </p>
                    <p className="text-lg font-bold text-green-600">
                      {formatBirr(selectedCashierData.summary?.totalPrizePool)}{" "}
                      Br
                    </p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <p className="text-sm font-medium text-purple-800 mb-1">
                      Total House Fee
                    </p>
                    <p className="text-lg font-bold text-purple-600">
                      {formatBirr(selectedCashierData.summary?.totalHouseFee)}{" "}
                      Br
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Active Cashiers List */}
            <div className="bg-white p-6 rounded-lg shadow mt-6">
              <h3 className="text-lg font-semibold mb-4 text-gray-800">
                Recently Active ({activeCashiers.length})
              </h3>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {activeCashiers.slice(0, 8).map((cashier) => (
                  <div
                    key={cashier.id}
                    className={`p-3 rounded cursor-pointer hover:bg-gray-50 border-l-4 ${
                      selectedCashierId === cashier.id
                        ? "bg-blue-50 border-blue-500"
                        : "border-transparent"
                    }`}
                    onClick={() => handleCashierSelect(cashier.id)}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-gray-900">
                          {cashier.name}
                        </p>
                        <p className="text-sm text-gray-500">{cashier.email}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {formatNumber(cashier.totalGames)} games
                        </p>
                        <p className="text-xs text-green-600 font-medium">
                          {formatBirr(cashier.totalHouseFee || 0)} Br
                        </p>
                        {cashier.latestActivity && (
                          <p className="text-[10px] text-gray-400 mt-1">
                            {new Date(
                              cashier.latestActivity
                            ).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {activeCashiers.length > 8 && (
                <button className="mt-3 text-blue-600 hover:text-blue-800 text-sm">
                  View All Active ({activeCashiers.length})
                </button>
              )}
            </div>
          </div>

          {/* Detailed Report Panel */}
          <div className="lg:col-span-2">
            {reportLoading && (
              <div className="bg-white p-8 rounded-lg shadow text-center">
                <div className="flex justify-center items-center space-x-2 mb-4">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                  <span className="text-gray-600">
                    Loading detailed report...
                  </span>
                </div>
              </div>
            )}

            {!selectedCashierId && !reportLoading && (
              <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
                <div className="max-w-md mx-auto">
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400 mb-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <h3 className="text-lg font-medium mb-2">Select a Cashier</h3>
                  <p className="mb-4">
                    Click "View Details" on any cashier in the table above to
                    see their detailed report and recent games.
                  </p>
                </div>
              </div>
            )}

            {selectedCashierData && (
              <div className="space-y-6">
                {/* Cashier Header */}
                <div className="bg-white p-6 rounded-lg shadow">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">
                        {selectedCashierData.cashier.name}
                      </h2>
                      <p className="text-gray-600 mt-1">
                        {selectedCashierData.cashier.email}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        Member since:{" "}
                        {new Date(
                          selectedCashierData.cashier.createdAt
                        ).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="mt-4 md:mt-0">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                          selectedCashierData.performance?.totalGames > 0
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800"
                        }`}
                      >
                        {selectedCashierData.performance?.totalGames > 0
                          ? "Active"
                          : "New"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Performance Metrics */}
                <div className="bg-white p-6 rounded-lg shadow">
                  <h3 className="text-xl font-semibold mb-6 text-gray-800">
                    Performance Overview
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="text-center p-4">
                      <p className="text-sm font-medium text-gray-600">
                        Total Games
                      </p>
                      <p className="text-3xl font-bold text-gray-900">
                        {formatNumber(selectedCashierData.summary?.totalGames)}
                      </p>
                    </div>
                    <div className="text-center p-4">
                      <p className="text-sm font-medium text-gray-600">
                        Prize Pool
                      </p>
                      <p className="text-3xl font-bold text-green-600">
                        {formatBirr(
                          selectedCashierData.summary?.totalPrizePool
                        )}{" "}
                        Br
                      </p>
                    </div>
                    <div className="text-center p-4">
                      <p className="text-sm font-medium text-gray-600">
                        House Fees
                      </p>
                      <p className="text-3xl font-bold text-purple-600">
                        {formatBirr(selectedCashierData.summary?.totalHouseFee)}{" "}
                        Br
                      </p>
                    </div>
                  </div>
                </div>

                {/* Recent Games Table */}
                {selectedCashierData.detailedReport?.recentGames &&
                  selectedCashierData.detailedReport.recentGames.length > 0 && (
                    <div className="bg-white p-6 rounded-lg shadow">
                      <h3 className="text-xl font-semibold mb-4 text-gray-800">
                        Recent Games
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                #
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Date
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Pattern
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Bet Amount
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                House %
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                House Fee
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Prize Pool
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Status
                              </th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-200">
                            {selectedCashierData.detailedReport.recentGames.map(
                              (game) => (
                                <tr key={game._id} className="hover:bg-gray-50">
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    #{game.gameNumber}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(
                                      game.createdAt
                                    ).toLocaleDateString()}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {game.pattern}
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {game.betAmount} Birr
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {game.houseFeePercentage}%
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    <span className="text-green-600 font-medium">
                                      {parseFloat(game.houseFee || 0).toFixed(
                                        2
                                      )}{" "}
                                      Birr
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {game.prizePool} Birr
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap">
                                    <span
                                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                        game.status === "completed"
                                          ? "bg-green-100 text-green-800"
                                          : game.status === "active"
                                          ? "bg-blue-100 text-blue-800"
                                          : game.status === "paused"
                                          ? "bg-yellow-100 text-yellow-800"
                                          : "bg-gray-100 text-gray-800"
                                      }`}
                                    >
                                      {game.status}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => handleViewGame(game._id)}
                                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs transition-colors"
                                      >
                                        View
                                      </button>
                                      {game.status === "active" && (
                                        <>
                                          <button
                                            onClick={() =>
                                              handleGameControl(
                                                game._id,
                                                "pause"
                                              )
                                            }
                                            className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-xs transition-colors"
                                          >
                                            Pause
                                          </button>
                                          <button
                                            onClick={() =>
                                              handleGameControl(
                                                game._id,
                                                "stop"
                                              )
                                            }
                                            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs transition-colors"
                                          >
                                            Stop
                                          </button>
                                        </>
                                      )}
                                      {(game.status === "pending" ||
                                        game.status === "paused") && (
                                        <button
                                          onClick={() =>
                                            handleGameControl(game._id, "play")
                                          }
                                          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs transition-colors"
                                        >
                                          {game.status === "paused"
                                            ? "Resume"
                                            : "Play"}
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                      {selectedCashierData.detailedReport.recentGames.length <
                        (selectedCashierData.summary?.totalGames || 0) && (
                        <div className="mt-4 pt-4 border-t border-gray-200">
                          <p className="text-sm text-gray-500">
                            Showing{" "}
                            {
                              selectedCashierData.detailedReport.recentGames
                                .length
                            }{" "}
                            of{" "}
                            {formatNumber(
                              selectedCashierData.summary?.totalGames
                            )}{" "}
                            games
                          </p>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            )}
          </div>
        </div>

        {/* Popup Modal */}
        {showAlert && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
              <h3
                className={`text-lg font-semibold mb-4 ${
                  alertType === "success"
                    ? "text-green-600 dark:text-green-400"
                    : alertType === "error"
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-900 dark:text-gray-100"
                }`}
              >
                {alertType === "success"
                  ? "Success"
                  : alertType === "error"
                  ? "Error"
                  : "Notification"}
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                {alertMessage}
              </p>
              <button
                onClick={hidePopup}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
              >
                OK
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
};

export default AdminReport;
