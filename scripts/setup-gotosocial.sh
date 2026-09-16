#!/usr/bin/env bash
# One-time bootstrap for the local GoToSocial instance (see docker-compose.yml
# and "Real platform integration: GoToSocial" in docs/ASSUMPTIONS.md):
# creates a test account, registers an OAuth app, walks through the one step
# that can't be scripted (opening an authorize URL and pasting back the
# resulting code), exchanges it for an access token, and posts a seed status.
#
# Usage: scripts/setup-gotosocial.sh
# Requires: docker, curl, jq, openssl on PATH, and `docker compose up -d`
# already run.
set -euo pipefail

BASE_URL="${GTS_BASE_URL:-http://localhost:8080}"
USERNAME="${GTS_SETUP_USERNAME:-blotato_test}"
EMAIL="${GTS_SETUP_EMAIL:-blotato-test@example.org}"
APP_NAME="${GTS_SETUP_APP_NAME:-blotato-assessment-setup}"
SCOPES="read write"
COMPOSE_SERVICE="gotosocial"
CRED_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.gotosocial-setup-credentials"

for bin in docker curl jq openssl; do
  command -v "$bin" >/dev/null 2>&1 || {
    echo "error: '$bin' is required but not found on PATH" >&2
    exit 1
  }
done

echo "==> Checking GoToSocial is reachable at ${BASE_URL}..."
if ! curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/api/v1/instance" | grep -q '^200$'; then
  echo "error: GoToSocial not reachable at ${BASE_URL}. Run 'docker compose up -d' first." >&2
  exit 1
fi

echo "==> Creating account '${USERNAME}'..."
PASSWORD="$(openssl rand -base64 24)"
CREATE_OUTPUT="$(docker compose exec -T "$COMPOSE_SERVICE" /gotosocial/gotosocial admin account create \
  --username "$USERNAME" --email "$EMAIL" --password "$PASSWORD" 2>&1)" && CREATE_STATUS=0 || CREATE_STATUS=$?

if [ "$CREATE_STATUS" -ne 0 ]; then
  if echo "$CREATE_OUTPUT" | grep -qi "already in use"; then
    echo "    account '${USERNAME}' already exists, reusing it."
    if [ -f "$CRED_FILE" ] && grep -q "^USERNAME=${USERNAME}$" "$CRED_FILE"; then
      PASSWORD="$(grep '^PASSWORD=' "$CRED_FILE" | cut -d= -f2-)"
      echo "    (using the password saved from a previous run of this script)"
    else
      echo "    warning: no saved credentials for '${USERNAME}' found — the" >&2
      echo "    password below won't match the existing account, so the sign-in" >&2
      echo "    step further down may fail. Either supply GTS_SETUP_USERNAME for" >&2
      echo "    a new account, or remove the gotosocial-data volume for a fully" >&2
      echo "    fresh instance." >&2
    fi
  else
    echo "error: account creation failed:" >&2
    echo "$CREATE_OUTPUT" >&2
    exit 1
  fi
else
  echo "USERNAME=${USERNAME}" >"$CRED_FILE"
  echo "PASSWORD=${PASSWORD}" >>"$CRED_FILE"
  chmod 600 "$CRED_FILE"
fi

echo "==> Registering OAuth app '${APP_NAME}'..."
APP_JSON="$(curl -s -X POST "${BASE_URL}/api/v1/apps" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg name "$APP_NAME" --arg scopes "$SCOPES" \
    '{client_name: $name, redirect_uris: "urn:ietf:wg:oauth:2.0:oob", scopes: $scopes}')")"
CLIENT_ID="$(echo "$APP_JSON" | jq -r '.client_id // empty')"
CLIENT_SECRET="$(echo "$APP_JSON" | jq -r '.client_secret // empty')"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "error: app registration failed:" >&2
  echo "$APP_JSON" >&2
  exit 1
fi

ENCODED_SCOPES="$(jq -rn --arg s "$SCOPES" '$s|@uri')"
AUTHORIZE_URL="${BASE_URL}/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=${ENCODED_SCOPES}"

echo
echo "==> Manual step required (this part can't be scripted — see docs/ASSUMPTIONS.md):"
echo "    1. Open this URL in a browser:"
echo "         ${AUTHORIZE_URL}"
echo "    2. Sign in as:"
echo "         email:    ${EMAIL}"
echo "         password: ${PASSWORD}"
echo "    3. Click 'Allow'. The resulting page shows an authorization code."
echo
if [ -n "${GTS_SETUP_AUTH_CODE:-}" ]; then
  AUTH_CODE="$GTS_SETUP_AUTH_CODE"
else
  read -rp "    Paste the code here: " AUTH_CODE
fi

echo "==> Exchanging code for an access token..."
TOKEN_JSON="$(curl -s -X POST "${BASE_URL}/oauth/token" \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg id "$CLIENT_ID" --arg secret "$CLIENT_SECRET" --arg code "$AUTH_CODE" \
    '{client_id: $id, client_secret: $secret, redirect_uri: "urn:ietf:wg:oauth:2.0:oob", grant_type: "authorization_code", code: $code}')")"
ACCESS_TOKEN="$(echo "$TOKEN_JSON" | jq -r '.access_token // empty')"

if [ -z "$ACCESS_TOKEN" ]; then
  echo "error: token exchange failed:" >&2
  echo "$TOKEN_JSON" >&2
  exit 1
fi

echo "==> Posting a seed status..."
STATUS_JSON="$(curl -s -X POST "${BASE_URL}/api/v1/statuses" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  --data-urlencode "status=Seed status posted by scripts/setup-gotosocial.sh for blotato-assessment local testing." \
  --data-urlencode "visibility=public")"
SEED_STATUS_ID="$(echo "$STATUS_JSON" | jq -r '.id // empty')"

if [ -z "$SEED_STATUS_ID" ]; then
  echo "error: seed status post failed:" >&2
  echo "$STATUS_JSON" >&2
  exit 1
fi

echo
echo "==> Done. Add this to .env:"
echo "      GTS_ACCESS_TOKEN=${ACCESS_TOKEN}"
echo
echo "    Seed status id (use as external_post_id for a test published_posts row):"
echo "      ${SEED_STATUS_ID}"
