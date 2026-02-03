#!/bin/bash
#
# test-remote.sh - Sync code to remote server and run tests
#
# Usage:
#   ./scripts/test-remote.sh           # Run all unit tests
#   ./scripts/test-remote.sh coverage  # Run with coverage
#   ./scripts/test-remote.sh watch     # Run in watch mode
#   ./scripts/test-remote.sh integration # Run integration tests
#

set -euo pipefail

# Configuration
REMOTE_HOST="${DINGTALK_TEST_HOST:-120.27.224.240}"
REMOTE_USER="${DINGTALK_TEST_USER:-root}"
SSH_KEY="${DINGTALK_TEST_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="/opt/clawdbot-dingtalk-test"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check SSH key exists
if [[ ! -f "$SSH_KEY" ]]; then
  log_error "SSH key not found: $SSH_KEY"
  log_info "Set DINGTALK_TEST_SSH_KEY environment variable to specify a different key"
  exit 1
fi

# SSH options
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
SSH_CMD="ssh $SSH_OPTS $REMOTE_USER@$REMOTE_HOST"
SCP_CMD="scp $SSH_OPTS"

log_info "Syncing code to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"

# Create remote directory if needed
$SSH_CMD "mkdir -p $REMOTE_DIR"

# Sync files using rsync (faster than scp for updates)
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '.git' \
  --exclude 'coverage' \
  --exclude '*.log' \
  -e "ssh $SSH_OPTS" \
  "$LOCAL_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

log_info "Sync complete"

# Determine test command
TEST_CMD="npm test"
case "${1:-}" in
  coverage)
    TEST_CMD="npm run test:coverage"
    ;;
  watch)
    TEST_CMD="npm run test:watch"
    ;;
  integration)
    TEST_CMD="npm run test:integration"
    ;;
  "")
    TEST_CMD="npm test"
    ;;
  *)
    log_warn "Unknown command: $1"
    log_info "Usage: $0 [coverage|watch|integration]"
    exit 1
    ;;
esac

log_info "Installing dependencies and running tests..."

# Run npm install and tests on remote
$SSH_CMD << EOF
  set -e
  cd $REMOTE_DIR

  # Ensure Node.js is available
  if ! command -v node &> /dev/null; then
    echo "Node.js not found, attempting to load nvm..."
    export NVM_DIR="\$HOME/.nvm"
    [ -s "\$NVM_DIR/nvm.sh" ] && \. "\$NVM_DIR/nvm.sh"
  fi

  echo "Node version: \$(node --version)"
  echo "npm version: \$(npm --version)"

  # Install dependencies
  npm install --legacy-peer-deps

  # Run tests
  echo "Running: $TEST_CMD"
  $TEST_CMD
EOF

EXIT_CODE=$?

if [[ $EXIT_CODE -eq 0 ]]; then
  log_info "Tests passed!"
else
  log_error "Tests failed with exit code $EXIT_CODE"
fi

exit $EXIT_CODE
