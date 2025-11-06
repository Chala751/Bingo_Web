import React, { useEffect, useRef, useState } from "react";
import SoundService from "../../../services/sound"; // Adjust path as needed

const BingoModals = ({
  isWinnerModalOpen,
  setIsWinnerModalOpen,
  bingoStatus,
  setBingoStatus,
  cardId,
  gameData,
  isNonWinnerModalOpen,
  setIsNonWinnerModalOpen,
  nonWinnerCardData,
  setNonWinnerCardData,
  isGameFinishedModalOpen,
  setIsGameFinishedModalOpen,
  isLoading,
  isErrorModalOpen,
  setIsErrorModalOpen,
  callError,
  setCallError,
  navigate,
  // NEW: Props for invalid card modal
  isInvalidCardModalOpen,
  setIsInvalidCardModalOpen,
  // Optional: called numbers for client-side highlights
  calledNumbers = [],
  // Optional: cards state for finer highlights
  cards = [],
}) => {
  useEffect(() => {
    // Only play winner sound when modal is opened for a confirmed winning card.
    // Guard against late-call / disqualified scenarios and ensure we have
    // winning numbers or a winner card grid before playing.
    if (isWinnerModalOpen && bingoStatus) {
      const hasWinningNumbers =
        Array.isArray(bingoStatus.winningNumbers) &&
        bingoStatus.winningNumbers.length > 0;
      const hasWinnerGrid =
        Array.isArray(bingoStatus.winnerCardNumbers) &&
        Array.isArray(bingoStatus.winnerCardNumbers[0]);
      const isDisqualified =
        !!bingoStatus.lateCall || !!bingoStatus.disqualified;
      if (!isDisqualified && (hasWinningNumbers || hasWinnerGrid)) {
        SoundService.playSound("winner");
        // Ensure any non-winner indicators are closed to avoid contradictory cues
        try {
          setIsNonWinnerModalOpen(false);
          setNonWinnerCardData(null);
        } catch {
          /* noop */
        }
      }
    }
  }, [isWinnerModalOpen, bingoStatus]);

  useEffect(() => {
    // Play non-winner sound only when we have card details to show and no winner modal is open.
    if (isNonWinnerModalOpen && nonWinnerCardData && !isWinnerModalOpen) {
      SoundService.playSound("you_didnt_win");
    }
  }, [isNonWinnerModalOpen, nonWinnerCardData]);

  useEffect(() => {
    if (isGameFinishedModalOpen) {
      SoundService.playSound("game_finish");
    }
  }, [isGameFinishedModalOpen]);

  // Global ESC key handler to close any open modal for accessibility
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (isWinnerModalOpen) {
          setIsWinnerModalOpen(false);
          setBingoStatus(null);
          setCallError(null);
        }
        if (isNonWinnerModalOpen) {
          setIsNonWinnerModalOpen(false);
          setNonWinnerCardData(null);
        }
        if (isGameFinishedModalOpen) {
          setIsGameFinishedModalOpen(false);
        }
        if (isErrorModalOpen) {
          setIsErrorModalOpen(false);
          setCallError(null);
        }
        if (isInvalidCardModalOpen) {
          setIsInvalidCardModalOpen(false);
          setCallError(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isWinnerModalOpen,
    isNonWinnerModalOpen,
    isGameFinishedModalOpen,
    isErrorModalOpen,
    isInvalidCardModalOpen,
  ]);

  // Refs and scaling state to ensure modal content fits without scroll
  const winnerPanelRef = useRef(null);
  const nonWinnerPanelRef = useRef(null);
  const finishedPanelRef = useRef(null);
  const errorPanelRef = useRef(null);
  const invalidPanelRef = useRef(null);

  const [winnerScale, setWinnerScale] = useState(1);
  const [nonWinnerScale, setNonWinnerScale] = useState(1);
  const [finishedScale, setFinishedScale] = useState(1);
  const [errorScale, setErrorScale] = useState(1);
  const [invalidScale, setInvalidScale] = useState(1);

  const fitToViewport = (ref, setScale) => {
    if (!ref?.current) return;
    // Small margin so the modal isn't flush to the viewport edges
    const margin = 96; // px total (top+bottom approx)
    const available = Math.max(200, window.innerHeight - margin);
    const el = ref.current;
    // Use scrollHeight to account for full content
    const height = el.scrollHeight || el.offsetHeight || 0;
    const scale = height > available ? Math.max(0.6, available / height) : 1;
    setScale(scale);
  };

  useEffect(() => {
    const onResize = () => {
      if (isWinnerModalOpen) fitToViewport(winnerPanelRef, setWinnerScale);
      if (isNonWinnerModalOpen)
        fitToViewport(nonWinnerPanelRef, setNonWinnerScale);
      if (isGameFinishedModalOpen)
        fitToViewport(finishedPanelRef, setFinishedScale);
      if (isErrorModalOpen) fitToViewport(errorPanelRef, setErrorScale);
      if (isInvalidCardModalOpen)
        fitToViewport(invalidPanelRef, setInvalidScale);
    };
    // Fit when any modal opens or content changes
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [
    isWinnerModalOpen,
    bingoStatus,
    isNonWinnerModalOpen,
    nonWinnerCardData,
    isGameFinishedModalOpen,
    isErrorModalOpen,
    callError,
    isInvalidCardModalOpen,
  ]);

  // Helper to build grid if needed (for robustness, in case data is object)
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

  // Heuristic: ensure a 5x5 grid aligns with B-I-N-G-O column ranges. If rows/cols are swapped, transpose it.
  const normalizeGridOrientation = (grid) => {
    try {
      if (!Array.isArray(grid) || grid.length !== 5) return grid;
      if (grid.some((row) => !Array.isArray(row) || row.length !== 5))
        return grid;

      const inRange = (v, min, max) => {
        const n = typeof v === "number" ? v : Number(v);
        return Number.isFinite(n) && n >= min && n <= max;
      };

      // Score how many cells per column fall into expected B/I/N/G/O ranges
      const colScore = () => {
        let s = 0;
        for (let c = 0; c < 5; c++) {
          const min = c * 15 + 1;
          const max = c * 15 + 15;
          for (let r = 0; r < 5; r++)
            if (grid[r][c] !== "FREE")
              s += inRange(grid[r][c], min, max) ? 1 : 0;
        }
        return s;
      };
      // If the grid is transposed, rows will match the B/I/N/G/O ranges instead of columns
      const rowScore = () => {
        let s = 0;
        for (let r = 0; r < 5; r++) {
          const min = r * 15 + 1;
          const max = r * 15 + 15;
          for (let c = 0; c < 5; c++)
            if (grid[r][c] !== "FREE")
              s += inRange(grid[r][c], min, max) ? 1 : 0;
        }
        return s;
      };

      const cScore = colScore();
      const rScore = rowScore();
      // If rows match the expected ranges more than columns, transpose
      if (rScore > cScore) {
        const transposed = Array.from({ length: 5 }, (_, r) =>
          Array.from({ length: 5 }, (_, c) => grid[c][r])
        );
        // Ensure center FREE semantics are preserved
        if (transposed[2][2] === undefined || transposed[2][2] === null) {
          transposed[2][2] = "FREE";
        }
        return transposed;
      }
      return grid;
    } catch {
      return grid;
    }
  };

  // Simple transpose helper for 5x5 grids
  const transposeGrid = (grid) => {
    try {
      if (!Array.isArray(grid) || grid.length !== 5) return grid;
      if (grid.some((row) => !Array.isArray(row) || row.length !== 5))
        return grid;
      const t = Array.from({ length: 5 }, (_, r) =>
        Array.from({ length: 5 }, (_, c) => grid[c][r])
      );
      return t;
    } catch {
      return grid;
    }
  };

  // Robust integer parser: handles numbers, numeric strings, and trims extras
  const toInt = (v) => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const m = v.match(/\d+/);
      return m ? parseInt(m[0], 10) : NaN;
    }
    return NaN;
  };

  return (
    <>
      {isWinnerModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="winner-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setIsWinnerModalOpen(false);
            setBingoStatus(null);
            setCallError(null);
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            ref={winnerPanelRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `scale(${winnerScale})`,
              transformOrigin: "center center",
            }}
            className="relative bg-[#0f1a4a] border-4 border-[#f0e14a] p-6 rounded-xl text-center min-w-[320px] max-w-[640px] w-full shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <h2
                id="winner-title"
                className="text-[#f0e14a] text-lg font-extrabold flex items-center gap-2"
              >
                <span className="text-2xl">🎉</span>
                <span>Winner Found</span>
              </h2>
              <button
                aria-label="Close winner dialog"
                className="text-[#f0e14a] bg-transparent px-2 py-1 rounded hover:bg-white/5"
                onClick={() => {
                  setIsWinnerModalOpen(false);
                  setBingoStatus(null);
                  setCallError(null);
                }}
              >
                ✖
              </button>
            </div>
            <p className="text-white text-base">
              Card <span className="text-[#f0e14a] font-bold">{cardId}</span>{" "}
              won with{" "}
              <span className="text-green-400 font-bold">
                {bingoStatus?.pattern?.replace("_", " ") || "unknown"}
              </span>
              !
            </p>
            {(bingoStatus?.winnerCardNumbers || bingoStatus?.patternInfo) && (
              <div className="mt-3">
                <h3 className="text-white text-base font-semibold mb-2 flex items-center justify-center gap-1">
                  <span className="text-green-400 text-sm">🎯</span>
                  <span className="text-sm">Winning Pattern</span>
                </h3>
                <div className="w-full max-w-[360px] mx-auto relative p-2 bg-black/30 rounded-lg">
                  <div className="grid grid-cols-5 gap-1 mb-2 justify-items-center">
                    {/* Legend for late call (pattern-only removed) */}
                    {bingoStatus?.lateCall && (
                      <div className="flex gap-2 mt-2 justify-center items-center">
                        <div className="flex items-center gap-1">
                          <span className="w-4 h-4 bg-amber-400 rounded" />
                          <span className="text-xs text-white">Completing</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="w-4 h-4 bg-orange-500 rounded" />
                          <span className="text-xs text-white">Winning</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="w-4 h-4 bg-blue-600 rounded" />
                          <span className="text-xs text-white">Called</span>
                        </div>
                      </div>
                    )}
                    {["B", "I", "N", "G", "O"].map((letter, index) => (
                      <div
                        key={`header-${index}`}
                        className="w-12 h-9 flex items-center justify-center text-sm font-bold text-[#f0e14a] bg-[#22305a] rounded border border-[#f0e14a] uppercase tracking-tight"
                      >
                        {letter}
                      </div>
                    ))}
                  </div>
                  {bingoStatus?.patternInfo && (
                    <div className="absolute top-[-8px] left-1/2 transform -translate-x-1/2">
                      <div className="bg-gradient-to-r from-green-500 to-green-600 text-white px-2 py-0.5 rounded-full text-[10px] font-bold shadow border border-green-400 flex items-center gap-1 whitespace-nowrap">
                        {(() => {
                          const rowNum = bingoStatus.patternInfo.rowIndex;
                          const colNum = bingoStatus.patternInfo.colIndex;
                          if (
                            rowNum !== null &&
                            !isNaN(rowNum) &&
                            rowNum >= 0 &&
                            rowNum <= 4
                          ) {
                            return <>📏 Row {rowNum + 1}</>;
                          }
                          if (
                            colNum !== null &&
                            !isNaN(colNum) &&
                            colNum >= 0 &&
                            colNum <= 4
                          ) {
                            return <>📐 Col {colNum + 1}</>;
                          }
                          return (
                            <>
                              <span className="text-[8px]">✨</span>
                              <span className="max-w-[80px] truncate">
                                {bingoStatus.pattern
                                  ?.replace("_", " ")
                                  .toUpperCase() || "PATTERN"}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-5 gap-1 pt-0.5 relative">
                    {(() => {
                      let cardGrid;
                      if (
                        Array.isArray(bingoStatus.winnerCardNumbers) &&
                        Array.isArray(bingoStatus.winnerCardNumbers[0])
                      ) {
                        // Keep original orientation for winners so indices from backend align
                        cardGrid = bingoStatus.winnerCardNumbers;
                      } else if (
                        bingoStatus.winnerCardNumbers &&
                        typeof bingoStatus.winnerCardNumbers === "object"
                      ) {
                        // If it's {B,I,N,G,O}, build grid
                        cardGrid = buildGrid(bingoStatus.winnerCardNumbers);
                      } else {
                        cardGrid = Array(5)
                          .fill()
                          .map(() => Array(5).fill("FREE"));
                      }
                      // Normalize and prioritize pattern data
                      const winningIndicesArr =
                        bingoStatus.winningIndices || [];
                      // Note: we compute an effective set below; the original presence flag isn't needed
                      const winIndexSet = new Set(
                        (winningIndicesArr || []).map((x) => toInt(x))
                      );

                      // Prefer backend numbers but fall back to local computed ones
                      const winningNumbersArr =
                        bingoStatus.winningNumbers ||
                        bingoStatus.patternInfo?.localSelectedNumbers ||
                        [];
                      const winNumberSet = new Set(
                        (winningNumbersArr || []).map((x) => toInt(x))
                      );

                      const completingNumber =
                        bingoStatus?.completingNumber ?? null;
                      const calledSet = new Set(
                        (calledNumbers || []).map((x) => toInt(x))
                      );
                      const otherCalledSet = new Set(
                        (bingoStatus.otherCalledNumbers || []).map((x) =>
                          toInt(x)
                        )
                      );

                      // Local fallback: if backend didn't supply winners, compute from grid + called
                      const isMarked = (cell) =>
                        cell === "FREE" || calledSet.has(toInt(cell));

                      const computeFallbackWin = () => {
                        // rows
                        for (let r = 0; r < 5; r++) {
                          const ok = [0, 1, 2, 3, 4].every((c) =>
                            isMarked(cardGrid[r][c])
                          );
                          if (ok)
                            return {
                              indices: [0, 1, 2, 3, 4].map((c) => r * 5 + c),
                            };
                        }
                        // cols
                        for (let c = 0; c < 5; c++) {
                          const ok = [0, 1, 2, 3, 4].every((r) =>
                            isMarked(cardGrid[r][c])
                          );
                          if (ok)
                            return {
                              indices: [0, 1, 2, 3, 4].map((r) => r * 5 + c),
                            };
                        }
                        // main diag
                        if (
                          [0, 1, 2, 3, 4].every((i) => isMarked(cardGrid[i][i]))
                        ) {
                          return { indices: [0, 6, 12, 18, 24] };
                        }
                        // other diag
                        if (
                          [0, 1, 2, 3, 4].every((i) =>
                            isMarked(cardGrid[i][4 - i])
                          )
                        ) {
                          return { indices: [4, 8, 12, 16, 20] };
                        }
                        // four corners (center optional)
                        const corners = [
                          [0, 0],
                          [0, 4],
                          [4, 0],
                          [4, 4],
                        ];
                        if (
                          corners.every(([r, c]) => isMarked(cardGrid[r][c]))
                        ) {
                          return { indices: [0, 4, 20, 24] };
                        }
                        // inner corners
                        const inner = [
                          [1, 1],
                          [1, 3],
                          [3, 1],
                          [3, 3],
                        ];
                        if (inner.every(([r, c]) => isMarked(cardGrid[r][c]))) {
                          return { indices: [6, 8, 16, 18] };
                        }
                        return { indices: [] };
                      };

                      let effectiveWinIndexSet = new Set(winIndexSet);
                      let effectiveWinNumberSet = new Set(winNumberSet);
                      if (
                        effectiveWinIndexSet.size === 0 &&
                        effectiveWinNumberSet.size === 0
                      ) {
                        const fb = computeFallbackWin();
                        if (fb.indices && fb.indices.length) {
                          effectiveWinIndexSet = new Set(fb.indices);
                        }
                      }
                      // (unused; replaced by otherCalledSet)
                      return cardGrid.map((row, rowIndex) =>
                        (row || Array(5).fill("FREE")).map(
                          (number, colIndex) => {
                            const cellIndex = rowIndex * 5 + colIndex;
                            const isFreeSpace = number === "FREE";
                            const isWinningCell =
                              effectiveWinIndexSet.size > 0
                                ? effectiveWinIndexSet.has(cellIndex)
                                : false;
                            const numberValue = toInt(number);
                            const isWinningNumber =
                              effectiveWinIndexSet.size === 0
                                ? effectiveWinNumberSet.has(numberValue)
                                : false;
                            const isOtherCalledNumber =
                              otherCalledSet.has(numberValue) &&
                              !isWinningNumber &&
                              !isWinningCell;
                            const isCalledNumber =
                              (calledSet.has(numberValue) ||
                                isOtherCalledNumber) &&
                              !isWinningCell &&
                              !isWinningNumber;
                            const displayNumber = isFreeSpace
                              ? "FREE"
                              : numberValue;
                            // Larger cells, clearer typography, and glow for winners
                            const base =
                              "flex items-center justify-center rounded border transition-all duration-300 relative overflow-hidden";
                            let sizeClass = "w-14 h-14 text-lg";
                            let bgClass = "bg-white text-black border-gray-300";
                            let extra = "";
                            const isCompletingCell =
                              !isFreeSpace &&
                              numberValue === completingNumber &&
                              (isWinningCell || isWinningNumber);

                            if (isFreeSpace) {
                              bgClass =
                                "bg-blue-700 text-white border-blue-500";
                            } else if (isWinningCell || isWinningNumber) {
                              bgClass =
                                "bg-gradient-to-br from-orange-500 to-orange-600 text-white border-orange-700 shadow-[0_6px_24px_rgba(255,165,0,0.35)]";
                              extra = isCompletingCell
                                ? "ring-4 ring-amber-300/60"
                                : "ring-4 ring-orange-300/30";
                            } else if (isCalledNumber) {
                              bgClass =
                                "bg-blue-600 text-white border-blue-400 shadow-[0_4px_12px_rgba(59,130,246,0.16)]";
                            } else {
                              bgClass =
                                "bg-white text-black border-gray-300 hover:bg-gray-50";
                            }
                            return (
                              <div
                                key={`${rowIndex}-${colIndex}`}
                                className={`${base} ${sizeClass} ${bgClass} ${extra} font-bold`}
                                title={
                                  isFreeSpace ? "FREE" : String(displayNumber)
                                }
                              >
                                <span className="relative z-10 select-none">
                                  {displayNumber}
                                </span>
                              </div>
                            );
                          }
                        )
                      );
                    })()}
                  </div>
                </div>
                {/* Legend */}
                <div className="flex gap-2 mt-2 justify-center items-center">
                  {bingoStatus?.completingNumber != null && (
                    <div className="flex items-center gap-1">
                      <span className="w-4 h-4 bg-amber-400 rounded" />
                      <span className="text-xs text-white">Completing</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <span className="w-4 h-4 bg-orange-500 rounded" />
                    <span className="text-xs text-white">Winning</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="w-4 h-4 bg-blue-600 rounded" />
                    <span className="text-xs text-white">Called</span>
                  </div>
                </div>
              </div>
            )}
            {bingoStatus?.winningNumbers &&
              bingoStatus.winningNumbers.length > 0 && (
                <div className="bg-green-900/30 border border-green-400 p-2 rounded-lg">
                  <h4 className="text-green-300 font-bold text-xs mb-1 flex items-center gap-1">
                    <span className="text-sm">🎯</span>
                    Winning Pattern Numbers ({bingoStatus.winningNumbers.length}
                    )
                  </h4>
                  <div className="flex flex-wrap gap-1 justify-center">
                    {bingoStatus.winningNumbers.slice(0, 10).map((n) => (
                      <div
                        key={n}
                        className="bg-green-500 text-white px-1.5 py-0.5 rounded text-[10px] font-bold border border-green-600 flex items-center gap-0.5 shadow-md"
                      >
                        <span className="text-green-200 text-[8px]">⭐</span>
                        <span className="text-white">{n}</span>
                      </div>
                    ))}
                    {bingoStatus.winningNumbers.length > 10 && (
                      <span className="bg-green-600 text-green-900 px-1.5 py-0.5 rounded text-[10px] font-bold border border-green-400">
                        +{bingoStatus.winningNumbers.length - 10}
                      </span>
                    )}
                  </div>
                </div>
              )}
            <div className="bg-gradient-to-r from-yellow-800 to-orange-700 border border-yellow-400 p-3 rounded-lg shadow-lg mt-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">💰</div>
                  <div>
                    <p className="text-yellow-100 text-xs font-semibold uppercase tracking-wide">
                      PRIZE
                    </p>
                    <div className="text-2xl font-extrabold text-yellow-50 bg-black/10 px-3 py-1 rounded border border-yellow-300">
                      {bingoStatus?.prize || "0.00"} BIRR
                    </div>
                  </div>
                </div>
                <div className="text-sm text-yellow-200 bg-yellow-900/20 px-2 py-1 rounded">
                  Winner:{" "}
                  <span className="font-bold text-yellow-50">
                    Card {cardId}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <button
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2 bg-gradient-to-r from-[#e9744c] to-[#f0854c] text-white font-bold rounded shadow hover:scale-[1.01] transition-transform"
                onClick={() => {
                  setIsWinnerModalOpen(false);
                  setBingoStatus(null);
                  setCallError(null);
                }}
              >
                <span className="text-lg">🎊</span>
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {isNonWinnerModalOpen && nonWinnerCardData && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="nonwinner-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setIsNonWinnerModalOpen(false);
            setNonWinnerCardData(null);
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            ref={nonWinnerPanelRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `scale(${nonWinnerScale})`,
              transformOrigin: "center center",
            }}
            className="relative bg-[#0f1a4a] border-4 border-[#f0e14a] p-5 rounded-xl text-center min-w-[320px] max-w-[640px] w-full shadow-[0_8px_40px_rgba(0,0,0,0.6)]"
          >
            <div className="flex items-start justify-between gap-4 mb-3">
              <h2
                id="nonwinner-title"
                className="text-[#f0e14a] text-lg font-extrabold flex items-center gap-2"
              >
                <span className="text-2xl">🃏</span>
                <span>
                  {nonWinnerCardData.lateCall ? "Late Call" : "Card Check"}
                </span>
              </h2>
              <button
                aria-label="Close card check dialog"
                className="text-[#f0e14a] bg-transparent px-2 py-1 rounded hover:bg-white/5"
                onClick={() => {
                  setIsNonWinnerModalOpen(false);
                  setNonWinnerCardData(null);
                }}
              >
                ✖
              </button>
            </div>
            {nonWinnerCardData.lateCall ? (
              <p className="text-white text-base">
                Late call detected for card{" "}
                <span className="text-[#f0e14a] font-bold">
                  {nonWinnerCardData.cardId}
                </span>
              </p>
            ) : (
              <p className="text-white text-base">
                Card{" "}
                <span className="text-[#f0e14a] font-bold">
                  {nonWinnerCardData.cardId}
                </span>{" "}
                is not winner
              </p>
            )}
            {nonWinnerCardData.lateCall && nonWinnerCardData.wouldHaveWon && (
              <div className="bg-yellow-900/50 border border-yellow-400 p-3 rounded-lg">
                <h3 className="text-yellow-200 text-base font-semibold mb-2">
                  Late Call! ⏰
                </h3>
                <p className="text-yellow-100 text-sm mb-2">
                  {nonWinnerCardData.lateCallMessage ||
                    "You missed your chance!"}
                </p>
                <div className="text-xs text-yellow-200 space-y-1">
                  <p>
                    <strong>Pattern:</strong>{" "}
                    {nonWinnerCardData.wouldHaveWon.pattern?.replace(
                      "_",
                      " "
                    ) || "unknown"}
                  </p>
                  <p>
                    <strong>On call:</strong> #
                    {nonWinnerCardData.wouldHaveWon.callIndex}
                  </p>
                  <p>
                    <strong>Completing Number:</strong>{" "}
                    {nonWinnerCardData.wouldHaveWon.completingNumber}
                  </p>
                </div>
              </div>
            )}
            <div className="mt-3">
              <h3 className="text-white text-base font-semibold mb-2 flex items-center justify-center gap-1">
                <span className="text-green-400 text-sm">🎯</span>
                <span className="text-sm">Card Details</span>
              </h3>
              <div className="w-full max-w-[260px] mx-auto relative p-1 bg-black/20 rounded-lg">
                <div className="grid grid-cols-5 gap-0.5 mb-1 justify-items-center">
                  {["B", "I", "N", "G", "O"].map((letter, index) => (
                    <div
                      key={`header-${index}`}
                      className="w-10 h-8 flex items-center justify-center text-sm font-bold text-[#f0e14a] bg-[#2a3969] rounded border border-[#f0e14a] uppercase tracking-tight"
                    >
                      {letter}
                    </div>
                  ))}
                </div>
                {nonWinnerCardData.patternInfo && (
                  <div className="absolute top-[-8px] left-1/2 transform -translate-x-1/2">
                    <div className="bg-gradient-to-r from-green-500 to-green-600 text-white px-2 py-0.5 rounded-full text-[10px] font-bold shadow border border-green-400 flex items-center gap-1 whitespace-nowrap">
                      {(() => {
                        const rowNum = nonWinnerCardData.patternInfo.rowIndex;
                        const colNum = nonWinnerCardData.patternInfo.colIndex;
                        if (
                          rowNum !== null &&
                          !isNaN(rowNum) &&
                          rowNum >= 0 &&
                          rowNum <= 4
                        ) {
                          return <>📏 Row {rowNum + 1}</>;
                        }
                        if (
                          colNum !== null &&
                          !isNaN(colNum) &&
                          colNum >= 0 &&
                          colNum <= 4
                        ) {
                          return <>📐 Col {colNum + 1}</>;
                        }
                        return (
                          <>
                            <span className="text-[8px]">✨</span>
                            <span className="max-w-[80px] truncate">
                              {nonWinnerCardData.pattern
                                ?.replace("_", " ")
                                .toUpperCase() || "PATTERN"}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-5 gap-1 pt-0.5 relative w-full max-w-[360px] mx-auto">
                  {(() => {
                    let cardGrid;
                    if (
                      Array.isArray(nonWinnerCardData.cardNumbers) &&
                      Array.isArray(nonWinnerCardData.cardNumbers[0])
                    ) {
                      cardGrid = normalizeGridOrientation(
                        nonWinnerCardData.cardNumbers
                      );
                    } else if (
                      nonWinnerCardData.cardNumbers &&
                      typeof nonWinnerCardData.cardNumbers === "object"
                    ) {
                      // If it's {B,I,N,G,O}, build grid
                      cardGrid = buildGrid(nonWinnerCardData.cardNumbers);
                    } else if (
                      Array.isArray(nonWinnerCardData.cardNumbers) &&
                      nonWinnerCardData.cardNumbers.length === 25
                    ) {
                      // If flat 25 (assuming row-major order), build 2D row-major grid
                      const flatNumbers = nonWinnerCardData.cardNumbers;
                      cardGrid = Array(5)
                        .fill()
                        .map(() => Array(5).fill(null));
                      for (let row = 0; row < 5; row++) {
                        for (let col = 0; col < 5; col++) {
                          const index = row * 5 + col;
                          cardGrid[row][col] =
                            flatNumbers[index] === "FREE"
                              ? "FREE"
                              : Number(flatNumbers[index]);
                        }
                      }
                      cardGrid = normalizeGridOrientation(cardGrid);
                    } else {
                      cardGrid = Array(5)
                        .fill()
                        .map(() => Array(5).fill("FREE"));
                    }
                    // User-reported: rows/cols are swapped in non-winner view. Force a transpose for display.
                    const wasTransposed = true;
                    cardGrid = transposeGrid(cardGrid);
                    const patternIndices =
                      nonWinnerCardData.patternInfo?.selectedIndices ||
                      nonWinnerCardData.patternInfo?.localSelectedIndices ||
                      [];
                    const remappedPatternIndices = wasTransposed
                      ? patternIndices.map((idx) => {
                          const r = Math.floor(idx / 5);
                          const c = idx % 5;
                          return c * 5 + r;
                        })
                      : patternIndices;
                    const calledInPattern =
                      nonWinnerCardData.calledNumbersInPattern || [];
                    const otherCalled =
                      nonWinnerCardData.otherCalledNumbers || [];
                    const allCalled = [...calledInPattern, ...otherCalled].map(
                      Number
                    );
                    return cardGrid.map((row, rowIndex) =>
                      (row || Array(5).fill("FREE")).map((number, colIndex) => {
                        const cellIndex = rowIndex * 5 + colIndex;
                        const isFree = number === "FREE";
                        const num = Number(number);
                        const isCalled =
                          allCalled.includes(num) ||
                          calledNumbers.includes(num);
                        const isWinningCell =
                          nonWinnerCardData.lateCall &&
                          remappedPatternIndices.includes(cellIndex);
                        const displayNum = isFree ? "FREE" : num;
                        const base =
                          "flex items-center justify-center rounded border relative overflow-hidden";
                        let sizeClass = "w-14 h-14 text-lg";
                        let bgClass = "bg-white text-black border-gray-300";
                        let extra = "font-bold";
                        if (isFree) {
                          bgClass = "bg-blue-700 text-white border-blue-500";
                        } else if (isWinningCell && isCalled) {
                          bgClass =
                            "bg-gradient-to-br from-orange-500 to-orange-600 text-white border-orange-700 shadow-[0_6px_24px_rgba(255,165,0,0.25)]";
                          extra += " ring-4 ring-orange-300/25";
                        } else if (isCalled) {
                          bgClass =
                            "bg-blue-600 text-white border-blue-400 shadow-[0_4px_12px_rgba(59,130,246,0.12)]";
                        } else {
                          bgClass = "bg-white text-black border-gray-300";
                        }
                        return (
                          <div
                            key={`${rowIndex}-${colIndex}`}
                            className={`${base} ${sizeClass} ${bgClass} ${extra}`}
                            title={isFree ? "FREE" : String(displayNum)}
                          >
                            <span className="relative z-10 select-none">
                              {displayNum}
                            </span>
                          </div>
                        );
                      })
                    );
                  })()}
                </div>
              </div>
              {(() => {
                const calledInPattern =
                  nonWinnerCardData.calledNumbersInPattern || [];
                const otherCalled = nonWinnerCardData.otherCalledNumbers || [];
                const allCalled = [...calledInPattern, ...otherCalled].map(
                  Number
                );
                if (allCalled.length > 0) {
                  return (
                    <div className="bg-blue-900/30 border border-blue-400 p-2 rounded-lg mt-2">
                      <h4 className="text-blue-300 font-bold text-xs mb-1 flex items-center gap-1">
                        <span className="text-sm">📞</span>
                        Called Numbers on Card ({allCalled.length})
                      </h4>
                      <div className="flex flex-wrap gap-1 justify-center">
                        {allCalled.slice(0, 10).map((n) => (
                          <div
                            key={n}
                            className="bg-blue-500 text-white px-1.5 py-0.5 rounded text-[10px] font-bold border border-blue-600 flex items-center gap-0.5 shadow-md"
                          >
                            <span className="text-blue-200 text-[8px]">🔵</span>
                            <span className="text-white">{n}</span>
                          </div>
                        ))}
                        {allCalled.length > 10 && (
                          <span className="bg-blue-600 text-blue-900 px-1.5 py-0.5 rounded text-[10px] font-bold border border-blue-400">
                            +{allCalled.length - 10}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
            <div className="mt-4">
              <button
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-[#e9744c] to-[#f0854c] text-white font-bold rounded shadow hover:scale-[1.01] transition-transform"
                onClick={() => {
                  setIsNonWinnerModalOpen(false);
                  setNonWinnerCardData(null);
                }}
              >
                <span>✅</span>
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {isGameFinishedModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="finished-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setIsGameFinishedModalOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            ref={finishedPanelRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `scale(${finishedScale})`,
              transformOrigin: "center center",
            }}
            className="relative bg-[#0f1a4a] border-4 border-[#f0e14a] p-6 rounded-xl text-center min-w-[300px] max-w-[520px] w-full shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
          >
            <h2
              id="finished-title"
              className="text-[#f0e14a] mb-4 text-2xl font-extrabold"
            >
              Game Finished!
            </h2>
            <p className="mb-4 text-lg text-white">
              Game <span className="font-bold">#{gameData?.gameNumber}</span>:
              All numbers called or game ended.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                className="bg-[#e9a64c] text-black px-4 py-2 font-bold rounded hover:bg-[#f0b76a]"
                onClick={() => setIsGameFinishedModalOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {isErrorModalOpen && callError && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="error-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setIsErrorModalOpen(false);
            setCallError(null);
          }}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            ref={errorPanelRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `scale(${errorScale})`,
              transformOrigin: "center center",
            }}
            className="relative bg-blue-950 border-4 border-orange-500 p-6 rounded-xl text-center min-w-[300px] max-w-[520px] w-full shadow-2xl"
          >
            <h2
              id="error-title"
              className="text-orange-500 mb-4 text-2xl font-extrabold"
            >
              Error
            </h2>
            <p className="mb-4 text-lg text-white">{callError}</p>
            <div className="flex gap-2 justify-center">
              <button
                className="bg-orange-400 text-black px-4 py-2 font-bold rounded hover:bg-orange-300"
                onClick={() => {
                  setIsErrorModalOpen(false);
                  setCallError(null);
                  if (
                    callError.includes("Invalid game ID") ||
                    callError.includes("No game ID found") ||
                    callError.includes("Failed to load game")
                  ) {
                    navigate("/create-game");
                  }
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* NEW: Invalid Card Modal */}
      {isInvalidCardModalOpen && callError && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="invalidcard-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => {
            setIsInvalidCardModalOpen(false);
            setCallError(null);
          }}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            ref={invalidPanelRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `scale(${invalidScale})`,
              transformOrigin: "center center",
            }}
            className="relative bg-red-950 border-4 border-red-500 p-6 rounded-xl text-center min-w-[300px] max-w-[520px] w-full shadow-2xl"
          >
            <h2
              id="invalidcard-title"
              className="text-red-400 mb-4 text-2xl font-extrabold flex items-center justify-center gap-2"
            >
              <span>🚫</span>
              <span>Invalid Card</span>
            </h2>
            <p className="mb-4 text-lg text-white">{callError}</p>
            <div className="flex gap-2 justify-center">
              <button
                className="bg-red-400 text-black px-4 py-2 font-bold rounded hover:bg-red-300"
                onClick={() => {
                  setIsInvalidCardModalOpen(false);
                  setCallError(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BingoModals;
