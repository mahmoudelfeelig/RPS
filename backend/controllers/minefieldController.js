const MinefieldSession = require('../models/MinefieldSession');
const User = require('../models/User');
const rewardMultiplier = require('../utils/rewardMultiplier');
const { getUserBuffs, consumeOneShot } = require('../utils/applyEffects');
const { positiveInt, positiveMoney } = require('../utils/inputValidation');
const mongoose = require('mongoose');

function validateParameters(rows, cols, mines) {
  if (rows < 3 || cols < 3) return 'Grid must be at least 3×3';
  const total = rows * cols;
  if (mines < 2) return 'Need at least 2 mines';
  if (mines >= total) return 'Too many mines for this grid';
  return null;
}

function oddsMultiplier(safeCount, mines, totalCells) {
  let mult = 1;
  let remainingCells = totalCells;
  const remainingMines = mines;
  const dampening = 0.6;

  for (let i = 0; i < safeCount; i++) {
    const safeCells = remainingCells - remainingMines;
    if (safeCells <= 0) break;
    const trueOdds = remainingCells / safeCells;
    const effOdds = 1 + dampening * (trueOdds - 1);
    mult *= effOdds;
    remainingCells -= 1;
  }
  return mult;
}

exports.startRound = async (req, res) => {
  const transaction = await mongoose.startSession();
  try {
    const userId = req.user.id;
    let { betAmount, rows, cols, mines } = req.body;
    betAmount = positiveMoney(betAmount, { min: 1, max: 100000 });
    rows = positiveInt(rows, { min: 3, max: 12 });
    cols = positiveInt(cols, { min: 3, max: 12 });
    mines = positiveInt(mines, { min: 2, max: 120 });

    if (rows == null || cols == null || mines == null) {
      return res.status(400).json({ message: 'Must supply rows, cols, and mines' });
    }
    if (!betAmount) {
      return res.status(400).json({ message: 'Invalid bet amount' });
    }
    const paramError = validateParameters(rows, cols, mines);
    if (paramError) return res.status(400).json({ message: paramError });

    let user;
    let session;
    let mineReduction;
    let extraSafeClicks;
    await transaction.withTransaction(async () => {
      const prev = await MinefieldSession.findOne({ user: userId, ended: false }).session(
        transaction
      );
      user = await User.findById(userId).populate('inventory.item').session(transaction);
      if (!user || user.balance < betAmount) {
        const error = new Error('Insufficient funds');
        error.status = 400;
        throw error;
      }

      if (prev) {
        prev.ended = true;
        prev.cashedOut = true;
        user.balance += prev.betAmount;
        await prev.save({ session: transaction });
      }

      const buffs = getUserBuffs(user, ['extra-safe-click', 'mine-reduction']);
      mineReduction = buffs
        .filter((b) => b.effectType === 'mine-reduction')
        .reduce((sum, b) => sum + b.effectValue, 0);
      extraSafeClicks = buffs
        .filter((b) => b.effectType === 'extra-safe-click')
        .reduce((sum, b) => sum + b.effectValue, 0);

      let finalMines = mines - mineReduction;
      const minExplodable = 2;
      if (finalMines < extraSafeClicks + minExplodable) {
        finalMines = extraSafeClicks + minExplodable;
      }

      await consumeOneShot(user, ['extra-safe-click', 'mine-reduction'], transaction);
      user.balance -= betAmount;
      user.minefieldPlays = (user.minefieldPlays || 0) + 1;
      await user.save({ session: transaction });

      session = await MinefieldSession.createNew(
        {
          user: userId,
          rows,
          cols,
          mines: finalMines,
          betAmount,
          extraSafeClicks,
          originalMines: mines,
        },
        { session: transaction }
      );
    });

    return res.json({
      sessionId: session._id,
      rows: session.rows,
      cols: session.cols,
      minesCount: session.mines.length,
      extraSafeClicks,
      mineReduction,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Minefield start error:', err);
    if (err?.code === 11000) {
      return res
        .status(409)
        .json({ message: 'Another round started at the same time. Try again.' });
    }
    return res
      .status(err.status || 500)
      .json({ message: err.status ? err.message : 'Could not start minefield round' });
  } finally {
    await transaction.endSession();
  }
};

exports.revealCell = async (req, res) => {
  const { sessionId } = req.body;
  const cellIndex = positiveInt(req.body.cellIndex, { min: 0, max: 10000 });

  try {
    const session = await MinefieldSession.findById(sessionId);
    if (!session || session.user.toString() !== req.user.id)
      return res.status(404).json({ message: 'Session not found' });
    if (session.ended) return res.status(400).json({ message: 'Round already ended' });
    if (cellIndex == null || cellIndex >= session.rows * session.cols) {
      return res.status(400).json({ message: 'Cell is outside the board' });
    }
    if (session.revealedCells.includes(cellIndex))
      return res.status(400).json({ message: 'Cell already revealed' });

    session.revealedCells.push(cellIndex);

    if (session.mines.includes(cellIndex)) {
      if (session.extraSafeClicks > 0) {
        session.extraSafeClicks -= 1;
        await session.save();
      } else {
        session.ended = true;
        session.exploded = true;
        await session.save();

        const loser = await User.findById(req.user.id);
        loser.gamblingLost = (loser.gamblingLost || 0) + session.betAmount;
        await loser.save();

        return res.json({ exploded: true, mines: session.mines });
      }
    }

    session.safeCount += 1;
    await session.save();

    const mult = oddsMultiplier(
      session.safeCount,
      session.originalMines,
      session.rows * session.cols
    );
    const baseReward = Math.floor(session.betAmount * mult);

    const user = await User.findById(req.user.id).populate('inventory.item');
    const totalMult = rewardMultiplier(user);
    const profit = Math.max(0, baseReward - session.betAmount);
    const bonus = Math.round(profit * (totalMult - 1));
    const potentialReward = baseReward + bonus;

    return res.json({
      exploded: false,
      safeCount: session.safeCount,
      potentialReward,
      extraSafeClicks: session.extraSafeClicks,
    });
  } catch (err) {
    console.error('Reveal cell error:', err);
    return res.status(500).json({ message: 'Could not reveal cell' });
  }
};

exports.cashOut = async (req, res) => {
  const { sessionId } = req.body;
  const transaction = await mongoose.startSession();

  try {
    let user;
    let totalPayout;
    await transaction.withTransaction(async () => {
      const session = await MinefieldSession.findOneAndUpdate(
        {
          _id: sessionId,
          user: req.user.id,
          ended: false,
          safeCount: { $gt: 0 },
        },
        { $set: { ended: true, cashedOut: true } },
        { new: true, session: transaction }
      );
      if (!session) {
        const error = new Error('Session not found, already ended, or has no safe reveals');
        error.status = 409;
        throw error;
      }

      const mult = oddsMultiplier(
        session.safeCount,
        session.originalMines,
        session.rows * session.cols
      );
      const baseReward = Math.floor(session.betAmount * mult);

      user = await User.findById(req.user.id).populate('inventory.item').session(transaction);
      const profit = baseReward - session.betAmount;
      const bonus = Math.round(profit * (rewardMultiplier(user) - 1));
      totalPayout = baseReward + bonus;

      user.minefieldWins = (user.minefieldWins || 0) + 1;
      const net = totalPayout - session.betAmount;
      if (net >= 0) {
        user.gamblingWon = (user.gamblingWon || 0) + net;
      } else {
        user.gamblingLost = (user.gamblingLost || 0) + -net;
      }

      await consumeOneShot(user, ['reward-multiplier'], transaction);
      user.balance += totalPayout;
      await user.save({ session: transaction });
    });

    return res.json({ reward: totalPayout, balance: user.balance });
  } catch (err) {
    console.error('Cash out error:', err);
    return res
      .status(err.status || 500)
      .json({ message: err.status ? err.message : 'Could not cash out' });
  } finally {
    await transaction.endSession();
  }
};
