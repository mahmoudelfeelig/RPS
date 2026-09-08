const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { validateImageUpload } = require('../utils/uploadStorage');
const {
  updateUser,
  deleteUser,
  sendMoney,
  searchUsers,
  getStats,
  getPublicProfile,
  getMe,
} = require('../controllers/userController');
const { getTopUsers } = require('../controllers/leaderboardController');

const router = express.Router();

router.get('/me', authenticate, getMe);

router.get('/admin', authenticate, authorize('admin'), (req, res) => {
  res.json({ message: 'Tsk Tsk Tsk.' });
});

router.get('/stats', authenticate, getStats);
router.get('/search', authenticate, searchUsers);
router.get('/public/:username', getPublicProfile);

router.post('/update', authenticate, upload.single('image'), validateImageUpload, updateUser);
router.post('/delete', authenticate, deleteUser);
router.get('/top', getTopUsers);
router.post('/send-money', authenticate, sendMoney);

module.exports = router;
