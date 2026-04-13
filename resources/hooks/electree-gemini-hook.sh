#!/bin/bash
# Electree Gemini hook — writes session status to /tmp/electree-gemini/
# so the Electree app can display Gemini's state in terminal tabs.

# Gemini hooks receive JSON via stdin
INPUT=$(cat)
DIR="/tmp/electree-gemini"
mkdir -p "$DIR" 2>/dev/null

echo "--- $(date) --- GEMINI PID: $$ PPID: $PPID ---" >> /tmp/electree-gemini-hook-debug.log
echo "INPUT: $INPUT" >> /tmp/electree-gemini-hook-debug.log
echo "GEMINI_SESSION_ID env: $GEMINI_SESSION_ID" >> /tmp/electree-gemini-hook-debug.log
echo "GEMINI_CWD env: $GEMINI_CWD" >> /tmp/electree-gemini-hook-debug.log

# Simple JSON string field extraction (no jq dependency)
field() { echo "$INPUT" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

# Gemini provides these as env vars, which is more reliable
SID=${GEMINI_SESSION_ID}
CWD_VAL=${GEMINI_CWD}

# Fallback to JSON parsing if env vars are missing
if [ -z "$SID" ]; then
  SID=$(field session_id)
fi

if [ -z "$SID" ]; then
  echo "{}"
  exit 0
fi

EVT=$(field hook_event_name)
FILE="$DIR/$SID.json"

case "$EVT" in
  SessionStart) S=idle ;;
  BeforeAgent)  S=working ;;
  AfterAgent)   S=idle ;;
  SessionEnd)   rm -f "$FILE"; echo "{}"; exit 0 ;;
  *)            echo "{}"; echo "Unknown event: $EVT" >> /tmp/electree-gemini-hook-debug.log; exit 0 ;;
esac

if [ -z "$CWD_VAL" ]; then
  CWD_VAL=$(field cwd)
fi

# Capture user prompt on BeforeAgent or SessionStart for tab naming
PROMPT=""
if [ "$EVT" = "BeforeAgent" ] || [ "$EVT" = "SessionStart" ]; then
  # Extract prompt, escape double quotes and backslashes for JSON safety
  PROMPT=$(echo "$INPUT" | grep -o '"prompt":"[^"]*"' | head -1 | cut -d'"' -f4 | sed 's/\\/\\\\/g; s/"/\\"/g')
fi

# Traverse up from $PPID to find the shell.
# $PPID is the process that called the hook (gemini).
# We want the first ancestor that is NOT 'node' or 'gemini', which should be the shell.
CUR=$PPID
SHELL_PID=0
while [ "$CUR" -gt 1 ]; do
  PNAME=$(ps -o comm= -p "$CUR" 2>/dev/null | tr -d ' ' | sed 's:.*/::')
  if [[ "$PNAME" != "node" && "$PNAME" != "gemini" && "$PNAME" != "bash" && "$PNAME" != "zsh" && "$PNAME" != "sh" ]]; then
    SHELL_PID=$CUR
    break
  fi
  # If it's a shell, this is likely our shell
  if [[ "$PNAME" == "bash" || "$PNAME" == "zsh" || "$PNAME" == "sh" ]]; then
    SHELL_PID=$CUR
    break
  fi
  CUR=$(ps -o ppid= -p "$CUR" 2>/dev/null | tr -d ' ')
done

# Merge prompt into existing file to preserve the last known prompt across events
EXISTING_PROMPT=""
if [ -f "$FILE" ] && [ -z "$PROMPT" ]; then
  EXISTING_PROMPT=$(grep -o '"prompt":"[^"]*"' "$FILE" | head -1 | cut -d'"' -f4)
fi
FINAL_PROMPT="${PROMPT:-$EXISTING_PROMPT}"

printf '%s\n' "{\"session_id\":\"$SID\",\"status\":\"$S\",\"cwd\":\"$CWD_VAL\",\"shell_pid\":${SHELL_PID:-0},\"prompt\":\"$FINAL_PROMPT\"}" > "$FILE"

# Gemini CLI expects a JSON response on stdout
echo "{}"
exit 0
