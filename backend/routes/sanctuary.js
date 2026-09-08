const express = require('express');
const router = express.Router();
const sanctuaryController = require('../controllers/sanctuaryController');
const { authenticate } = require('../middleware/auth');

router.get('/resources', authenticate, sanctuaryController.claimPassiveResources);
router.post('/minigame/start', authenticate, sanctuaryController.startMiniGame);
router.post('/minigame/complete', authenticate, sanctuaryController.handleMiniGameResult);

module.exports = router;
