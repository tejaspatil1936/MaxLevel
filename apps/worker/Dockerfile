# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS builder

WORKDIR /app
RUN npm install -g pnpm@12.14.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY apps/worker/ ./apps/worker/

RUN pnpm --filter @mitaoe/worker run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4001
ENV HOST=0.0.0.0

# Install dependencies for headless Chromium (PDF printing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_PATH=/usr/bin/chromium

RUN npm install -g pnpm@12.14.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

EXPOSE 4001

CMD ["node", "apps/worker/dist/server.js"]
