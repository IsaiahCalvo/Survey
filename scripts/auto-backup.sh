#!/bin/bash
# Auto-backup script for Survey project
# Runs every 25 minutes via launchd, keeps last 10 backups

PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"
LOG_FILE="$PROJECT_DIR/scripts/backup.log"
MAX_BACKUPS=10

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

# Count current commits on main
COMMIT_COUNT=$(git rev-list --count HEAD 2>/dev/null || echo "0")
log "Total commits: $COMMIT_COUNT"

# If we have more than MAX_BACKUPS commits, keep only the last MAX_BACKUPS
if [ "$COMMIT_COUNT" -gt "$MAX_BACKUPS" ]; then
    log "Pruning: keeping last $MAX_BACKUPS of $COMMIT_COUNT commits"

    # Create a consolidated first commit with all old content
    # then cherry-pick the recent commits on top

    # Save current HEAD
    CURRENT_HEAD=$(git rev-parse HEAD)

    # Get the commit that will become our new "base" (oldest to keep)
    NEW_BASE=$(git rev-list HEAD | tail -n +$MAX_BACKUPS | head -1)

    # Create orphan branch with the content of NEW_BASE
    git checkout --orphan temp-rebase 2>/dev/null
    git reset --hard "$NEW_BASE" 2>/dev/null

    # Amend to create clean root commit
    git commit --amend -m "Base: Consolidated history" --quiet 2>/dev/null || true

    # Cherry-pick the recent commits (excluding the base)
    RECENT_COMMITS=$(git rev-list --reverse "$NEW_BASE".."$CURRENT_HEAD" 2>/dev/null)
    for commit in $RECENT_COMMITS; do
        git cherry-pick "$commit" --quiet 2>/dev/null || {
            # If cherry-pick fails, just continue
            git cherry-pick --skip 2>/dev/null || true
        }
    done

    # Replace main with our rebased history
    git branch -D main 2>/dev/null || true
    git branch -m main
    git gc --prune=now --quiet 2>/dev/null || true

    NEW_COUNT=$(git rev-list --count HEAD)
    log "Pruned to $NEW_COUNT commits"
fi

# Push to remote (force because we may have rewritten history)
log "Pushing to GitHub..."
if git push origin main --force 2>> "$LOG_FILE"; then
    log "Successfully pushed to GitHub"
else
    log "ERROR: Failed to push to GitHub"
    # Don't exit with error - we still have the local commit
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
