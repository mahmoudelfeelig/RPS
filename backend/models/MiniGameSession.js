const mongoose = require('mongoose');

const miniGameSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    critter: { type: mongoose.Schema.Types.ObjectId, ref: 'Critter', required: true },
    game: {
      type: String,
      enum: ['coin-catcher', 'critter-match', 'dodge-n-dash'],
      required: true,
    },
    active: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

miniGameSessionSchema.index(
  { user: 1, critter: 1, game: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
miniGameSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('MiniGameSession', miniGameSessionSchema);
