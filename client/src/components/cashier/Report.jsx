import React, { useState, useEffect, Component, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import gameService from "../../services/game";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Filler,
} from "chart.js";
import { Pie, Bar, Line } from "react-chartjs-2";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Filler
);

// Error Boundary Component
class ErrorBoundary extends Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4 flex items-center justify-center">
          <div className="text-center text-red-600 dark:text-red-400">
            <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
            <p>{this.state.error?.message || "An unexpected error occurred"}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const getCurrentUser = () => {
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    if (!user || !user.id) {
      throw new Error("No authenticated user found");
    }
    return { id: user.id, role: user.role || "cashier" };
  } catch (error) {
    console.error("getCurrentUser error:", error.message);
    return null;
  }
};

const CashierReport = () => {
  const navigate = useNavigate();
  const [reportData, setReportData] = useState({
    totalGames: 0,
    activeGames: 0,
    totalHouseFee: "0.00",
    games: [],
    counters: [],
    results: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({
    status: "",
    pattern: "",
    startDate: "",
    endDate: "",
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [currentJackpot, setCurrentJackpot] = useState(0);
  const [controlLoading, setControlLoading] = useState({}); // Per-game loading
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertType, setAlertType] = useState("info");
  const [gamesStatusData, setGamesStatusData] = useState({
    labels: ["Active/Pending", "Finished"],
    datasets: [
      {
        data: [0, 0],
        backgroundColor: ["#3B82F6", "#10B981"],
        borderColor: ["#1D4ED8", "#059669"],
        borderWidth: 1,
      },
    ],
  });
  const [patternsData, setPatternsData] = useState({
    labels: [
      "Four Corners Center",
      "Cross",
      "Main Diagonal",
      "Other Diagonal",
      "Horizontal Line",
      "Vertical Line",
      "All",
    ],
    datasets: [
      {
        data: [0, 0, 0, 0, 0, 0, 0],
        backgroundColor: "#F59E0B",
        borderColor: "#D97706",
        borderWidth: 1,
      },
    ],
  });
  const [dailyActivityData, setDailyActivityData] = useState({
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        data: [0, 0, 0, 0, 0, 0, 0],
        borderColor: "#8B5CF6",
        backgroundColor: "rgba(139, 92, 246, 0.1)",
        fill: true,
        tension: 0.4,
      },
    ],
  });
  const [betAmountData, setBetAmountData] = useState({
    labels: [
      "0-10 Birr",
      "11-20 Birr",
      "21-50 Birr",
      "51-100 Birr",
      "100+ Birr",
    ],
    datasets: [
      {
        data: [0, 0, 0, 0, 0],
        backgroundColor: "#10B981",
        borderColor: "#059669",
        borderWidth: 1,
      },
    ],
  });
  const [houseFeeData, setHouseFeeData] = useState({
    labels: ["Low (<10%)", "Medium (10-20%)", "High (>20%)"],
    datasets: [
      {
        data: [0, 0, 0],
        backgroundColor: "#EF4444",
        borderColor: "#DC2626",
        borderWidth: 1,
      },
    ],
  });
  const [revenueTrendData, setRevenueTrendData] = useState({
    labels: [],
    datasets: [
      {
        data: [],
        borderColor: "#10B981",
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        fill: true,
        tension: 0.4,
      },
    ],
  });
  const [jackpotContributionData, setJackpotContributionData] = useState({
    labels: ["This Week", "Last Week", "Prior"],
    datasets: [
      {
        data: [0, 0, 0],
        backgroundColor: "#F59E0B",
        borderColor: "#D97706",
        borderWidth: 1,
      },
    ],
  });

  const [summaryStats, setSummaryStats] = useState({
    totalGames: 0,
    activeGames: 0,
    completedGames: 0,
    totalHouseFee: 0,
    sumBetAmounts: 0,
    totalPrizePool: 0,
    averageBetAmount: 0,
    totalPotentialJackpot: 0,
    totalPrizesAwarded: 0,
  });

  // Helper to get local YYYY-MM-DD string
  const getLocalDateStr = (date) => {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getDate()).padStart(2, "0")}`;
  };

  // Compute filtered data reactively
  const filteredData = useMemo(() => {
    // Derive effective date range: if only one date is selected, treat it as a single-day filter
    const effStartDate = filters.startDate || filters.endDate || "";
    const effEndDate = filters.endDate || filters.startDate || "";
    const todayStr = getLocalDateStr(new Date());
    let filteredGames;
    if (effStartDate > todayStr || (effEndDate && effEndDate > todayStr)) {
      filteredGames = [];
    } else {
      filteredGames = reportData.games.filter((game) => {
        const gameDateStr = getLocalDateStr(game.createdAt);
        return (
          (game.gameNumber?.toString().includes(searchTerm) ||
            game.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
            game.pattern.toLowerCase().includes(searchTerm.toLowerCase())) &&
          (!filters.status || game.status === filters.status) &&
          (!filters.pattern || game.pattern === filters.pattern) &&
          (!effStartDate || gameDateStr >= effStartDate) &&
          (!effEndDate || gameDateStr <= effEndDate)
        );
      });
    }
    return {
      games: filteredGames,
      counters: reportData.counters, // Counters don't filter by date, so keep full
      results: reportData.results, // Same for results
    };
  }, [
    reportData.games,
    reportData.counters,
    reportData.results,
    filters,
    searchTerm,
  ]);

  const showPopup = (message, type = "info") => {
    setAlertMessage(message);
    setAlertType(type);
    setShowAlert(true);
  };

  const hidePopup = () => {
    setShowAlert(false);
  };

  // Fetch data on mount and when date/status/pattern filters change (server-side filtering)
  useEffect(() => {
    fetchReportData();
  }, [filters.startDate, filters.endDate, filters.status, filters.pattern]);

  // Update summaries and charts whenever filteredData changes
  useEffect(() => {
    if (filteredData.games.length > 0) {
      updateSummaryStats({
        games: filteredData.games,
        totalPrizesAwarded: filteredData.results.reduce(
          (sum, r) => sum + (parseFloat(r.prize) || 0),
          0
        ),
      });
      updateCharts(filteredData.games);
      // Update reportData total for consistency
      setReportData((prev) => ({
        ...prev,
        totalGames: filteredData.games.length,
      }));
    } else {
      // Reset to empty if no filtered games
      updateSummaryStats({ games: [], totalPrizesAwarded: 0 });
      // Reset charts to zero
      setGamesStatusData({
        labels: ["Active/Pending", "Finished"],
        datasets: [
          {
            data: [0, 0],
            backgroundColor: ["#3B82F6", "#10B981"],
            borderColor: ["#1D4ED8", "#059669"],
            borderWidth: 1,
          },
        ],
      });
      setPatternsData({
        labels: [
          "Four Corners Center",
          "Cross",
          "Main Diagonal",
          "Other Diagonal",
          "Horizontal Line",
          "Vertical Line",
          "All",
        ],
        datasets: [
          {
            data: [0, 0, 0, 0, 0, 0, 0],
            backgroundColor: "#F59E0B",
            borderColor: "#D97706",
            borderWidth: 1,
          },
        ],
      });
      setDailyActivityData({
        labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        datasets: [
          {
            data: [0, 0, 0, 0, 0, 0, 0],
            borderColor: "#8B5CF6",
            backgroundColor: "rgba(139, 92, 246, 0.1)",
            fill: true,
            tension: 0.4,
          },
        ],
      });
      setBetAmountData({
        labels: [
          "0-10 Birr",
          "11-20 Birr",
          "21-50 Birr",
          "51-100 Birr",
          "100+ Birr",
        ],
        datasets: [
          {
            data: [0, 0, 0, 0, 0],
            backgroundColor: "#10B981",
            borderColor: "#059669",
            borderWidth: 1,
          },
        ],
      });
      setHouseFeeData({
        labels: ["Low (<10%)", "Medium (10-20%)", "High (>20%)"],
        datasets: [
          {
            data: [0, 0, 0],
            backgroundColor: "#EF4444",
            borderColor: "#DC2626",
            borderWidth: 1,
          },
        ],
      });
      setRevenueTrendData({
        labels: [],
        datasets: [
          {
            data: [],
            borderColor: "#10B981",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            fill: true,
            tension: 0.4,
          },
        ],
      });
      setJackpotContributionData({
        labels: ["This Week", "Last Week", "Prior"],
        datasets: [
          {
            data: [0, 0, 0],
            backgroundColor: "#F59E0B",
            borderColor: "#D97706",
            borderWidth: 1,
          },
        ],
      });
    }
  }, [filteredData]);

  const fetchReportData = async () => {
    setLoading(true);
    setError(null);
    try {
      const user = getCurrentUser();
      if (!user || !user.id) {
        console.error(
          "[fetchReportData] No authenticated user, redirecting to login"
        );
        navigate("/login");
        throw new Error("Please log in to view the report");
      }
      const cashierId = user.id;
      console.log(
        "[fetchReportData] Fetching report for cashierId:",
        cashierId
      );
      // Derive effective dates for server: one selected date means single-day filter
      const effStartDate = filters.startDate || filters.endDate || undefined;
      const effEndDate = filters.endDate || filters.startDate || undefined;
      const serverFilters = {
        status: filters.status || undefined,
        pattern: filters.pattern || undefined,
        startDate: effStartDate,
        endDate: effEndDate,
      };
      const dataRaw = await gameService.getCashierReport(
        cashierId,
        serverFilters
      );
      console.log("[fetchReportData] Report data (raw):", dataRaw);

      // Defensive normalization: backend may return payload directly or under `data`
      const payload = dataRaw?.data || dataRaw || {};

      // Support both `games` and `games` nested under other keys
      const games = Array.isArray(payload.games)
        ? payload.games
        : Array.isArray(payload.data?.games)
        ? payload.data.games
        : [];

      // Fallbacks for numeric aggregates
      const totalGames =
        payload.totalGames ?? payload.count ?? games.length ?? 0;
      const activeGames = payload.activeGames ?? 0;
      const totalHouseFee =
        payload.totalHouseFee ?? payload.totalHouseFeeFormatted ?? "0.00";

      setReportData({
        totalGames: Number(totalGames) || 0,
        activeGames: Number(activeGames) || 0,
        totalHouseFee: totalHouseFee || "0.00",
        games: games,
        counters: payload.counters || [],
        results: payload.results || [],
      });

      // Handle jackpot fetch separately to avoid failing the entire report
      try {
        const jackpotData = await gameService.getJackpot(cashierId);
        setCurrentJackpot(jackpotData.amount || 0);
      } catch (jackpotError) {
        console.warn(
          "[fetchReportData] No jackpot found, setting to 0 Birr:",
          jackpotError.message
        );
        setCurrentJackpot(0);
      }
    } catch (error) {
      console.error("[fetchReportData] Error fetching report:", error);
      setError(error.message || "Failed to fetch report data");
      setReportData({
        totalGames: 0,
        activeGames: 0,
        totalHouseFee: "0.00",
        games: [],
        counters: [],
        results: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const updateSummaryStats = (data) => {
    const games = Array.isArray(data.games) ? data.games : [];
    const sumBet = games.reduce(
      (sum, g) => sum + (parseFloat(g.betAmount) || 0),
      0
    );
    const totalPrize = games.reduce(
      (sum, g) => sum + (parseFloat(g.prizePool) || 0),
      0
    );
    const totalHouseFee = games.reduce(
      (sum, g) => sum + (parseFloat(g.houseFee) || 0),
      0
    );
    const completed = games.filter((g) => g.status === "completed").length;
    const avgBet = games.length > 0 ? (sumBet / games.length).toFixed(2) : 0;
    const totalPotential = games.reduce(
      (sum, g) => sum + (parseFloat(g.potentialJackpot) || 0),
      0
    );
    const totalPrizesAwarded = data.totalPrizesAwarded || 0;

    setSummaryStats({
      totalGames: games.length,
      activeGames: games.filter(
        (g) => g.status === "active" || g.status === "pending"
      ).length,
      completedGames: completed,
      totalHouseFee: totalHouseFee.toFixed(2),
      sumBetAmounts: sumBet.toFixed(2),
      totalPrizePool: totalPrize.toFixed(2),
      averageBetAmount: avgBet,
      totalPotentialJackpot: totalPotential.toFixed(2),
      totalPrizesAwarded: totalPrizesAwarded.toFixed(2),
    });
  };

  const updateCharts = (games) => {
    if (!Array.isArray(games)) {
      console.warn("updateCharts: Games is not an array", games);
      return;
    }

    const active = games.filter(
      (g) => g.status === "active" || g.status === "pending"
    ).length;
    const finished = games.filter((g) => g.status === "completed").length;
    setGamesStatusData({
      labels: ["Active/Pending", "Finished"],
      datasets: [
        {
          data: [active, finished],
          backgroundColor: ["#3B82F6", "#10B981"],
          borderColor: ["#1D4ED8", "#059669"],
          borderWidth: 1,
        },
      ],
    });

    const patternCounts = {
      four_corners_center: 0,
      cross: 0,
      main_diagonal: 0,
      other_diagonal: 0,
      horizontal_line: 0,
      vertical_line: 0,
      all: 0,
    };
    games.forEach((g) => {
      if (g.pattern in patternCounts) {
        patternCounts[g.pattern]++;
      }
    });
    setPatternsData({
      labels: [
        "Four Corners Center",
        "Cross",
        "Main Diagonal",
        "Other Diagonal",
        "Horizontal Line",
        "Vertical Line",
        "All",
      ],
      datasets: [
        {
          label: "Number of Games",
          data: Object.values(patternCounts),
          backgroundColor: "#F59E0B",
          borderColor: "#D97706",
          borderWidth: 1,
        },
      ],
    });

    const daily = [0, 0, 0, 0, 0, 0, 0];
    games.forEach((game) => {
      const date = new Date(game.createdAt);
      const day = date.getDay() === 0 ? 6 : date.getDay() - 1;
      daily[day]++;
    });
    setDailyActivityData({
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      datasets: [
        {
          label: "Number of Games",
          data: daily,
          borderColor: "#8B5CF6",
          backgroundColor: "rgba(139, 92, 246, 0.1)",
          fill: true,
          tension: 0.4,
        },
      ],
    });

    const bet = [0, 0, 0, 0, 0];
    games.forEach((game) => {
      const amount = parseFloat(game.betAmount || 0);
      if (amount <= 10) bet[0]++;
      else if (amount <= 20) bet[1]++;
      else if (amount <= 50) bet[2]++;
      else if (amount <= 100) bet[3]++;
      else bet[4]++;
    });
    setBetAmountData({
      labels: [
        "0-10 Birr",
        "11-20 Birr",
        "21-50 Birr",
        "51-100 Birr",
        "100+ Birr",
      ],
      datasets: [
        {
          label: "Number of Games",
          data: bet,
          backgroundColor: "#10B981",
          borderColor: "#059669",
          borderWidth: 1,
        },
      ],
    });

    const houseLow = games.filter(
      (g) => parseFloat(g.houseFeePercentage || 0) < 10
    ).length;
    const houseMed = games.filter((g) => {
      const perc = parseFloat(g.houseFeePercentage || 0);
      return perc >= 10 && perc <= 20;
    }).length;
    const houseHigh = games.filter(
      (g) => parseFloat(g.houseFeePercentage || 0) > 20
    ).length;
    setHouseFeeData({
      labels: ["Low (<10%)", "Medium (10-20%)", "High (>20%)"],
      datasets: [
        {
          label: "Number of Games",
          data: [houseLow, houseMed, houseHigh],
          backgroundColor: "#EF4444",
          borderColor: "#DC2626",
          borderWidth: 1,
        },
      ],
    });

    // Adjust revenue trend to respect date filters if startDate/endDate are set
    const effStartStr = filters.startDate || filters.endDate || null;
    const effEndStr = filters.endDate || filters.startDate || null;
    let trendStartDate = new Date();
    let trendEndDate = new Date();
    if (effStartStr && effEndStr) {
      trendStartDate = new Date(effStartStr);
      trendEndDate = new Date(effEndStr);
    } else if (effStartStr) {
      trendStartDate = new Date(effStartStr);
      trendEndDate = new Date(effStartStr);
    } else if (effEndStr) {
      trendStartDate = new Date(effEndStr);
      trendEndDate = new Date(effEndStr);
    }
    // Generate dates for the trend within the filter range or last 7 days
    const numDays =
      filters.startDate || filters.endDate
        ? Math.ceil((trendEndDate - trendStartDate) / (1000 * 60 * 60 * 24)) + 1
        : 7;
    const lastDays = [];
    const tempDate = new Date(trendEndDate);
    for (let i = numDays - 1; i >= 0; i--) {
      const year = tempDate.getFullYear();
      const month = String(tempDate.getMonth() + 1).padStart(2, "0");
      const day = String(tempDate.getDate()).padStart(2, "0");
      lastDays.push(`${year}-${month}-${day}`);
      tempDate.setDate(tempDate.getDate() - 1);
    }
    lastDays.reverse();
    const revenueData = lastDays.map((date) => {
      return games
        .filter((g) => {
          const gDateStr = getLocalDateStr(g.createdAt);
          return gDateStr === date;
        })
        .reduce((sum, g) => sum + (parseFloat(g.houseFee) || 0), 0);
    });
    setRevenueTrendData({
      labels: lastDays.map((d) =>
        new Date(d).toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      ),
      datasets: [
        {
          label: "House Fee (Birr)",
          data: revenueData,
          borderColor: "#10B981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          fill: true,
          tension: 0.4,
        },
      ],
    });

    // Adjust jackpot contributions to respect filters
    const now = new Date();
    let weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekAgo = new Date(weekStart);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(weekAgo);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);

    // Filter games within date range first
    const filteredForTrend = games.filter((g) => {
      const gDateStr = getLocalDateStr(g.createdAt);
      if (effStartStr && gDateStr < effStartStr) return false;
      if (effEndStr && gDateStr > effEndStr) return false;
      return true;
    });

    const thisWeek = filteredForTrend
      .filter((g) => new Date(g.createdAt) >= weekStart)
      .reduce((sum, g) => sum + (parseFloat(g.houseFee) || 0), 0);
    const lastWeek = filteredForTrend
      .filter((g) => {
        const gDate = new Date(g.createdAt);
        return gDate > weekAgo && gDate <= weekStart;
      })
      .reduce((sum, g) => sum + (parseFloat(g.houseFee) || 0), 0);
    const prior =
      filteredForTrend.reduce(
        (sum, g) => sum + (parseFloat(g.houseFee) || 0),
        0
      ) -
      thisWeek -
      lastWeek;
    setJackpotContributionData({
      labels: ["This Week", "Last Week", "Prior"],
      datasets: [
        {
          label: "Contributions (Birr)",
          data: [thisWeek, lastWeek, prior],
          backgroundColor: "#F59E0B",
          borderColor: "#D97706",
          borderWidth: 1,
        },
      ],
    });
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const exportToCSV = () => {
    const headers = [
      "Game #",
      "Date",
      "Pattern",
      "Bet Amount",
      "House %",
      "House Fee",
      "Prize Pool",
      "Status",
    ];
    const csvContent = [
      headers.join(","),
      ...filteredData.games.map((game) =>
        [
          game.gameNumber,
          new Date(game.createdAt).toLocaleDateString(),
          game.pattern,
          game.betAmount,
          game.houseFeePercentage,
          (parseFloat(game.houseFee) || 0).toFixed(2),
          game.prizePool,
          game.status,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bingo-report.csv";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleGameControl = async (gameId, action) => {
    const gameIndex = reportData.games.findIndex((g) => g._id === gameId);
    if (gameIndex === -1) {
      showPopup("Game not found", "error");
      return;
    }

    const previousReportData = { ...reportData };
    const previousSummaryStats = { ...summaryStats };
    const previousGamesStatusData = { ...gamesStatusData };
    const targetGame = { ...reportData.games[gameIndex] };

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
      const updatedGames = reportData.games.map((g, idx) =>
        idx === gameIndex ? { ...g, status: newStatus } : g
      );
      setReportData((prev) => ({
        ...prev,
        games: updatedGames,
        activeGames: updatedGames.filter((g) =>
          ["active", "pending"].includes(g.status)
        ).length,
      }));
      setSummaryStats((prev) => ({
        ...prev,
        activeGames: updatedGames.filter((g) =>
          ["active", "pending"].includes(g.status)
        ).length,
        completedGames: updatedGames.filter((g) => g.status === "completed")
          .length,
      }));
      setGamesStatusData((prev) => ({
        ...prev,
        datasets: [
          {
            ...prev.datasets[0],
            data: [
              updatedGames.filter((g) =>
                ["active", "pending"].includes(g.status)
              ).length,
              updatedGames.filter((g) => g.status === "completed").length,
            ],
          },
        ],
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
            const updatedJackpot = await gameService.getJackpot(
              getCurrentUser().id
            );
            setCurrentJackpot(updatedJackpot.amount || currentJackpot);
            console.log(
              `[handleGameControl] Jackpot finalized: ${updatedJackpot.amount}`
            );
          }
        } catch (jackpotError) {
          console.warn(
            `[handleGameControl] Jackpot finalization failed: ${jackpotError.message}`
          );
        }
      }

      // Sync charts (will use filteredData which includes the update)
      updateCharts(updatedGames);

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
      setReportData(previousReportData);
      setSummaryStats(previousSummaryStats);
      setGamesStatusData(previousGamesStatusData);

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

  const renderTableRow = (game, index) => {
    const houseFee = parseFloat(game.houseFee) || 0;
    const isLoading =
      controlLoading[`${game._id}-play`] ||
      controlLoading[`${game._id}-pause`] ||
      controlLoading[`${game._id}-stop`];
    return (
      <tr
        key={game._id || index}
        className="hover:bg-gray-50 dark:hover:bg-gray-700"
      >
        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
          {game.gameNumber}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          {new Date(game.createdAt).toLocaleDateString()}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          {game.pattern}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          {game.betAmount} Birr
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          {game.houseFeePercentage}%
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
          {houseFee.toFixed(2)} Birr
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
          {game.prizePool} Birr
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <span
            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
              game.status === "completed"
                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
                : game.status === "active"
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
                : game.status === "paused"
                ? "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300"
                : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
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
              disabled={isLoading}
            >
              View
            </button>
            {game.status === "active" && (
              <>
                <button
                  onClick={() => handleGameControl(game._id, "pause")}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white px-3 py-1 rounded text-xs transition-colors disabled:opacity-50"
                  disabled={isLoading}
                >
                  {isLoading ? "..." : "Pause"}
                </button>
                <button
                  onClick={() => handleGameControl(game._id, "stop")}
                  className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs transition-colors disabled:opacity-50"
                  disabled={isLoading}
                >
                  {isLoading ? "..." : "Stop"}
                </button>
              </>
            )}
            {(game.status === "pending" || game.status === "paused") && (
              <button
                onClick={() => handleGameControl(game._id, "play")}
                className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs transition-colors disabled:opacity-50"
                disabled={isLoading}
              >
                {isLoading
                  ? "..."
                  : game.status === "paused"
                  ? "Resume"
                  : "Play"}
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 w-6 h-6 border-2 border-gray-600 dark:border-gray-400 border-t-indigo-500 rounded-full animate-spin"></div>
          <p className="text-gray-500 dark:text-gray-400">Loading report...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4 flex items-center justify-center">
        <div className="text-center text-red-600 dark:text-red-400">
          <h2 className="text-2xl font-bold mb-2">Error</h2>
          <p>{error}</p>
          <button
            onClick={fetchReportData}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6 mb-6">
          {[
            {
              name: "Total Games",
              value: summaryStats.totalGames,
              color:
                "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300",
              icon: "🎲",
              label: "Filtered",
            },
            {
              name: "Active Games",
              value: summaryStats.activeGames,
              color:
                "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300",
              icon: "⏳",
              label: "In Progress",
            },
            {
              name: "Completed Games",
              value: summaryStats.completedGames,
              color:
                "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300",
              icon: "✅",
              label: "Finished",
            },
            {
              name: "Total House Fee",
              value: `${summaryStats.totalHouseFee} Birr`,
              color:
                "bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-300",
              icon: "💰",
              label: "Filtered",
            },
            {
              name: "Avg Bet Amount",
              value: `${summaryStats.averageBetAmount} Birr`,
              color:
                "bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-300",
              icon: "📊",
              label: "Per Game",
            },
            {
              name: "Current Jackpot",
              value: `${currentJackpot} Birr`,
              color:
                "bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-300",
              icon: "🏆",
              label: "Current Jackpot", // Updated label
            },
          ].map((stat) => (
            <div
              key={stat.name}
              className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6 text-center transition-all hover:scale-105"
            >
              <div
                className={`inline-flex items-center justify-center w-12 h-12 rounded-full mx-auto mb-2 ${stat.color}`}
              >
                <span className="text-lg">{stat.icon}</span>
              </div>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                {stat.label}
              </h3>
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Filters with Search and Export */}
        <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
            Filters & Search
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <select
              value={filters.status}
              onChange={(e) => handleFilterChange("status", e.target.value)}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
              <option value="paused">Paused</option>
            </select>
            <select
              value={filters.pattern}
              onChange={(e) => handleFilterChange("pattern", e.target.value)}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              <option value="">All Patterns</option>
              <option value="four_corners_center">Four Corners Center</option>
              <option value="cross">Cross</option>
              <option value="main_diagonal">Main Diagonal</option>
              <option value="other_diagonal">Other Diagonal</option>
              <option value="horizontal_line">Horizontal Line</option>
              <option value="vertical_line">Vertical Line</option>
              <option value="all">All</option>
            </select>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => handleFilterChange("startDate", e.target.value)}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => handleFilterChange("endDate", e.target.value)}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <input
              type="text"
              placeholder="Search games..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div className="mt-4">
            <button
              onClick={exportToCSV}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
            >
              Export to CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg overflow-hidden mb-6">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Games List ({filteredData.games.length} results)
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Pattern
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Bet Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    House %
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    House Fee
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Prize Pool
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {filteredData.games.length === 0 ? (
                  <tr>
                    <td
                      colSpan="9"
                      className="px-6 py-12 text-center text-gray-500 dark:text-gray-400"
                    >
                      No games found matching the criteria.
                    </td>
                  </tr>
                ) : (
                  filteredData.games.map((game, index) =>
                    renderTableRow(game, index + 1)
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Games by Status
            </h3>
            <div className="h-64">
              <Pie
                data={gamesStatusData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Pattern Distribution
            </h3>
            <div className="h-64">
              <Bar
                data={patternsData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Daily Activity
            </h3>
            <div className="h-64">
              <Line
                data={dailyActivityData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Bet Amount Distribution
            </h3>
            <div className="h-64">
              <Bar
                data={betAmountData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              House Fee Distribution
            </h3>
            <div className="h-64">
              <Bar
                data={houseFeeData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Revenue Trend (Filtered Period)
            </h3>
            <div className="h-64">
              <Line
                data={revenueTrendData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6 lg:col-span-2">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Jackpot Contributions by Period (Filtered)
            </h3>
            <div className="h-64">
              <Bar
                data={jackpotContributionData}
                options={{ responsive: true, maintainAspectRatio: false }}
              />
            </div>
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
    </ErrorBoundary>
  );
};

export default CashierReport;
