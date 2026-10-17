#!/bin/sh
# Install the 15-minute scheduled-scan worker for the current user.
# macOS: launchd LaunchAgent. Linux: one marked crontab line.
set -eu

LABEL=io.career-ops.scheduled-scan
MARKER='# career-ops recurring scan'

if [ "$(id -u)" -eq 0 ]; then
  echo "must not run as root: the scan schedule belongs to the current user" >&2
  exit 1
fi

OS=$(uname -s)
case "$OS" in
  Darwin | Linux) ;;
  *) echo "unsupported OS: $OS" >&2; exit 1 ;;
esac

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RUNNER="$ROOT/web/scripts/scheduled-jobs-runner.mjs"
if [ ! -f "$RUNNER" ]; then
  echo "runner not found: $RUNNER" >&2
  exit 1
fi

NODE=$(command -v node || true)
if [ -z "$NODE" ]; then
  echo "node not found on PATH" >&2
  exit 1
fi

# The command quotes paths with single quotes, so a quote in a path cannot be escaped.
case "$ROOT$NODE" in
  *"'"*) echo "paths containing a single quote are not supported" >&2; exit 1 ;;
esac

mkdir -p "$ROOT/data"

# The tick file records the last check time for the status banner.
TICK="touch 'data/scheduled-jobs.json.tick'"
RUN="'$NODE' 'web/scripts/scheduled-jobs-runner.mjs' >/dev/null 2>>'data/scheduled-jobs.log'"
CMD="cd '$ROOT' && $TICK && $RUN"

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

if [ "$OS" = Darwin ]; then
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>$(xml_escape "$CMD")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Minute</key><integer>0</integer></dict>
    <dict><key>Minute</key><integer>15</integer></dict>
    <dict><key>Minute</key><integer>30</integer></dict>
    <dict><key>Minute</key><integer>45</integer></dict>
  </array>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then
    echo "launchctl bootstrap failed; a logged-in GUI session is required" >&2
    exit 1
  fi
  echo "Installed $LABEL (launchd, every 15 minutes)."
else
  TMP=$(mktemp)
  ERR=$(mktemp)
  NEW=$(mktemp)
  trap 'rm -f "$TMP" "$ERR" "$NEW"' EXIT

  if ! crontab -l >"$TMP" 2>"$ERR"; then
    if grep -q 'no crontab' "$ERR"; then
      : >"$TMP"
    else
      cat "$ERR" >&2
      exit 1
    fi
  fi

  # grep exits 1 when no line remains; that is expected.
  grep -v -F "$MARKER" "$TMP" >"$NEW" || true
  # cron treats an unescaped % as a newline.
  CRON_CMD=$(printf '%s' "$CMD" | sed 's/%/\\%/g')
  printf '*/15 * * * * %s %s\n' "$CRON_CMD" "$MARKER" >>"$NEW"
  crontab - <"$NEW"
  echo "Installed $MARKER (cron, every 15 minutes)."
fi
