# Backend

Express and MongoDB API for the RPS app.

## Stack

- Node.js
- Express
- MongoDB with Mongoose
- JWT auth
- Multer uploads
- Node cron jobs

## Layout

```text
backend/
├── controllers/
├── routes/
├── models/
├── middleware/
├── utils/
├── jobs/
├── scripts/
├── seeders/
├── public/
│   └── assets/
│       └── avatars/
├── uploads/
└── index.js
```

## Conventions

- Use `kebab-case` for routes and URL paths.
- Use `camelCase` for functions, variables, and helper files.
- Keep feature-specific code close to the feature that uses it.
- Put static files under `public/assets/<purpose>/`, not at the root of `public/`.

## Runtime Notes

- `backend/index.js` serves API routes, backend static assets, and uploaded files. The production frontend is built and served by the root Nginx image.
- `backend/public/assets/avatars/default-avatar.png` is the shared avatar fallback.
- `backend/routes/games.js` contains the RPS, spinner, casino, puzzle, and click-frenzy routes.
