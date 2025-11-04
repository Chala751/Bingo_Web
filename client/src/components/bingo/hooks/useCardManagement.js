// src/components/bingo/hooks/useCardManagement.js
import { useState, useEffect, useCallback } from "react";
import gameService from "../../../services/game";

export default function useCardManagement(gameState, numberCalling) {
  const {
    gameData,
    calledNumbers,
    numberIndexRef,
    calledNumbersSetRef,
    appliedNumbersRef,
  } = gameState;
  const { applyCalledNumber } = numberCalling;

  const [bingoCards, setBingoCards] = useState([]);
  const [cards, setCards] = useState([]);

  const markNumberPositions = (n) => {
    const entries = numberIndexRef.current.get(n) || [];
    if (!entries.length) return false;

    const affected = new Map();
    for (const { cardId, letter, row } of entries) {
      const card = bingoCards.find(c => c.id === cardId);
      if (!card) continue;
      if (!affected.has(cardId)) {
        affected.set(cardId, {
          ...card,
          markedPositions: JSON.parse(JSON.stringify(card.markedPositions)),
        });
      }
      const upd = affected.get(cardId);
      if (!upd.markedPositions[letter][row]) {
        upd.markedPositions[letter][row] = true;
      }
    }

    if (affected.size > 0) {
      setBingoCards(prev => prev.map(c => affected.get(c.id) || c));
      setCards(prev => prev.map(c => affected.get(c.id) || c));
    }
    return true;
  };

  const fetchBingoCards = useCallback(async () => {
    if (!gameData?._id) return;
    try {
      const allCards = await gameService.getAllCards();
      const selected = gameData.selectedCards || [];
      const gameCards = selected
        .map(s => {
          const full = allCards.find(c => c.card_number == s.id);
          if (!full) return null;
          const letters = ["B", "I", "N", "G", "O"];
          const numbers = {};
          letters.forEach((l, i) => {
            numbers[l] = full.numbers[i].map((n, rowIndex) => {
              if (n === "FREE" || n === null || n === undefined) {
                return "FREE";
              }
              const num = Number(n);
              if (Number.isFinite(num)) {
                return num;
              }
              // Ensure the traditional free space remains free even if encoded oddly
              if (l === "N" && rowIndex === 2) {
                return "FREE";
              }
              return n;
            });
          });
          const markedPositions = {
            B: new Array(5).fill(false),
            I: new Array(5).fill(false),
            N: new Array(5).fill(false).map((_, i) => i === 2),
            G: new Array(5).fill(false),
            O: new Array(5).fill(false),
          };
          return { id: s.id, numbers, markedPositions, winningPositions: { ...markedPositions } };
        })
        .filter(Boolean);

      const index = new Map();
      for (const card of gameCards) {
        ["B", "I", "N", "G", "O"].forEach((l) => {
          card.numbers[l].forEach((n, r) => {
            if (typeof n === "number") {
              if (!index.has(n)) index.set(n, []);
              index.get(n).push({ cardId: card.id, letter: l, row: r });
            }
          });
        });
      }
      numberIndexRef.current = index;
      setBingoCards(gameCards);
      setCards(gameCards);
      return gameCards;
    } catch (err) {
      console.error("fetchBingoCards error:", err);
      return null;
    }
  }, [gameData?._id, gameData?.selectedCards, numberIndexRef]);

  useEffect(() => {
    fetchBingoCards();
  }, [fetchBingoCards]);

  useEffect(() => {
    const newlyCalled = calledNumbers.filter(n => !appliedNumbersRef.current.has(n));
    newlyCalled.forEach(applyCalledNumber);
  }, [calledNumbers, applyCalledNumber, appliedNumbersRef]);

  return {
    bingoCards,
    setBingoCards,
    cards,
    setCards,
    markNumberPositions,
    fetchBingoCards,
  };
}