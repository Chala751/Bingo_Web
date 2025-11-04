import React from "react";

/**
 * BingoBoard - renders the 5x15 number grid with BINGO headers.
 *
 * Props:
 * - displayNumbers: number[] length 75 (for shuffle animation)
 * - calledNumbers: number[]
 * - isShuffling: boolean
 */
const BingoBoard = ({ displayNumbers = [], calledNumbers = [], isShuffling }) => {
  const letters = [
    { letter: "B", color: "bg-[#e9a64c]" },
    { letter: "I", color: "bg-[#e9a64c]" },
    { letter: "N", color: "bg-[#e9a64c]" },
    { letter: "G", color: "bg-[#e9a64c]" },
    { letter: "O", color: "bg-[#e9a64c]" },
  ];

  const renderBoard = () => {
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
        const displayNum = isShuffling ? displayNumbers[numberIdx] : originalNum;
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

  return <div className="flex flex-col gap-[5px] mb-5 w-full max-w-[1200px] grow justify-center items-center">{renderBoard()}</div>;
};

export default BingoBoard;
