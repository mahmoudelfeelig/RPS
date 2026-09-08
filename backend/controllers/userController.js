const User = require('../models/User');
const UserInventory = require('../models/UserInventory');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const checkAndAwardBadges = require('../utils/checkAndAwardBadges');
const checkAndAwardAchievements = require('../utils/checkAndAwardAchievements');
const { publicUploadUrl } = require('../utils/uploadStorage');
const generateToken = require('../utils/authToken');

exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('username balance profileImage');
    if (!user) return res.status(404).json({ error: 'User not found' });

    const inv = await UserInventory.findOneAndUpdate(
      { userId: req.user.id },
      {},
      { upsert: true, new: true }
    );

    const now = Date.now();
    const last = inv.lastPassiveClaim?.getTime() || 0;
    const nextClaim = last + 15 * 60 * 1000; // 15 min cooldown

    res.json({
      username: user.username,
      balance: user.balance,
      profileImage: user.profileImage,
      resources: {
        coins: inv.resources.coins,
        food: Object.fromEntries(inv.resources.food),
        toys: Object.fromEntries(inv.resources.toys),
        shards: inv.shards,
        nextClaim: Math.max(0, nextClaim - now),
      },
    });
  } catch (err) {
    console.error('getMe error:', err);
    res.status(500).json({ error: 'Failed to fetch user info.' });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId).select('+password +tokenVersion');

    const { username, password, currentPassword, profileImageUrl, avatarUrl } = req.body;
    const updates = {};

    if (username && username !== user.username) {
      const existingUsername = await User.findOne({ username });
      if (existingUsername) return res.status(400).json({ message: 'Username already taken' });
      updates.username = username;
    }

    if (password) {
      if (String(password).length < 8) {
        return res.status(400).json({ message: 'Password must be at least 8 characters' });
      }
      if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }
      updates.password = await bcrypt.hash(password, 10);
      updates.tokenVersion = Number(user.tokenVersion || 0) + 1;
    }

    const remoteImage = (profileImageUrl || avatarUrl || '').trim();
    if (remoteImage && /^(https?:\/\/|\/)/i.test(remoteImage)) {
      updates.profileImage = remoteImage;
    }

    if (req.file && req.file.path) {
      updates.profileImage = publicUploadUrl(req.file);
    }

    const updatedUser = await User.findByIdAndUpdate(userId, updates, { new: true }).select(
      '-password +tokenVersion'
    );
    const userData = updatedUser.toObject();
    delete userData.tokenVersion;
    if (password) {
      return res.json({ user: userData, token: generateToken(updatedUser) });
    }
    res.json({ user: userData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update user' });
  }
};

exports.deleteUser = async (req, res) => {
  const { password } = req.body;
  const user = await User.findById(req.user.id).select('+password');
  if (!user) return res.status(404).json({ message: 'User not found' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(400).json({ message: 'Incorrect password' });

  await Promise.all([
    User.findByIdAndDelete(req.user.id),
    UserInventory.deleteOne({ userId: req.user.id }),
  ]);
  res.json({ message: 'Account deleted' });
};

exports.getLeaderboard = async (req, res) => {
  try {
    const users = await User.find({})
      .sort({ balance: -1 })
      .select('username balance profileImage inventory achievements')
      .populate({
        path: 'inventory',
        populate: {
          path: 'item',
          model: 'StoreItem',
          select: 'name emoji image',
        },
      })
      .populate('achievements', 'title icon')
      .lean();

    const out = users.map((u) => ({
      ...u,
      inventory: (u.inventory || []).map(({ item, quantity }) => ({ item, quantity })),
    }));

    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching leaderboard' });
  }
};

exports.sendMoney = async (req, res) => {
  let session;
  try {
    const { recipientUsername, amount } = req.body;
    const senderId = req.user.id;
    const numericAmount = Math.floor(Number(amount));

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount' });
    }

    const recipient = await User.findOne({ username: recipientUsername });

    if (!recipient) return res.status(404).json({ message: 'User not found' });
    if (String(recipient._id) === String(senderId)) {
      return res.status(400).json({ message: 'Cannot send coins to yourself' });
    }

    session = await mongoose.startSession();
    session.startTransaction();

    const netAmount = Math.floor(0.95 * numericAmount);
    const senderDebit = await User.updateOne(
      { _id: senderId, balance: { $gte: numericAmount } },
      {
        $inc: { balance: -numericAmount },
        $push: {
          transactionHistory: {
            type: 'send',
            amount: numericAmount,
            to: recipient._id,
          },
        },
      },
      { session }
    );

    if (senderDebit.modifiedCount !== 1)
      return res.status(400).json({ message: 'Insufficient funds' });

    await User.updateOne(
      { _id: recipient._id },
      {
        $inc: { balance: netAmount },
        $push: {
          transactionHistory: {
            type: 'receive',
            amount: numericAmount,
            from: senderId,
          },
        },
      },
      { session }
    );
    await session.commitTransaction();

    const sender = await User.findById(senderId).lean();
    res.json({ newBalance: sender.balance });
  } catch (err) {
    if (session) await session.abortTransaction();
    res.status(500).json({ message: 'Transfer failed' });
  } finally {
    if (session) session.endSession();
  }
};

exports.searchUsers = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      _id: { $ne: req.user.id },
      username: { $regex: safe, $options: 'i' },
    })
      .select('username profileImage balance isBot')
      .sort({ username: 1 })
      .limit(8)
      .lean();
    res.json(users);
  } catch (err) {
    console.error('User search error:', err);
    res.status(500).json({ message: 'Failed to search users' });
  }
};

exports.getStats = async (req, res) => {
  try {
    await checkAndAwardBadges(req.user.id);
    await checkAndAwardAchievements(req.user.id);

    const user = await User.findById(req.user.id)
      .populate('achievements')
      .populate({
        path: 'inventory',
        populate: {
          path: 'item',
          model: 'StoreItem',
          select:
            'name type emoji image description price effect effectType effectValue consumable',
        },
      })
      .populate({
        path: 'currentBets',
        select: 'title options predictions result',
      })
      .lean();

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const inventory = (user.inventory || [])
      .map(({ item, quantity }) => ({ item, quantity }))
      .filter((entry) => entry.item);

    const stats = {
      username: user.username,
      betsPlaced: user.betsPlaced,
      betsWon: user.betsWon,
      storePurchases: user.storePurchases,
      marketTrades: user.marketTrades || 0,
      dividendsClaimed: user.dividendsClaimed || 0,
      logins: user.loginCount,
      role: user.role,
      tasksCompleted: user.tasksCompleted,
      balance: user.balance,
      prestigeLevel: user.prestigeLevel,
      prestigeResets: user.prestigeResets,
      prestigeMultiplier: user.prestigeMultiplier,
      lastPrestigeAt: user.lastPrestigeAt,
      portfolio: user.portfolio || [],
      claimedAchievements: user.achievements || [],
      badges: user.badges || [],
      currentBets: user.currentBets || [],
      profileImage: user.profileImage,
      inventory,
      activeEffects: user.activeEffects || [],
      minefieldPlays: user.minefieldPlays,
      minefieldWins: user.minefieldWins,
      puzzleSolves: user.puzzleSolves,
      rpsPlays: user.rpsPlays,
      rpsWins: user.rpsWins,
      clickFrenzyClicks: user.clickFrenzyClicks,
      casinoPlays: user.casinoPlays,
      casinoWins: user.casinoWins,
      slotsPlays: user.slotsPlays,
      slotsWins: user.slotsWins,
    };

    res.json({ userId: req.user.id, ...stats });
  } catch (err) {
    console.error('Error in getStats:', err);
    res.status(500).json({ message: 'Failed to load stats' });
  }
};

exports.getPublicProfile = async (req, res) => {
  try {
    const username = String(req.params.username || '').trim();
    const safeUsername = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const user = await User.findOne({ username: { $regex: `^${safeUsername}$`, $options: 'i' } })
      .select('username balance profileImage badges achievements inventory')
      .populate({
        path: 'inventory',
        populate: {
          path: 'item',
          model: 'StoreItem',
          select: 'name type emoji image description price',
        },
      })
      .populate('achievements')
      .populate('badges')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const inventory = (user.inventory || [])
      .map(({ item, quantity }) => ({ item, quantity }))
      .filter((entry) => entry.item);
    const badges = (user.badges || []).filter((b) => typeof b === 'object');

    res.json({
      username: user.username,
      balance: user.balance,
      profileImage: user.profileImage,
      achievements: user.achievements,
      badges,
      inventory,
    });
  } catch (err) {
    console.error('Error in getPublicProfile:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
