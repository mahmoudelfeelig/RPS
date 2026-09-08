const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { publicUploadUrl, validateImageUpload } = require('../utils/uploadStorage');
const {
  createAchievement,
  getAllAchievements,
  completeAchievement,
} = require('../controllers/achievementController');

router.get('/', authenticate, getAllAchievements);
router.post('/complete', authenticate, completeAchievement);
router.post('/create', authenticate, authorize('admin', 'game-master'), createAchievement);
router.post(
  '/upload',
  authenticate,
  authorize('admin', 'game-master'),
  upload.single('image'),
  validateImageUpload,
  (req, res) => {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    res.json({ url: publicUploadUrl(req.file) });
  }
);

module.exports = router;
