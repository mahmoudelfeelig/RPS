const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const User = require('../models/User');
const GameProgress = require('../models/GameProgress');
const StoreItem = require('../models/StoreItem');
const MarketAsset = require('../models/MarketAsset');
const ECONOMY_BOTS = require('../config/economyBots');
const RPS_BOTS = require('../config/rpsBots');
const checkAndAwardBadges = require('../utils/checkAndAwardBadges');
const checkAndAwardAchievements = require('../utils/checkAndAwardAchievements');
const { recordRpsMarketOutcome } = require('../controllers/marketController');

const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const chance = (probability) => Math.random() < probability;
const pick = (values) => values[Math.floor(Math.random() * values.length)];

function weightedPick(weights = {}) {
  const entries = Object.entries(weights).filter(([, weight]) => Number(weight) > 0);
  const total = entries.reduce((sum, [, weight]) => sum + Number(weight), 0);
  if (!entries.length || total <= 0) return pick(RPS_CHOICES);

  let roll = Math.random() * total;
  for (const [value, weight] of entries) {
    roll -= Number(weight);
    if (roll <= 0) return value;
  }
  return entries[0][0];
}

function resolveRps(yourPick, theirPick) {
  if (yourPick === theirPick) return 'draw';
  return RPS_BEATS[yourPick] === theirPick ? 'win' : 'lose';
}

function portfolioValue(user, assetMap) {
  return (user.portfolio || []).reduce((sum, position) => {
    const asset = assetMap.get(position.symbol);
    return sum + (asset ? asset.currentPrice * position.quantity : 0);
  }, 0);
}

async function ensureEconomyBots() {
  const password = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);

  for (const bot of ECONOMY_BOTS) {
    const existing = await User.findOne({ username: bot.username });
    if (existing && !existing.isBot) continue;

    if (!existing) {
      await User.create({
        username: bot.username,
        email: `${bot.username.toLowerCase()}@bots.rps.local`,
        password,
        balance: Math.round(3500 + bot.activity * 9000 + bot.risk * 4000),
        profileImage: '/assets/avatars/default-avatar.png',
        publicProfileCreated: true,
        emailVerified: true,
        isBot: true,
        botProfile: {
          archetype: bot.archetype,
          risk: bot.risk,
          activity: bot.activity,
          spending: bot.spending,
        },
        games: {
          unlocked: ['casino', 'minefield', 'click-frenzy', 'rps', 'puzzle-rush'],
          nguLevel: 1,
          nguRate: 1,
        },
      });
      continue;
    }

    existing.status = 'active';
    existing.botProfile = {
      archetype: bot.archetype,
      risk: bot.risk,
      activity: bot.activity,
      spending: bot.spending,
      lastSimulatedAt: existing.botProfile?.lastSimulatedAt || null,
    };
    await existing.save();
  }
}

function simulateEarnings(user, bot) {
  const base = 50 + Math.round(bot.activity * 190);
  const streakBonus = chance(0.18) ? Math.round(100 + bot.activity * 400) : 0;
  user.balance += Math.round((base + streakBonus) * (user.prestigeMultiplier || 1));
  user.clickFrenzyClicks += Math.round(2 + bot.activity * 12 + Math.random() * 10);
  user.puzzleSolves += chance(0.35 + bot.activity * 0.25) ? 1 : 0;
}

async function simulateStore(user, bot, storeItems) {
  if (!storeItems.length || !chance(0.12 + bot.spending * 0.28)) return;

  const affordable = storeItems
    .filter(
      (item) =>
        item.stock > 0 && item.price <= user.balance * clamp(0.08 + bot.spending * 0.28, 0.08, 0.38)
    )
    .sort((a, b) => b.price - a.price);

  const item = affordable[0] || null;
  if (!item) return;

  user.balance -= item.price;
  user.storePurchases += 1;
  user.inventory = user.inventory || [];
  const existing = user.inventory.find((slot) => String(slot.item) === String(item._id));
  if (existing) {
    existing.quantity += 1;
  } else {
    user.inventory.push({ item: item._id, quantity: 1 });
  }
  user.purchaseHistory.push({ item: item._id, purchasedAt: new Date() });

  item.stock = Math.max(0, item.stock - 1);
  await item.save();
}

async function simulateMarkets(user, bot, assets, assetMap) {
  if (!assets.length) return;
  user.portfolio = user.portfolio || [];

  const currentValue = portfolioValue(user, assetMap);
  const maxExposure = Math.max(1500, user.balance * (0.18 + bot.risk * 0.38));

  if (user.balance > 600 && currentValue < maxExposure && chance(0.32 + bot.activity * 0.26)) {
    const preferred = assets.filter((asset) => bot.marketBias.includes(asset.category));
    const asset = pick(preferred.length ? preferred : assets);
    const budget = user.balance * clamp(0.05 + bot.risk * 0.12, 0.04, 0.2);
    const quantity = Math.max(1, Math.floor(budget / asset.currentPrice));
    const cost = quantity * asset.currentPrice;

    if (quantity > 0 && cost <= user.balance) {
      const position = user.portfolio.find((pos) => pos.symbol === asset.symbol);
      if (position) {
        const totalQuantity = position.quantity + quantity;
        position.avgPrice = (position.avgPrice * position.quantity + cost) / totalQuantity;
        position.quantity = totalQuantity;
        position.dividendYield = asset.dividendYield;
      } else {
        user.portfolio.push({
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
          quantity,
          avgPrice: asset.currentPrice,
          dividendYield: asset.dividendYield,
          lastDividendAt: null,
        });
      }
      user.balance -= cost;
      user.marketTrades += 1;
      asset.volume += quantity;
      await asset.save();
    }
  }

  if (user.portfolio.length && chance(0.08 + bot.risk * 0.14)) {
    const position = pick(user.portfolio);
    const asset = assetMap.get(position.symbol);
    if (asset) {
      const quantity = Math.max(1, Math.ceil(position.quantity * (0.2 + Math.random() * 0.4)));
      const sold = Math.min(quantity, position.quantity);
      position.quantity -= sold;
      user.balance += sold * asset.currentPrice;
      user.marketTrades += 1;
      asset.volume += sold;
      await asset.save();
      user.portfolio = user.portfolio.filter((pos) => pos.quantity > 0);
    }
  }

  if (user.portfolio.length && chance(0.08)) {
    let dividends = 0;
    for (const position of user.portfolio) {
      const asset = assetMap.get(position.symbol);
      if (!asset?.dividendYield) continue;
      const base = position.quantity * asset.currentPrice * asset.dividendYield;
      dividends += Math.round(base * (user.prestigeMultiplier || 1));
      position.lastDividendAt = new Date();
    }
    if (dividends > 0) {
      user.balance += dividends;
      user.dividendsClaimed += dividends;
    }
  }
}

async function simulateGames(user, bot, rpsAssets) {
  const plays = Math.max(1, Math.round(1 + bot.activity * 5));

  for (let i = 0; i < plays; i += 1) {
    const game = pick(bot.gameBias);
    const stake = Math.max(
      25,
      Math.round(40 + user.balance * clamp(0.004 + bot.risk * 0.006, 0.004, 0.012))
    );

    if (game === 'rps') {
      const opponent = pick(RPS_BOTS);
      const yourPick = weightedPick(opponent.bias);
      const theirPick = pick(RPS_CHOICES);
      const outcome = resolveRps(yourPick, theirPick);
      user.rpsPlays += 1;

      if (outcome === 'win') {
        user.rpsWins += 1;
        user.balance += stake;
        user.gamblingWon += stake;
      } else if (outcome === 'lose') {
        user.balance = Math.max(0, user.balance - stake);
        user.gamblingLost += stake;
      }

      user.rpsHistory.push({
        opponent: opponent.name,
        opponentType: 'bot',
        opponentMood: opponent.mood,
        buyIn: stake,
        yourPick,
        theirPick,
        outcome,
      });
      user.rpsHistory = user.rpsHistory.slice(-30);

      if (rpsAssets.length && outcome !== 'draw') {
        const member = pick(rpsAssets);
        await recordRpsMarketOutcome(member.linkedTo || member.name, outcome === 'win');
      }
    }

    if (game === 'blackjack' || game === 'slots') {
      const winRate = game === 'blackjack' ? 0.46 + bot.risk * 0.04 : 0.36 + bot.risk * 0.03;
      const won = chance(winRate);
      user.casinoPlays += 1;
      if (game === 'slots') user.slotsPlays += 1;

      if (won) {
        const payout = Math.round(stake * (game === 'slots' ? 2.2 : 1.4));
        user.casinoWins += 1;
        if (game === 'slots') user.slotsWins += 1;
        user.balance += payout;
        user.gamblingWon += payout;
      } else {
        user.balance = Math.max(0, user.balance - stake);
        user.gamblingLost += stake;
      }
    }

    if (game === 'minefield') {
      const won = chance(0.42 - bot.risk * 0.08);
      user.minefieldPlays += 1;
      if (won) {
        const payout = Math.round(stake * (1.6 + bot.risk));
        user.minefieldWins += 1;
        user.balance += payout;
        user.gamblingWon += payout;
      } else {
        user.balance = Math.max(0, user.balance - stake);
        user.gamblingLost += stake;
      }
    }
  }
}

async function runBotSimulation() {
  if (process.env.BOT_SIMULATION_ENABLED !== 'true' || process.env.ECONOMY_BOTS_ENABLED !== 'true')
    return;

  await ensureEconomyBots();

  const [bots, storeItems, assets] = await Promise.all([
    User.find({ isBot: true, status: 'active' }),
    StoreItem.find({ active: true, stock: { $gt: 0 } }).sort({ price: 1 }),
    MarketAsset.find({ active: { $ne: false } }),
  ]);

  if (!bots.length) return;

  const assetMap = new Map(assets.map((asset) => [asset.symbol, asset]));
  const rpsAssets = assets.filter((asset) => asset.category === 'rps-member');

  for (const user of bots) {
    const bot =
      ECONOMY_BOTS.find((profile) => profile.username === user.username) || ECONOMY_BOTS[0];
    simulateEarnings(user, bot);
    await simulateMarkets(user, bot, assets, assetMap);
    await simulateStore(user, bot, storeItems);
    await simulateGames(user, bot, rpsAssets);

    user.botProfile = {
      archetype: bot.archetype,
      risk: bot.risk,
      activity: bot.activity,
      spending: bot.spending,
      lastSimulatedAt: new Date(),
    };

    await user.save();
    await GameProgress.findOneAndUpdate(
      { user: user._id },
      {
        $set: {
          rpsWins: user.rpsWins || 0,
          rpsGames: user.rpsPlays || 0,
          puzzleRushTotal: user.puzzleSolves || 0,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
    await checkAndAwardBadges(user._id);
    await checkAndAwardAchievements(user._id);
  }

  console.log(
    `[${new Date().toISOString()}] Economy bot simulation processed ${bots.length} bot players.`
  );
}

cron.schedule(process.env.BOT_SIMULATION_CRON || '*/5 * * * *', () => {
  runBotSimulation().catch((err) => {
    console.error('Bot simulation failed:', err);
  });
});

module.exports = runBotSimulation;
