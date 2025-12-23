#!/bin/bash
# Script to add safety configurations to the local git repo
# Prevents deleting information on the remote

PROJECT_DIR="/Users/isaiahcalvo/Desktop/Survey"
cd "$PROJECT_DIR" || exit 1

echo "=== Configuring Backup Protections ==="

# 1. Prevent non-fast-forward pushes (rewriting history)
# Note: This affects pushing to the remote primarily, but we can set local safety too
# For local safety, we primarily want to avoid accidental resets if possible, but git is flexible.
# The most important part is configuring the PUSH to fail if it would overwrite history.

# Since we can't configure the GitHub remote server settings from here (only repo admins can via UI),
# we will configure the local client to be safer.

# Enable protection against force pushing
git config push.followTags true

# We can create a pre-push hook to block force pushes
HOOK_FILE=".git/hooks/pre-push"
echo "Creating pre-push hook to block force pushing..."

cat > "$HOOK_FILE" << 'EOF'
#!/bin/bash
# Block force pushes to prevent overwriting backups

while read local_ref local_sha remote_ref remote_sha
do
    if [ "$remote_sha" != "0000000000000000000000000000000000000000" ] && [ "$local_sha" != "0000000000000000000000000000000000000000" ]; then
        # Check if the push is a fast-forward
        if ! git merge-base --is-ancestor "$remote_sha" "$local_sha"; then
            echo "ERROR: Force push detected! This is blocked to protect backups."
            echo "If you really must force push, delete this hook (.git/hooks/pre-push)."
            exit 1
        fi
    fi
done

exit 0
EOF

chmod +x "$HOOK_FILE"

echo "Protection enabled: Pre-push hook installed."
echo "NOTE: GitHub branch protection rules should also be enabled in the repo settings for maximum security."
