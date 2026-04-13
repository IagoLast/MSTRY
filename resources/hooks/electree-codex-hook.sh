#!/bin/bash
# Electree Codex hook — writes session status to /tmp/electree-codex/
# so the Electree app can display Codex state in terminal tabs.

INPUT=$(cat)
DIR="/tmp/electree-codex"
mkdir -p "$DIR" 2>/dev/null

field() { printf '%s' "$INPUT" | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

SID=$(field session_id)
if [ -z "$SID" ]; then
  echo "{}"
  exit 0
fi

EVT=$(field hook_event_name)
FILE="$DIR/$SID.json"

case "$EVT" in
  SessionStart)                     S=idle    ;;
  PreToolUse|PostToolUse|UserPromptSubmit) S=working ;;
  Stop)                             S=idle    ;;
  *)                                echo "{}"; exit 0 ;;
esac

CWD_VAL=$(field cwd)
TP=$(field transcript_path)

PROMPT=""
if [ "$EVT" = "UserPromptSubmit" ]; then
  PROMPT=$(printf '%s' "$INPUT" | grep -o '"prompt":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

CODEX_PID=$PPID
CUR=$CODEX_PID
SHELL_PID=0
while [ -n "$CUR" ] && [ "$CUR" -gt 1 ] 2>/dev/null; do
  PNAME=$(ps -o comm= -p "$CUR" 2>/dev/null | tr -d ' ' | sed 's:.*/::')
  if [[ "$PNAME" != "node" && "$PNAME" != "codex" ]]; then
    SHELL_PID=$CUR
    break
  fi
  CUR=$(ps -o ppid= -p "$CUR" 2>/dev/null | tr -d ' ')
done

if [ "${SHELL_PID:-0}" -eq 0 ] 2>/dev/null; then
  SHELL_PID=$(ps -o ppid= -p "$CODEX_PID" 2>/dev/null | tr -d ' ')
fi

EXISTING_PROMPT=""
if [ -f "$FILE" ] && [ -z "$PROMPT" ]; then
  EXISTING_PROMPT=$(grep -o '"prompt":"[^"]*"' "$FILE" | head -1 | cut -d'"' -f4)
fi
FINAL_PROMPT=$(json_escape "${PROMPT:-$EXISTING_PROMPT}")

CWD_ESCAPED=$(json_escape "$CWD_VAL")
TP_ESCAPED=$(json_escape "$TP")

printf '%s\n' "{\"session_id\":\"$SID\",\"status\":\"$S\",\"cwd\":\"$CWD_ESCAPED\",\"transcript_path\":\"$TP_ESCAPED\",\"shell_pid\":${SHELL_PID:-0},\"agent_pid\":${CODEX_PID:-0},\"prompt\":\"$FINAL_PROMPT\"}" > "$FILE"

echo "{}"
exit 0
