#!/bin/bash
# Backup control script - manage your automated backups

PLIST="com.survey.autobackup"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST.plist"
PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"

case "$1" in
    start)
        echo "Starting backup scheduler..."
        launchctl load "$PLIST_PATH" 2>/dev/null || echo "Already loaded"
        launchctl start "$PLIST" 2>/dev/null
        echo "Backup scheduler is now running (every 25 minutes)"
        ;;
    stop)
        echo "Stopping backup scheduler..."
        launchctl unload "$PLIST_PATH" 2>/dev/null || echo "Already stopped"
        echo "Backup scheduler stopped"
        ;;
    status)
        if launchctl list | grep -q "$PLIST"; then
            echo "✓ Backup scheduler is RUNNING"
            launchctl list "$PLIST"
        else
            echo "✗ Backup scheduler is NOT running"
        fi
        ;;
    now)
        echo "Running backup now..."
        "$PROJECT_DIR/scripts/auto-backup.sh"
        ;;
    log)
        echo "=== Recent backup log entries ==="
        tail -30 "$PROJECT_DIR/scripts/backup.log" 2>/dev/null || echo "No log file yet"
        ;;
    history)
        echo "=== Backup history (last 10 commits) ==="
        cd "$PROJECT_DIR"
        git log --oneline -10
        ;;
    test-ssh)
        echo "Testing GitHub SSH connection..."
        ssh -T git@github.com 2>&1
        ;;
    *)
        echo "Survey Backup Control"
        echo "====================="
        echo "Usage: $0 {start|stop|status|now|log|history|test-ssh}"
        echo ""
        echo "Commands:"
        echo "  start     - Start automatic backups (every 25 min)"
        echo "  stop      - Stop automatic backups"
        echo "  status    - Check if backup scheduler is running"
        echo "  now       - Run a backup immediately"
        echo "  log       - Show recent backup log entries"
        echo "  history   - Show last 10 backup commits"
        echo "  test-ssh  - Test GitHub SSH connection"
        ;;
esac
