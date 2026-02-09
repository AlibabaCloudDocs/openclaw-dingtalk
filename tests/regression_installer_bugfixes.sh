#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installer="${repo_root}/scripts/openclaw_installer.sh"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp_dir" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

pass() {
  echo "PASS: $*"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

require_cmd bash
require_cmd node

export CLAWDBOT_INSTALL_SH_NO_RUN=1
# shellcheck disable=SC1090
source "$installer"

# Silence UI/log helpers during tests.
spinner_start() { :; }
spinner_stop() { :; }
log() { :; }
clack_intro() { :; }
clack_outro() { :; }

get_channel_display_name() { echo "钉钉 (DingTalk)"; }
clear_npm_cache() { :; }
install_channel_plugin() { :; }
config_exists() { return 0; }
config_backup() { :; }
config_set() { :; }
config_delete() { :; }

## ============================================================
## Regression 1: --channel-add dingtalk should NOT prompt twice
## ============================================================

CONFIGURE_DINGTALK_CALLED=0
configure_channel_dingtalk() {
  CONFIGURE_DINGTALK_CALLED=$((CONFIGURE_DINGTALK_CALLED + 1))
  CHANNEL_DINGTALK_CLIENT_ID="test_client_id"
  CHANNEL_DINGTALK_CLIENT_SECRET="test_client_secret"
  return 0
}

CHANNEL_ACTION="add"
CHANNEL_TARGET="dingtalk"
run_channel_flow >/dev/null 2>&1 || fail "run_channel_flow(add dingtalk) failed"

if [[ "$CONFIGURE_DINGTALK_CALLED" -ne 1 ]]; then
  fail "configure_channel_dingtalk called ${CONFIGURE_DINGTALK_CALLED} times (expected 1)"
fi

pass "channel-add dingtalk prompts once when config exists"

## ============================================================
## Regression 2: plugin install/upgrade should restart gateway
## when gateway is running (even if service.loaded is false)
## ============================================================

fake_claw="${tmp_dir}/fake-openclaw"
restart_log="${tmp_dir}/restarts.log"
status_file="${tmp_dir}/status.json"

: >"$restart_log"

cat >"$fake_claw" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "gateway" && "${2:-}" == "status" && "${3:-}" == "--json" ]]; then
  cat "${FAKE_STATUS_FILE}"
  exit 0
fi

if [[ "${1:-}" == "gateway" && "${2:-}" == "restart" ]]; then
  echo "restart" >> "${FAKE_RESTART_LOG}"
  exit 0
fi

exit 2
EOF
chmod +x "$fake_claw"

export FAKE_STATUS_FILE="$status_file"
export FAKE_RESTART_LOG="$restart_log"

# Case: running true -> should restart
echo '{"service":{"loaded":false,"running":true}}' >"$status_file"
restart_gateway_if_running "$fake_claw"
grep -q "restart" "$restart_log" || fail "expected gateway restart when service.running=true"

# Case: running false -> should NOT restart
: >"$restart_log"
echo '{"service":{"loaded":true,"running":false}}' >"$status_file"
restart_gateway_if_running "$fake_claw"
if grep -q "restart" "$restart_log"; then
  fail "unexpected gateway restart when service.running=false"
fi

pass "gateway restarts only when running"

