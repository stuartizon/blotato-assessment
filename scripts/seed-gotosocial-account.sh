#!/bin/sh
# Runs inside the gotosocial image itself (see docker-compose.yml's
# gotosocial-account-init service, which shares gotosocial's storage
# volume) to non-interactively create the seed account that
# seed-gotosocial-data.sh then posts through. Idempotent: tolerates the
# account already existing from a previous `docker compose up`.
set -e

OUTPUT=$(/gotosocial/gotosocial admin account create \
  --username "$GTS_SEED_USERNAME" \
  --email "$GTS_SEED_EMAIL" \
  --password "$GTS_SEED_PASSWORD" 2>&1) && STATUS=0 || STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  if echo "$OUTPUT" | grep -qi "already in use"; then
    echo "Seed account '$GTS_SEED_USERNAME' already exists, reusing it."
  else
    echo "$OUTPUT" >&2
    exit 1
  fi
else
  echo "Created seed account '$GTS_SEED_USERNAME'."
fi
