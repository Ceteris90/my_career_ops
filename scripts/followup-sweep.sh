#!/bin/zsh
# Unattended follow-up sweep, run via launchd (see docs/AUTOMATION.md).
# Never sends anything -- writes drafts to output/ for the user to review.

set -euo pipefail

REPO="$(cd "$(dirname "${0}")/.." && pwd)"
# Drafts and the sweep log live in the data root. CAREER_OPS_ROOT lets a
# non-default layout (and the test harness) keep those files off the checkout.
ROOT="${CAREER_OPS_ROOT:-$REPO}"
OUT_DIR="$ROOT/output"
DATE_STR="$(date +%Y-%m-%d)"
DRAFT_FILE="$OUT_DIR/followup-drafts-$DATE_STR.md"
LOG_FILE="$ROOT/data/followup-sweep.log"

mkdir -p "$OUT_DIR" "$(dirname "$LOG_FILE")"
cd "$REPO"

# Skip before spending an agent turn when the user turned follow-ups off.
# loadFollowupsEnabled is the same source of truth as followup-cadence.mjs.
if node --input-type=module -e "import { loadFollowupsEnabled } from './followup-cadence.mjs'; process.exit(loadFollowupsEnabled() ? 1 : 0)"; then
  {
    echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep skipped: follow-ups are turned off (follow_ups.enabled: false) ==="
  } >> "$LOG_FILE"
  exit 0
fi

PROMPT="Run the career-ops 'followup' mode (modes/followup.md) against $ROOT/data/applications.md and $ROOT/data/follow-ups.md. Run node followup-cadence.mjs, and for every overdue/urgent entry generate the follow-up email/LinkedIn draft per the mode's framework (voice-dna.md guardrails apply). Write the full dashboard plus every generated draft to $DRAFT_FILE as markdown. Do NOT send, submit, or record anything as sent -- draft-only, for the user to review later. If there is nothing overdue/urgent, write a one-line note to that file saying so instead."

{
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep starting ==="
  claude -p "$PROMPT"
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') follow-up sweep done -> $DRAFT_FILE ==="
} >> "$LOG_FILE" 2>&1

if [ -f "$DRAFT_FILE" ]; then
  osascript -e "display notification \"Follow-up drafts ready: $DRAFT_FILE\" with title \"career-ops\"" >/dev/null 2>&1 || true
fi
