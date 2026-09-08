const User = require('../models/User');

exports.getTopUsers = async (req, res) => {
  try {
    const sort = req.query.sort || 'balance';
    const sortOptions = {
      balance: { balance: -1 },
      wins: { betsWon: -1 },
      achievements: { achievementsCount: -1 },
    };

    const users = await User.aggregate([
      {
        $addFields: {
          achievementsCount: { $size: { $ifNull: ['$achievements', []] } },
        },
      },
      { $sort: sortOptions[sort] || { balance: -1 } },
      { $limit: 50 },
      {
        $project: {
          _id: 1,
          username: 1,
          balance: 1,
          profileImage: 1,
          betsWon: 1,
          achievementsCount: 1,
        },
      },
    ]);

    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch leaderboard users' });
  }
};
