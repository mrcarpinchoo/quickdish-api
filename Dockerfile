# Isolated environment to test and run the API. CI runs the checks, the tests
# and the Worker build inside this image, and locally it serves the API with
# `wrangler dev`. It is never deployed: Cloudflare Workers don't run containers.

# Debian, not Alpine: workerd (used by `wrangler dev`) needs glibc.
FROM node:24-slim

ENV CI=true \
    WRANGLER_SEND_METRICS=false \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# workerd needs the system CA certificates, which the slim image leaves out.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm comes from the `packageManager` field in package.json.
RUN corepack enable

WORKDIR /app

# Dependencies first, so this layer is reused until the lockfile or the
# Prisma schema changes. `postinstall` generates the Prisma Client.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma7.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 8787

CMD ["sh", "scripts/docker-dev.sh"]
