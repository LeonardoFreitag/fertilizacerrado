# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder

# Toolchain para native addons + openssl para o engine do Prisma
RUN apk add --no-cache python3 make g++ openssl

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Manifestos antes do código para aproveitar o cache de camadas
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# ---------- Stage 2: production ----------
FROM node:20-alpine AS production

RUN apk add --no-cache openssl tini \
    && corepack enable && corepack prepare pnpm@latest --activate

ENV NODE_ENV=production

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/prisma ./prisma
# prisma/seed.ts roda via ts-node e importa de src/ (env, política de senha)
COPY --from=builder --chown=appuser:appgroup /app/tsconfig.json ./
COPY --from=builder --chown=appuser:appgroup /app/src ./src

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

# tini como PID 1: repassa sinais ao Node e recolhe processos zombie
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
