#!/bin/sh
# Interactive authentication console, served via ttyd at /terminal.
# Lets the user log in either backend from the browser; credentials land in
# volume-persisted dirs (~/.claude, ~/.cli-proxy-api).
set +e

while true; do
  echo ""
  echo "==============================================="
  echo "  claude-proxy - authentication console"
  echo "==============================================="
  echo ""
  echo "  1) Log in Claude   (Claude Code CLI OAuth)"
  echo "  2) Log in Gemini   (Antigravity OAuth via CLIProxyAPI)"
  echo "  3) Shell           (claude doctor, inspect creds, ...)"
  echo "  4) Exit"
  echo ""
  printf "Select [1-4]: "
  read -r choice

  case "$choice" in
    1)
      echo ""
      echo "Starting Claude login (follow the URL, paste the code)..."
      if claude auth login 2>/dev/null; then :
      elif claude login 2>/dev/null; then :
      else
        echo "Interactive login command not found; trying setup-token..."
        claude setup-token
      fi
      echo ""
      echo "Done. Click 'restart proxy' on the dashboard to apply."
      ;;
    2)
      echo ""
      echo "Starting Antigravity OAuth login (follow the URL, paste the code)..."
      cli-proxy-api --config /app/gemini-config.yaml --antigravity-login --no-browser
      echo ""
      echo "Done. Click 'restart proxy' on the dashboard to apply."
      ;;
    3)
      exec sh
      ;;
    4)
      exit 0
      ;;
    *)
      echo "Invalid choice."
      ;;
  esac
done
