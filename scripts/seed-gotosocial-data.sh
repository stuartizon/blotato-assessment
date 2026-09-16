#!/bin/sh
# Runs inside curlimages/curl (see docker-compose.yml's gotosocial-seed
# service) to seed the local GoToSocial instance with a few sample posts
# and comments, so `docker compose up -d` alone gives you real content to
# explore/test against — see "Real platform integration: GoToSocial" in
# docs/ASSUMPTIONS.md.
#
# GoToSocial's OAuth flow turns out to be fully scriptable with plain HTTP
# (sign in, authorize, exchange — no browser needed), which is what makes
# this automatic. That's distinct from provisioning GTS_ACCESS_TOKEN for
# *our own app* (scripts/setup-gotosocial.sh), which stays a deliberate,
# separate manual step — this script's OAuth token is used once, here, and
# discarded.
set -e

APP_NAME="blotato-assessment-seed"
SCOPES="read write"

# Extracts a flat "field":"value" string from GoToSocial's compact
# (non-pretty-printed) JSON responses. Not a general JSON parser — relies
# on the field appearing unnested and first-of-its-name, true for every
# field this script reads (verified against a live instance).
json_field() {
  grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

# Same idea, for a bare (unquoted) numeric field.
json_number_field() {
  grep -o "\"$1\":[0-9]*" | head -1 | cut -d':' -f2
}

# Extracts "name=value" from the first Set-Cookie header in raw response
# headers read from stdin. GoToSocial scopes its session cookie to
# GTS_HOST ("localhost", for the human-facing manual flow in
# setup-gotosocial.sh), but this script talks to the container over the
# Docker network as "gotosocial" — a legitimate host/cookie-domain
# mismatch, so curl's own cookie jar (which enforces domain matching)
# won't do here; the cookie is threaded through manually instead.
extract_cookie() {
  grep -i '^set-cookie:' | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: *//' | cut -d';' -f1
}

echo "==> Registering OAuth app..."
APP_JSON=$(curl -s -X POST "$GTS_BASE_URL/api/v1/apps" \
  -H 'Content-Type: application/json' \
  -d "{\"client_name\":\"$APP_NAME\",\"redirect_uris\":\"urn:ietf:wg:oauth:2.0:oob\",\"scopes\":\"$SCOPES\"}")
CLIENT_ID=$(echo "$APP_JSON" | json_field client_id)
CLIENT_SECRET=$(echo "$APP_JSON" | json_field client_secret)
if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "Failed to register OAuth app: $APP_JSON" >&2
  exit 1
fi

AUTHORIZE_URL="$GTS_BASE_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=read%20write"

echo "==> Signing in as the seed account..."
COOKIE=$(curl -s -D - "$AUTHORIZE_URL" -o /dev/null | extract_cookie)

SIGNIN_HEADERS=$(curl -s -D - -X POST "$GTS_BASE_URL/auth/sign_in" \
  -H "Cookie: $COOKIE" \
  --data-urlencode "username=$GTS_SEED_EMAIL" \
  --data-urlencode "password=$GTS_SEED_PASSWORD" -o /dev/null)
NEW_COOKIE=$(echo "$SIGNIN_HEADERS" | extract_cookie)
[ -n "$NEW_COOKIE" ] && COOKIE="$NEW_COOKIE"

curl -s -H "Cookie: $COOKIE" "$GTS_BASE_URL/oauth/authorize" -o /dev/null

echo "==> Authorizing the app..."
CODE=$(curl -s -D - -X POST "$GTS_BASE_URL/oauth/authorize" -H "Cookie: $COOKIE" -o /dev/null \
  | grep -i '^location' | sed -E 's/.*code=([A-Za-z0-9]+).*/\1/' | tr -d '\r')
if [ -z "$CODE" ]; then
  echo "Failed to obtain an authorization code (sign-in likely failed)." >&2
  exit 1
fi

echo "==> Exchanging the code for an access token..."
TOKEN_JSON=$(curl -s -X POST "$GTS_BASE_URL/oauth/token" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\",\"redirect_uri\":\"urn:ietf:wg:oauth:2.0:oob\",\"grant_type\":\"authorization_code\",\"code\":\"$CODE\"}")
ACCESS_TOKEN=$(echo "$TOKEN_JSON" | json_field access_token)
if [ -z "$ACCESS_TOKEN" ]; then
  echo "Failed to exchange code for a token: $TOKEN_JSON" >&2
  exit 1
fi

# Idempotency check: skip re-seeding if the seed account already has posts
# from a previous `docker compose up` run, rather than piling up
# duplicates. Checking the account's own state (not a marker file) also
# sidesteps needing write access to the gotosocial-data volume, which this
# container doesn't otherwise need and doesn't own (it's owned by
# gotosocial's UID, not curl_user's).
EXISTING_STATUSES=$(curl -s "$GTS_BASE_URL/api/v1/accounts/verify_credentials" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | json_number_field statuses_count)
if [ -n "$EXISTING_STATUSES" ] && [ "$EXISTING_STATUSES" -gt 0 ]; then
  echo "Seed account already has $EXISTING_STATUSES status(es) — skipping re-seed."
  exit 0
fi

# Posts $1, optionally in reply to $2, and prints the created status id.
post_status() {
  text="$1"
  reply_to="$2"
  if [ -n "$reply_to" ]; then
    curl -s -X POST "$GTS_BASE_URL/api/v1/statuses" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      --data-urlencode "status=$text" \
      --data-urlencode "in_reply_to_id=$reply_to" \
      --data-urlencode "visibility=public" | json_field id
  else
    curl -s -X POST "$GTS_BASE_URL/api/v1/statuses" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      --data-urlencode "status=$text" \
      --data-urlencode "visibility=public" | json_field id
  fi
}

echo "==> Posting seed content..."

POST1=$(post_status "Just shipped the comment sync worker for the multi-platform comments API - replies now go out async via pg-boss.")
REPLY1=$(post_status "Nice, how are you handling retries on platform 5xxs?" "$POST1")
post_status "PlatformApiError.retryable = true means the worker lets pg-boss's backoff handle it." "$REPLY1" >/dev/null

POST2=$(post_status "Anyone else self-hosting GoToSocial for local dev instead of mocking the whole platform API?")
post_status "Yep - real HTTP, real edit semantics, no app-review wait. Worth it." "$POST2" >/dev/null

POST3=$(post_status "TIL GoToSocial's OAuth flow is fully scriptable with curl - no browser step needed after all.")
post_status "Wait really? I thought that needed a manual step." "$POST3" >/dev/null

echo "==> Done seeding. Post ids (use as external_post_id for a test published_posts row):"
echo "      $POST1"
echo "      $POST2"
echo "      $POST3"
