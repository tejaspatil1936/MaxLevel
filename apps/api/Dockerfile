# syntax=docker/dockerfile:1
FROM node:24-alpine AS builder

WORKDIR /app
RUN npm install -g pnpm@12.14.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api/ ./apps/api/

RUN pnpm --filter @mitaoe/api run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

RUN npm install -g pnpm@12.14.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 4000

CMD ["node", "apps/api/dist/server.js"]
