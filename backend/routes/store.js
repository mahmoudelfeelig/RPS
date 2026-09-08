const express = require('express');
const router = express.Router();
const {
  getStoreItems,
  createStoreItem,
  purchaseItem,
  getUserStoreInfo,
  consumeItem,
} = require('../controllers/storeController');
const { authenticate, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { publicUploadUrl, validateImageUpload } = require('../utils/uploadStorage');

router.get('/', getStoreItems);
router.get('/items', getStoreItems);
router.get('/user', authenticate, getUserStoreInfo);
router.post('/create', authenticate, authorize('admin', 'game-master'), createStoreItem);
router.post('/purchase', authenticate, purchaseItem);
router.post('/consume/:itemId', authenticate, consumeItem);
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
