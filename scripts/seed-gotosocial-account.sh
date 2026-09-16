#!/bin/sh
# Runs inside the gotosocial image itself (see docker-compose.yml's
# gotosocial-account-init service, which shares gotosocial's storage
# volume) to non-interactively create the two accounts
# seed-gotosocial-data.sh then posts through: a poster (the "business")
# and a commenter (someone else engaging with its posts) — see docs/
# ASSUMPTIONS.md. Idempotent: tolerates an account already existing from a
# previous `docker compose up`.
set -e

create_account() {
  username="$1"
  email="$2"
  password="$3"

  output=$(/gotosocial/gotosocial admin account create \
    --username "$username" --email "$email" --password "$password" \
    2>&1) && status=0 || status=$?

  if [ "$status" -ne 0 ]; then
    if echo "$output" | grep -qi "already in use"; then
      echo "Account '$username' already exists, reusing it."
    else
      echo "$output" >&2
      exit 1
    fi
  else
    echo "Created account '$username'."
  fi
}

create_account "$GTS_SEED_USERNAME" "$GTS_SEED_EMAIL" "$GTS_SEED_PASSWORD"
create_account "$GTS_COMMENTER_USERNAME" "$GTS_COMMENTER_EMAIL" "$GTS_COMMENTER_PASSWORD"
