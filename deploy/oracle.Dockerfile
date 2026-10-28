FROM node:20.19.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY oracle/package.json oracle/package-lock.json ./oracle/
RUN cd oracle && npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node oracle ./oracle
COPY --chown=node:node backEnd/model-params.json backEnd/triage-policy.json ./backEnd/
COPY --chown=node:node backEnd/artifacts/xgboost-advisory-v1.json backEnd/artifacts/xgboost-advisory-manifest.json ./backEnd/artifacts/
COPY --chown=node:node backEnd/artifacts/xgboost-protocol-v3.json ./backEnd/artifacts/
COPY --chown=node:node backEnd/services/advisoryContextService.js backEnd/services/continuousFeatureService.js ./backEnd/services/
COPY --chown=node:node backEnd/research/context.js backEnd/research/phase3-plan.json ./backEnd/research/
COPY --chown=node:node scripts/observability.js ./scripts/observability.js

USER node
WORKDIR /app/oracle
CMD ["node", "index.js"]
