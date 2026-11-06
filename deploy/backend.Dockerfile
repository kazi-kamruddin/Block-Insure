FROM node:24.16.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY backEnd/package.json backEnd/package-lock.json ./backEnd/
RUN cd backEnd && npm ci --omit=dev --no-audit --no-fund

COPY --chown=node:node backEnd ./backEnd
COPY --chown=node:node oracle/observableFeatures.js oracle/independentAssessment.js oracle/merkleProof.js oracle/xgboostAssessment.js oracle/shadowAssessment.js oracle/advisoryBundle.js ./oracle/
COPY --chown=node:node oracle/runtimeProtocol.js oracle/protocolAssessment.js oracle/modelArtifact.js oracle/protocol.js oracle/recordIdentity.js oracle/index.js ./oracle/
COPY --chown=node:node oracle/scanRecovery.js oracle/workerHealth.js ./oracle/
COPY --chown=node:node scripts/observability.js ./scripts/observability.js

USER node
EXPOSE 5000
CMD ["node", "backEnd/server.js"]
