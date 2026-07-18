#!/bin/sh
# Interactive Claude authentication console, served via ttyd at /terminal.
# Tries the known login entrypoints across Claude Code CLI versions, then
# drops to a shell for manual steps (claude doctor, inspecting ~/.claude).
set +e

echo "==============================================="
echo "  claude-proxy - authentication console"
echo "==============================================="
echo ""
echo "Starting interactive Claude login..."
echo "(follow the URL it prints, then paste the code)"
echo ""

if claude auth login 2>/dev/null; then
  :
elif claude login 2>/dev/null; then
  :
else
  echo "Interactive login command not found; trying setup-token..."
  claude setup-token
fi

echo ""
echo "-----------------------------------------------"
echo "If login succeeded, credentials are stored in"
echo "~/.claude (persisted via the Docker volume)."
echo ""
echo "Now restart the proxy to pick them up:"
echo "  - click 'Restart proxy' on the dashboard, or"
echo "  - run: docker restart claude-proxy"
echo "-----------------------------------------------"
echo "Dropping to a shell (claude doctor is available)."
exec sh
