FROM docker.io/library/node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .dockerignore tsconfig.base.json tsconfig.json ./
COPY lib ./lib
COPY artifacts/api-server ./artifacts/api-server
RUN pnpm install --frozen-lockfile --filter @workspace/api-server...
ARG TF_PROOF_SOURCE_REVISION
ARG TF_PROOF_SOURCE_DIGEST
RUN node artifacts/api-server/proofs/coolify/source-digest.mjs image
RUN node artifacts/api-server/proofs/coolify/build-migrator.mjs
COPY lib/db/migrations /app/migrations
RUN mkdir -p /app/artifacts/api-server/node_modules/.vite
RUN chown -R node:node /app
USER node
CMD ["node", "artifacts/api-server/proofs/coolify/execute.mjs", "proof"]
