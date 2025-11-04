import React from "react";
import { FaMoneyBillWave } from "react-icons/fa";

/**
 * PrizeDisplay - shows last called number and prize pool amount.
 * Props: currentNumber (number|null), prizePool (number)
 */
const PrizeDisplay = ({ currentNumber, prizePool = 0 }) => {
  return (
    <div className="flex items-center gap-4 ">
      <div className="flex flex-col items-center">
        <p className="w-38 h-38 flex justify-center items-center bg-[#f0e14a] shadow-[inset_0_0_10px_white] rounded-full text-8xl font-black text-black">
          {currentNumber || "-"}
        </p>
      </div>
      <div className=" flex flex-col items-center">
        <div className="flex items-center gap-2">
          <span className="text-5xl font-black text-white">{Number(prizePool || 0).toFixed(2)} ብር</span>
          <FaMoneyBillWave className="w-14 h-14 text-green-500" />
        </div>
      </div>
    </div>
  );
};

export default PrizeDisplay;
