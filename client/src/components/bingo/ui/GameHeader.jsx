import React from "react";

/**
 * GameHeader - top navigation and title with recent numbers.
 *
 * Props:
 * - onBack: function to navigate back
 * - isFullscreen: boolean
 * - onToggleFullscreen: function to toggle fullscreen
 * - language: string (current lang key)
 * - translations: object (translations map)
 * - toggleLanguage: function to switch language
 * - lastCalledNumbers: number[] (latest first)
 */
const GameHeader = ({
  onBack,
  isFullscreen,
  onToggleFullscreen,
  language,
  translations = {},
  toggleLanguage,
  lastCalledNumbers = [],
}) => {
  const recent = (Array.isArray(lastCalledNumbers) ? lastCalledNumbers : []).map(
    (num, index) => (
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
    )
  );

  return (
    <>
      {/* Navigation Header */}
      <div className="flex justify-between items-center w-full max-w-[1200px]">
        <button
          className="bg-transparent border border-gray-600 text-[#f0e14a] hover:border-none w-10 h-10 rounded flex justify-center items-center text-xl cursor-pointer transition-all duration-300"
          onClick={onBack}
        >
          ↩️
        </button>
        <button
          className="bg-transparent border border-gray-600 text-[#f0e14a] w-10 h-10 rounded flex justify-center items-center text-xl cursor-pointer transition-all duration-300 hover:bg-white/10 hover:scale-105"
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? "⎋" : "⛶"}
        </button>
        <button
          className="bg-transparent border border-gray-600 text-[#f0e14a] px-3 flex items-center gap-1.5 rounded cursor-pointer transition-all duration-300 hover:bg-white/10 hover:scale-105"
          onClick={toggleLanguage}
        >
          <span className="text-base">🇬🇧</span>
          <span className="text-sm">{translations?.[language]?.language || "Language"}</span>
        </button>
      </div>

      {/* Title and Recent Numbers */}
      <div className="w-full flex justify-between px-16 items-center my-8 max-[1100px]:flex-col max-[1100px]:gap-2">
        <h1 className="text-7xl font-black text-[#f0e14a] text-center">JOKER BINGO</h1>
        <div className="flex justify-center items-center gap-2">
          <span className="text-[#e9a64c] text-2xl font-bold mr-1">Last called:</span>
          {recent}
        </div>
      </div>
    </>
  );
};

export default GameHeader;
