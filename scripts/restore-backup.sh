#!/bin/bash
# Script to restore from a previous backup
# Lists recent backup commits and allows user to checkout a specific state

PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"
cd "$PROJECT_DIR" || exit 1

echo "=== Restore Backup ==="
echo "Fetching recent backups..."

# list last 20 commits with "Backup" in the message
git log --grep="Backup:" --pretty=format:"%h - %cd - %s" --date=local -n 20 > /tmp/recent_backups.txt

if [ ! -s /tmp/recent_backups.txt ]; then
    echo "No recent backups found."
    exit 0
fi

# Display backups with line numbers
cat -n /tmp/recent_backups.txt

echo ""
echo "Enter the number of the backup you want to restore to (or 'q' to quit):"
read -r choice

if [[ "$choice" == "q" ]]; then
    echo "Operation cancelled."
    exit 0
fi

# Validate input
if ! [[ "$choice" =~ ^[0-9]+$ ]]; then
    echo "Invalid input."
    exit 1
fi

# Get the commit hash for the selected line
COMMIT_HASH=$(sed -n "${choice}p" /tmp/recent_backups.txt | awk '{print $1}')

if [ -z "$COMMIT_HASH" ]; then
    echo "Invalid selection."
    exit 1
fi

echo "You selected commit: $COMMIT_HASH"
echo "WARNING: This will detach your HEAD state and revert files to this point in time."
echo "Any uncommitted changes will be lost."
echo "Are you sure? (y/n)"
read -r confirm

if [[ "$confirm" == "y" ]]; then
    git checkout "$COMMIT_HASH"
    echo "Restored to backup $COMMIT_HASH"
    echo "You are now in a 'detached HEAD' state."
    echo "To modify code from here, create a new branch: git checkout -b restore-branch-$COMMIT_HASH"
else
    echo "Restore cancelled."
fi

rm /tmp/recent_backups.txt
