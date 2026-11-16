#!/bin/sh
# Default command of the Docker image: prepares the local D1 database and
# serves the API on http://localhost:8787.
set -e

if [ ! -f .dev.vars ]; then
  echo "No .dev.vars mounted: using .dev.vars.example (placeholder JWT_SECRET, local only)."
  cp .dev.vars.example .dev.vars
fi

pnpm db:migrate:local
pnpm db:seed:local

exec pnpm dev --ip 0.0.0.0 --port 8787
