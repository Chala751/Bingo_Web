// src/components/bingo/hooks/useModalState.js
import { useState } from "react";

export default function useModalState() {
  const [isNonWinnerModalOpen, setIsNonWinnerModalOpen] = useState(false);
  const [isWinnerModalOpen, setIsWinnerModalOpen] = useState(false);
  const [isGameFinishedModalOpen, setIsGameFinishedModalOpen] = useState(false);
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [isInvalidCardModalOpen, setIsInvalidCardModalOpen] = useState(false);
  const [callError, setCallError] = useState(null);
  const [showMessage, setShowMessage] = useState(null);
  const [messageType, setMessageType] = useState(null);
  const [showWinModal, setShowWinModal] = useState(false);

  return {
    isNonWinnerModalOpen, setIsNonWinnerModalOpen,
    isWinnerModalOpen, setIsWinnerModalOpen,
    isGameFinishedModalOpen, setIsGameFinishedModalOpen,
    isErrorModalOpen, setIsErrorModalOpen,
    isInvalidCardModalOpen, setIsInvalidCardModalOpen,
    callError, setCallError,
    showMessage, setShowMessage,
    messageType, setMessageType,
    showWinModal, setShowWinModal,
  };
}