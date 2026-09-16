#!/bin/sh
# Runs inside curlimages/curl (see docker-compose.yml's gotosocial-seed
# service) to seed the local GoToSocial instance with sample posts and
# comments from *two different accounts*, so `docker compose up -d` alone
# gives you real content that models this project's actual premise: a
# business posts (blotato_seed), someone else comments on it
# (blotato_commenter), and the app replies automatically — see "Real
# platform integration: GoToSocial" in docs/ASSUMPTIONS.md.
#
# GoToSocial's OAuth flow turns out to be fully scriptable with plain HTTP
# (sign in, authorize, exchange — no browser needed), which is what makes
# this automatic. That's distinct from provisioning GTS_ACCESS_TOKEN for
# *our own app* (scripts/setup-gotosocial.sh), which stays a deliberate,
# separate manual step — this script's OAuth tokens are used once, here,
# and discarded.
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

# Signs in as $1/$2 (email/password) through the app registered above and
# echoes an access token. The same OAuth app can authorize any number of
# different user sessions — no need to register a separate app per account.
get_access_token() {
  email="$1"
  password="$2"
  authorize_url="$GTS_BASE_URL/oauth/authorize?client_id=$CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob&response_type=code&scope=read%20write"

  cookie=$(curl -s -D - "$authorize_url" -o /dev/null | extract_cookie)

  signin_headers=$(curl -s -D - -X POST "$GTS_BASE_URL/auth/sign_in" \
    -H "Cookie: $cookie" \
    --data-urlencode "username=$email" \
    --data-urlencode "password=$password" -o /dev/null)
  new_cookie=$(echo "$signin_headers" | extract_cookie)
  [ -n "$new_cookie" ] && cookie="$new_cookie"

  curl -s -H "Cookie: $cookie" "$GTS_BASE_URL/oauth/authorize" -o /dev/null

  code=$(curl -s -D - -X POST "$GTS_BASE_URL/oauth/authorize" -H "Cookie: $cookie" -o /dev/null \
    | grep -i '^location' | sed -E 's/.*code=([A-Za-z0-9]+).*/\1/' | tr -d '\r')
  if [ -z "$code" ]; then
    echo "Failed to obtain an authorization code for $email (sign-in likely failed)." >&2
    exit 1
  fi

  token_json=$(curl -s -X POST "$GTS_BASE_URL/oauth/token" \
    -H 'Content-Type: application/json' \
    -d "{\"client_id\":\"$CLIENT_ID\",\"client_secret\":\"$CLIENT_SECRET\",\"redirect_uri\":\"urn:ietf:wg:oauth:2.0:oob\",\"grant_type\":\"authorization_code\",\"code\":\"$code\"}")
  token=$(echo "$token_json" | json_field access_token)
  if [ -z "$token" ]; then
    echo "Failed to exchange code for a token for $email: $token_json" >&2
    exit 1
  fi
  echo "$token"
}

echo "==> Signing in as the poster account ($GTS_SEED_EMAIL)..."
POSTER_TOKEN=$(get_access_token "$GTS_SEED_EMAIL" "$GTS_SEED_PASSWORD")

# Idempotency check: the poster only ever posts top-level statuses (never
# comments), so its own statuses_count is an accurate "have we already
# seeded" signal — skip re-seeding if a previous `docker compose up` run
# already did it, rather than piling up duplicates.
EXISTING_STATUSES=$(curl -s "$GTS_BASE_URL/api/v1/accounts/verify_credentials" \
  -H "Authorization: Bearer $POSTER_TOKEN" | json_number_field statuses_count)
if [ -n "$EXISTING_STATUSES" ] && [ "$EXISTING_STATUSES" -gt 0 ]; then
  echo "Poster account already has $EXISTING_STATUSES status(es) — skipping re-seed."
  exit 0
fi

# Posts $2, optionally in reply to $3, as account token $1. Prints the
# created status id.
post_status() {
  token="$1"
  text="$2"
  reply_to="$3"
  if [ -n "$reply_to" ]; then
    curl -s -X POST "$GTS_BASE_URL/api/v1/statuses" \
      -H "Authorization: Bearer $token" \
      --data-urlencode "status=$text" \
      --data-urlencode "in_reply_to_id=$reply_to" \
      --data-urlencode "visibility=public" | json_field id
  else
    curl -s -X POST "$GTS_BASE_URL/api/v1/statuses" \
      -H "Authorization: Bearer $token" \
      --data-urlencode "status=$text" \
      --data-urlencode "visibility=public" | json_field id
  fi
}

echo "==> Posting sample posts as the poster account..."
POST1=$(post_status "$POSTER_TOKEN" "Just shipped the comment sync worker for the multi-platform comments API - replies now go out async via pg-boss.")
POST2=$(post_status "$POSTER_TOKEN" "Anyone else self-hosting GoToSocial for local dev instead of mocking the whole platform API?")
POST3=$(post_status "$POSTER_TOKEN" "TIL GoToSocial's OAuth flow is fully scriptable with curl - no browser step needed after all.")

echo "==> Signing in as the commenter account ($GTS_COMMENTER_EMAIL)..."
COMMENTER_TOKEN=$(get_access_token "$GTS_COMMENTER_EMAIL" "$GTS_COMMENTER_PASSWORD")

echo "==> Posting sample comments as the commenter account..."
post_status "$COMMENTER_TOKEN" "Nice, how are you handling retries on platform 5xxs?" "$POST1" >/dev/null
post_status "$COMMENTER_TOKEN" "Also curious what happens if the platform is down for an extended period." "$POST1" >/dev/null
post_status "$COMMENTER_TOKEN" "Yep - real HTTP, real edit semantics, no app-review wait. Worth it." "$POST2" >/dev/null
post_status "$COMMENTER_TOKEN" "Wait really? I thought that needed a manual step." "$POST3" >/dev/null

echo "==> Done seeding. Post ids (use as external_post_id for a test published_posts row):"
echo "      $POST1"
echo "      $POST2"
echo "      $POST3"
