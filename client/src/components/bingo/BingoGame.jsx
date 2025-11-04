// src/components/bingo/BingoGame.jsx
import React, { useRef, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { LanguageContext } from "../../context/LanguageProvider";
import useFullscreen from "./hooks/useFullscreen";
import useBingoController from "./hooks/useBingoController";

import GameHeader from "./ui/GameHeader";
import BingoBoard from "./ui/BingoBoard";
import ControlsPanel from "./ui/ControlsPanel";
import PrizeDisplay from "./ui/PrizeDisplay";
import JackpotContainer from "./ui/JackpotContainer";
import BingoModals from "./Modals/BingoModals";

const BingoGame = () => {
  const navigate = useNavigate();
  const { language, translations, toggleLanguage } =
    useContext(LanguageContext);
  const containerRef = useRef(null);
  const { isFullscreen, toggleFullscreen } = useFullscreen(containerRef);

  const {
    user,
    isOnline,
    gameData,
    bingoCards,
    cards,
    calledNumbers,
    lastCalledNumbers,
    currentNumber,
    displayNumbers,
    isShuffling,
    isLoading,
    isGameOver,
    hasStarted,
    isPlaying,
    isAutoCall,
    toggleAutoCall, // FROM useAutoCaller
    speed,
    setSpeed,
    cardId,
    setCardId,
    isCallingNumber,
    handlePlayPause,
    handleNextClick,
    handleFinish,
    handleShuffle,
    handleCheckCard,
    // Modals
    isNonWinnerModalOpen,
    setIsNonWinnerModalOpen,
    nonWinnerCardData,
    setNonWinnerCardData,
    isWinnerModalOpen,
    setIsWinnerModalOpen,
    isGameFinishedModalOpen,
    setIsGameFinishedModalOpen,
    isErrorModalOpen,
    setIsErrorModalOpen,
    isInvalidCardModalOpen,
    setIsInvalidCardModalOpen,
    callError,
    setCallError,
    bingoStatus,
    setBingoStatus,
    winnerData,
    showMessage,
    messageType,
  } = useBingoController();

  if (!user)
    return <div className="text-white text-center p-10">Loading user...</div>;

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center min-h-screen bg-[#0c111b] text-white p-4"
    >
      <GameHeader
        onBack={() => navigate(-1)}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        language={language}
        translations={translations}
        toggleLanguage={toggleLanguage}
        lastCalledNumbers={lastCalledNumbers || []}
      />

      <div className="flex flex-wrap justify-center gap-2 mb-5 w-full">
        <div className="text-[#f0e14a] text-2xl font-bold mr-2">
          GAME {isLoading ? "..." : gameData?.gameNumber || "Unknown"}
        </div>
        <div className="bg-[#f0e14a] text-black px-3 py-1.5 rounded-full font-bold text-xs">
          Called {calledNumbers?.length || 0}/75
        </div>
      </div>

      <BingoBoard
        isShuffling={isShuffling}
        displayNumbers={displayNumbers || []}
        calledNumbers={calledNumbers || []}
      />

      <div className="flex justify-center items-center gap-8 my-6 w-full max-w-[1200px] flex-row">
        <ControlsPanel
          isPlaying={isPlaying}
          isGameOver={isGameOver}
          isOnline={isOnline}
          gameId={gameData?._id}
          isAutoCall={isAutoCall}
          toggleAutoCall={toggleAutoCall} // PASSED FROM useAutoCaller
          isCallingNumber={isCallingNumber}
          hasStarted={hasStarted}
          isShuffling={isShuffling}
          speed={speed}
          setSpeed={setSpeed}
          cardId={cardId}
          setCardId={setCardId}
          onPlayPause={handlePlayPause}
          onNextClick={handleNextClick}
          onFinish={handleFinish}
          onShuffle={handleShuffle}
          onCheckCard={handleCheckCard}
        />
        <PrizeDisplay
          currentNumber={currentNumber}
          prizePool={gameData?.prizePool || 0}
        />
      </div>

      <JackpotContainer
        gameId={gameData?._id}
        userId={user?.id}
        setCallError={setCallError}
        setIsErrorModalOpen={setIsErrorModalOpen}
      />

      <BingoModals
        isWinnerModalOpen={isWinnerModalOpen}
        setIsWinnerModalOpen={setIsWinnerModalOpen}
        bingoStatus={bingoStatus}
        setBingoStatus={setBingoStatus}
        cardId={cardId}
        gameData={gameData}
        isNonWinnerModalOpen={isNonWinnerModalOpen}
        setIsNonWinnerModalOpen={setIsNonWinnerModalOpen}
        nonWinnerCardData={nonWinnerCardData}
        setNonWinnerCardData={setNonWinnerCardData}
        isGameFinishedModalOpen={isGameFinishedModalOpen}
        setIsGameFinishedModalOpen={setIsGameFinishedModalOpen}
        isLoading={isLoading}
        isErrorModalOpen={isErrorModalOpen}
        setIsErrorModalOpen={setIsErrorModalOpen}
        callError={callError}
        setCallError={setCallError}
        navigate={navigate}
        winnerData={winnerData}
        showMessage={showMessage}
        messageType={messageType}
        bingoCards={bingoCards}
        cards={cards}
        calledNumbers={calledNumbers || []}
        isInvalidCardModalOpen={isInvalidCardModalOpen}
        setIsInvalidCardModalOpen={setIsInvalidCardModalOpen}
      />
    </div>
  );
};

export default BingoGame;
