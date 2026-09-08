const Auction = require('../models/Auction');
const BossRaid = require('../models/BossRaid');
const EconomyEvent = require('../models/EconomyEvent');
const Guild = require('../models/Guild');
const InsurancePolicy = require('../models/InsurancePolicy');
const Loan = require('../models/Loan');
const Stake = require('../models/Stake');
const User = require('../models/User');
const UserCard = require('../models/UserCard');
const mongoose = require('mongoose');
const { memberCards } = require('../config/memberTiers');

const PACKS = {
  rookie: {
    cost: 750,
    count: 2,
    minRarity: null,
    label: 'Rookie pack',
    description: 'Cheap entry pack with mostly lower-tier cards.',
  },
  standard: {
    cost: 1500,
    count: 3,
    minRarity: null,
    label: 'Standard pack',
    description: 'Balanced starter pack for building copies.',
  },
  contender: {
    cost: 3500,
    count: 4,
    minRarity: 'uncommon',
    label: 'Contender pack',
    description: 'Skips the weakest floor and improves upgrade odds.',
  },
  elite: {
    cost: 6000,
    count: 5,
    minRarity: 'rare',
    label: 'Elite pack',
    description: 'Rare minimum for stronger roster progress.',
  },
  division: {
    cost: 12000,
    count: 5,
    minRarity: 'epic',
    label: 'Division pack',
    description: 'Epic minimum for serious collection pushes.',
  },
  mythic: {
    cost: 22000,
    count: 6,
    minRarity: 'epic',
    label: 'Mythic chase',
    description: 'High-card count with a strong rarity floor.',
  },
  anomaly: {
    cost: 50000,
    count: 7,
    minRarity: 'legendary',
    label: 'Anomaly case',
    description: 'Expensive chase pack for top-tier cards.',
  },
};

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'anomaly'];
const TAX_RATE = 0.03;
const LEAGUE_THRESHOLDS = [
  { name: 'Obsidian', netWorth: 1000000 },
  { name: 'Diamond', netWorth: 500000 },
  { name: 'Platinum', netWorth: 200000 },
  { name: 'Gold', netWorth: 75000 },
  { name: 'Silver', netWorth: 25000 },
  { name: 'Bronze', netWorth: 0 },
];

const parsePositiveInt = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
};

const cardDefs = () => memberCards();

function weightedCard(pool) {
  const total = pool.reduce((sum, card) => sum + card.packWeight, 0);
  let roll = Math.random() * total;
  for (const card of pool) {
    roll -= card.packWeight;
    if (roll <= 0) return card;
  }
  return pool[0];
}

function leagueFor(netWorth) {
  return LEAGUE_THRESHOLDS.find((league) => netWorth >= league.netWorth)?.name || 'Bronze';
}

async function awardCard(userId, card, quantity = 1) {
  const existing = await UserCard.findOne({ user: userId, cardKey: card.key });
  if (existing) {
    existing.quantity += quantity;
    existing.xp += card.basePower * quantity;
    existing.power = card.basePower + existing.level * 4;
    await existing.save();
    return existing;
  }

  return UserCard.create({
    user: userId,
    cardKey: card.key,
    name: card.name,
    tier: card.tier,
    rarity: card.rarity,
    quantity,
    power: card.basePower,
    styleSeed: card.styleSeed,
  });
}

exports.getEconomyOverview = async (req, res) => {
  try {
    const [cards, auctions, events, guild, loans, policies, stakes, raid, user] = await Promise.all(
      [
        UserCard.find({ user: req.user.id }).sort({ power: -1 }).lean(),
        Auction.find({ active: true, settled: false })
          .sort({ endsAt: 1 })
          .limit(12)
          .populate('highestBidder', 'username')
          .lean(),
        EconomyEvent.find({ active: true, endsAt: { $gt: new Date() } })
          .sort({ endsAt: 1 })
          .lean(),
        Guild.findOne({ members: req.user.id }).lean(),
        Loan.find({ user: req.user.id, status: 'active' }).lean(),
        InsurancePolicy.find({
          user: req.user.id,
          active: true,
          expiresAt: { $gt: new Date() },
        }).lean(),
        Stake.find({ user: req.user.id, status: 'active' }).lean(),
        BossRaid.findOne({ active: true }).sort({ createdAt: -1 }).lean(),
        User.findById(req.user.id).select('balance portfolio').lean(),
      ]
    );

    const portfolioValue = (user?.portfolio || []).reduce(
      (sum, pos) => sum + (pos.quantity || 0) * (pos.avgPrice || 0),
      0
    );
    res.json({
      balance: user?.balance || 0,
      league: leagueFor((user?.balance || 0) + portfolioValue),
      cards,
      auctions,
      events,
      guild,
      loans,
      policies,
      stakes,
      raid,
      meta: {
        taxRate: TAX_RATE,
        packs: PACKS,
        leagues: LEAGUE_THRESHOLDS,
      },
    });
  } catch (err) {
    console.error('Economy overview error:', err);
    res.status(500).json({ message: 'Failed to load economy overview' });
  }
};

exports.openCardPack = async (req, res) => {
  try {
    const pack = PACKS[req.body.pack || 'standard'];
    if (!pack) return res.status(400).json({ message: 'Invalid card pack' });

    const debit = await User.updateOne(
      { _id: req.user.id, balance: { $gte: pack.cost } },
      { $inc: { balance: -pack.cost } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ message: 'Insufficient funds' });

    const user = await User.findById(req.user.id);
    const tax = Math.floor(pack.cost * TAX_RATE);
    const cards = cardDefs();
    const minIndex = pack.minRarity ? RARITY_ORDER.indexOf(pack.minRarity) : 0;
    const pool = cards.filter((card) => RARITY_ORDER.indexOf(card.rarity) >= minIndex);
    const pulls = [];

    for (let i = 0; i < pack.count; i += 1) {
      const card = weightedCard(pool);
      const saved = await awardCard(user._id, card);
      pulls.push(saved.toObject());
    }

    res.json({
      pack: req.body.pack || 'standard',
      cost: pack.cost,
      tax,
      pulls,
      balance: user.balance,
    });
  } catch (err) {
    console.error('Card pack error:', err);
    res.status(500).json({ message: 'Could not open pack' });
  }
};

exports.upgradeCard = async (req, res) => {
  try {
    const card = await UserCard.findOne({ user: req.user.id, cardKey: req.body.cardKey });
    if (!card) return res.status(404).json({ message: 'Card not found' });
    const required = Math.min(10, 2 + card.level);
    if (card.quantity < required) {
      return res.status(400).json({ message: `Need ${required} copies to upgrade` });
    }

    card.quantity -= required;
    card.level += 1;
    card.power += 8 + card.level * 2;
    card.xp += 100;
    await card.save();
    res.json({ card, required });
  } catch (err) {
    console.error('Card upgrade error:', err);
    res.status(500).json({ message: 'Upgrade failed' });
  }
};

exports.craft = async (req, res) => {
  try {
    const userCards = await UserCard.find({ user: req.user.id, quantity: { $gte: 3 } })
      .sort({ power: 1 })
      .limit(3);
    if (userCards.length < 1)
      return res.status(400).json({ message: 'Need duplicate cards to craft' });

    const card = userCards[0];
    card.quantity -= 3;
    card.xp += 250;
    card.power += 12;
    await card.save();

    const user = await User.findById(req.user.id);
    const reward = 500 + card.level * 150;
    user.balance += reward;
    await user.save();
    res.json({ message: 'Crafted card shards into power', card, reward, balance: user.balance });
  } catch (err) {
    console.error('Craft error:', err);
    res.status(500).json({ message: 'Crafting failed' });
  }
};

exports.createAuction = async (req, res) => {
  try {
    const startingBid = parsePositiveInt(req.body.startingBid);
    const durationHours = Math.min(72, parsePositiveInt(req.body.durationHours) || 12);
    if (!startingBid) return res.status(400).json({ message: 'Invalid starting bid' });

    const title = String(req.body.title || 'Player Auction').slice(0, 80);
    const auction = await Auction.create({
      title,
      kind: req.body.kind || 'boost',
      cardKey: req.body.cardKey || '',
      description: String(req.body.description || '').slice(0, 240),
      startingBid,
      currentBid: startingBid,
      endsAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
    });
    res.status(201).json({ auction });
  } catch (err) {
    console.error('Create auction error:', err);
    res.status(500).json({ message: 'Could not create auction' });
  }
};

exports.bidAuction = async (req, res) => {
  try {
    const amount = parsePositiveInt(req.body.amount);
    const auction = await Auction.findById(req.params.id);
    if (!auction || auction.settled || !auction.active || auction.endsAt <= new Date()) {
      return res.status(404).json({ message: 'Auction not available' });
    }
    if (!amount || amount <= auction.currentBid) {
      return res.status(400).json({ message: 'Bid must beat current bid' });
    }

    const debit = await User.updateOne(
      { _id: req.user.id, balance: { $gte: amount } },
      { $inc: { balance: -amount } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ message: 'Insufficient funds' });

    const previous = await Auction.findOneAndUpdate(
      {
        _id: auction._id,
        active: true,
        settled: false,
        endsAt: { $gt: new Date() },
        currentBid: auction.currentBid,
      },
      {
        $set: { currentBid: amount, highestBidder: req.user.id },
        $push: { bids: { bidder: req.user.id, amount } },
      },
      { new: false }
    );

    if (!previous) {
      await User.findByIdAndUpdate(req.user.id, { $inc: { balance: amount } });
      return res.status(409).json({ message: 'Auction changed. Try bidding again.' });
    }

    if (previous.highestBidder) {
      await User.findByIdAndUpdate(previous.highestBidder, {
        $inc: { balance: previous.currentBid },
      });
    }

    const [updatedAuction, user] = await Promise.all([
      Auction.findById(auction._id).populate('highestBidder', 'username').lean(),
      User.findById(req.user.id).lean(),
    ]);
    res.json({ auction: updatedAuction, balance: user.balance });
  } catch (err) {
    console.error('Auction bid error:', err);
    res.status(500).json({ message: 'Bid failed' });
  }
};

exports.settleAuction = async (req, res) => {
  try {
    const auction = await Auction.findOneAndUpdate(
      {
        _id: req.params.id,
        settled: false,
        $or: [{ endsAt: { $lte: new Date() } }, { active: false }],
      },
      { $set: { settled: true, active: false } },
      { new: true }
    ).populate('highestBidder', 'username');

    if (!auction) return res.status(404).json({ message: 'Auction is not ready to settle' });

    let awardedCard = null;
    if (auction.highestBidder && auction.kind === 'card' && auction.cardKey) {
      const def = cardDefs().find((card) => card.key === auction.cardKey);
      if (def) awardedCard = await awardCard(auction.highestBidder._id, def);
    }

    res.json({ auction, awardedCard });
  } catch (err) {
    console.error('Auction settle error:', err);
    res.status(500).json({ message: 'Settlement failed' });
  }
};

exports.borrowLoan = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const principal = parsePositiveInt(req.body.amount);
    if (!principal || principal > 100000)
      return res.status(400).json({ message: 'Invalid loan amount' });

    const interestRate = principal > 25000 ? 0.18 : 0.12;
    const outstanding = Math.ceil(principal * (1 + interestRate));
    let loan;
    let user;
    await session.withTransaction(async () => {
      const activeLoans = await Loan.find({ user: req.user.id, status: 'active' })
        .select('slot')
        .session(session)
        .lean();
      if (activeLoans.length >= 2) {
        const error = new Error('Too many active loans');
        error.status = 400;
        throw error;
      }
      const occupied = new Set(activeLoans.map((active) => active.slot));
      const slot = [1, 2].find((candidate) => !occupied.has(candidate));
      if (!slot) {
        const error = new Error('Too many active loans');
        error.status = 400;
        throw error;
      }

      [loan] = await Loan.create(
        [
          {
            user: req.user.id,
            slot,
            principal,
            outstanding,
            interestRate,
            dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        ],
        { session }
      );
      user = await User.findByIdAndUpdate(
        req.user.id,
        { $inc: { balance: principal } },
        { new: true, session }
      );
    });

    res.status(201).json({ loan, balance: user.balance });
  } catch (err) {
    console.error('Loan error:', err);
    const conflict = err?.code === 11000;
    res.status(err.status || (conflict ? 409 : 500)).json({
      message: conflict
        ? 'A concurrent loan request used the last available slot'
        : err.status
          ? err.message
          : 'Loan failed',
    });
  } finally {
    await session.endSession();
  }
};

exports.repayLoan = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let loan;
    let user;
    await session.withTransaction(async () => {
      loan = await Loan.findOne({
        _id: req.params.id,
        user: req.user.id,
        status: 'active',
      }).session(session);
      if (!loan) {
        const error = new Error('Loan not found');
        error.status = 404;
        throw error;
      }

      user = await User.findOneAndUpdate(
        { _id: req.user.id, balance: { $gte: loan.outstanding } },
        { $inc: { balance: -loan.outstanding } },
        { new: true, session }
      );
      if (!user) {
        const error = new Error('Insufficient funds');
        error.status = 400;
        throw error;
      }

      loan.outstanding = 0;
      loan.status = 'repaid';
      await loan.save({ session });
    });
    res.json({ loan, balance: user.balance });
  } catch (err) {
    console.error('Repay loan error:', err);
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Repay failed' });
  } finally {
    await session.endSession();
  }
};

exports.buyInsurance = async (req, res) => {
  try {
    const type = String(req.body.type || '');
    if (!['casino', 'market', 'minefield'].includes(type))
      return res.status(400).json({ message: 'Invalid policy type' });

    const premium = type === 'market' ? 2500 : 1500;
    const debit = await User.updateOne(
      { _id: req.user.id, balance: { $gte: premium } },
      { $inc: { balance: -premium } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ message: 'Insufficient funds' });

    const policy = await InsurancePolicy.create({
      user: req.user.id,
      type,
      premium,
      coverageRate: type === 'market' ? 0.25 : 0.35,
      maxCoverage: type === 'market' ? 15000 : 8000,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const user = await User.findById(req.user.id).lean();
    res.status(201).json({ policy, balance: user.balance });
  } catch (err) {
    console.error('Insurance error:', err);
    res.status(500).json({ message: 'Insurance failed' });
  }
};

exports.createStake = async (req, res) => {
  try {
    const amount = parsePositiveInt(req.body.amount);
    const days = Math.min(30, Math.max(1, parsePositiveInt(req.body.days) || 7));
    if (!amount) return res.status(400).json({ message: 'Invalid stake amount' });

    const debit = await User.updateOne(
      { _id: req.user.id, balance: { $gte: amount } },
      { $inc: { balance: -amount } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ message: 'Insufficient funds' });

    const stake = await Stake.create({
      user: req.user.id,
      amount,
      apr: days >= 14 ? 0.22 : 0.14,
      lockedUntil: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    });
    const user = await User.findById(req.user.id).lean();
    res.status(201).json({ stake, balance: user.balance });
  } catch (err) {
    console.error('Stake error:', err);
    res.status(500).json({ message: 'Stake failed' });
  }
};

exports.claimStake = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let stake;
    let reward;
    let user;
    await session.withTransaction(async () => {
      stake = await Stake.findOneAndUpdate(
        {
          _id: req.params.id,
          user: req.user.id,
          status: 'active',
          lockedUntil: { $lte: new Date() },
        },
        { $set: { status: 'claimed', claimedAt: new Date() } },
        { new: true, session }
      );
      if (!stake) {
        const error = new Error('Stake not found, already claimed, or still locked');
        error.status = 404;
        throw error;
      }

      const days = Math.max(1, (stake.lockedUntil - stake.createdAt) / (24 * 60 * 60 * 1000));
      reward = Math.floor(stake.amount * (1 + stake.apr * (days / 365)));
      user = await User.findByIdAndUpdate(
        req.user.id,
        { $inc: { balance: reward } },
        { new: true, session }
      );
    });
    res.json({ stake, reward, balance: user.balance });
  } catch (err) {
    console.error('Claim stake error:', err);
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Claim failed' });
  } finally {
    await session.endSession();
  }
};

exports.createGuild = async (req, res) => {
  try {
    const name = String(req.body.name || '')
      .trim()
      .slice(0, 32);
    const tag = String(req.body.tag || '')
      .trim()
      .toUpperCase()
      .slice(0, 5);
    if (!name || !tag) return res.status(400).json({ message: 'Name and tag are required' });

    const existing = await Guild.findOne({ members: req.user.id });
    if (existing) return res.status(400).json({ message: 'Already in a guild' });

    const guild = await Guild.create({ name, tag, owner: req.user.id, members: [req.user.id] });
    res.status(201).json({ guild });
  } catch (err) {
    console.error('Create guild error:', err);
    res.status(500).json({ message: 'Guild creation failed' });
  }
};

exports.joinGuild = async (req, res) => {
  try {
    const guild = await Guild.findById(req.params.id);
    if (!guild) return res.status(404).json({ message: 'Guild not found' });
    if (!guild.members.some((id) => String(id) === req.user.id)) guild.members.push(req.user.id);
    await guild.save();
    res.json({ guild });
  } catch (err) {
    console.error('Join guild error:', err);
    res.status(500).json({ message: 'Join failed' });
  }
};

exports.contributeGuild = async (req, res) => {
  try {
    const amount = parsePositiveInt(req.body.amount);
    if (!amount) return res.status(400).json({ message: 'Invalid contribution' });

    const guild = await Guild.findOne({ members: req.user.id });
    if (!guild) return res.status(404).json({ message: 'Join a guild first' });
    const debit = await User.updateOne(
      { _id: req.user.id, balance: { $gte: amount } },
      { $inc: { balance: -amount } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ message: 'Insufficient funds' });

    guild.treasury += amount;
    guild.xp += Math.floor(amount / 10);
    guild.seasonScore += amount;
    guild.level = 1 + Math.floor(guild.xp / 5000);
    await guild.save();
    const user = await User.findById(req.user.id).lean();
    res.json({ guild, balance: user.balance });
  } catch (err) {
    console.error('Guild contribution error:', err);
    res.status(500).json({ message: 'Contribution failed' });
  }
};

async function ensureRaid() {
  let raid = await BossRaid.findOne({ active: true });
  if (!raid) {
    raid = await BossRaid.create({
      name: 'The House Edge',
      bossKey: 'house-edge',
      maxHp: 250000,
      hp: 250000,
      rewardPool: 50000,
      endsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
  }
  return raid;
}

exports.attackRaid = async (req, res) => {
  try {
    const amount = parsePositiveInt(req.body.amount);
    if (!amount) return res.status(400).json({ message: 'Invalid attack amount' });

    const [raid, cards] = await Promise.all([
      ensureRaid(),
      UserCard.find({ user: req.user.id }).sort({ power: -1 }).limit(5),
    ]);
    const debit = await User.updateOne(
      { _id: req.user.id, balance: { $gte: amount } },
      { $inc: { balance: -amount } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ message: 'Insufficient funds' });

    const cardPower = cards.reduce((sum, card) => sum + card.power, 0);
    const damage = Math.floor(amount * 0.8 + cardPower * 3);
    raid.hp = Math.max(0, raid.hp - damage);
    raid.rewardPool += Math.floor(amount * 0.35);
    raid.contributions.push({ user: req.user.id, damage });
    if (raid.hp <= 0) {
      raid.defeated = true;
      raid.active = false;
    }
    await raid.save();
    const user = await User.findById(req.user.id).lean();
    res.json({ raid, damage, balance: user.balance });
  } catch (err) {
    console.error('Raid attack error:', err);
    res.status(500).json({ message: 'Raid attack failed' });
  }
};

exports.claimRaidReward = async (req, res) => {
  try {
    const currentRaid = await BossRaid.findOne({ _id: req.params.id, active: false }).lean();
    if (!currentRaid) return res.status(404).json({ message: 'No claimable raid reward' });

    const totalDamage = currentRaid.contributions.reduce(
      (sum, entry) => sum + (entry.damage || 0),
      0
    );
    const userDamage = currentRaid.contributions
      .filter((entry) => String(entry.user) === req.user.id)
      .reduce((sum, entry) => sum + (entry.damage || 0), 0);

    if (!totalDamage || !userDamage)
      return res.status(400).json({ message: 'No raid contribution found' });

    const raid = await BossRaid.findOneAndUpdate(
      { _id: req.params.id, active: false, claimedBy: { $ne: req.user.id } },
      { $addToSet: { claimedBy: req.user.id } },
      { new: true }
    );
    if (!raid) return res.status(404).json({ message: 'No claimable raid reward' });

    const reward = Math.floor(currentRaid.rewardPool * (userDamage / totalDamage));
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $inc: { balance: reward } },
      { new: true }
    ).lean();
    res.json({ raid, reward, balance: user.balance });
  } catch (err) {
    console.error('Raid claim error:', err);
    res.status(500).json({ message: 'Reward claim failed' });
  }
};

exports.createMarketEvent = async (req, res) => {
  try {
    const presets = [
      {
        name: 'Dividend Week',
        type: 'market',
        description: 'Dividend assets get more attention.',
        modifier: 1.15,
      },
      {
        name: 'Member Stock Derby',
        type: 'member-stock',
        description: 'RPS member stocks move faster for a short window.',
        modifier: 1.25,
      },
      {
        name: 'Liquidity Drain',
        type: 'sink',
        description: 'Auction taxes and high-risk play remove more coins.',
        modifier: 1.1,
      },
    ];
    const preset = presets[Math.floor(Math.random() * presets.length)];
    const event = await EconomyEvent.create({
      ...preset,
      endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
    res.status(201).json({ event });
  } catch (err) {
    console.error('Market event error:', err);
    res.status(500).json({ message: 'Could not create event' });
  }
};
