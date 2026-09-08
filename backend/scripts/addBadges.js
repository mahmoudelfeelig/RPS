require('dotenv').config({ path: __dirname + '/../.env' });
const mongoose = require('mongoose');
const User = require('../models/User');
const {
  Types: { ObjectId },
} = mongoose;

(async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const earnedAt = new Date('2025-05-09T19:00:00.000Z');
  const oldNames = ['God among men', 'Laws of motion', 'ts pmo', 'celestial dragons'];

  const updates = {
    '681a28675c25c23cd8b1fbc6': {
      unique: { name: 'God among men', description: 'Be part of the big 3' },
    },
    '681a35e85c25c23cd8b20a1c': {
      unique: { name: 'Laws of motion', description: "Newton didn't do it like we do" },
    },
    '681a9c3f21e83eff3a70c8d9': {
      unique: { name: 'Celestial Dragon', description: 'Flew too close to the sun' },
    },
  };

  for (const [userId, { unique }] of Object.entries(updates)) {
    const user = await User.findById(userId);
    if (!user) {
      console.warn(`User ${userId} not found – skipping`);
      continue;
    }

    user.badges = user.badges.filter((b) => !oldNames.includes(b.name));

    user.badges.push({
      _id: new ObjectId(),
      name: unique.name,
      description: unique.description,
      earnedAt,
    });

    await user.save();
    console.log(`→ Badges updated for user ${userId}`);
  }

  console.log('✅ All done');
  process.exit(0);
})();
