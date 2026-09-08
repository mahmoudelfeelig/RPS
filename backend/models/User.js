const mongoose = require('mongoose');

const { Schema } = mongoose;

const ROLES = ['user', 'admin', 'game-master', 'global-admin'];
const USER_STATUSES = ['active', 'inactive', 'banned'];
const MARKET_CATEGORIES = ['stock', 'crypto', 'option', 'rps-member'];
const GAME_KEYS = [
  'casino',
  'spinner',
  'minefield',
  'mystery-box',
  'gacha',
  'click-frenzy',
  'rps',
  'idle-ngu',
  'market',
  'puzzle-rush',
  'daily-arcade',
  'merge-lab',
  'virtual-pet',
  'critters',
  'factory-tycoon',
  'quiz-duel',
];

const nonNegativeNumber = { type: Number, default: 0, min: 0 };

const botProfileSchema = new Schema(
  {
    archetype: { type: String, default: '' },
    risk: { type: Number, default: 0.5, min: 0, max: 1 },
    activity: { type: Number, default: 0.5, min: 0, max: 1 },
    spending: { type: Number, default: 0.5, min: 0, max: 1 },
    lastSimulatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const inventoryEntrySchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'StoreItem' },
    quantity: { type: Number, default: 1, min: 0 },
  },
  { _id: false }
);

const activeEffectSchema = new Schema(
  {
    effectType: { type: String, default: '' },
    effectValue: { type: Number, default: 0 },
    sourceItem: { type: Schema.Types.ObjectId, ref: 'StoreItem' },
    sourceName: { type: String, default: '' },
    consumable: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },
    activatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const purchaseHistorySchema = new Schema(
  {
    item: { type: Schema.Types.ObjectId, ref: 'StoreItem' },
    purchasedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const parlaySchema = new Schema(
  {
    bets: [
      {
        betId: { type: Schema.Types.ObjectId, ref: 'Bet' },
        choice: String,
      },
    ],
    amount: { type: Number, min: 0 },
    totalOdds: { type: Number, min: 0 },
    placedAt: { type: Date, default: Date.now },
    won: { type: Boolean, default: null },
  },
  { _id: false }
);

const badgeSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    earnedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const transactionSchema = new Schema(
  {
    type: { type: String, enum: ['send', 'receive', 'trade'], required: true },
    amount: { type: Number, min: 0 },
    from: { type: Schema.Types.ObjectId, ref: 'User' },
    to: { type: Schema.Types.ObjectId, ref: 'User' },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const portfolioPositionSchema = new Schema(
  {
    symbol: { type: String, required: true },
    name: { type: String, default: '' },
    category: { type: String, enum: MARKET_CATEGORIES, required: true },
    quantity: { type: Number, default: 0, min: 0 },
    avgPrice: { type: Number, default: 0, min: 0 },
    dividendYield: { type: Number, default: 0, min: 0 },
    lastDividendAt: { type: Date, default: null },
    acquiredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const gameStateSchema = new Schema(
  {
    unlocked: [
      {
        type: String,
        enum: GAME_KEYS,
      },
    ],
    lastSpinDate: { type: Date },
    nguLevel: { type: Number, default: 1, min: 1 },
    nguRate: { type: Number, default: 1, min: 0 },
    lastClickFrenzy: { type: Date },
  },
  { _id: false }
);

const rpsHistorySchema = new Schema(
  {
    opponent: { type: String, default: '' },
    opponentType: { type: String, enum: ['user', 'bot'], default: 'user' },
    opponentMood: { type: String, default: '' },
    buyIn: { type: Number, min: 0 },
    yourPick: { type: String, enum: ['rock', 'paper', 'scissors'] },
    theirPick: { type: String, enum: ['rock', 'paper', 'scissors'] },
    outcome: { type: String, enum: ['win', 'lose', 'draw'] },
    playedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, index: true },
    email: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    password: { type: String, required: true, select: false },
    tokenVersion: { type: Number, default: 0, min: 0, select: false },
    role: { type: String, enum: ROLES, default: 'user', index: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', index: true },

    isBot: { type: Boolean, default: false, index: true },
    botProfile: { type: botProfileSchema, default: () => ({}) },

    balance: { type: Number, default: 0, min: 0 },
    profileImage: { type: String, default: '/assets/avatars/default-avatar.png' },
    publicProfileCreated: { type: Boolean, default: false },
    starterCritterAdoptedAt: { type: Date, default: null },

    emailVerified: { type: Boolean, default: false, index: true },
    emailVerificationCode: { type: String, default: null, select: false },
    emailVerificationToken: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null },
    passwordResetCode: { type: String, default: null, select: false },
    passwordResetToken: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null },

    prestigeLevel: nonNegativeNumber,
    prestigeResets: nonNegativeNumber,
    prestigeMultiplier: { type: Number, default: 1, min: 1 },
    lastPrestigeAt: { type: Date, default: null },

    inventory: { type: [inventoryEntrySchema], default: [] },
    activeEffects: { type: [activeEffectSchema], default: [] },
    purchaseHistory: { type: [purchaseHistorySchema], default: [] },

    currentBets: { type: [{ type: Schema.Types.ObjectId, ref: 'Bet' }], default: [] },
    parlays: { type: [parlaySchema], default: [] },

    betsPlaced: nonNegativeNumber,
    betsWon: nonNegativeNumber,
    loginCount: { type: Number, default: 1, min: 0 },
    lastLoginDate: { type: Date },
    storePurchases: nonNegativeNumber,
    marketTrades: nonNegativeNumber,
    dividendsClaimed: nonNegativeNumber,
    tasksCompleted: nonNegativeNumber,
    minefieldPlays: nonNegativeNumber,
    minefieldWins: nonNegativeNumber,
    puzzleSolves: nonNegativeNumber,
    clickFrenzyClicks: nonNegativeNumber,
    casinoPlays: nonNegativeNumber,
    casinoWins: nonNegativeNumber,
    rpsPlays: nonNegativeNumber,
    rpsWins: nonNegativeNumber,
    slotsPlays: nonNegativeNumber,
    slotsWins: nonNegativeNumber,
    gamblingWon: nonNegativeNumber,
    gamblingLost: nonNegativeNumber,

    achievements: { type: [{ type: Schema.Types.ObjectId, ref: 'Achievement' }], default: [] },
    badges: { type: [badgeSchema], default: [] },
    transactionHistory: { type: [transactionSchema], default: [] },
    portfolio: { type: [portfolioPositionSchema], default: [] },
    games: { type: gameStateSchema, default: () => ({}) },
    rpsHistory: { type: [rpsHistorySchema], default: [] },
  },
  { timestamps: true }
);

userSchema.index({ balance: -1 });
userSchema.index({ 'portfolio.symbol': 1 });
userSchema.index({ updatedAt: -1 });
userSchema.index({ 'botProfile.lastSimulatedAt': 1 });

module.exports = mongoose.model('User', userSchema);
