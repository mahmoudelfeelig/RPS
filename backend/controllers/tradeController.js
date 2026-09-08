const Trade = require('../models/Trade');
const User = require('../models/User');
const mongoose = require('mongoose');
const { positiveInt } = require('../utils/inputValidation');

function normalizeTradeItems(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 25) return null;
  const normalized = [];
  for (const item of items) {
    const quantity = positiveInt(item.quantity, { min: 1, max: 999 });
    if (!item.itemId || !quantity) return null;
    normalized.push({ itemId: String(item.itemId), quantity });
  }
  return normalized;
}

exports.getTrades = async (req, res) => {
  try {
    const outgoing = await Trade.find({ fromUser: req.user.id })
      .populate('fromUser', 'username')
      .populate('toUser', 'username');

    const incoming = await Trade.find({ toUser: req.user.id })
      .populate('fromUser', 'username')
      .populate('toUser', 'username');

    res.json({
      outgoing,
      incoming,
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch trades' });
  }
};

exports.createTradeRequest = async (req, res) => {
  try {
    const { toUsername, fromItems } = req.body;

    const normalizedFromItems = normalizeTradeItems(fromItems);
    if (!normalizedFromItems) {
      return res
        .status(400)
        .json({ message: 'Invalid item format. Expected { itemId, quantity } objects.' });
    }

    const toUser = await User.findOne({ username: toUsername });
    if (!toUser) return res.status(400).json({ message: 'Recipient user not found' });

    const fromUser = await User.findById(req.user.id).populate('inventory.item');
    const inventoryMap = new Map();

    for (const { item, quantity } of fromUser.inventory) {
      inventoryMap.set(
        item._id.toString(),
        (inventoryMap.get(item._id.toString()) || 0) + quantity
      );
    }

    const formattedItems = normalizedFromItems.map(({ itemId, quantity }) => ({
      item: itemId,
      quantity,
    }));

    for (const { item, quantity } of formattedItems) {
      if ((inventoryMap.get(item) || 0) < quantity) {
        return res.status(400).json({ message: 'You do not own enough of one or more items.' });
      }
    }

    const activeTrades = await Trade.find({
      status: { $in: ['pending', 'responded'] },
      $or: [{ fromUser: req.user.id }, { toUser: req.user.id }],
    });
    const lockedCounts = new Map();
    for (const trade of activeTrades) {
      const reserved = trade.fromUser.toString() === req.user.id ? trade.fromItems : trade.toItems;
      for (const { item, quantity } of reserved) {
        const key = item.toString();
        lockedCounts.set(key, (lockedCounts.get(key) || 0) + quantity);
      }
    }

    for (const { item, quantity } of formattedItems) {
      const total = inventoryMap.get(item) || 0;
      const locked = lockedCounts.get(item) || 0;
      if (locked + quantity > total) {
        return res.status(400).json({ message: 'Some items are already used in an active trade' });
      }
    }

    const enrichedFromItems = formattedItems.map(({ item, quantity }) => {
      const match = fromUser.inventory.find((i) => i.item._id.toString() === item);
      return {
        item,
        quantity,
        name: match?.item.name,
        image: match?.item.image,
        emoji: match?.item.emoji,
        price: match?.item.price,
      };
    });

    const trade = await Trade.create({
      fromUser: req.user.id,
      toUser: toUser._id,
      fromItems: enrichedFromItems,
      toItems: [],
      status: 'pending',
    });

    res.status(201).json({ trade });
  } catch (err) {
    console.error('Trade request failed', err);
    res.status(500).json({ message: 'Trade request failed' });
  }
};

exports.respondToTrade = async (req, res) => {
  try {
    const { id } = req.params;
    const { toItems, action } = req.body;
    const trade = await Trade.findById(id);

    if (!trade || trade.toUser.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Unauthorized or trade not found' });
    }

    if (trade.status !== 'pending') {
      return res.status(400).json({ message: 'Trade is not pending' });
    }

    if (action === 'accept') {
      const normalizedToItems = normalizeTradeItems(toItems);
      if (!normalizedToItems) {
        return res
          .status(400)
          .json({ message: 'Invalid item format. Expected { itemId, quantity } objects.' });
      }

      const user = await User.findById(req.user.id).populate('inventory.item');
      const inventoryMap = new Map();
      for (const { item, quantity } of user.inventory) {
        inventoryMap.set(
          item._id.toString(),
          (inventoryMap.get(item._id.toString()) || 0) + quantity
        );
      }

      for (const { itemId, quantity } of normalizedToItems) {
        if ((inventoryMap.get(itemId) || 0) < quantity) {
          return res.status(400).json({ message: 'Insufficient quantity of one or more items' });
        }
      }

      const activeTrades = await Trade.find({
        _id: { $ne: id },
        status: { $in: ['pending', 'responded'] },
        $or: [{ fromUser: req.user.id }, { toUser: req.user.id }],
      });
      const lockedCounts = new Map();
      for (const t of activeTrades) {
        const reserved = t.fromUser.toString() === req.user.id ? t.fromItems : t.toItems;
        for (const e of reserved) {
          const key = e.item.toString();
          lockedCounts.set(key, (lockedCounts.get(key) || 0) + e.quantity);
        }
      }

      for (const { itemId, quantity } of normalizedToItems) {
        const available = inventoryMap.get(itemId) || 0;
        const locked = lockedCounts.get(itemId) || 0;
        if (locked + quantity > available) {
          return res
            .status(400)
            .json({ message: 'Some response items are already used in another trade' });
        }
      }

      const enriched = normalizedToItems.map(({ itemId, quantity }) => {
        const match = user.inventory.find((i) => i.item._id.toString() === itemId);
        return {
          item: itemId,
          quantity,
          name: match?.item.name,
          image: match?.item.image,
          emoji: match?.item.emoji,
          price: match?.item.price,
        };
      });

      const respondedTrade = await Trade.findOneAndUpdate(
        { _id: id, toUser: req.user.id, status: 'pending', expiresAt: { $gt: new Date() } },
        { $set: { toItems: enriched, status: 'responded' } },
        { new: true }
      );
      if (!respondedTrade) {
        return res.status(409).json({ message: 'Trade changed or expired' });
      }

      return res.status(200).json({ trade: respondedTrade });
    }

    if (action === 'deny') {
      const rejectedTrade = await Trade.findOneAndUpdate(
        { _id: id, toUser: req.user.id, status: 'pending' },
        { $set: { status: 'rejected' } },
        { new: true }
      );
      if (!rejectedTrade) {
        return res.status(409).json({ message: 'Trade changed' });
      }
      return res.status(200).json({ trade: rejectedTrade });
    }

    return res.status(400).json({ message: 'Invalid action' });
  } catch (err) {
    console.error('Trade response failed', err);
    res.status(500).json({ message: 'Trade response failed' });
  }
};

exports.finalizeTrade = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;
    let acceptedTrade;
    await session.withTransaction(async () => {
      const trade = await Trade.findOne({
        _id: id,
        fromUser: req.user.id,
        status: 'responded',
        expiresAt: { $gt: new Date() },
      }).session(session);
      if (!trade) {
        const error = new Error(
          'Trade is not ready, has expired, or only the sender can finalize it'
        );
        error.status = 400;
        throw error;
      }

      const fromUser = await User.findById(trade.fromUser).session(session);
      const toUser = await User.findById(trade.toUser).session(session);
      if (!fromUser || !toUser) {
        const error = new Error('Trade participant no longer exists');
        error.status = 400;
        throw error;
      }

      const removeItems = (user, items) => {
        for (const { item, quantity } of items) {
          const inv = user.inventory.find((i) => i.item.toString() === item.toString());
          if (!inv || inv.quantity < quantity) {
            const error = new Error('Insufficient item quantity');
            error.status = 409;
            throw error;
          }
          inv.quantity -= quantity;
        }
        user.inventory = user.inventory.filter((i) => i.quantity > 0);
      };

      const addItems = (user, items) => {
        for (const { item, quantity } of items) {
          const existing = user.inventory.find((i) => i.item.toString() === item.toString());
          if (existing) existing.quantity += quantity;
          else user.inventory.push({ item, quantity });
        }
      };

      removeItems(fromUser, trade.fromItems);
      removeItems(toUser, trade.toItems);
      addItems(fromUser, trade.toItems);
      addItems(toUser, trade.fromItems);

      trade.status = 'accepted';
      await fromUser.save({ session });
      await toUser.save({ session });
      await trade.save({ session });
      acceptedTrade = trade;
    });

    res.status(200).json({ trade: acceptedTrade });
  } catch (err) {
    console.error('Finalize error:', err);
    res
      .status(err.status || 500)
      .json({ message: err.status ? err.message : 'Failed to finalize trade' });
  } finally {
    await session.endSession();
  }
};

exports.cancelTrade = async (req, res) => {
  try {
    const { id } = req.params;
    const trade = await Trade.findOneAndUpdate(
      {
        _id: id,
        status: { $in: ['pending', 'responded'] },
        $or: [{ fromUser: req.user.id }, { toUser: req.user.id }],
      },
      { $set: { status: 'canceled' } },
      { new: true }
    );

    if (!trade)
      return res
        .status(409)
        .json({ message: 'Trade not found, unauthorized, or already finalized' });

    res.status(200).json({ message: 'Trade canceled', trade });
  } catch (err) {
    console.error('Cancel trade failed', err);
    res.status(500).json({ message: 'Failed to cancel trade' });
  }
};
