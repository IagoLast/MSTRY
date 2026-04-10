#!/bin/bash
# Electree Claude hook — writes session status to /tmp/electree-claude/
# so the Electree app can display Claude's state in terminal tabs.
INPUT=$(cat)
DIR="/tmp/electree-claude"
mkdir -p "$DIR" 2>/dev/null

# Simple JSON string field extraction (no jq dependency)
field() { echo "$INPUT" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

SID=$(field session_id)
[ -z "$SID" ] && exit 0

EVT=$(field hook_event_name)
FILE="$DIR/$SID.json"

case "$EVT" in
  PreToolUse|UserPromptSubmit) S=working ;;
  Stop)                        S=idle    ;;
  SessionEnd)                  rm -f "$FILE"; exit 0 ;;
  *)                           exit 0 ;;
esac

CWD_VAL=$(field cwd)
TP=$(field transcript_path)

# Capture user prompt on UserPromptSubmit for tab naming
PROMPT=""
if [ "$EVT" = "UserPromptSubmit" ]; then
  # Extract prompt, escape double quotes and backslashes for JSON safety
  PROMPT=$(echo "$INPUT" | grep -o '"prompt":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\\/\\\\/g; s/"/\\"/g')
fi

# $PPID is the claude process; its parent is the shell that owns the PTY
CLAUDE_PID=$PPID
SHELL_PID=$(ps -o ppid= -p "$CLAUDE_PID" 2>/dev/null | tr -d ' ')

# Merge prompt into existing file to preserve the last known prompt across events
EXISTING_PROMPT=""
if [ -f "$FILE" ] && [ -z "$PROMPT" ]; then
  EXISTING_PROMPT=$(grep -o '"prompt":"[^"]*"' "$FILE" | head -1 | cut -d'"' -f4)
fi
FINAL_PROMPT="${PROMPT:-$EXISTING_PROMPT}"

printf '%s\n' "{\"session_id\":\"$SID\",\"status\":\"$S\",\"cwd\":\"$CWD_VAL\",\"transcript_path\":\"$TP\",\"shell_pid\":${SHELL_PID:-0},\"prompt\":\"$FINAL_PROMPT\"}" > "$FILE"
exit 0
