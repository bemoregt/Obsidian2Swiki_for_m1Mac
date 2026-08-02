#!/usr/bin/env bash
# Start the local Ollama server (detached).
set -e
export PATH="$HOME/opt/ollama/bin:$PATH"
mkdir -p "$HOME/.local/state/ollama"
PIDFILE="$HOME/.local/state/ollama/server.pid"
LOG="$HOME/.local/state/ollama/server.log"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Already running (pid $(cat "$PIDFILE"))."
  exit 0
fi
setsid nohup ollama serve >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"
sleep 2
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Started (pid $(cat "$PIDFILE"))."
else
  echo "Failed to start. See $LOG"
  exit 1
fi
