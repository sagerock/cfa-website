#!/usr/bin/env bash
# CfA site doorbell — one polling cycle, headless.
# Run manually or from cron, e.g.:
#   */15 8-20 * * 1-5  /mnt/d/dev/cfa-site/doorbell/run.sh
# Runs from the CfA client folder so that session's MCP servers (Gmail via
# workspace-mcp) are available; the repo itself lives at /mnt/d/dev/cfa-site.

set -euo pipefail
REPO=/mnt/d/dev/cfa-site
WORKDIR=/mnt/d/dev/sagerock/clients/center-for-anthroposophy
STATE="$REPO/doorbell/state"
mkdir -p "$STATE"
LOG="$STATE/run-$(date +%Y%m%d-%H%M%S).log"

cd "$WORKDIR"
/home/sage/.local/bin/claude -p "$(cat "$REPO/doorbell/AGENT.md")" \
  --allowedTools "Bash,Edit,Write,Read,Glob,Grep,mcp__workspace-mcp__search_gmail_messages,mcp__workspace-mcp__get_gmail_message_content,mcp__workspace-mcp__get_gmail_thread_content,mcp__workspace-mcp__send_gmail_message,mcp__workspace-mcp__modify_gmail_message_labels" \
  >> "$LOG" 2>&1

# keep the last 40 run logs
ls -t "$STATE"/run-*.log 2>/dev/null | tail -n +41 | xargs -r rm -f
