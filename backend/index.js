const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

dotenv.config();

const runStoreSeeder = require('./seeders/storeSeeder');
const { uploadsDir } = require('./utils/uploadStorage');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const betRoutes = require('./routes/bet');
const taskRoutes = require('./routes/tasks');
const achievementRoutes = require('./routes/achievements');
const adminRoutes = require('./routes/admin');
const leaderboardRoutes = require('./routes/leaderboard');
const storeRoutes = require('./routes/store');
const serviceRoutes = require('./routes/service');
const tradeRoutes = require('./routes/trades');
const marketRoutes = require('./routes/markets');
const economyRoutes = require('./routes/economy');

const gamesRoutes = require('./routes/games');
const minefieldRoutes = require('./routes/minefield');

const crittersRoutes = require('./routes/critters');
const sanctuaryRoutes = require('./routes/sanctuary');
const cosmeticsRoutes = require('./routes/cosmetics');
const gachaRoutes = require('./routes/gacha');
const traitsRoutes = require('./routes/traits');
const shopRoutes = require('./routes/shop');
const breedRoutes = require('./routes/breeding');

const requestsRoutes = require('./routes/requests');

const app = express();
const defaultOrigins = [
  ...(process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:3000', 'http://localhost:5173']),
  process.env.FRONTEND_URL,
  process.env.FRONTEND_ORIGIN,
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
]
  .filter(Boolean)
  .map((origin) => origin.trim());

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    app.use(
      cors({
        origin:
          defaultOrigins.length > 0 ? defaultOrigins : process.env.NODE_ENV === 'production' ? false : true,
        methods: 'GET,POST,PUT,PATCH,DELETE',
        credentials: true,
      })
    );
    app.use(express.json());

    fs.mkdirSync(uploadsDir, { recursive: true });
    app.use(
      '/uploads',
      express.static(uploadsDir, {
        setHeaders: (res) => {
          res.setHeader('Content-Disposition', 'attachment');
          res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
          res.setHeader('X-Content-Type-Options', 'nosniff');
        },
      })
    );
    app.use(express.static(path.join(__dirname, 'public')));

    app.use('/api/auth', authRoutes);
    app.use('/api/user', userRoutes);
    app.use('/api/bets', betRoutes);
    app.use('/api/tasks', taskRoutes);
    app.use('/api/achievements', achievementRoutes);
    app.use('/api/admin', adminRoutes);
    app.use('/api/leaderboard', leaderboardRoutes);
    app.use('/api/store', storeRoutes);
    app.use('/api/services', serviceRoutes);
    app.use('/api/trades', tradeRoutes);
    app.use('/api/markets', marketRoutes);
    app.use('/api/economy', economyRoutes);
    app.use('/api/requests', requestsRoutes);

    app.use('/api/games', gamesRoutes);
    app.use('/api/games/minefield', minefieldRoutes);

    app.use('/api/critters', crittersRoutes);
    app.use('/api/sanctuary', sanctuaryRoutes);
    app.use('/api/cosmetics', cosmeticsRoutes);
    app.use('/api/gacha', gachaRoutes);
    app.use('/api/traits', traitsRoutes);
    app.use('/api/shop', shopRoutes);
    app.use('/api/breeding', breedRoutes);

    app.get('/api/health', (req, res) => {
      res.json({ ok: true });
    });

    app.get('/', (req, res) => {
      res.send('RPS API is live');
    });

    require('./jobs/passiveResourceJob');
    require('./jobs/botSimulationJob');

    cron.schedule(
      '0 0 * * *',
      async () => {
        try {
          console.log('Running daily store seeder...');
          await runStoreSeeder();
          console.log('Store seeder completed.');
        } catch (err) {
          console.error('Store seeder failed:', err);
        }
      },
      {
        timezone: 'Europe/Berlin',
      }
    );

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Startup error:', err.message);
    process.exit(1);
  }
}

startServer();
