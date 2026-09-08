const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const economy = require('../controllers/economyController');

const router = express.Router();

router.get('/', authenticate, economy.getEconomyOverview);

router.post('/cards/open-pack', authenticate, economy.openCardPack);
router.post('/cards/upgrade', authenticate, economy.upgradeCard);
router.post('/craft', authenticate, economy.craft);

router.post('/auctions', authenticate, authorize('admin', 'game-master'), economy.createAuction);
router.post('/auctions/:id/bid', authenticate, economy.bidAuction);
router.post(
  '/auctions/:id/settle',
  authenticate,
  authorize('admin', 'game-master'),
  economy.settleAuction
);

router.post('/loans', authenticate, economy.borrowLoan);
router.post('/loans/:id/repay', authenticate, economy.repayLoan);

router.post('/insurance', authenticate, economy.buyInsurance);

router.post('/staking', authenticate, economy.createStake);
router.post('/staking/:id/claim', authenticate, economy.claimStake);

router.post('/guilds', authenticate, economy.createGuild);
router.post('/guilds/:id/join', authenticate, economy.joinGuild);
router.post('/guilds/contribute', authenticate, economy.contributeGuild);

router.post('/raid/attack', authenticate, economy.attackRaid);
router.post('/raid/:id/claim', authenticate, economy.claimRaidReward);
router.post('/events', authenticate, economy.createMarketEvent);

module.exports = router;
