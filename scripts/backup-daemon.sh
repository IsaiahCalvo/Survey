#!/bin/bash
# Background backup daemon - runs every 25 minutes while active
# Start: ./scripts/backup-daemon.sh &
# Stop:  ./scripts/backup-control.sh stop-daemon

PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"
PID_FILE="$PROJECT_DIR/scripts/backup-daemon.pid"
INTERVAL=1500  # 25 minutes in seconds

# Save PID so we can stop it later
echo $$ > "$PID_FILE"

echo "Backup daemon started (PID: $$)"
echo "Running every 25 minutes. Stop with: ./scripts/backup-control.sh stop-daemon"

while true; do
    "$PROJECT_DIR/scripts/auto-backup.sh"
    sleep $INTERVAL
done
