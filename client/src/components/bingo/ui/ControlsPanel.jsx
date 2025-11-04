// src/components/bingo/ui/ControlsPanel.jsx
import React from "react";

const ControlsPanel = ({
  isPlaying,
  isGameOver,
  isOnline,
  gameId,
  isAutoCall,
  isCallingNumber,
  hasStarted,
  isShuffling,
  speed,
  setSpeed,
  cardId,
  setCardId,
  onPlayPause,
  toggleAutoCall,          // ← NEW PROP
  onNextClick,
  onFinish,
  onShuffle,
  onCheckCard,
}) => {
  return (
    <div className="w-full flex items-center gap-4 max-w-[1000px] max-md:flex-col translate-x-40">
      <div className="flex-1 flex flex-col items-center">
        {/* Buttons */}
        <div className="flex flex-wrap justify-center gap-2 mb-4 w-full">
          <button
            className={`bg-[#4caf50] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a] ${
              isPlaying ? "bg-[#e9744c]" : ""
            }`}
            onClick={onPlayPause}
            disabled={isGameOver}
          >
            {isPlaying ? "Pause" : "Play"}
          </button>

          {/* AUTO CALL */}
          <button
            className={`${
              isAutoCall
                ? "bg-[#4caf50] hover:bg-[#43a047]"
                : "bg-[#e9744c] hover:bg-[#f0b76a]"
            } text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300`}
            onClick={toggleAutoCall}               // ← CALLS IT
            disabled={!gameId || isGameOver || !isOnline}  // allow toggling even when paused
          >
            Auto Call {isAutoCall ? "On" : "Off"}
          </button>

          {/* ... rest of your buttons (Next, Finish, Shuffle, Check) */}
          <button
            className="bg-[#e9a64c] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a]"
            onClick={onNextClick}
            disabled={!gameId || isCallingNumber || !isPlaying || isGameOver || !isOnline}
          >
            {isCallingNumber ? "Calling..." : "Next"}
          </button>

          <button
            className="bg-[#e9a64c] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a]"
            onClick={onFinish}
            disabled={isGameOver || !isOnline}
          >
            Finish
          </button>

          {!isPlaying && !hasStarted && (
            <button
              className="bg-[#e9a64c] text-black border-none px-4 py-2 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a] disabled:opacity-50"
              onClick={onShuffle}
              disabled={isShuffling}
            >
              {isShuffling ? "Shuffling..." : "Shuffle"}
            </button>
          )}
        </div>

        {/* Card Input + Speed (unchanged) */}
        <div className="flex gap-2 mt-2 w-full justify-center">
          <input
            type="text"
            className="p-2 bg-[#e9a64c] border-none rounded text-sm text-black w-40"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            placeholder="Enter Card ID"
            onKeyDown={(e) => {
              if (e.key === "Enter" && gameId) {
                e.preventDefault();
                onCheckCard(cardId, undefined);
              }
            }}
            disabled={!gameId}
          />
          <button
            className="bg-[#e9a64c] text-black border-none px-4 py-4 font-bold rounded cursor-pointer text-sm transition-colors duration-300 hover:bg-[#f0b76a]"
            onClick={() => onCheckCard(cardId, undefined)}
            disabled={!gameId || !isOnline}
          >
            Check
          </button>
        </div>

        <div className="flex justify-center items-center gap-2 mt-4 mb-4">
          <span className="text-sm">Speed:</span>
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
    </div>
  );
};

export default ControlsPanel;