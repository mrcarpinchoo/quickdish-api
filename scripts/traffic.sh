#!/bin/sh
# Sends read-only requests to a deployed API, so the Cloudflare dashboard has
# request and CPU data to show (Workers & Pages -> the Worker -> Metrics).
#
# Usage: sh scripts/traffic.sh <api-url> [count]
#   sh scripts/traffic.sh https://quickdish-api-prod.guillermo-romero.workers.dev 300
set -eu

url=${1:?"Usage: sh scripts/traffic.sh <api-url> [count]"}
count=${2:-300}
paths="/health /categories /products"

ok=0
failed=0
i=0
while [ "$i" -lt "$count" ]; do
  for path in $paths; do
    [ "$i" -ge "$count" ] && break
    if curl -fsS -o /dev/null "$url$path"; then
      ok=$((ok + 1))
    else
      failed=$((failed + 1))
    fi
    i=$((i + 1))
  done
done

echo "Sent $count requests to $url: $ok ok, $failed failed."
