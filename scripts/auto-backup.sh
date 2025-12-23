#!/bin/bash
# Auto-backup script for Survey project
# Runs every 25 minutes, keeps ALL backups (protected from force push)

PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"
LOG_FILE="$PROJECT_DIR/scripts/backup.log"

# Ensure we're in the project directory
cd "$PROJECT_DIR" || exit 1

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

log "=== Starting backup process ==="

# Ensure SSH agent is running with the correct key
export SSH_AUTH_SOCK=$(ls /tmp/ssh-*/agent.* 2>/dev/null | head -1)
if [ -z "$SSH_AUTH_SOCK" ] || ! ssh-add -l >/dev/null 2>&1; then
    eval "$(ssh-agent -s)" > /dev/null 2>&1
    ssh-add ~/.ssh/github_survey 2>/dev/null
fi

# Check if there are any changes to commit
CHANGES=$(git status --porcelain)
if [ -z "$CHANGES" ]; then
    log "No changes to backup"
    exit 0
fi

log "Changes detected:"
echo "$CHANGES" | while read line; do log "  $line"; done

# Stage all changes
git add -A

# Create commit with timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
git commit -m "Backup: $TIMESTAMP" --quiet

log "Created commit: Backup $TIMESTAMP"

# Push to remote (regular push only - force push is blocked by GitHub)
# Get current branch
CURRENT_BRANCH=$(git symbolic-ref --short HEAD)

# Push to remote (regular push only - force push is blocked by GitHub)
if [ -n "$CURRENT_BRANCH" ]; then
    log "Pushing to GitHub branch: $CURRENT_BRANCH..."
    if git push origin "$CURRENT_BRANCH" 2>> "$LOG_FILE"; then
        log "Successfully pushed to GitHub"
    else
        log "ERROR: Push failed"
    fi
else
    log "ERROR: Could not determine current branch, skipping push"
fi

# Keep log file manageable
if [ -f "$LOG_FILE" ]; then
    LINE_COUNT=$(wc -l < "$LOG_FILE" | tr -d ' ')
    if [ "$LINE_COUNT" -gt 1000 ]; then
        tail -500 "$LOG_FILE" > "$LOG_FILE.tmp"
        mv "$LOG_FILE.tmp" "$LOG_FILE"
    fi
fi

log "=== Backup complete ==="
