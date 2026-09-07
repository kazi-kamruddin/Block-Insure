FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY oracle/package.json oracle/package-lock.json ./oracle/
RUN cd oracle && npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node oracle ./oracle
COPY --chown=node:node backEnd/model-params.json backEnd/triage-policy.json ./backEnd/
COPY --chown=node:node scripts/observability.js ./scripts/observability.js

USER node
WORKDIR /app/oracle
CMD ["node", "index.js"]
