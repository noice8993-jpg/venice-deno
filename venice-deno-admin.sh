#!/data/data/com.termux/files/usr/bin/bash
# Venice Deno admin helper
# Set VENICE_DENO_URL & VENICE_DENO_ADMIN env, atau edit default di bawah.

URL="${VENICE_DENO_URL:-https://apikey.noice8993-jpg.deno.net}"
ADMIN="${VENICE_DENO_ADMIN:-REDACTED_OLD_ADMIN_TOKEN}"

H_ADMIN="Authorization: Bearer $ADMIN"
H_JSON="Content-Type: application/json"

pretty() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool 2>/dev/null || cat
  else
    cat
  fi
}

cmd="$1"; shift

case "$cmd" in
  keys|list-keys)
    curl -s "$URL/admin/keys" -H "$H_ADMIN" | pretty ;;
  create-key)
    NAME="${1:-unnamed}"
    curl -s -X POST "$URL/admin/keys/create" -H "$H_ADMIN" -H "$H_JSON" \
      -d "{\"name\":\"$NAME\"}" | pretty ;;
  revoke-key)
    [ -z "$1" ] && { echo "Usage: $0 revoke-key <sk-venice-xxx>"; exit 1; }
    curl -s -X POST "$URL/admin/keys/revoke" -H "$H_ADMIN" -H "$H_JSON" \
      -d "{\"key\":\"$1\"}" | pretty ;;
  delete-key)
    [ -z "$1" ] && { echo "Usage: $0 delete-key <sk-venice-xxx>"; exit 1; }
    curl -s -X POST "$URL/admin/keys/delete" -H "$H_ADMIN" -H "$H_JSON" \
      -d "{\"key\":\"$1\"}" | pretty ;;
  models|list-models)
    curl -s "$URL/admin/models" -H "$H_ADMIN" | pretty ;;
  models-ids)
    curl -s "$URL/admin/models" -H "$H_ADMIN" \
      | python3 -c "import sys,json; d=json.load(sys.stdin); [print(('[X] ' if m['disabled'] else '[ ] ')+m['id']) for m in d.get('models',[])]" ;;
  disable-model)
    [ -z "$1" ] && { echo "Usage: $0 disable-model <model-id>"; exit 1; }
    curl -s -X POST "$URL/admin/models/disable" -H "$H_ADMIN" -H "$H_JSON" \
      -d "{\"model\":\"$1\"}" | pretty ;;
  enable-model)
    [ -z "$1" ] && { echo "Usage: $0 enable-model <model-id>"; exit 1; }
    curl -s -X POST "$URL/admin/models/enable" -H "$H_ADMIN" -H "$H_JSON" \
      -d "{\"model\":\"$1\"}" | pretty ;;
  health)
    curl -s "$URL/" | pretty ;;
  test)
    KEY="${1:-${VENICE_DENO_KEY:-REDACTED_OLD_KEY2}}"
    MODEL="${2:-llama-3.3-70b}"
    MSG="${3:-halo, jawab singkat: 1+1?}"
    curl -s -X POST "$URL/v1/chat/completions" \
      -H "Authorization: Bearer $KEY" -H "$H_JSON" \
      -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"$MSG\"}],\"max_tokens\":50}" \
      | pretty ;;
  *)
    cat <<EOF
Venice Deno admin helper
URL  : $URL    (override: VENICE_DENO_URL)
ADMIN: ${ADMIN:0:8}...  (override: VENICE_DENO_ADMIN)

KEYS:    keys | create-key [name] | revoke-key <k> | delete-key <k>
MODELS:  models | models-ids | disable-model <id> | enable-model <id>
UTIL:    health | test <key> [model] [msg]
EOF
    ;;
esac
