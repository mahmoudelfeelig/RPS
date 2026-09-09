FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

COPY --chown=node:node backend ./backend

RUN mkdir -p /data/uploads && chown -R node:node /data/uploads

WORKDIR /app/backend

ENV NODE_ENV=production
EXPOSE 5000

USER node
CMD ["node", "index.js"]
