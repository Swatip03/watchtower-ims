# ── Stage 1: install deps + build ────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Cache node_modules layer separately from source
COPY package.json package-lock.json* ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

COPY . .
RUN npm run build


# ── Stage 2: serve the built app ─────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Only copy what we need to run preview
COPY --from=builder /app/dist         ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/vite.config.js ./vite.config.js

EXPOSE 5173

CMD ["npm", "run", "preview"]