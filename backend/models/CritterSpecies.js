const mongoose = require('mongoose');

const CritterSpeciesSchema = new mongoose.Schema(
  {
    species: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: '' },
    baseRarity: {
      type: String,
      enum: ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythical'],
      required: true,
    },
    foodPreferences: { type: [String], default: [] },
    playPreferences: { type: [String], default: [] },
    cosmeticsAvailable: { type: [String], default: [] },
    unlockableTraits: { type: [String], default: [] },
    evolution: {
      nextSpecies: String,
      levelReq: { type: Number, min: 1 },
      itemReq: String,
    },
    passiveTraitsByLevel: {
      type: Map,
      of: String,
    },
  },
  { timestamps: true }
);

CritterSpeciesSchema.index({ baseRarity: 1 });

module.exports = mongoose.model('CritterSpecies', CritterSpeciesSchema);
