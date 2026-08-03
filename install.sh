#!/usr/bin/env bash
# Symlink the skill into ~/.claude/skills so Claude Code can discover it.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skills/rpc-optimize"
DEST="$HOME/.claude/skills/rpc-optimize"

mkdir -p "$HOME/.claude/skills"

if [ -L "$DEST" ]; then
  echo "Replacing existing symlink at $DEST"
  rm "$DEST"
elif [ -e "$DEST" ]; then
  echo "error: $DEST exists and is not a symlink." >&2
  echo "Move or remove it first — this script will not delete real directories." >&2
  exit 1
fi

ln -s "$SRC" "$DEST"
echo "Linked $DEST -> $SRC"
echo "Restart Claude Code (or start a new session) to pick up the skill."
