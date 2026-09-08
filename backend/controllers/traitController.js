const Critter = require('../models/Critter');
const UserInventory = require('../models/UserInventory');
const CritterSpecies = require('../models/CritterSpecies');
const mongoose = require('mongoose');

exports.unlockTrait = async (req, res) => {
  const userId = req.user._id;
  const { critterId, trait } = req.body;
  const cost = 50;
  const session = await mongoose.startSession();
  try {
    let inv;
    let critter;
    await session.withTransaction(async () => {
      critter = await Critter.findOne({ _id: critterId, ownerId: userId }).session(session);
      if (!critter) {
        const error = new Error('Critter not found');
        error.status = 404;
        throw error;
      }

      const species = await CritterSpecies.findOne({ species: critter.species }).session(session);
      const traitName = typeof trait === 'string' ? trait.trim() : '';
      if (!traitName || !species?.unlockableTraits?.includes(traitName)) {
        const error = new Error('Trait is not unlockable for this species');
        error.status = 400;
        throw error;
      }
      if (critter.traits && critter.traits[traitName]) {
        const error = new Error('Trait already unlocked');
        error.status = 409;
        throw error;
      }

      inv = await UserInventory.findOneAndUpdate(
        { userId, shards: { $gte: cost } },
        { $inc: { shards: -cost } },
        { new: true, session }
      );
      if (!inv) {
        const error = new Error('Not enough shards');
        error.status = 400;
        throw error;
      }

      critter.traits = { ...(critter.traits || {}), [traitName]: true };
      await critter.save({ session });
    });

    res.json({
      message: `Unlocked trait ${trait}`,
      newShards: inv.shards,
      traits: critter.traits,
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.status ? error.message : 'Failed to unlock trait',
    });
  } finally {
    await session.endSession();
  }
};
