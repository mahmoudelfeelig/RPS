const Critter = require('../models/Critter');
const UserInventory = require('../models/UserInventory');
const CritterSpecies = require('../models/CritterSpecies');
const traitEffects = require('../utils/traitEffects');
const MiniGameSession = require('../models/MiniGameSession');

const COOLDOWN_MS = 15 * 60 * 1000;
const MINI_GAME_COOLDOWN_MS = 5 * 60 * 1000;
const MINI_GAME_SCORE_CAPS = {
  'coin-catcher': 250,
  'critter-match': 150,
  'dodge-n-dash': 200,
};

exports.startMiniGame = async (req, res) => {
  try {
    const { critterId, game } = req.body;
    if (!MINI_GAME_SCORE_CAPS[game]) {
      return res.status(400).json({ error: 'Unknown mini-game.' });
    }

    const critter = await Critter.findOne({ _id: critterId, ownerId: req.user._id }).lean();
    if (!critter) return res.sendStatus(404);
    if (
      critter.lastPlayedAt &&
      Date.now() - critter.lastPlayedAt.getTime() < MINI_GAME_COOLDOWN_MS
    ) {
      return res.status(429).json({
        error: 'This critter needs a short break before another mini-game.',
        nextPlay: critter.lastPlayedAt.getTime() + MINI_GAME_COOLDOWN_MS,
      });
    }

    await MiniGameSession.updateMany(
      {
        user: req.user._id,
        critter: critterId,
        game,
        active: true,
        expiresAt: { $lte: new Date() },
      },
      { $set: { active: false } }
    );
    const miniGameSession = await MiniGameSession.create({
      user: req.user._id,
      critter: critterId,
      game,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    res.status(201).json({ sessionId: miniGameSession._id, expiresAt: miniGameSession.expiresAt });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: 'A mini-game session is already active.' });
    }
    console.error('Error starting mini-game:', error);
    res.status(500).json({ error: 'Failed to start mini-game.' });
  }
};
exports.claimPassiveResources = async (req, res) => {
  try {
    const inv = await UserInventory.findOneAndUpdate(
      { userId: req.user._id },
      { $setOnInsert: { userId: req.user._id } },
      { upsert: true, new: true }
    );

    const now = Date.now();
    const claimedInventory = await UserInventory.findOneAndUpdate(
      {
        _id: inv._id,
        $or: [
          { lastPassiveClaim: null },
          { lastPassiveClaim: { $lte: new Date(now - COOLDOWN_MS) } },
        ],
      },
      { $set: { lastPassiveClaim: new Date(now) } },
      { new: true }
    );
    if (!claimedInventory) {
      return res.status(400).json({
        error: 'Too soon to claim again',
        nextClaim: inv.lastPassiveClaim.getTime() + COOLDOWN_MS,
      });
    }

    const critters = await Critter.find({ ownerId: req.user._id });
    let coinGain = 0,
      foodGain = {},
      toyGain = {};

    for (const c of critters) {
      let base = { coins: 1, food: {}, toys: {} };

      const owned = c.traits && typeof c.traits === 'object' ? Object.keys(c.traits) : [];

      for (const t of owned) {
        const eff = traitEffects[t];
        if (eff?.generate) {
          const r = eff.generate();
          base.coins += r.coins || 0;
          if (r.food) {
            for (const [k, v] of Object.entries(r.food)) {
              base.food[k] = (base.food[k] || 0) + v;
            }
          }
          if (r.toys) {
            for (const [k, v] of Object.entries(r.toys)) {
              base.toys[k] = (base.toys[k] || 0) + v;
            }
          }
        }
      }

      for (const t of owned) {
        const eff = traitEffects[t];
        if (eff?.modifyGeneration) {
          base = { ...{ food: {}, toys: {}, coins: 0 }, ...base }; // default + current
          base = eff.modifyGeneration(base);
        }
      }

      base.coins *= 1 + c.level * 0.02;
      base.coins *= 1 + c.affection * 0.005;

      coinGain += Math.floor(base.coins);

      base.food = base.food || {};
      base.toys = base.toys || {};
      Object.entries(base.food).forEach(([k, v]) => {
        foodGain[k] = (foodGain[k] || 0) + v;
      });
      Object.entries(base.toys).forEach(([k, v]) => {
        toyGain[k] = (toyGain[k] || 0) + v;
      });
    }

    const incOps = {
      'resources.coins': coinGain,
      ...Object.fromEntries(Object.entries(foodGain).map(([k, v]) => [`resources.food.${k}`, v])),
      ...Object.fromEntries(Object.entries(toyGain).map(([k, v]) => [`resources.toys.${k}`, v])),
    };

    const updated = await UserInventory.findOneAndUpdate(
      { userId: req.user._id },
      {
        $inc: incOps,
      },
      { new: true }
    );

    res.json({
      message: 'Resources claimed!',
      coinsAdded: coinGain,
      foodAdded: foodGain,
      toysAdded: toyGain,
      newInventory: updated.resources,
      nextClaim: now + COOLDOWN_MS,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to claim resources.' });
  }
};

exports.handleMiniGameResult = async (req, res) => {
  try {
    const { critterId, game, sessionId } = req.body;
    const scoreCap = MINI_GAME_SCORE_CAPS[game];
    const actualScore = Number(req.body.actualScore);
    if (!scoreCap || !Number.isFinite(actualScore) || actualScore < 0 || actualScore > scoreCap) {
      return res.status(400).json({ error: 'Invalid or missing score.' });
    }

    const completedSession = await MiniGameSession.findOneAndUpdate(
      {
        _id: sessionId,
        user: req.user._id,
        critter: critterId,
        game,
        active: true,
        expiresAt: { $gt: new Date() },
      },
      { $set: { active: false, completedAt: new Date() } },
      { new: true }
    );
    if (!completedSession) {
      return res
        .status(409)
        .json({ error: 'Mini-game session is missing, expired, or already used.' });
    }

    const critter = await Critter.findOneAndUpdate(
      {
        _id: critterId,
        ownerId: req.user._id,
        $or: [
          { lastPlayedAt: null },
          { lastPlayedAt: { $lte: new Date(Date.now() - MINI_GAME_COOLDOWN_MS) } },
        ],
      },
      { $set: { lastPlayedAt: new Date() } },
      { new: true }
    );
    if (!critter) {
      return res
        .status(429)
        .json({ error: 'This critter needs a short break before another mini-game.' });
    }

    const traits = Array.isArray(critter.traits)
      ? critter.traits
      : typeof critter.traits === 'object' && critter.traits !== null
        ? Object.keys(critter.traits)
        : [];

    let finalScore = actualScore;
    for (const t of traits) {
      if (traitEffects[t]?.doubleMiniGame) {
        finalScore = traitEffects[t].doubleMiniGame(finalScore);
      }
    }

    let expGain = Math.min(finalScore, 100);
    let affectionGain = Math.floor(expGain / 2);
    for (const t of traits) {
      if (traitEffects[t]?.modifyMiniGameExp) {
        expGain = traitEffects[t].modifyMiniGameExp(expGain);
      }
      if (traitEffects[t]?.modifyAffection) {
        affectionGain = traitEffects[t].modifyAffection(affectionGain);
      }
    }

    critter.experience += expGain;
    critter.affection += affectionGain;

    const species = await CritterSpecies.findOne({ species: critter.species });
    const nextLvl = Math.floor(Math.sqrt(critter.experience / 50)) + 1;
    if (nextLvl > critter.level) {
      critter.level = nextLvl;
      const newTrait = species?.passiveTraitsByLevel?.[String(nextLvl)];
      if (newTrait && !traits.includes(newTrait)) {
        critter.traits = { ...(critter.traits || {}), [newTrait]: true };
      }
    }

    await critter.save();

    let coinsGained = 0,
      newCoinBalance;
    if (game === 'coin-catcher' && finalScore > 0) {
      coinsGained = finalScore;
      const inv = await UserInventory.findOneAndUpdate(
        { userId: req.user._id },
        { $inc: { 'resources.coins': coinsGained } },
        { new: true, upsert: true }
      );
      newCoinBalance = inv.resources.coins;
    }

    const payload = {
      message: 'Mini-game rewards applied.',
      newLevel: critter.level,
      newAffection: critter.affection,
      expGained: expGain,
      affectionGained: affectionGain,
    };
    if (game === 'coin-catcher') {
      payload.coinsGained = coinsGained;
      payload.newCoinBalance = newCoinBalance;
    }

    res.json(payload);
  } catch (err) {
    console.error('Error handling mini-game:', err);
    res.status(500).json({ error: 'Failed to apply mini-game rewards.' });
  }
};
