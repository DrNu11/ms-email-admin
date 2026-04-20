#!/usr/bin/env bash
# End-to-end isolation test via HTTP (simulates what the browser does).
# Requires: backend on :4000.
set -euo pipefail

API="${API:-http://localhost:4000/api}"
LOG=/tmp/e2e_isolation.log
: > "$LOG"

say() { printf '\n=== %s ===\n' "$*" | tee -a "$LOG"; }
run() { printf '$ %s\n' "$*" | tee -a "$LOG"; }
jq_field() { python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))"; }

# Use timestamp-based usernames so the script is idempotent.
TS=$(date +%s)
U_A="qa_a_$TS"
U_B="qa_b_$TS"
PW="pass1234"

say "register $U_A"
TA=$(curl -sS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U_A\",\"password\":\"$PW\"}" | tee -a "$LOG" | jq_field token)
echo "token-A=${TA:0:24}..." | tee -a "$LOG"

say "register $U_B"
TB=$(curl -sS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$U_B\",\"password\":\"$PW\"}" | tee -a "$LOG" | jq_field token)
echo "token-B=${TB:0:24}..." | tee -a "$LOG"

say "A imports 2 mails"
curl -sS -X POST "$API/emails/import" -H "Authorization: Bearer $TA" \
  -H 'Content-Type: text/plain' \
  --data-binary $'a1@example.com----pw----cid----rt\na2@example.com----pw----cid----rt' \
  | tee -a "$LOG"; echo

say "B imports 1 mail"
curl -sS -X POST "$API/emails/import" -H "Authorization: Bearer $TB" \
  -H 'Content-Type: text/plain' \
  --data-binary $'b1@example.com----pw----cid----rt' \
  | tee -a "$LOG"; echo

say "A lists own mails (expect 2)"
A_COUNT=$(curl -sS -H "Authorization: Bearer $TA" "$API/emails" \
  | tee -a "$LOG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["total"])')
echo "A total=$A_COUNT" | tee -a "$LOG"

say "B lists own mails (expect 1)"
B_COUNT=$(curl -sS -H "Authorization: Bearer $TB" "$API/emails" \
  | tee -a "$LOG" | python3 -c 'import sys,json;print(json.load(sys.stdin)["total"])')
echo "B total=$B_COUNT" | tee -a "$LOG"

# Grab A's first mail id to attack.
A_ID=$(curl -sS -H "Authorization: Bearer $TA" "$API/emails?pageSize=1" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["list"][0]["id"])')

say "B tries to DELETE A's id=$A_ID (expect 404)"
HTTP=$(curl -sS -o /tmp/e2e.body -w '%{http_code}' -X DELETE \
  "$API/emails/$A_ID" -H "Authorization: Bearer $TB")
echo "HTTP=$HTTP body=$(cat /tmp/e2e.body)" | tee -a "$LOG"

say "B tries to REFRESH A's id=$A_ID (expect 404)"
HTTP=$(curl -sS -o /tmp/e2e.body -w '%{http_code}' -X POST \
  "$API/emails/refresh" -H "Authorization: Bearer $TB" \
  -H 'Content-Type: application/json' -d "{\"id\":$A_ID}")
echo "HTTP=$HTTP body=$(cat /tmp/e2e.body)" | tee -a "$LOG"

say "B tries batch-delete [$A_ID] (expect deleted=0)"
curl -sS -X POST "$API/emails/batch-delete" -H "Authorization: Bearer $TB" \
  -H 'Content-Type: application/json' -d "{\"ids\":[$A_ID]}" \
  | tee -a "$LOG"; echo

say "A re-verifies own count (expect still 2)"
AFTER=$(curl -sS -H "Authorization: Bearer $TA" "$API/emails" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["total"])')
echo "A total after attacks=$AFTER" | tee -a "$LOG"

say "unauthenticated GET /api/emails (expect 401)"
HTTP=$(curl -sS -o /tmp/e2e.body -w '%{http_code}' "$API/emails")
echo "HTTP=$HTTP body=$(cat /tmp/e2e.body)" | tee -a "$LOG"

say "SUMMARY"
pass=true
[ "$A_COUNT" = "2" ] || { echo "FAIL A_COUNT=$A_COUNT expect 2" | tee -a "$LOG"; pass=false; }
[ "$B_COUNT" = "1" ] || { echo "FAIL B_COUNT=$B_COUNT expect 1" | tee -a "$LOG"; pass=false; }
[ "$AFTER" = "2" ] || { echo "FAIL AFTER=$AFTER expect 2" | tee -a "$LOG"; pass=false; }
if $pass; then
  echo "ALL GOOD — data isolation works" | tee -a "$LOG"
else
  echo "ISOLATION BROKEN — see $LOG" | tee -a "$LOG"
  exit 1
fi
