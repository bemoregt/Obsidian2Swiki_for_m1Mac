#!/usr/bin/env bash
# Stop the local Ollama server.
set -e
PIDFILE="$HOME/.local/state/ollama/server.pid"
if [ -f "$PIDFILE" ]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    echo "Stopped (pid $PID)."
  else
    echo "Not running (stale pid $PID)."
  fi
  rm -f "$PIDFILE"
else
  echo "No pid file. Not running?"
fi
