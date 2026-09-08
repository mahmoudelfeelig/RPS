const mongoose = require('mongoose');
const { Schema } = mongoose;

function generateMines(rows, cols, mines) {
  const total = rows * cols;
  const picks = new Set();
  while (picks.size < mines) {
    picks.add(Math.floor(Math.random() * total));
  }
  return Array.from(picks);
}

const minefieldSessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rows: { type: Number, required: true, min: 3 },
    cols: { type: Number, required: true, min: 3 },
    mines: { type: [Number], required: true },
    extraSafeClicks: { type: Number, default: 0 },
    originalMines: { type: Number, required: true },
    revealedCells: { type: [Number], default: [] },
    safeCount: { type: Number, default: 0 },
    betAmount: { type: Number, default: 0 },
    ended: { type: Boolean, default: false },
    exploded: { type: Boolean, default: false },
    cashedOut: { type: Boolean, default: false },
  },
  { timestamps: true }
);

minefieldSessionSchema.statics.createNew = function (
  { user, rows, cols, mines, betAmount, extraSafeClicks, originalMines },
  options = {}
) {
  return this.create(
    [
      {
        user,
        rows,
        cols,
        mines: generateMines(rows, cols, mines),
        betAmount,
        extraSafeClicks,
        originalMines,
      },
    ],
    options
  ).then(([session]) => session);
};

module.exports = mongoose.model('MinefieldSession', minefieldSessionSchema);
