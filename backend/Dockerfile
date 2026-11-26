# Stage 1: Install production dependencies
FROM node:22-slim AS builder
WORKDIR /build
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Stage 2: Minimal hardened runtime
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

RUN groupadd --gid 10001 appgroup \
    && useradd --uid 10001 --gid 10001 --shell /sbin/nologin --no-create-home appuser

COPY --from=builder --chown=10001:10001 /build/node_modules ./node_modules
COPY --chown=10001:10001 package.json ./
COPY --chown=10001:10001 src ./src

USER 10001:10001
EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8000/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/server.js"]
