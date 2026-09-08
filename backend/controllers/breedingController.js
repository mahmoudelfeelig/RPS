const Critter = require('../models/Critter');
const PendingBreed = require('../models/PendingBreed');
const UserInventory = require('../models/UserInventory');
const User = require('../models/User');
const mongoose = require('mongoose');

const RARITY_ORDER = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythical'];
const CritterSpecies = require('../models/CritterSpecies');

const BREED_DURATIONS = {
  Common: 6 * 60 * 60 * 1000, // 6h
  Uncommon: 12 * 60 * 60 * 1000, // 12h
  Rare: 24 * 60 * 60 * 1000, // 24h
  Legendary: 48 * 60 * 60 * 1000, // 48h
  Mythical: 96 * 60 * 60 * 1000, // 96h
};

const POST_HATCH_CD = 24 * 60 * 60 * 1000; // 24h

const PET_COST = 500;
const GOLD_FACTOR = 10;

function pickHalf(arr = []) {
  const n = Math.ceil(arr.length / 2),
    out = [],
    tmp = [...arr];
  while (out.length < n && tmp.length) {
    out.push(tmp.splice(Math.floor(Math.random() * tmp.length), 1)[0]);
  }
  return out;
}

function makeChildName(a, b, gen) {
  const hA = Math.ceil(a.length / 2),
    hB = Math.floor(b.length / 2);
  return `${a.slice(0, hA)}${b.slice(hB)}-G${gen}`;
}

exports.breedCritters = async (req, res) => {
  const userId = req.user._id;
  const { parentA, parentB, paymentMethod = 'pet' } = req.body;
  if (parentA === parentB)
    return res.status(400).json({ error: 'Must pick two different parents.' });

  const [a, b] = await Promise.all([
    Critter.findOne({ _id: parentA, ownerId: userId }),
    Critter.findOne({ _id: parentB, ownerId: userId }),
  ]);
  if (!a || !b) return res.status(404).json({ error: 'Parent not found.' });

  const now = Date.now();
  for (const p of [a, b]) {
    if (p.breeding?.hatchAt && now < p.breeding.hatchAt) {
      return res.status(400).json({ error: `${p.variant || p.species} is already breeding.` });
    }
    if (p.lastHatchedAt && now - new Date(p.lastHatchedAt) < POST_HATCH_CD) {
      return res.status(400).json({ error: `${p.variant || p.species} needs more rest.` });
    }
  }

  const goldCost = PET_COST * GOLD_FACTOR;
  if (paymentMethod === 'gold') {
    const debit = await User.updateOne(
      { _id: userId, balance: { $gte: goldCost } },
      { $inc: { balance: -goldCost } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ error: 'Not enough gold.' });
  } else {
    const debit = await UserInventory.updateOne(
      { userId, 'resources.coins': { $gte: PET_COST } },
      { $inc: { 'resources.coins': -PET_COST } }
    );
    if (debit.modifiedCount !== 1) return res.status(400).json({ error: 'Not enough pet coins.' });
  }

  const idxA = RARITY_ORDER.indexOf(a.rarity);
  const idxB = RARITY_ORDER.indexOf(b.rarity);
  const childRarity = RARITY_ORDER[Math.min(idxA, idxB)];

  const speciesDocs = await CritterSpecies.find({ baseRarity: childRarity }).lean();
  if (!speciesDocs.length) {
    if (paymentMethod === 'gold') {
      await User.findByIdAndUpdate(userId, { $inc: { balance: goldCost } });
    } else {
      await UserInventory.updateOne({ userId }, { $inc: { 'resources.coins': PET_COST } });
    }
    return res.status(500).json({ error: 'No species available for child rarity.' });
  }
  const pool = speciesDocs
    .map((d) => d.species)
    .filter((name) => name !== a.species && name !== b.species);
  let childSpecies;
  if (pool.length) {
    childSpecies = pool[Math.floor(Math.random() * pool.length)];
  } else {
    childSpecies = speciesDocs[Math.floor(Math.random() * speciesDocs.length)].species;
  }

  const ta = Object.keys(a.traits || {});
  const tb = Object.keys(b.traits || {});
  const mixed = Array.from(new Set([...pickHalf(ta), ...pickHalf(tb)]));
  const childTraits = Object.fromEntries(mixed.map((t) => [t, true]));

  const generation = Math.max(a.generation, b.generation) + 1;
  const variant = makeChildName(a.variant || a.species, b.variant || b.species, generation);

  const durA = BREED_DURATIONS[a.rarity] || BREED_DURATIONS.Common;
  const durB = BREED_DURATIONS[b.rarity] || BREED_DURATIONS.Common;
  const hatchAt = new Date(now + Math.max(durA, durB));

  const egg = await PendingBreed.create({
    userId,
    parents: [a._id, b._id],
    child: { species: childSpecies, variant, generation, rarity: childRarity, traits: childTraits },
    hatchAt,
  });

  a.breeding = { start: new Date(now), hatchAt };
  b.breeding = { start: new Date(now), hatchAt };
  await Promise.all([a.save(), b.save()]);
  const [updatedUser, updatedInv] = await Promise.all([
    paymentMethod === 'gold' ? User.findById(userId).lean() : null,
    paymentMethod === 'pet' ? UserInventory.findOne({ userId }).lean() : null,
  ]);

  res.status(201).json({
    message: 'Breeding started!',
    egg,
    newBalance: paymentMethod === 'gold' ? updatedUser?.balance : undefined,
    newPetCoins: paymentMethod === 'pet' ? updatedInv?.resources?.coins : undefined,
  });
};

exports.listEggs = async (req, res) => {
  const eggs = await PendingBreed.find({
    userId: req.user._id,
    hatched: false,
  }).sort('hatchAt');
  res.json(eggs);
};

exports.hatchEgg = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let child;
    await session.withTransaction(async () => {
      const now = new Date();
      const egg = await PendingBreed.findOneAndUpdate(
        {
          _id: req.params.id,
          userId: req.user._id,
          hatched: false,
          hatchAt: { $lte: now },
        },
        { $set: { hatched: true } },
        { new: true, session }
      );
      if (!egg) {
        const error = new Error('Egg not found, already hatched, or not ready.');
        error.status = 409;
        throw error;
      }

      [child] = await Critter.create(
        [
          {
            ownerId: egg.userId,
            species: egg.child.species,
            variant: egg.child.variant,
            rarity: egg.child.rarity,
            traits: egg.child.traits,
            parents: egg.parents,
            generation: egg.child.generation,
          },
        ],
        { session }
      );

      await Critter.updateMany(
        { _id: { $in: egg.parents } },
        {
          $unset: { breeding: '' },
          $set: { lastHatchedAt: now },
        },
        { session }
      );
    });

    res.json({ message: 'Hatched!', child });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to hatch egg.',
    });
  } finally {
    await session.endSession();
  }
};
