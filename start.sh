#!/usr/bin/env bash
# Start the Obsidian2Swiki wiki service (detached).
set -e
cd "$(dirname "$0")"
export PATH="$HOME/opt/node/bin:$HOME/opt/ffmpeg:$PATH"
mkdir -p "$HOME/.local/state/obsidian2swiki"
PIDFILE="$HOME/.local/state/obsidian2swiki/server.pid"
LOG="$HOME/.local/state/obsidian2swiki/server.log"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Already running (pid $(cat "$PIDFILE"))."
  exit 0
fi
setsid nohup node server.js >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
sleep 1
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Started (pid $(cat "$PIDFILE"))."
else
  echo "Failed to start. See $LOG"
  exit 1
fi
