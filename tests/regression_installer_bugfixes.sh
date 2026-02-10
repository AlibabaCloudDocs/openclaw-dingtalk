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

## ============================================================
## Regression 3: skip Openclaw 2026.2.6* (including -1/-2/-3)
## ============================================================# Stub npm to avoid real network installs.
NPM_INSTALL_CAPTURED_SPEC=""
npm() {
  local args=("$@")

  # Find the npm subcommand (flags may appear before it).
  local cmd=""
  local cmd_idx=-1
  local i
  for ((i = 0; i < ${#args[@]}; i++)); do
    case "${args[$i]}" in
      view|install|config|cache|list|root)
        cmd="${args[$i]}"
        cmd_idx=$i
        break
        ;;
    esac
  done

  [[ -n "$cmd" ]] || return 0

  case "$cmd" in
    view)
      # Examples:
      # - npm view openclaw@latest version --prefer-online
      # - npm view openclaw versions --json
      local spec="${args[$((cmd_idx + 1))]:-}"
      local field="${args[$((cmd_idx + 2))]:-}"
      if [[ "$spec" == "openclaw@latest" && "$field" == "version" ]]; then
        echo "2026.2.6-3"
        return 0
      fi
      if [[ "$spec" == "openclaw@2026.2.5" && "$field" == "version" ]]; then
        echo "2026.2.5"
        return 0
      fi
      if [[ "$spec" == "openclaw@2026.2.6" && "$field" == "version" ]]; then
        echo "2026.2.6"
        return 0
      fi
      if [[ "$spec" == "openclaw" && "$field" == "versions" ]]; then
        # Include blocked versions; resolver should pick 2026.2.5.
        echo '["2026.2.4","2026.2.5","2026.2.6","2026.2.6-1","2026.2.6-3"]'
        return 0
      fi
      return 0
      ;;
    config)
      return 0
      ;;
    cache)
      return 0
      ;;
    install)
      # Capture the spec after -g/--global.
      local j
      for ((j = cmd_idx; j < ${#args[@]}; j++)); do
        if [[ "${args[$j]}" == "-g" || "${args[$j]}" == "--global" ]]; then
          NPM_INSTALL_CAPTURED_SPEC="${args[$((j + 1))]:-}"
          break
        fi
      done
      return 0
      ;;
    root)
      # Minimal stub if invoked.
      echo "${tmp_dir}/npm-root"
      return 0
      ;;
    list)
      return 0
      ;;
  esac
}

# get_latest_version(openclaw, latest) should filter out blocked 2026.2.6*
latest_safe="$(get_latest_version "openclaw" "latest")"
if [[ "$latest_safe" != "2026.2.5" ]]; then
  fail "expected safe latest version 2026.2.5, got: ${latest_safe:-<empty>}"
fi

# install_clawdbot_npm(openclaw@latest) should NOT attempt to install 2026.2.6*.
NPM_INSTALL_CAPTURED_SPEC=""
install_clawdbot_npm "openclaw@latest" >/dev/null 2>&1 || fail "install_clawdbot_npm(openclaw@latest) failed"
if [[ "$NPM_INSTALL_CAPTURED_SPEC" == "openclaw@latest" || "$NPM_INSTALL_CAPTURED_SPEC" == "openclaw@2026.2.6"* ]]; then
  fail "expected npm to install safe version, got spec: ${NPM_INSTALL_CAPTURED_SPEC:-<empty>}"
fi

# Explicitly pinned blocked version should be rejected.
NPM_INSTALL_CAPTURED_SPEC=""
if install_clawdbot_npm "openclaw@2026.2.6" >/dev/null 2>&1; then
  fail "expected install_clawdbot_npm(openclaw@2026.2.6) to fail, but it succeeded"
fi
if [[ -n "$NPM_INSTALL_CAPTURED_SPEC" ]]; then
  fail "expected npm install not to run for blocked version, but got: $NPM_INSTALL_CAPTURED_SPEC"
fi

pass "openclaw 2026.2.6* is skipped/blocked during install/upgrade"

## ============================================================
## Regression 4: core install is pinned to OPENCLAW_PINNED_VERSION
## ============================================================

# Even if the user tries to force --version/--beta, the installer should pin the
# core to OPENCLAW_PINNED_VERSION for reproducibility.
NPM_INSTALL_CAPTURED_SPEC=""
install_clawdbot_npm() {
  NPM_INSTALL_CAPTURED_SPEC="${1:-}"
  return 0
}
CLAWDBOT_VERSION="latest"
USE_BETA=1
install_clawdbot >/dev/null 2>&1 || fail "install_clawdbot failed"
if [[ "$NPM_INSTALL_CAPTURED_SPEC" != "openclaw@${OPENCLAW_PINNED_VERSION}" ]]; then
  fail "expected pinned install spec openclaw@${OPENCLAW_PINNED_VERSION}, got: ${NPM_INSTALL_CAPTURED_SPEC:-<empty>}"
fi

pass "core install is pinned to ${OPENCLAW_PINNED_VERSION}"
