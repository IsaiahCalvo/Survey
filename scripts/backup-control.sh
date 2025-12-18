#!/bin/bash
# Backup control script - manage your automated backups

PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"
SCRIPT_PATH="$PROJECT_DIR/scripts/auto-backup.sh"
DAEMON_PATH="$PROJECT_DIR/scripts/backup-daemon.sh"
PID_FILE="$PROJECT_DIR/scripts/backup-daemon.pid"
BACKUP_LOG="$PROJECT_DIR/scripts/backup.log"

case "$1" in
    start)
        # Check if daemon already running
        if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            echo "Backup daemon already running (PID: $(cat $PID_FILE))"
            exit 0
        fi

        echo "Starting backup daemon..."
        nohup "$DAEMON_PATH" > /dev/null 2>&1 &
        sleep 1

        if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            echo "✓ Backup daemon started (PID: $(cat $PID_FILE))"
            echo "  Backups will run every 25 minutes"
        else
            echo "✗ Failed to start daemon"
        fi
        ;;
    stop)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                kill "$PID"
                rm -f "$PID_FILE"
                echo "✓ Backup daemon stopped"
            else
                rm -f "$PID_FILE"
                echo "Daemon was not running"
            fi
        else
            echo "Daemon is not running"
        fi
        ;;
    status)
        echo "=== Backup Status ==="
        if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
            echo "✓ Backup daemon is RUNNING (PID: $(cat $PID_FILE))"
        else
            echo "✗ Backup daemon is NOT running"
            echo "  Run './scripts/backup-control.sh start' to enable"
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
        echo "  start     - Start automatic backups (every 25 min)"
        echo "  stop      - Stop automatic backups"
        echo "  status    - Check if backup daemon is running"
        echo "  now       - Run a backup immediately"
        echo "  log       - Show recent backup log entries"
        echo "  history   - Show last 10 backup commits"
        echo "  restore   - Restore to a specific backup"
        echo "  test-ssh  - Test GitHub SSH connection"
        ;;
esac
