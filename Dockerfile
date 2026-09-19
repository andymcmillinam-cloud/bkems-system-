# ---------- Build stage ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- Runtime stage ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/db ./db
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/public ./public
EXPOSE 3000
# On container start: apply committed migrations (idempotent, non-interactive),
# seed demo/operator accounts (idempotent), then serve.
CMD npx drizzle-kit migrate || true; npx tsx db/seed.ts || true; node dist/boot.js
