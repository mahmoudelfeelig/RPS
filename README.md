# RPS

RPS is a full-stack betting and arcade app with a React frontend, Express API, and MongoDB backend.

## Layout

- `backend/` contains the API, models, routes, jobs, and seeders.
- `frontend/` contains the React app and static assets.

## Local Setup

- Use Node 20 or newer.
- Run `npm run install-all` from the repository root.
- Run `npm run dev` to start the frontend and API together, or use each package's `npm run dev` command separately.

## Economy

- Market assets live in `backend/config/marketAssets.js`.
- Full economy bots live in `backend/config/economyBots.js`.
- Bots are real user records marked with `isBot: true`; they earn, play, buy store items, trade assets, and unlock rewards.
- Set `ALPHA_VANTAGE_API_KEY` to enable external stock and crypto pricing.
- Set both `ECONOMY_BOTS_ENABLED=true` and `BOT_SIMULATION_ENABLED=true` to enable autonomous bot activity.

## Asset Rules

- Use `frontend/public/assets/brand/` for app branding.
- Use `frontend/public/assets/avatars/` for shared profile images.
- Use `frontend/public/assets/sounds/` for shared audio.
- Keep feature-specific assets near the feature that uses them.

## Frontend Notes

- Page-specific components should live next to the page they support.
- Keep folder names lowercase and purpose-based.
- Avoid duplicate copies of the same asset in `src/` and `public/`.
