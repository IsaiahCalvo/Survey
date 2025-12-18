#!/bin/bash
# Backup control script - manage your automated backups

PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"
SCRIPT_PATH="$PROJECT_DIR/scripts/auto-backup.sh"
CRON_LOG="$PROJECT_DIR/scripts/backup-cron.log"
BACKUP_LOG="$PROJECT_DIR/scripts/backup.log"

case "$1" in
    start)
        echo "Setting up cron job for backups every 25 minutes..."
        (crontab -l 2>/dev/null | grep -v "auto-backup.sh"; echo "*/25 * * * * $SCRIPT_PATH >> $CRON_LOG 2>&1") | crontab -
        echo "✓ Backup scheduler configured"
        echo ""
        echo "NOTE: For cron to work, grant Full Disk Access:"
        echo "  1. Open System Settings → Privacy & Security → Full Disk Access"
        echo "  2. Click + and add /usr/sbin/cron"
        echo "  (Press Cmd+Shift+G to navigate to /usr/sbin/cron)"
        ;;
    stop)
        echo "Removing backup cron job..."
        crontab -l 2>/dev/null | grep -v "auto-backup.sh" | crontab -
        echo "✓ Backup scheduler removed"
        ;;
    status)
        echo "=== Backup Status ==="
        if crontab -l 2>/dev/null | grep -q "auto-backup.sh"; then
            echo "✓ Cron job is CONFIGURED (runs every 25 minutes)"
            crontab -l | grep "auto-backup.sh"
        else
            echo "✗ Cron job is NOT configured"
        fi
        echo ""
        echo "=== Last 5 Log Entries ==="
        tail -5 "$BACKUP_LOG" 2>/dev/null || echo "No backup log yet"
        ;;
    now)
        echo "Running backup now..."
        "$SCRIPT_PATH"
        echo ""
        echo "=== Result ==="
        tail -10 "$BACKUP_LOG"
        ;;
    log)
        echo "=== Recent backup log entries ==="
        tail -30 "$BACKUP_LOG" 2>/dev/null || echo "No log file yet"
        ;;
    history)
        echo "=== Backup history (last 10 commits) ==="
        cd "$PROJECT_DIR"
        git log --oneline -10
        ;;
    restore)
        if [ -z "$2" ]; then
            echo "Usage: $0 restore <commit-hash>"
            echo ""
            echo "Available backups:"
            cd "$PROJECT_DIR"
            git log --oneline -10
            exit 1
        fi
        echo "Restoring to commit $2..."
        cd "$PROJECT_DIR"
        git checkout "$2" -- .
        echo "✓ Restored. Run 'git status' to see changes."
        ;;
    test-ssh)
        echo "Testing GitHub SSH connection..."
        ssh -T git@github.com 2>&1
        ;;
    *)
        echo "╔════════════════════════════════════╗"
        echo "║     Survey Backup Control          ║"
        echo "╚════════════════════════════════════╝"
        echo ""
        echo "Usage: ./scripts/backup-control.sh <command>"
        echo ""
        echo "Commands:"
        echo "  start     - Enable automatic backups (every 25 min)"
        echo "  stop      - Disable automatic backups"
        echo "  status    - Check if backup scheduler is running"
        echo "  now       - Run a backup immediately"
        echo "  log       - Show recent backup log entries"
        echo "  history   - Show last 10 backup commits"
        echo "  restore   - Restore to a specific backup"
        echo "  test-ssh  - Test GitHub SSH connection"
        ;;
esac
