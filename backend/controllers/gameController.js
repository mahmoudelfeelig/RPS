const GameProgress = require('../models/GameProgress');
const User = require('../models/User');
const DailyPuzzle = require('../models/DailyPuzzle');
const RPSChallenge = require('../models/RPSChallenge');
const RPS_BOTS = require('../config/rpsBots');
const { recordRpsMarketOutcome } = require('./marketController');
const {
  generateMatch3,
  generateSliding,
  generateMemory,
  generateNQueens,
} = require('../utils/puzzleGenerator');

const MAX_FRENZY_PER_HOUR = 100;
const ICON_REWARDS = {
  '🐭': 5,
  '🦉': 10,
  '🐧': 7,
  '🦋': 12,
  '🐞': 15,
};
const rewardMultiplier = require('../utils/rewardMultiplier');
const { getUserBuffs, consumeOneShot } = require('../utils/applyEffects');
const mongoose = require('mongoose');

const RPS_BEATS = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

const HOUSE_TAX_RATE = 0.02;
const MAX_GAME_BET = 100000;
const MATCH3_SIZE = 5;
const MATCH3_TILE_COUNT = 7;
const MATCH3_TARGET = 20;
const MATCH3_MAX_MOVES = 80;
const DAILY_ARCADE_REWARDS = {
  'mini-queens': 340,
  'knight-gap': 300,
  'nonogram-row': 280,
  'cipher-vault': 260,
  'mine-clue': 300,
  'circuit-endpoint': 320,
};

function parseBet(value) {
  const bet = Number(value);
  if (!Number.isFinite(bet) || bet <= 0 || bet > MAX_GAME_BET) return null;
  return Math.floor(bet);
}

function taxedPayout(gross) {
  const tax = Math.max(0, Math.floor(gross * HOUSE_TAX_RATE));
  return { payout: gross - tax, tax };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function previousDateKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function nextPuzzleStreak(streak = {}, dateKey = todayKey()) {
  const last = streak.lastSolvedDate || null;
  const current =
    last === dateKey
      ? Number(streak.current || 0)
      : last === previousDateKey(dateKey)
        ? Number(streak.current || 0) + 1
        : 1;
  const best = Math.max(Number(streak.best || 0), current);
  const bonus = Math.min(1000, current * 75);
  return {
    current,
    best,
    lastSolvedDate: dateKey,
    lastReward: bonus,
    bonus,
  };
}

function hashSeed(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededNumber(seed, index, min, max) {
  const next = hashSeed(`${seed}:${index}`);
  return min + (next % (max - min + 1));
}

function buildDailyArcade(seed) {
  const queenSolutions = [
    [0, 2, 4, 1, 3],
    [0, 3, 1, 4, 2],
    [1, 3, 0, 2, 4],
    [1, 4, 2, 0, 3],
    [2, 0, 3, 1, 4],
    [2, 4, 1, 3, 0],
    [3, 0, 2, 4, 1],
    [3, 1, 4, 2, 0],
    [4, 1, 3, 0, 2],
    [4, 2, 0, 3, 1],
  ];
  const queenColumns = queenSolutions[seededNumber(seed, 1, 0, queenSolutions.length - 1)];
  const lockedRows = [seededNumber(seed, 2, 0, 1), seededNumber(seed, 3, 3, 4)];
  const missingRows = [0, 1, 2, 3, 4].filter((row) => !lockedRows.includes(row));
  const queenAnswer = missingRows.map((row) => `${row},${queenColumns[row]}`).join(';');

  const knightMoves = [
    [1, 2],
    [2, 1],
    [-1, 2],
    [-2, 1],
    [1, -2],
    [2, -1],
    [-1, -2],
    [-2, -1],
  ];
  const knightPath = [];
  let knight = { r: seededNumber(seed, 10, 0, 4), c: seededNumber(seed, 11, 0, 4) };
  knightPath.push(knight);
  for (let step = 0; step < 5; step += 1) {
    const legal = knightMoves
      .map(([dr, dc]) => ({ r: knight.r + dr, c: knight.c + dc }))
      .filter((cell) => cell.r >= 0 && cell.r < 5 && cell.c >= 0 && cell.c < 5)
      .filter((cell) => !knightPath.some((prev) => prev.r === cell.r && prev.c === cell.c));
    if (!legal.length) break;
    knight = legal[seededNumber(seed, 12 + step, 0, legal.length - 1)];
    knightPath.push(knight);
  }
  while (knightPath.length < 6) {
    knightPath.push({ r: knightPath.length % 5, c: (knightPath.length * 2) % 5 });
  }
  const hiddenKnightIndex = 3;
  const knightAnswer = `${knightPath[hiddenKnightIndex].r},${knightPath[hiddenKnightIndex].c}`;

  const nonogramBits = Array.from({ length: 9 }, (_, index) =>
    seededNumber(seed, 30 + index, 0, 1)
  );
  if (!nonogramBits.some(Boolean)) nonogramBits[seededNumber(seed, 40, 0, 8)] = 1;
  const clues = [];
  let run = 0;
  for (const bit of nonogramBits) {
    if (bit) run += 1;
    else if (run) {
      clues.push(run);
      run = 0;
    }
  }
  if (run) clues.push(run);

  const words = ['crown', 'orbit', 'rival', 'vault', 'prism', 'quest', 'flare', 'glyph'];
  const cipherWord = words[seededNumber(seed, 50, 0, words.length - 1)];
  const shift = seededNumber(seed, 51, 2, 9);
  const cipherText = cipherWord
    .split('')
    .map((char) => String.fromCharCode(((char.charCodeAt(0) - 97 + shift) % 26) + 97))
    .join('');

  const mineSize = 4;
  const mineBombs = new Set();
  for (let i = 0; mineBombs.size < 4 && i < 20; i += 1) {
    mineBombs.add(
      `${seededNumber(seed, 70 + i * 2, 0, 3)},${seededNumber(seed, 71 + i * 2, 0, 3)}`
    );
  }
  const clueCells = [];
  for (let r = 0; r < mineSize; r += 1) {
    for (let c = 0; c < mineSize; c += 1) {
      if (mineBombs.has(`${r},${c}`)) continue;
      const count = [-1, 0, 1]
        .flatMap((dr) => [-1, 0, 1].map((dc) => [dr, dc]))
        .filter(([dr, dc]) => dr || dc)
        .filter(([dr, dc]) => mineBombs.has(`${r + dr},${c + dc}`)).length;
      if (count > 0) clueCells.push({ r, c, count });
    }
  }
  const mineClue = clueCells[seededNumber(seed, 80, 0, Math.max(0, clueCells.length - 1))] || {
    r: 0,
    c: 0,
    count: 0,
  };

  const directions = ['up', 'right', 'down', 'left'];
  const deltas = { up: [-1, 0], right: [0, 1], down: [1, 0], left: [0, -1] };
  let cursor = { r: seededNumber(seed, 90, 1, 3), c: seededNumber(seed, 91, 1, 3) };
  const circuitStart = { ...cursor };
  const route = [];
  for (let i = 0; i < 6; i += 1) {
    const legal = directions.filter((direction) => {
      const [dr, dc] = deltas[direction];
      const next = { r: cursor.r + dr, c: cursor.c + dc };
      return next.r >= 0 && next.r < 5 && next.c >= 0 && next.c < 5;
    });
    const direction = legal[seededNumber(seed, 100 + i, 0, legal.length - 1)];
    const [dr, dc] = deltas[direction];
    cursor = { r: cursor.r + dr, c: cursor.c + dc };
    route.push(direction);
  }

  return [
    {
      id: 'mini-queens',
      title: 'Mini Queens',
      description:
        'Complete the 5x5 queen layout. No two queens can share a row, column, or diagonal.',
      prompt: {
        size: 5,
        lockedQueens: lockedRows.map((row) => ({ row, col: queenColumns[row] })),
        missingRows,
      },
      inputType: 'coordinate-list',
      placeholder: 'row,col; row,col; row,col',
      reward: DAILY_ARCADE_REWARDS['mini-queens'],
      answer: queenAnswer,
    },
    {
      id: 'knight-gap',
      title: 'Knight Gap',
      description: 'A knight route has one missing stop. Fill the hidden coordinate.',
      prompt: {
        size: 5,
        path: knightPath.map((cell, index) => (index === hiddenKnightIndex ? null : cell)),
        hiddenIndex: hiddenKnightIndex + 1,
      },
      inputType: 'coordinate',
      placeholder: 'row,col',
      reward: DAILY_ARCADE_REWARDS['knight-gap'],
      answer: knightAnswer,
    },
    {
      id: 'nonogram-row',
      title: 'Nonogram Row',
      description: 'Rebuild the filled cells from the row clues. Use 1 for filled and 0 for empty.',
      prompt: { length: nonogramBits.length, clues },
      inputType: 'binary',
      placeholder: 'Example: 101100010',
      reward: DAILY_ARCADE_REWARDS['nonogram-row'],
      answer: nonogramBits.join(''),
    },
    {
      id: 'cipher-vault',
      title: 'Cipher Vault',
      description: 'Decode the Caesar-shifted vault word.',
      prompt: { cipherText, shift },
      inputType: 'text',
      placeholder: 'decoded word',
      reward: DAILY_ARCADE_REWARDS['cipher-vault'],
      answer: cipherWord,
    },
    {
      id: 'mine-clue',
      title: 'Mine Clue',
      description: 'Given the hidden mine map, enter the number shown by the selected safe cell.',
      prompt: {
        size: mineSize,
        bombs: [...mineBombs],
        clueCell: { row: mineClue.r, col: mineClue.c },
      },
      inputType: 'number',
      placeholder: 'adjacent mine count',
      reward: DAILY_ARCADE_REWARDS['mine-clue'],
      answer: String(mineClue.count),
    },
    {
      id: 'circuit-endpoint',
      title: 'Circuit Endpoint',
      description: 'Trace the route from the start node and enter the final coordinate.',
      prompt: { size: 5, start: circuitStart, route },
      inputType: 'coordinate',
      placeholder: 'row,col',
      reward: DAILY_ARCADE_REWARDS['circuit-endpoint'],
      answer: `${cursor.r},${cursor.c}`,
    },
  ];
}

function validateMemoryPairs(board, pairs) {
  const flat = board.flat();
  if (!Array.isArray(pairs) || pairs.length !== flat.length / 2) return false;
  const used = new Set();
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) return false;
    const [a, b] = pair.map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return false;
    if (a < 0 || b < 0 || a >= flat.length || b >= flat.length) return false;
    if (used.has(a) || used.has(b)) return false;
    if (flat[a] !== flat[b]) return false;
    used.add(a);
    used.add(b);
  }
  return used.size === flat.length;
}

function cloneMatchGrid(grid) {
  return grid.map((row) => row.slice());
}

function isValidMatch3Board(board) {
  return (
    Array.isArray(board) &&
    board.length === MATCH3_SIZE &&
    board.every(
      (row) =>
        Array.isArray(row) &&
        row.length === MATCH3_SIZE &&
        row.every((value) => Number.isInteger(value) && value >= 0 && value < MATCH3_TILE_COUNT)
    )
  );
}

function deterministicMatchTile(seed, refillIndex, col, slot) {
  return hashSeed(`${seed}:tile:${refillIndex}:${col}:${slot}`) % MATCH3_TILE_COUNT;
}

function findMatch3Cells(grid) {
  const matched = Array.from({ length: MATCH3_SIZE }, () => Array(MATCH3_SIZE).fill(false));
  for (let r = 0; r < MATCH3_SIZE; r += 1) {
    for (let c = 0; c <= MATCH3_SIZE - 3; c += 1) {
      const v = grid[r][c];
      if (v != null && v === grid[r][c + 1] && v === grid[r][c + 2]) {
        matched[r][c] = true;
        matched[r][c + 1] = true;
        matched[r][c + 2] = true;
      }
    }
  }
  for (let c = 0; c < MATCH3_SIZE; c += 1) {
    for (let r = 0; r <= MATCH3_SIZE - 3; r += 1) {
      const v = grid[r][c];
      if (v != null && v === grid[r + 1][c] && v === grid[r + 2][c]) {
        matched[r][c] = true;
        matched[r + 1][c] = true;
        matched[r + 2][c] = true;
      }
    }
  }
  const found = matched.flat().filter(Boolean).length;
  return { matched, found };
}

function applyMatch3Gravity(grid, seed, refillIndex) {
  const next = Array.from({ length: MATCH3_SIZE }, () => Array(MATCH3_SIZE).fill(null));
  let refill = refillIndex;
  for (let c = 0; c < MATCH3_SIZE; c += 1) {
    const existing = [];
    for (let r = 0; r < MATCH3_SIZE; r += 1) {
      if (grid[r][c] != null) existing.push(grid[r][c]);
    }
    const missing = MATCH3_SIZE - existing.length;
    const column = [];
    for (let slot = 0; slot < missing; slot += 1) {
      column.push(deterministicMatchTile(seed, refill, c, slot));
      refill += 1;
    }
    column.push(...existing);
    for (let r = 0; r < MATCH3_SIZE; r += 1) {
      next[r][c] = column[r];
    }
  }
  return { grid: next, refillIndex: refill };
}

function resolveMatch3(grid, seed, refillIndex) {
  let current = cloneMatchGrid(grid);
  let refill = refillIndex;
  let score = 0;
  for (let pass = 0; pass < MATCH3_SIZE * MATCH3_SIZE; pass += 1) {
    const { matched, found } = findMatch3Cells(current);
    if (found === 0) break;
    score += Math.floor(found / 3);
    const cleared = current.map((row, r) => row.map((cell, c) => (matched[r][c] ? null : cell)));
    const gravity = applyMatch3Gravity(cleared, seed, refill);
    current = gravity.grid;
    refill = gravity.refillIndex;
  }
  return { grid: current, refillIndex: refill, score };
}

function swapMatch3(grid, from, to) {
  const next = cloneMatchGrid(grid);
  [next[from.r][from.c], next[to.r][to.c]] = [next[to.r][to.c], next[from.r][from.c]];
  return next;
}

function normalizeMatch3Coord(coord) {
  if (!coord) return null;
  const rawR = coord.r ?? coord.row ?? coord[0];
  const rawC = coord.c ?? coord.col ?? coord[1];
  const r = Number(rawR);
  const c = Number(rawC);
  if (
    !Number.isInteger(r) ||
    !Number.isInteger(c) ||
    r < 0 ||
    c < 0 ||
    r >= MATCH3_SIZE ||
    c >= MATCH3_SIZE
  ) {
    return null;
  }
  return { r, c };
}

function hasMatch3Move(grid) {
  for (let r = 0; r < MATCH3_SIZE; r += 1) {
    for (let c = 0; c < MATCH3_SIZE; c += 1) {
      const from = { r, c };
      const candidates = [
        { r: r + 1, c },
        { r, c: c + 1 },
      ];
      for (const to of candidates) {
        if (to.r >= MATCH3_SIZE || to.c >= MATCH3_SIZE) continue;
        if (findMatch3Cells(swapMatch3(grid, from, to)).found > 0) return true;
      }
    }
  }
  return false;
}

function generateDeterministicMatch3Board(seed, round) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const board = Array.from({ length: MATCH3_SIZE }, (_, r) =>
      Array.from(
        { length: MATCH3_SIZE },
        (_, c) => hashSeed(`${seed}:board:${round}:${attempt}:${r}:${c}`) % MATCH3_TILE_COUNT
      )
    );
    if (hasMatch3Move(board)) return board;
  }
  return Array.from({ length: MATCH3_SIZE }, (_, r) =>
    Array.from({ length: MATCH3_SIZE }, (_, c) => (r + c) % MATCH3_TILE_COUNT)
  );
}

function validateMatch3Moves(puzzle, moves) {
  if (!isValidMatch3Board(puzzle.question?.grid)) {
    return { correct: false, message: 'Invalid Match-3 board' };
  }
  if (!Array.isArray(moves) || moves.length > MATCH3_MAX_MOVES) {
    return { correct: false, message: `Submit between 1 and ${MATCH3_MAX_MOVES} moves` };
  }

  const seed = puzzle.id;
  let refillIndex = 0;
  let current = cloneMatchGrid(puzzle.question.grid);
  let score = 0;
  const initial = resolveMatch3(current, seed, refillIndex);
  current = initial.grid;
  refillIndex = initial.refillIndex;
  score += initial.score;

  for (let i = 0; i < moves.length && score < MATCH3_TARGET; i += 1) {
    const from = normalizeMatch3Coord(moves[i]?.from);
    const to = normalizeMatch3Coord(moves[i]?.to);
    if (!from || !to || Math.abs(from.r - to.r) + Math.abs(from.c - to.c) !== 1) {
      return { correct: false, message: 'Invalid Match-3 move' };
    }
    const swapped = swapMatch3(current, from, to);
    const settled = resolveMatch3(swapped, seed, refillIndex);
    if (settled.score === 0) {
      return { correct: false, message: 'Move does not create a match' };
    }
    current = settled.grid;
    refillIndex = settled.refillIndex;
    score += settled.score;
    if (!hasMatch3Move(current) && score < MATCH3_TARGET) {
      current = generateDeterministicMatch3Board(seed, i);
      const refreshed = resolveMatch3(current, seed, refillIndex);
      current = refreshed.grid;
      refillIndex = refreshed.refillIndex;
      score += refreshed.score;
    }
  }

  return { correct: score >= MATCH3_TARGET, score };
}

function publicDailyArcadeGame(game, solved) {
  const safeGame = { ...game };
  delete safeGame.answer;
  return { ...safeGame, solved };
}

async function debitUserForBet(userId, bet, populateInventory = false) {
  const debit = await User.updateOne(
    { _id: userId, balance: { $gte: bet } },
    { $inc: { balance: -bet } }
  );
  if (debit.modifiedCount !== 1) return null;
  const query = User.findById(userId);
  return populateInventory ? query.populate('inventory.item') : query;
}

function publicPuzzle(puzzle) {
  const output = {
    id: puzzle.id,
    type: puzzle.type,
    question: { ...(puzzle.question || {}) },
  };
  if (puzzle.type === 'memory' && !output.question.board && puzzle.solution?.board) {
    output.question.board = puzzle.solution.board;
  }
  return output;
}

function applySlidingMoves(board, moves = []) {
  const current = board.map((row) => row.slice());
  const dirs = {
    up: [-1, 0],
    down: [1, 0],
    left: [0, -1],
    right: [0, 1],
  };
  for (const move of moves.slice(0, 80)) {
    const dir = dirs[move];
    if (!dir) return null;
    let blank;
    current.forEach((row, r) =>
      row.forEach((value, c) => {
        if (value === 0) blank = [r, c];
      })
    );
    if (!blank) return null;
    const nr = blank[0] + dir[0];
    const nc = blank[1] + dir[1];
    if (nr < 0 || nr >= current.length || nc < 0 || nc >= current[0].length) return null;
    [current[blank[0]][blank[1]], current[nr][nc]] = [current[nr][nc], current[blank[0]][blank[1]]];
  }
  return current;
}

function findRpsBot(opponentUsername = '') {
  const normalized = opponentUsername.trim().toLowerCase();
  return RPS_BOTS.find((bot) => bot.name.toLowerCase() === normalized) || null;
}

function escapeRegex(input = '') {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findRpsOpponent(username = '') {
  const normalized = String(username || '').trim();
  if (!normalized) return null;
  return User.findOne({
    username: { $regex: `^${escapeRegex(normalized)}$`, $options: 'i' },
    status: 'active',
  });
}

function pickWeightedMove(weights) {
  const entries = Object.entries(weights);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = Math.random() * total;
  for (const [move, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return move;
  }
  return entries[0]?.[0] || 'rock';
}

function getBotChoice(bot, userChoice) {
  const weights = { ...bot.bias };
  if (userChoice && RPS_BEATS[userChoice]) {
    const counter = Object.entries(RPS_BEATS).find(([, losesTo]) => losesTo === userChoice)?.[0];
    if (counter) {
      weights[counter] = (weights[counter] || 0) + 0.12;
    }
  }
  return pickWeightedMove(weights);
}

const BLACKJACK_RANKS = {
  A: 11,
  K: 10,
  Q: 10,
  J: 10,
  T: 10,
  9: 9,
  8: 8,
  7: 7,
  6: 6,
  5: 5,
  4: 4,
  3: 3,
  2: 2,
};
const BLACKJACK_SUITS = ['♠', '♥', '♦', '♣'];

function createBlackjackDeck() {
  const deck = [];
  for (const rank of Object.keys(BLACKJACK_RANKS)) {
    for (const suit of BLACKJACK_SUITS) {
      deck.push({ rank, suit });
    }
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardLabel(card) {
  return `${card.rank}${card.suit}`;
}

function scoreBlackjackHand(hand = []) {
  let total = 0;
  let aces = 0;

  for (const card of hand) {
    total += BLACKJACK_RANKS[card.rank] || 0;
    if (card.rank === 'A') aces += 1;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

function formatBlackjackState(progress, hideDealerHole = true) {
  const game = progress?.blackjack || {};
  const playerHand = game.playerHand || [];
  const dealerHand = game.dealerHand || [];
  const playerTotal = scoreBlackjackHand(playerHand);
  const dealerVisible = game.finished || !hideDealerHole ? dealerHand : dealerHand.slice(0, 1);
  const dealerTotal =
    game.finished || !hideDealerHole
      ? scoreBlackjackHand(dealerHand)
      : scoreBlackjackHand(dealerVisible);

  return {
    active: !!game.active,
    bet: game.bet || 0,
    deckSize: (game.deck || []).length,
    finished: !!game.finished,
    result: game.result || null,
    playerHand: playerHand.map(cardLabel),
    dealerHand: dealerVisible.map(cardLabel),
    playerTotal,
    dealerTotal,
    canHit: !!game.active && !game.finished && playerTotal < 21,
    canStand: !!game.active && !game.finished,
  };
}

async function loadOrCreateProgress(userId) {
  let prog = await GameProgress.findOne({ user: userId });
  if (!prog) {
    prog = await GameProgress.create({ user: userId });
  }
  return prog;
}

async function settleBlackjack(user, prog, outcome, naturalBlackjack = false) {
  const bet = Number(prog.blackjack?.bet) || 0;
  if (outcome === 'player') {
    user.balance += Math.round(bet * (naturalBlackjack ? 2.5 : 2));
  } else if (outcome === 'push') {
    user.balance += bet;
  }

  prog.blackjack.active = false;
  prog.blackjack.finished = true;
  prog.blackjack.result = outcome;
  await Promise.all([user.save(), prog.save()]);
}

async function resolveBlackjackIfNeeded(user, prog) {
  const playerTotal = scoreBlackjackHand(prog.blackjack.playerHand);
  const dealerTotal = scoreBlackjackHand(prog.blackjack.dealerHand);
  const playerNatural = prog.blackjack.playerHand.length === 2 && playerTotal === 21;
  const dealerNatural = prog.blackjack.dealerHand.length === 2 && dealerTotal === 21;

  if (playerNatural || dealerNatural) {
    if (playerNatural && dealerNatural) {
      await settleBlackjack(user, prog, 'push');
    } else if (playerNatural) {
      await settleBlackjack(user, prog, 'player', true);
    } else {
      await settleBlackjack(user, prog, 'dealer');
    }
    return true;
  }

  return false;
}

exports.getProgress = async (req, res) => {
  try {
    let prog = await GameProgress.findOne({ user: req.user.id }).lean();
    if (!prog) {
      prog = await GameProgress.create({ user: req.user.id });
      prog = prog.toObject();
    }

    const spinnerConfigs = {
      spinner: {
        rewardOptions: [0, 10, 20, 30, 50, 75, 100, 150, 200],
        weights: [10, 20, 25, 20, 10, 8, 5, 1, 1],
      },
      spinner12: {
        rewardOptions: [0, 50, 100, 150, 250, 400, 600, 900, 1200],
        weights: [15, 25, 30, 15, 10, 4, 1, 0.5, 0.5],
      },
      spinnerDaily: {
        rewardOptions: [0, 200, 400, 600, 1000, 1500, 2000, 3000, 4000],
        weights: [10, 20, 25, 20, 10, 8, 5, 1, 1],
      },
      spinnerWeekly: {
        rewardOptions: [0, 500, 1000, 1500, 2500, 4000, 6000, 8000, 10000],
        weights: [10, 20, 25, 20, 10, 8, 5, 1, 1],
      },
    };

    return res.json({
      unlockedGames: prog.unlockedGames,
      blackjack: formatBlackjackState(prog),
      cooldowns: {
        spinner: prog.cooldowns?.spinner?.toISOString() || null,
        spinner12: prog.cooldowns?.spinner12?.toISOString() || null,
        spinnerDaily: prog.cooldowns?.spinnerDaily?.toISOString() || null,
        spinnerWeekly: prog.cooldowns?.spinnerWeekly?.toISOString() || null,
        clickFrenzy: prog.cooldowns?.clickFrenzy?.toISOString() || null,
      },
      spinners: spinnerConfigs,
      rpsStats: {
        wins: prog.rpsWins || 0,
        games: prog.rpsGames || 0,
      },
      puzzleStats: {
        wins: prog.puzzleRushTotal || 0,
        resetAt: prog.puzzleRushResetAt?.toISOString() || null,
      },
      gambling: {
        won: prog.gamblingWon || 0,
        lost: prog.gamblingLost || 0,
      },
      plays: {
        minefield: req.user.minefieldPlays || 0,
        spinner: req.user.spinnerPlays || 0,
        clickFrenzy: req.user.clickFrenzyPlays || 0,
        casino: req.user.casinoPlays || 0,
        roulette: req.user.roulettePlays || 0,
        coinFlip: req.user.coinFlipPlays || 0,
        slots: req.user.slotsPlays || 0,
        rps: req.user.rpsPlays || 0,
        puzzleRush: prog.puzzleRushTotal || 0,
      },
    });
  } catch (err) {
    console.error('Error fetching game progress:', err);
    return res.status(500).json({ message: 'Failed to load progress' });
  }
};

async function spinTiered(req, res, opts) {
  const { cooldownField, cooldownMs, rewardOptions, weights } = opts;
  try {
    const userId = req.user.id;
    const prog = await GameProgress.findOne({ user: userId });
    if (!prog) return res.status(404).json({ message: 'Game progress not found' });

    const now = new Date();
    const nextSpin = prog.cooldowns[cooldownField];
    if (nextSpin && now < nextSpin) {
      return res.status(429).json({ message: 'Come back later!' });
    }

    const totalW = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * totalW,
      cum = 0,
      reward = 0;
    for (let i = 0; i < rewardOptions.length; i++) {
      cum += weights[i];
      if (roll < cum) {
        reward = rewardOptions[i];
        break;
      }
    }

    const user = await User.findById(userId).populate('inventory.item');

    const mult = rewardMultiplier(user);
    await consumeOneShot(user, ['reward-multiplier']);
    user.balance += Math.round(reward * mult);
    user.spinnerPlays = (user.spinnerPlays || 0) + 1;
    await user.save();

    prog.cooldowns[cooldownField] = new Date(now.getTime() + cooldownMs);
    await prog.save();

    return res.json({
      reward,
      nextSpin: prog.cooldowns[cooldownField].toISOString(),
      balance: user.balance,
    });
  } catch (err) {
    console.error(`Spinner ${opts.cooldownField} error:`, err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
}

exports.spinSpinner = (req, res) =>
  spinTiered(req, res, {
    cooldownField: 'spinner',
    cooldownMs: 1 * 60 * 60 * 1000, // 1h
    rewardOptions: [0, 10, 20, 30, 50, 75, 100, 150, 200],
    weights: [10, 20, 25, 20, 10, 8, 5, 1, 1],
  });

exports.spinSpinner12 = (req, res) =>
  spinTiered(req, res, {
    cooldownField: 'spinner12',
    cooldownMs: 12 * 60 * 60 * 1000, // 12h
    rewardOptions: [0, 50, 100, 150, 250, 400, 600, 900, 1200],
    weights: [15, 25, 30, 15, 10, 4, 1, 0.5, 0.5],
  });

exports.spinSpinnerDaily = (req, res) =>
  spinTiered(req, res, {
    cooldownField: 'spinnerDaily',
    cooldownMs: 24 * 60 * 60 * 1000, // 24h
    rewardOptions: [0, 200, 400, 600, 1000, 1500, 2000, 3000, 4000],
    weights: [10, 20, 25, 20, 10, 8, 5, 1, 1],
  });

exports.spinSpinnerWeekly = (req, res) =>
  spinTiered(req, res, {
    cooldownField: 'spinnerWeekly',
    cooldownMs: 7 * 24 * 60 * 60 * 1000, // 7d
    rewardOptions: [0, 500, 1000, 1500, 2500, 4000, 6000, 8000, 10000],
    weights: [10, 20, 25, 20, 10, 8, 5, 1, 1],
  });

exports.getFrenzyStats = async (req, res) => {
  try {
    const userId = req.user.id;
    let prog = await GameProgress.findOne({ user: userId });
    if (!prog) prog = await GameProgress.create({ user: userId });

    const now = new Date();
    if (!prog.frenzyResetAt || now - prog.frenzyResetAt >= 60 * 60 * 1000) {
      prog.frenzyResetAt = now;
      prog.frenzyTotal = 0;
      await prog.save();
    }

    const user = await User.findById(userId);
    return res.json({
      frenzyTotal: prog.frenzyTotal,
      frenzyResetAt: prog.frenzyResetAt.toISOString(),
      balance: user.balance,
    });
  } catch (err) {
    console.error('Click Frenzy GET error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.playFrenzy = async (req, res) => {
  try {
    const userId = req.user.id;
    let prog = await GameProgress.findOne({ user: userId });
    if (!prog) {
      prog = await GameProgress.create({
        user: userId,
        frenzyTotal: 0,
        frenzyResetAt: new Date(),
      });
    }

    const now = Date.now();
    if (!prog.frenzyResetAt || now - prog.frenzyResetAt >= 3600_000) {
      prog.frenzyResetAt = new Date();
      prog.frenzyTotal = 0;
    }

    const clicks = Math.max(0, parseInt(req.body.clicks, 10) || 0);
    if (clicks < 1) {
      return res.status(400).json({ message: 'At least one click is required' });
    }
    const emoji = req.body.emoji;
    const remaining = MAX_FRENZY_PER_HOUR - prog.frenzyTotal;
    if (remaining <= 0) {
      await prog.save();
      return res.status(429).json({ message: 'Hourly limit reached!' });
    }

    const usedClicks = Math.min(clicks, remaining);
    prog.frenzyTotal += usedClicks;
    await prog.save();

    const baseReward = ICON_REWARDS[emoji] || 5;
    const userDoc = await User.findById(userId).populate('inventory.item');

    const boostedProfit = Math.round(baseReward * (rewardMultiplier(userDoc) - 1));
    await consumeOneShot(userDoc, ['reward-multiplier']);
    const reward = baseReward + boostedProfit;
    userDoc.balance += reward;
    userDoc.clickFrenzyPlays = (userDoc.clickFrenzyPlays || 0) + 1;
    await userDoc.save();

    return res.json({
      baseReward,
      boostedProfit,
      reward,
      frenzyTotal: prog.frenzyTotal,
      frenzyResetAt: prog.frenzyResetAt.toISOString(),
      balance: userDoc.balance,
    });
  } catch (err) {
    console.error('Click Frenzy error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.playCasino = async (req, res) => {
  try {
    const userId = req.user.id;
    const betAmount = parseFloat(req.body.betAmount);
    if (!betAmount || betAmount <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }

    const user = await debitUserForBet(userId, betAmount);
    if (!user) {
      return res.status(400).json({ message: 'Insufficient funds' });
    }

    user.casinoPlays = (user.casinoPlays || 0) + 1;
    await user.save();

    const win = Math.random() < 0.5;
    let payout = 0,
      boostedProfit = 0;
    if (win) {
      const baseProfit = betAmount; // win pays 2×, so profit = betAmount
      const mult = rewardMultiplier(user);
      boostedProfit = Math.round(baseProfit * (mult - 1));
      user.balance += betAmount + baseProfit + boostedProfit;
      user.gamblingWon = (user.gamblingWon || 0) + (baseProfit + boostedProfit);
      await consumeOneShot(user, ['reward-multiplier']);
      await user.save();
      payout = betAmount * 2 + boostedProfit;
    } else {
      user.gamblingLost = (user.gamblingLost || 0) + betAmount;
      await user.save();
    }

    return res.json({
      win,
      wager: betAmount,
      payout,
      boostedProfit,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Casino error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.playRoulette = async (req, res) => {
  try {
    const userId = req.user.id;
    const { betAmount, color } = req.body;
    const amt = parseFloat(betAmount);
    if (!amt || amt <= 0 || !['red', 'black', 'green'].includes(color)) {
      return res.status(400).json({ message: 'Invalid bet or color' });
    }

    const user = await debitUserForBet(userId, amt, true);
    if (!user) {
      return res.status(400).json({ message: 'Insufficient funds' });
    }

    user.roulettePlays = (user.roulettePlays || 0) + 1;
    await user.save();

    const slot = Math.floor(Math.random() * 37);
    let resultColor = slot === 0 ? 'green' : slot <= 18 ? 'red' : 'black';
    const win = resultColor === color;
    let payout = 0,
      boostedProfit = 0;
    if (win) {
      const baseProfit = color === 'green' ? amt * 14 - amt : amt * 2 - amt;
      const mult = rewardMultiplier(user);
      boostedProfit = Math.round(baseProfit * (mult - 1));
      user.balance += amt + baseProfit + boostedProfit;
      user.gamblingWon = (user.gamblingWon || 0) + (baseProfit + boostedProfit);
      await consumeOneShot(user, ['reward-multiplier']);
      await user.save();
      payout = (color === 'green' ? amt * 14 : amt * 2) + boostedProfit;
    } else {
      user.gamblingLost = (user.gamblingLost || 0) + amt;
      await user.save();
    }

    return res.json({
      win,
      wager: amt,
      choice: color,
      result: resultColor,
      payout,
      boostedProfit,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Roulette error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.playCoinFlip = async (req, res) => {
  try {
    const userId = req.user.id;
    const { betAmount, guess } = req.body;
    const amt = parseFloat(betAmount);
    if (!amt || amt <= 0 || !['heads', 'tails'].includes(guess)) {
      return res.status(400).json({ message: 'Invalid bet or guess' });
    }

    const user = await debitUserForBet(userId, amt, true);
    if (!user) {
      return res.status(400).json({ message: 'Insufficient funds' });
    }

    user.coinFlipPlays = (user.coinFlipPlays || 0) + 1;
    await user.save();

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const win = result === guess;
    let payout = 0,
      boostedProfit = 0;
    if (win) {
      const baseProfit = amt * 2 - amt;
      const mult = rewardMultiplier(user);
      boostedProfit = Math.round(baseProfit * (mult - 1));
      user.balance += amt + baseProfit + boostedProfit;
      user.gamblingWon = (user.gamblingWon || 0) + (baseProfit + boostedProfit);
      await consumeOneShot(user, ['reward-multiplier']);
      await user.save();
      payout = amt * 2 + boostedProfit;
    } else {
      user.gamblingLost = (user.gamblingLost || 0) + amt;
      await user.save();
    }

    return res.json({
      win,
      wager: amt,
      guess,
      result,
      payout,
      boostedProfit,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Coin Flip error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

const SYMBOLS = [
  '🍒',
  '🍋',
  '🍉',
  '⭐',
  '7️⃣',
  '💎',
  '🔔',
  '🍇',
  '🥝',
  '🎰',
  '💰',
  '🍓',
  '🍊',
  '👑',
  '🃏',
  '🍀',
  '🪙',
  '🛎️',
  '🌈',
  '🔥',
  '💣',
];

const MULTIPLIERS = {
  '7️⃣': 15,
  '💎': 12,
  '👑': 10,
  '⭐': 8,
  '💰': 7,
  '🔔': 6,
  '🎰': 6,
  '🍒': 5,
  '🍉': 4,
  '🍇': 4,
  '🍋': 3,
  '🍊': 3,
  '🍓': 3,
  '🥝': 2,
  '🃏': 2,
  '🍀': 2,
  '🛎️': 1.5,
  '🪙': 1.5,
  '🌈': 1,
  '🔥': 1,
  '💣': 0, // bomb = no payout even on match
};

const SPECIAL_COMBOS = [
  {
    name: 'Jackpot Trio',
    symbols: ['💎', '7️⃣', '⭐'],
    multiplier: 20,
  },
  {
    name: 'Fruit Medley',
    symbols: ['🍒', '🍋', '🍉'],
    multiplier: 5,
  },
  {
    name: 'Berry Bonus',
    symbols: ['🍇', '🍇', '🍒'],
    exact: true,
    multiplier: 4,
  },
  {
    name: 'Double Lucky',
    symbols: ['7️⃣', '7️⃣'],
    matchTwoOnly: true,
    multiplier: 3,
  },
  {
    name: 'Juicy Row',
    symbols: ['🥝', '🍉', '🍇'],
    multiplier: 2.5,
  },
  {
    name: 'Firebomb',
    symbols: ['🔥', '💣', '🔥'],
    exact: true,
    multiplier: 7,
  },
  {
    name: 'Triple Crown',
    symbols: ['👑', '👑', '👑'],
    exact: true,
    multiplier: 25,
  },
  {
    name: 'Triple Jokers',
    symbols: ['🃏', '🃏', '🃏'],
    exact: true,
    multiplier: 10,
  },
];

function matchesCombo(combo, reel) {
  if (combo.exact) {
    return JSON.stringify(reel) === JSON.stringify(combo.symbols);
  }
  const reelCopy = [...reel];
  return combo.symbols.every((sym) => {
    const idx = reelCopy.indexOf(sym);
    if (idx !== -1) {
      reelCopy.splice(idx, 1);
      return true;
    }
    return false;
  });
}

exports.playSlots = async (req, res) => {
  try {
    const userId = req.user.id;
    const { betAmount } = req.body;
    const amt = parseFloat(betAmount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }

    const user = await User.findById(userId).populate('inventory.item');
    const luckBuffs = await getUserBuffs(user, ['slots-luck']);
    let guaranteedWin = false;
    if (luckBuffs.length) {
      const boost = luckBuffs.reduce((s, b) => s + b.effectValue, 0);
      if (Math.random() < boost / 100) guaranteedWin = true;
      await consumeOneShot(user, ['slots-luck']);
      await user.save();
    }

    const debitUser = await debitUserForBet(userId, amt, true);
    if (!debitUser) {
      return res.status(400).json({ message: 'Insufficient funds' });
    }
    user.balance = debitUser.balance;
    user.slotsPlays = (user.slotsPlays || 0) + 1;
    await user.save();

    let reel;
    if (guaranteedWin) {
      const winners = Object.entries(MULTIPLIERS)
        .filter(([, m]) => m > 0)
        .map(([s]) => s);
      const pick = winners[Math.floor(Math.random() * winners.length)];
      reel = [pick, pick, pick];
    } else {
      reel = Array.from({ length: 3 }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    }

    const counts = reel.reduce((a, s) => {
      a[s] = (a[s] || 0) + 1;
      return a;
    }, {});
    let win = false,
      payout = 0,
      comboName = null;
    for (let combo of SPECIAL_COMBOS) {
      if (matchesCombo(combo, reel) && (!combo.matchTwoOnly || Object.values(counts).includes(2))) {
        win = true;
        payout = Math.floor(amt * combo.multiplier);
        comboName = combo.name;
        break;
      }
    }
    if (!win) {
      for (let sym in counts) {
        if (counts[sym] === 3) {
          win = true;
          payout = Math.floor(amt * (MULTIPLIERS[sym] || 1));
          break;
        }
      }
    }
    if (!win) {
      for (let sym in counts) {
        if (counts[sym] === 2 && MULTIPLIERS[sym]) {
          win = true;
          payout = Math.floor(amt * ((MULTIPLIERS[sym] || 1) / 2));
          break;
        }
      }
    }

    let boostedProfit = 0;
    if (win && payout > 0) {
      const baseProfit = payout - amt;
      const mult = rewardMultiplier(user);
      boostedProfit = Math.round(baseProfit * (mult - 1));
      user.balance += payout + boostedProfit;
      user.gamblingWon = (user.gamblingWon || 0) + (baseProfit + boostedProfit);
      await consumeOneShot(user, ['reward-multiplier']);
      await user.save();
    } else if (!win) {
      user.gamblingLost = (user.gamblingLost || 0) + amt;
      await user.save();
    }

    return res.json({
      reel,
      win,
      payout,
      boostedProfit,
      combo: comboName,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Slots error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.getRPSInvites = async (req, res) => {
  try {
    const invites = await RPSChallenge.find({ to: req.user.id })
      .populate('from', 'username')
      .lean();

    const output = invites.map((inv) => ({
      _id: inv._id,
      fromUsername: inv.from.username,
      buyIn: inv.buyIn,
    }));

    return res.json(output);
  } catch (err) {
    console.error('RPS invites error:', err);
    return res.status(500).json({ message: 'Failed to load invites' });
  }
};

exports.getRPSStats = async (req, res) => {
  try {
    const prog = await GameProgress.findOne({ user: req.user.id }).lean();
    res.json({
      wins: prog?.rpsWins || 0,
      games: prog?.rpsGames || 0,
    });
  } catch (err) {
    console.error('RPS stats error:', err);
    res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.getRPSHistory = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    res.json(user.rpsHistory?.slice(-10).reverse() || []);
  } catch (err) {
    console.error('RPS history error:', err);
    res.status(500).json({ message: 'Failed to load history' });
  }
};

exports.getRPSBots = async (req, res) => {
  try {
    return res.json(
      RPS_BOTS.map((bot) => ({
        name: bot.name,
        title: bot.title,
        mood: bot.mood,
        quip: bot.quip,
      }))
    );
  } catch (err) {
    console.error('RPS bots error:', err);
    return res.status(500).json({ message: 'Failed to load bot roster' });
  }
};

exports.playRPS = async (req, res) => {
  try {
    const { opponentUsername, buyIn, userChoice } = req.body;
    const requestedOpponent = String(opponentUsername || '').trim();
    const buyInAmount = parseBet(buyIn);
    if (!requestedOpponent || !buyInAmount || !['rock', 'paper', 'scissors'].includes(userChoice)) {
      return res.status(400).json({ message: 'Invalid parameters' });
    }

    const challengerId = req.user.id;
    const bot = findRpsBot(requestedOpponent);
    const opponent = bot ? null : await findRpsOpponent(requestedOpponent);
    if (!bot && !opponent) {
      return res.status(400).json({ message: 'Opponent not found' });
    }
    if (opponent && String(opponent._id) === String(challengerId)) {
      return res.status(400).json({ message: 'You cannot challenge yourself' });
    }

    const opponentId = opponent?._id?.toString();

    if (bot) {
      const user = await debitUserForBet(challengerId, buyInAmount);
      if (!user) return res.status(400).json({ message: 'You have insufficient funds' });
      user.rpsPlays = (user.rpsPlays || 0) + 1;

      const botPick = getBotChoice(bot, userChoice);
      let winner = null;
      if (userChoice !== botPick) {
        if (RPS_BEATS[userChoice] === botPick) {
          winner = challengerId;
        } else {
          winner = bot.name;
        }
      }

      let payout = 0;
      if (winner === challengerId) {
        const pot = buyInAmount * 2;
        const mult = rewardMultiplier(user);
        const boosted = Math.round(pot * (mult - 1));
        user.balance += pot + boosted;
        user.gamblingWon = (user.gamblingWon || 0) + (pot + boosted - buyInAmount);
        user.rpsWins = (user.rpsWins || 0) + 1;
        await consumeOneShot(user, ['reward-multiplier']);
        payout = pot + boosted;
      } else if (winner === bot.name) {
        user.gamblingLost = (user.gamblingLost || 0) + buyInAmount;
      } else {
        user.balance += buyInAmount;
      }

      user.rpsHistory = user.rpsHistory || [];
      user.rpsHistory.push({
        opponent: bot.name,
        opponentType: 'bot',
        opponentMood: bot.mood,
        buyIn: buyInAmount,
        yourPick: userChoice,
        theirPick: botPick,
        outcome: winner === challengerId ? 'win' : winner === bot.name ? 'lose' : 'draw',
      });

      await user.save();

      await recordRpsMarketOutcome(bot.name, winner === challengerId);

      await GameProgress.findOneAndUpdate(
        { user: challengerId },
        { $inc: { rpsGames: 1, ...(winner === challengerId ? { rpsWins: 1 } : {}) } },
        { upsert: true }
      );

      return res.json({
        userPick: userChoice,
        oppPick: botPick,
        winner,
        opponent: bot.name,
        opponentType: 'bot',
        opponentMood: bot.mood,
        quip: bot.quip,
        payout,
        balance: {
          you: user.balance,
          opponent: null,
        },
      });
    }

    const invite = await RPSChallenge.findOne({
      from: opponent._id,
      to: challengerId,
    });

    if (invite) {
      const inviteBuyIn = parseBet(invite.buyIn);
      if (!inviteBuyIn) return res.status(400).json({ message: 'Invalid challenge buy-in' });

      const userDebit = await User.updateOne(
        { _id: challengerId, balance: { $gte: inviteBuyIn } },
        { $inc: { balance: -inviteBuyIn, rpsPlays: 1 } }
      );
      if (userDebit.modifiedCount !== 1)
        return res.status(400).json({ message: 'You have insufficient funds' });

      const oppDebit = await User.updateOne(
        { _id: opponent._id, balance: { $gte: inviteBuyIn } },
        { $inc: { balance: -inviteBuyIn, rpsPlays: 1 } }
      );
      if (oppDebit.modifiedCount !== 1) {
        await User.findByIdAndUpdate(challengerId, {
          $inc: { balance: inviteBuyIn, rpsPlays: -1 },
        });
        return res.status(400).json({ message: 'Opponent has insufficient funds' });
      }

      const [user, opp] = await Promise.all([
        User.findById(challengerId),
        User.findById(opponent._id),
      ]);

      const userPick = userChoice;
      const oppPick = invite.choice;
      let winner = null;
      if (userPick !== oppPick) {
        if (RPS_BEATS[userPick] === oppPick) {
          winner = challengerId;
        } else if (RPS_BEATS[oppPick] === userPick) {
          winner = opponentId;
        }
      }

      if (winner) {
        const pot = inviteBuyIn * 2;
        const winUser = winner === challengerId ? user : opp;
        const mult = rewardMultiplier(winUser);
        winUser.balance += Math.round(pot * mult);
        winUser.gamblingWon = (winUser.gamblingWon || 0) + (pot * mult - inviteBuyIn);
        await winUser.save();

        await GameProgress.findOneAndUpdate(
          { user: winner },
          { $inc: { rpsWins: 1 } },
          { upsert: true }
        );
      } else {
        user.balance += inviteBuyIn;
        opp.balance += inviteBuyIn;
        await Promise.all([user.save(), opp.save()]);
      }

      await GameProgress.updateMany(
        { user: { $in: [challengerId, opponent._id] } },
        { $inc: { rpsGames: 1 } }
      );

      const outcomeUser = winner ? (winner === challengerId ? 'win' : 'lose') : 'draw';
      const outcomeOpp = winner ? (winner === opponentId ? 'win' : 'lose') : 'draw';

      user.rpsHistory = user.rpsHistory || [];
      opp.rpsHistory = opp.rpsHistory || [];

      user.rpsHistory.push({
        opponent: opponent.username,
        opponentType: 'user',
        buyIn: inviteBuyIn,
        yourPick: userPick,
        theirPick: oppPick,
        outcome: outcomeUser,
      });

      opp.rpsHistory.push({
        opponent: user.username,
        opponentType: 'user',
        buyIn: inviteBuyIn,
        yourPick: oppPick,
        theirPick: userPick,
        outcome: outcomeOpp,
      });

      await Promise.all([user.save(), opp.save()]);
      await invite.deleteOne();

      return res.json({
        userPick,
        oppPick,
        winner,
        opponent: opponent.username,
        opponentType: 'user',
        balance: {
          you: user.balance,
          opponent: opp.balance,
        },
      });
    } else {
      await RPSChallenge.create({
        from: challengerId,
        to: opponent._id,
        buyIn: buyInAmount,
        choice: userChoice,
      });

      return res.json({
        message: `Challenge sent to ${opponent.username}. They have 5 minutes to accept by challenging you back.`,
      });
    }
  } catch (err) {
    console.error('RPS error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.getBlackjackState = async (req, res) => {
  try {
    const prog = await loadOrCreateProgress(req.user.id);
    res.json({ blackjack: formatBlackjackState(prog) });
  } catch (err) {
    console.error('Blackjack state error:', err);
    res.status(500).json({ message: 'Failed to load blackjack state' });
  }
};

exports.startBlackjack = async (req, res) => {
  try {
    const betAmount = Number(req.body.betAmount);
    if (!betAmount || betAmount <= 0) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }

    const prog = await loadOrCreateProgress(req.user.id);
    if (prog.blackjack?.active && !prog.blackjack?.finished) {
      return res.status(400).json({ message: 'Finish your current hand first' });
    }

    const user = await debitUserForBet(req.user.id, betAmount);
    if (!user) {
      return res.status(400).json({ message: 'Insufficient funds' });
    }

    prog.blackjack = {
      active: true,
      bet: betAmount,
      deck: createBlackjackDeck(),
      playerHand: [],
      dealerHand: [],
      finished: false,
      result: null,
    };

    prog.blackjack.playerHand.push(prog.blackjack.deck.pop(), prog.blackjack.deck.pop());
    prog.blackjack.dealerHand.push(prog.blackjack.deck.pop(), prog.blackjack.deck.pop());

    await resolveBlackjackIfNeeded(user, prog);
    if (!prog.blackjack.finished) {
      await Promise.all([user.save(), prog.save()]);
    }

    res.json({
      balance: user.balance,
      blackjack: formatBlackjackState(prog),
    });
  } catch (err) {
    console.error('Blackjack start error:', err);
    res.status(500).json({ message: 'Failed to start blackjack' });
  }
};

exports.hitBlackjack = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const prog = await loadOrCreateProgress(req.user.id);
    const game = prog.blackjack || {};

    if (!game.active || game.finished) {
      return res.status(400).json({ message: 'No active blackjack hand' });
    }

    game.playerHand.push(game.deck.pop());
    prog.blackjack = game;

    const playerTotal = scoreBlackjackHand(game.playerHand);
    if (playerTotal > 21) {
      await settleBlackjack(user, prog, 'dealer');
    } else {
      await prog.save();
    }

    res.json({
      balance: user.balance,
      blackjack: formatBlackjackState(prog),
    });
  } catch (err) {
    console.error('Blackjack hit error:', err);
    res.status(500).json({ message: 'Failed to hit' });
  }
};

exports.standBlackjack = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const prog = await loadOrCreateProgress(req.user.id);
    const game = prog.blackjack || {};

    if (!game.active || game.finished) {
      return res.status(400).json({ message: 'No active blackjack hand' });
    }

    while (scoreBlackjackHand(game.dealerHand) < 17 && game.deck.length > 0) {
      game.dealerHand.push(game.deck.pop());
    }

    const playerTotal = scoreBlackjackHand(game.playerHand);
    const dealerTotal = scoreBlackjackHand(game.dealerHand);

    if (dealerTotal > 21) {
      await settleBlackjack(user, prog, 'player');
    } else if (playerTotal > dealerTotal) {
      await settleBlackjack(user, prog, 'player');
    } else if (playerTotal < dealerTotal) {
      await settleBlackjack(user, prog, 'dealer');
    } else {
      await settleBlackjack(user, prog, 'push');
    }

    res.json({
      balance: user.balance,
      blackjack: formatBlackjackState(prog),
    });
  } catch (err) {
    console.error('Blackjack stand error:', err);
    res.status(500).json({ message: 'Failed to stand' });
  }
};

exports.playCrash = async (req, res) => {
  try {
    const bet = parseBet(req.body.betAmount);
    const cashout = Number(req.body.cashoutMultiplier);
    if (!bet || !Number.isFinite(cashout) || cashout < 1.05 || cashout > 25) {
      return res.status(400).json({ message: 'Invalid crash bet or cashout target' });
    }

    const user = await debitUserForBet(req.user.id, bet, true);
    if (!user) {
      return res.status(400).json({ message: 'Insufficient funds' });
    }

    user.casinoPlays = (user.casinoPlays || 0) + 1;

    const roll = Math.max(0.000001, Math.random());
    const crashPoint = Math.max(1, Math.min(50, Math.floor((0.97 / roll) * 100) / 100));
    const won = cashout <= crashPoint;
    let payout = 0;
    let tax = 0;

    if (won) {
      const gross = Math.floor(bet * cashout * rewardMultiplier(user));
      const taxed = taxedPayout(gross);
      payout = taxed.payout;
      tax = taxed.tax;
      user.balance += payout;
      user.casinoWins = (user.casinoWins || 0) + 1;
      user.gamblingWon = (user.gamblingWon || 0) + Math.max(0, payout - bet);
      await consumeOneShot(user, ['reward-multiplier']);
    } else {
      user.gamblingLost = (user.gamblingLost || 0) + bet;
    }

    await user.save();
    res.json({
      game: 'crash',
      won,
      bet,
      cashoutMultiplier: cashout,
      crashPoint,
      payout,
      tax,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Crash error:', err);
    res.status(500).json({ message: 'Crash failed' });
  }
};

exports.playHigherLower = async (req, res) => {
  try {
    const bet = parseBet(req.body.betAmount);
    const guess = String(req.body.guess || '').toLowerCase();
    if (!bet || !['higher', 'lower'].includes(guess)) {
      return res.status(400).json({ message: 'Invalid higher/lower bet' });
    }

    const user = await debitUserForBet(req.user.id, bet, true);
    if (!user) return res.status(400).json({ message: 'Insufficient funds' });

    user.casinoPlays = (user.casinoPlays || 0) + 1;
    const current = Math.floor(Math.random() * 13) + 1;
    let next = Math.floor(Math.random() * 13) + 1;
    while (next === current) next = Math.floor(Math.random() * 13) + 1;

    const won = guess === 'higher' ? next > current : next < current;
    let payout = 0;
    let tax = 0;
    if (won) {
      const edge = Math.abs(next - current);
      const gross = Math.floor(bet * (1.75 + edge * 0.04) * rewardMultiplier(user));
      const taxed = taxedPayout(gross);
      payout = taxed.payout;
      tax = taxed.tax;
      user.balance += payout;
      user.casinoWins = (user.casinoWins || 0) + 1;
      user.gamblingWon = (user.gamblingWon || 0) + Math.max(0, payout - bet);
      await consumeOneShot(user, ['reward-multiplier']);
    } else {
      user.gamblingLost = (user.gamblingLost || 0) + bet;
    }

    await user.save();
    res.json({
      game: 'higher-lower',
      current,
      next,
      guess,
      won,
      payout,
      tax,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Higher/lower error:', err);
    res.status(500).json({ message: 'Higher/lower failed' });
  }
};

exports.playDiceDuel = async (req, res) => {
  try {
    const bet = parseBet(req.body.betAmount);
    const target = Number(req.body.target);
    if (!bet || !Number.isInteger(target) || target < 2 || target > 12) {
      return res.status(400).json({ message: 'Pick a dice target from 2 to 12' });
    }

    const user = await debitUserForBet(req.user.id, bet, true);
    if (!user) return res.status(400).json({ message: 'Insufficient funds' });

    user.casinoPlays = (user.casinoPlays || 0) + 1;
    const dice = [Math.floor(Math.random() * 6) + 1, Math.floor(Math.random() * 6) + 1];
    const sum = dice[0] + dice[1];
    const ways = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
    const won = sum === target;
    let payout = 0;
    let tax = 0;

    if (won) {
      const fairMultiplier = 36 / ways[target];
      const gross = Math.floor(bet * fairMultiplier * 0.86 * rewardMultiplier(user));
      const taxed = taxedPayout(gross);
      payout = taxed.payout;
      tax = taxed.tax;
      user.balance += payout;
      user.casinoWins = (user.casinoWins || 0) + 1;
      user.gamblingWon = (user.gamblingWon || 0) + Math.max(0, payout - bet);
      await consumeOneShot(user, ['reward-multiplier']);
    } else {
      user.gamblingLost = (user.gamblingLost || 0) + bet;
    }

    await user.save();
    res.json({ game: 'dice-duel', dice, sum, target, won, payout, tax, balance: user.balance });
  } catch (err) {
    console.error('Dice duel error:', err);
    res.status(500).json({ message: 'Dice duel failed' });
  }
};

exports.playBotRace = async (req, res) => {
  try {
    const bet = parseBet(req.body.betAmount);
    const racer = String(req.body.racer || '').trim();
    const racers = ['ByteJackal', 'TurboCrane', 'GlassRook', 'EchoLynx', 'VantaDice', 'NeonLatch'];
    if (!bet || !racers.includes(racer)) {
      return res.status(400).json({ message: 'Invalid race pick' });
    }

    const user = await debitUserForBet(req.user.id, bet, true);
    if (!user) return res.status(400).json({ message: 'Insufficient funds' });

    user.casinoPlays = (user.casinoPlays || 0) + 1;
    const results = racers
      .map((name, index) => ({
        name,
        speed: Math.round(60 + Math.random() * 30 + (index % 3) * 3),
        clutch: Math.round(Math.random() * 20),
      }))
      .map((entry) => ({ ...entry, score: entry.speed + entry.clutch + Math.random() * 15 }))
      .sort((a, b) => b.score - a.score);

    const winner = results[0].name;
    const won = winner === racer;
    let payout = 0;
    let tax = 0;
    if (won) {
      const gross = Math.floor(bet * 4.8 * rewardMultiplier(user));
      const taxed = taxedPayout(gross);
      payout = taxed.payout;
      tax = taxed.tax;
      user.balance += payout;
      user.casinoWins = (user.casinoWins || 0) + 1;
      user.gamblingWon = (user.gamblingWon || 0) + Math.max(0, payout - bet);
      await consumeOneShot(user, ['reward-multiplier']);
    } else {
      user.gamblingLost = (user.gamblingLost || 0) + bet;
    }

    await user.save();
    res.json({ game: 'bot-race', racer, winner, results, won, payout, tax, balance: user.balance });
  } catch (err) {
    console.error('Bot race error:', err);
    res.status(500).json({ message: 'Bot race failed' });
  }
};

exports.getDailyArcade = async (req, res) => {
  try {
    const dateKey = todayKey();
    const seed = `${dateKey}:${req.user.id}`;
    const games = buildDailyArcade(seed);
    let prog = await GameProgress.findOne({ user: req.user.id });
    if (!prog) prog = await GameProgress.create({ user: req.user.id });

    const solvedSet = new Set(
      (prog.dailyArcadeSolved || [])
        .filter((entry) => entry.dateKey === dateKey)
        .map((entry) => entry.gameId)
    );

    res.json({
      dateKey,
      games: games.map((game) => publicDailyArcadeGame(game, solvedSet.has(game.id))),
    });
  } catch (err) {
    console.error('Daily arcade GET error:', err);
    res.status(500).json({ message: 'Failed to load daily arcade' });
  }
};

exports.solveDailyArcade = async (req, res) => {
  try {
    const gameId = String(req.body.gameId || '');
    const answer = req.body.answer;
    const dateKey = todayKey();
    const seed = `${dateKey}:${req.user.id}`;
    const game = buildDailyArcade(seed).find((entry) => entry.id === gameId);
    if (!game) {
      return res.status(404).json({ message: 'Daily challenge not found' });
    }

    let normalizedAnswer;
    if (Array.isArray(answer)) {
      normalizedAnswer = answer
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value))
        .sort((a, b) => a - b)
        .join(',');
    } else if (['coordinate', 'coordinate-list', 'binary'].includes(game.inputType)) {
      normalizedAnswer = String(answer || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
    } else {
      normalizedAnswer = String(answer || '')
        .trim()
        .toLowerCase();
    }

    const correct = normalizedAnswer === game.answer;
    if (!correct) {
      return res.status(400).json({ message: 'That answer is not correct yet', correct: false });
    }

    const reward = game.reward;
    const progressUpdate = await GameProgress.updateOne(
      {
        user: req.user.id,
        dailyArcadeSolved: {
          $not: {
            $elemMatch: { dateKey, gameId },
          },
        },
      },
      {
        $push: {
          dailyArcadeSolved: {
            dateKey,
            gameId,
            reward,
            solvedAt: new Date(),
          },
        },
      },
      { upsert: true }
    );

    if (progressUpdate.modifiedCount !== 1 && progressUpdate.upsertedCount !== 1) {
      return res.status(400).json({ message: 'You already solved that challenge today' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { balance: reward } },
      { new: true }
    );

    res.json({
      correct: true,
      gameId,
      reward,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Daily arcade solve error:', err);
    res.status(500).json({ message: 'Failed to solve daily challenge' });
  }
};

exports.getPuzzleRush = async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    let daily = await DailyPuzzle.findOne({ date: today }).lean();

    if (!daily) {
      const puzzles = [generateMatch3(), generateSliding(), generateMemory(), generateNQueens()];
      daily = await DailyPuzzle.create({ date: today, puzzles });
    }

    let prog = await GameProgress.findOne({ user: req.user.id });

    if (!prog) {
      prog = await GameProgress.create({ user: req.user.id });
    }

    const now = new Date();
    if (!prog.puzzleRushResetAt || now - prog.puzzleRushResetAt >= 24 * 3600 * 1000) {
      prog.puzzleRushResetAt = now;
      prog.puzzleRushTotal = 0;
      prog.puzzleRushSolved = [];
      await prog.save();
    }

    return res.json({
      puzzles: daily.puzzles.map(publicPuzzle),
      wins: prog.puzzleRushTotal,
      solved: prog.puzzleRushSolved,
      resetAt: prog.puzzleRushResetAt.toISOString(),
      streak: prog.puzzleRushStreak || { current: 0, best: 0, lastReward: 0 },
    });
  } catch (err) {
    console.error('PuzzleRush GET error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.playPuzzleRush = async (req, res) => {
  try {
    const { puzzleId, answer } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    const daily = await DailyPuzzle.findOne({ date: today }).lean();
    if (!daily) {
      return res.status(500).json({ message: 'Daily puzzles not initialized' });
    }
    const puzzle = daily.puzzles.find((p) => p.id === puzzleId);
    if (!puzzle) {
      return res.status(404).json({ message: 'Puzzle not found' });
    }

    let prog = await GameProgress.findOne({ user: req.user.id });
    if (!prog) {
      prog = await GameProgress.create({
        user: req.user.id,
        puzzleRushTotal: 0,
        puzzleRushSolved: [],
        puzzleRushResetAt: Date.now(),
      });
    }

    const now = Date.now();
    if (!prog.puzzleRushResetAt || now - prog.puzzleRushResetAt >= 24 * 3600 * 1000) {
      prog.puzzleRushTotal = 0;
      prog.puzzleRushSolved = [];
      prog.puzzleRushResetAt = now;
      await prog.save();
    }

    if (prog.puzzleRushSolved.includes(puzzleId)) {
      return res.status(400).json({ message: 'You already solved that puzzle today' });
    }

    let correct = false;

    if (puzzle.type === 'match-3') {
      const result = validateMatch3Moves(puzzle, answer?.moves);
      if (!result.correct && result.message) {
        return res.status(400).json({ message: result.message });
      }
      correct = result.correct;
    } else if (puzzle.type === 'sliding') {
      const finalBoard = applySlidingMoves(puzzle.question.board, answer?.moves);
      correct =
        JSON.stringify(finalBoard) ===
        JSON.stringify([
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 0],
        ]);
    } else if (puzzle.type === 'memory') {
      correct = validateMemoryPairs(puzzle.question.board, answer?.pairs);
    } else if (puzzle.type === 'n-queens') {
      const queens = answer.positions;
      const regions = puzzle.question.regions;
      const N = 8;
      if (!Array.isArray(queens) || queens.length !== N) {
        return res.status(400).json({ message: 'Must place exactly 8 queens.' });
      }
      const rowSet = new Set(),
        colSet = new Set(),
        regionSet = new Set();
      for (const [r, c] of queens) {
        if (r < 0 || r >= N || c < 0 || c >= N) {
          return res.status(400).json({ message: `Invalid queen position: (${r}, ${c})` });
        }
        if (rowSet.has(r))
          return res.status(400).json({ message: `More than one queen in row ${r + 1}` });
        if (colSet.has(c))
          return res.status(400).json({ message: `More than one queen in column ${c + 1}` });
        for (const [r2, c2] of queens) {
          if ((r !== r2 || c !== c2) && Math.abs(r - r2) === 1 && Math.abs(c - c2) === 1) {
            return res.status(400).json({
              message: `Diagonal conflict between (${r + 1},${c + 1}) and (${r2 + 1},${c2 + 1})`,
            });
          }
        }
        const reg = regions[r]?.[c];
        if (reg != null && regionSet.has(reg)) {
          return res.status(400).json({ message: `More than one queen in region ${reg + 1}` });
        }
        rowSet.add(r);
        colSet.add(c);
        if (reg != null) regionSet.add(reg);
      }
      if (rowSet.size === N && colSet.size === N && regionSet.size === N) {
        correct = true;
      }
    } else {
      return res.status(400).json({ message: 'Unsupported puzzle type' });
    }

    if (!correct) {
      return res.status(400).json({ message: 'Incorrect solution' });
    }

    const baseReward = puzzle.type === 'logic-grid' ? 2000 : 250;
    const session = await mongoose.startSession();
    let reward;
    let streakUpdate;
    let updatedProg;
    let userDoc;
    try {
      await session.withTransaction(async () => {
        const currentProg = await GameProgress.findOne({ user: req.user.id }).session(session);
        if (!currentProg || currentProg.puzzleRushSolved.includes(puzzleId)) {
          const error = new Error('You already solved that puzzle today');
          error.status = 409;
          throw error;
        }

        const firstSolveToday = currentProg.puzzleRushSolved.length === 0;
        streakUpdate = firstSolveToday
          ? nextPuzzleStreak(currentProg.puzzleRushStreak, today)
          : { ...(currentProg.puzzleRushStreak || {}), bonus: 0 };
        reward = baseReward + (streakUpdate.bonus || 0);

        currentProg.puzzleRushTotal += 1;
        currentProg.puzzleRushSolved.push(puzzleId);
        if (firstSolveToday) {
          currentProg.puzzleRushStreak = {
            current: streakUpdate.current,
            best: streakUpdate.best,
            lastSolvedDate: streakUpdate.lastSolvedDate,
            lastReward: streakUpdate.lastReward,
          };
        }
        await currentProg.save({ session });
        userDoc = await User.findByIdAndUpdate(
          req.user.id,
          { $inc: { balance: reward, puzzleSolves: 1 } },
          { new: true, session }
        );
        updatedProg = currentProg.toObject();
      });
    } finally {
      await session.endSession();
    }
    return res.json({
      reward,
      baseReward,
      streakBonus: streakUpdate.bonus || 0,
      streak: updatedProg.puzzleRushStreak || { current: 0, best: 0, lastReward: 0 },
      wins: updatedProg.puzzleRushTotal,
      solved: updatedProg.puzzleRushSolved,
      resetAt: updatedProg.puzzleRushResetAt.toISOString(),
      balance: userDoc.balance,
    });
  } catch (err) {
    console.error('PuzzleRush POST error:', err);
    return res
      .status(err.status || 500)
      .json({ message: err.status ? err.message : 'Something went wrong' });
  }
};

exports.getLeaderboard = async (req, res) => {
  try {
    const [topRps, topPuzzle] = await Promise.all([
      GameProgress.find().sort({ rpsWins: -1 }).limit(10).populate('user', 'username').lean(),
      GameProgress.find()
        .sort({ puzzleRushTotal: -1 })
        .limit(10)
        .populate('user', 'username')
        .lean(),
    ]);

    return res.json({
      rps: topRps
        .filter((p) => p.user && p.user.username)
        .map((p) => ({
          username: p.user.username,
          wins: p.rpsWins,
          games: p.rpsGames,
        })),
      puzzleRush: topPuzzle
        .filter((p) => p.user && p.user.username)
        .map((p) => ({
          username: p.user.username,
          wins: p.puzzleRushTotal,
        })),
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

exports.__test = {
  MATCH3_TARGET,
  findMatch3Cells,
  generateDeterministicMatch3Board,
  hasMatch3Move,
  nextPuzzleStreak,
  resolveMatch3,
  swapMatch3,
  validateMatch3Moves,
};
