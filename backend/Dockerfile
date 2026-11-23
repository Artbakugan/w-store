FROM node:24-trixie-slim

ENV NODE_ENV=production
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm ci --omit=dev && node -e "require('sqlite3')"

COPY backend/*.js ./
COPY backend/api/ ./api/
COPY backend/domain/ ./domain/
COPY backend/service/ ./service/
COPY backend/tests/ ./tests/
COPY frontend/index.html frontend/resilience.js ../frontend/

USER node
EXPOSE 3000
CMD ["node", "server.js"]
