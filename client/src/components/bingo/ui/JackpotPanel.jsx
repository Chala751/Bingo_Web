import React from "react";

/**
 * JackpotPanel - bottom-left jackpot status and action button.
 *
 * Props:
 * - isAnimating: boolean
 * - jackpotAmount: number
 * - displayWinnerId: string (already formatted or '---')
 * - jackpotPrizeAmount: string (e.g., '---- BIRR')
 * - jackpotDrawDate: string
 * - onRunJackpot: function
 * - canRun: boolean (enabled state)
 * - runJackpotBtnText: string
 */
const JackpotPanel = ({
  isAnimating,
  jackpotAmount = 0,
  displayWinnerId = "---",
  jackpotPrizeAmount = "--- BIRR",
  jackpotDrawDate = "----",
  onRunJackpot,
  canRun = false,
  runJackpotBtnText = "Run Jackpot",
}) => {
  return (
    <div
      className={`fixed bottom-5 left-[0.1%] bg-[#0f1a4a] border-3 border-[#f0e14a] rounded-xl p-4 text-center shadow-lg z-10 min-w-[200px] transition-all duration-300 ${
        isAnimating ? "scale-105 animate-bounce" : ""
      }`}
    >
      <div className="text-3xl font-bold text-[#e9a64c] uppercase mb-2">JACKPOT</div>
      <div className="text-4xl font-bold text-[#f0e14a] mb-3">{jackpotAmount} BIRR</div>
      <div className="bg-[rgba(233,166,76,0.1)] p-3 rounded mb-2 text-xl">
        <div className="text-[#e9a64c] font-bold mb-2">
          Winner ID: <span className="text-[#f0e14a]">{displayWinnerId}</span>
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
          canRun
            ? "bg-[#e9744c] text-white cursor-pointer hover:bg-[#f0854c] hover:scale-105"
            : "bg-[#a07039] text-white cursor-not-allowed opacity-70"
        }`}
        onClick={onRunJackpot}
        disabled={!canRun}
      >
        {runJackpotBtnText}
      </button>
    </div>
  );
};

export default JackpotPanel;
