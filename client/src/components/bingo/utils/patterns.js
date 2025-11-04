/**
 * Pattern utilities for bingo cards (pure functions).
 */

export function getNumbersForPatternBackendStyle(
  numbers, // 2D 5x5 grid
  pattern,
  excludeIndices = [],
  isWinner = false,
  calledNumbers = [], // pass called numbers explicitly
  includeMarked = true // for winners include all in pattern
) {
  if (
    !Array.isArray(numbers) ||
    numbers.length !== 5 ||
    numbers.some((row) => !Array.isArray(row) || row.length !== 5)
  ) {
    throw new Error("Invalid card numbers: must be a 5x5 array");
  }
  if (!pattern) throw new Error("Pattern must be specified");

  const patterns = {
    four_corners_center: [0, 4, 20, 24, 12],
    cross: [2, 7, 12, 17, 22, 10, 11, 13, 14],
    main_diagonal: [0, 6, 12, 18, 24],
    other_diagonal: [4, 8, 12, 16, 20],
    all: Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 12),
    full_card: Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== 12),
    inner_corners: [6, 8, 16, 18],
  };

  let selectedIndices = [];

  if (patterns[pattern]) {
    selectedIndices = patterns[pattern];
  } else if (pattern === "horizontal_line" || pattern === "vertical_line") {
    const safeCalled = Array.isArray(calledNumbers) ? calledNumbers : [];
    const isLineComplete = (line) =>
      line.every((cell) => cell === "FREE" || safeCalled.includes(Number(cell)));

    if (pattern === "horizontal_line") {
      let winningRow = -1;
      if (includeMarked) {
        for (let row = 0; row < 5; row++) {
          if (isLineComplete(numbers[row])) {
            winningRow = row;
            break;
          }
        }
      } else if (!isWinner) {
        winningRow = Math.floor(Math.random() * 5);
      }
      if (winningRow >= 0) {
        selectedIndices = Array.from({ length: 5 }, (_, col) => winningRow * 5 + col);
      }
    } else if (pattern === "vertical_line") {
      let winningCol = -1;
      if (includeMarked) {
        for (let col = 0; col < 5; col++) {
          const colLine = numbers.map((row) => row[col]);
          if (isLineComplete(colLine)) {
            winningCol = col;
            break;
          }
        }
      } else if (!isWinner) {
        winningCol = Math.floor(Math.random() * 5);
      }
      if (winningCol >= 0) {
        selectedIndices = Array.from({ length: 5 }, (_, row) => row * 5 + winningCol);
      }
    }
  } else {
    throw new Error(`Invalid pattern: ${pattern}`);
  }

  selectedIndices = selectedIndices.filter((idx) => !excludeIndices.includes(idx) && idx !== 12);

  const flatNumbers = numbers.flat();
  const selectedNumbers = selectedIndices
    .map((idx) => flatNumbers[idx])
    .filter((num) => typeof num === "number" && num >= 1 && num <= 75);

  return { selectedIndices, selectedNumbers };
}

export function getNumbersForPattern(
  cardNumbers,
  pattern,
  calledNumbers = [],
  selectSpecificLine = false,
  targetIndices = [],
  includeMarked = false,
  lastCalledNumber = null
) {
  if (!cardNumbers || (!Array.isArray(cardNumbers) && typeof cardNumbers !== "object")) {
    return { numbers: [], selectedIndices: [], rowIndex: null, colIndex: null, pattern };
  }

  let grid = [];
  try {
    if (Array.isArray(cardNumbers) && Array.isArray(cardNumbers[0])) {
      grid = cardNumbers.map((row) => row.map((cell) => (cell === "FREE" ? "FREE" : Number(cell))));
    } else if (Array.isArray(cardNumbers)) {
      const flatNumbers = cardNumbers.filter((n) => n !== undefined && n !== null);
      if (flatNumbers.length >= 25) {
        for (let row = 0; row < 5; row++) {
          grid[row] = [];
          for (let col = 0; col < 5; col++) {
            const index = row * 5 + col;
            const num = flatNumbers[index];
            grid[row][col] = num === "FREE" || num === null ? "FREE" : Number(num);
          }
        }
      } else {
        for (let row = 0; row < 5; row++) grid[row] = new Array(5).fill("FREE");
      }
    } else {
      for (let row = 0; row < 5; row++) grid[row] = new Array(5).fill("FREE");
    }
  } catch (e) {
      for (let row = 0; row < 5; row++) grid[row] = new Array(5).fill("FREE");
  }

  let numbers = [];
  let selectedIndices = [];
  let rowIndex = null;
  let colIndex = null;
  const safeCalledNumbers = Array.isArray(calledNumbers) ? calledNumbers : [];
  const filterFn = includeMarked
    ? (n) => n !== "FREE"
    : (n) => {
        const num = Number(n);
        return n !== "FREE" && !isNaN(num) && !safeCalledNumbers.includes(num);
      };

  try {
    const findLineContainingNumber = (lastNum, g) => {
      if (!lastNum) return null;
      const s = String(lastNum);
      for (let r = 0; r < g.length; r++) {
        for (let c = 0; c < g[r].length; c++) {
          if (String(g[r][c]) === s) return { type: "row", index: r, col: c };
        }
      }
      for (let c = 0; c < g[0].length; c++) {
        for (let r = 0; r < g.length; r++) {
          if (String(g[r][c]) === s) return { type: "col", index: c, row: r };
        }
      }
      return null;
    };
    const isLineComplete = (line, called) =>
      line.every((n) => (n === "FREE" ? true : !isNaN(Number(n)) && called.includes(Number(n))));

    switch (pattern) {
      case "horizontal_line": {
        let selectedRow = null;
        if (lastCalledNumber) {
          const info = findLineContainingNumber(lastCalledNumber, grid);
          if (info && info.type === "row") selectedRow = info.index;
        }
        if (selectedRow == null) {
          for (let r = 0; r < grid.length; r++) {
            const rowNumbers = grid[r];
            if (isLineComplete(rowNumbers, safeCalledNumbers)) {
              selectedRow = r;
              break;
            }
          }
        }
        if (selectedRow == null && selectSpecificLine && Array.isArray(targetIndices) && targetIndices.length > 0) {
          selectedRow = Math.max(0, Math.min(4, targetIndices[0]));
        }
        if (selectedRow == null && grid.length > 0) selectedRow = 0;
        if (selectedRow != null) {
          rowIndex = selectedRow;
          const rowNumbers = grid[selectedRow].filter(filterFn);
          numbers.push(...rowNumbers);
          for (let j = 0; j < 5; j++) if (filterFn(grid[selectedRow][j])) selectedIndices.push(selectedRow * 5 + j);
        }
        break;
      }
      case "vertical_line": {
        let selectedCol = null;
        if (lastCalledNumber) {
          const info = findLineContainingNumber(lastCalledNumber, grid);
          if (info && info.type === "col") selectedCol = info.index;
        }
        if (selectedCol == null) {
          for (let c = 0; c < grid[0].length; c++) {
            const colNumbers = [0, 1, 2, 3, 4].map((r) => grid[r][c]);
            if (isLineComplete(colNumbers, safeCalledNumbers)) {
              selectedCol = c;
              break;
            }
          }
        }
        if (selectedCol == null && selectSpecificLine && Array.isArray(targetIndices) && targetIndices.length > 0) {
          selectedCol = Math.max(0, Math.min(4, targetIndices[0]));
        }
        if (selectedCol == null && grid[0] && grid[0].length > 0) selectedCol = 0;
        if (selectedCol != null) {
          colIndex = selectedCol;
          const colNumbers = [0, 1, 2, 3, 4].map((_, r) => grid[r][selectedCol]).filter(filterFn);
          numbers.push(...colNumbers);
          for (let i = 0; i < 5; i++) if (filterFn(grid[i][selectedCol])) selectedIndices.push(i * 5 + selectedCol);
        }
        break;
      }
      case "four_corners_center": {
        const cornersAndCenter = [grid[0][0], grid[0][4], grid[4][0], grid[4][4], grid[2][2]].filter(filterFn);
        numbers.push(...cornersAndCenter);
        selectedIndices.push(0, 4, 20, 24, 12);
        break;
      }
      case "inner_corners": {
        const innerCorners = [grid[1][1], grid[1][3], grid[3][1], grid[3][3]].filter(filterFn);
        numbers.push(...innerCorners);
        selectedIndices.push(6, 8, 16, 18);
        break;
      }
      case "main_diagonal": {
        const mainDiag = [0, 1, 2, 3, 4].map((i) => grid[i][i]).filter(filterFn);
        numbers.push(...mainDiag);
        selectedIndices.push(0, 6, 12, 18, 24);
        break;
      }
      case "other_diagonal": {
        const otherDiag = [0, 1, 2, 3, 4].map((i) => grid[i][4 - i]).filter(filterFn);
        numbers.push(...otherDiag);
        selectedIndices.push(4, 8, 12, 16, 20);
        break;
      }
      case "all": {
        for (let row = 0; row < 5; row++) {
          for (let col = 0; col < 5; col++) {
            if (filterFn(grid[row][col])) {
              numbers.push(grid[row][col]);
              selectedIndices.push(row * 5 + col);
            }
          }
        }
        break;
      }
      default: {
        return { numbers: [], selectedIndices: [], rowIndex: null, colIndex: null, pattern };
      }
    }

    numbers = numbers
      .filter((n) => {
        if (n == null) return false;
        const num = Number(n);
        return !isNaN(num) && num >= 1 && num <= 75;
      })
      .map(Number);

    return { numbers, selectedIndices, rowIndex, colIndex, pattern };
  } catch (e) {
      return { numbers: [], selectedIndices: [], rowIndex: null, colIndex: null, pattern };
  }
}
