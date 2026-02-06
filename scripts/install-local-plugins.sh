#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PLUGIN="dingtalk"
RAW_CONFIG_PATH="~/.openclaw/openclaw.json"
DO_BUILD=1
DO_VERIFY=1
DRY_RUN=0
VERBOSE=0

usage() {
    cat <<'EOF'
Install a local plugin from this repository into the current system Openclaw setup.

Usage:
  scripts/install-local-plugins.sh [options]

Options:
  --plugin <name>     Plugin to install (supported: dingtalk; default: dingtalk)
  --config <path>     Openclaw config file path (default: ~/.openclaw/openclaw.json)
  --no-build          Skip npm build before packing
  --skip-verify       Skip post-install plugin visibility verification
  --dry-run           Print actions without changing the system
  --verbose           Print verbose shell trace
  --help, -h          Show this help

Examples:
  scripts/install-local-plugins.sh
  scripts/install-local-plugins.sh --plugin dingtalk --config ~/.openclaw/openclaw.json
  scripts/install-local-plugins.sh --dry-run --verbose
EOF
}

info() {
    echo "[INFO] $*"
}

warn() {
    echo "[WARN] $*" >&2
}

fail() {
    echo "[ERROR] $*" >&2
    exit 1
}

print_cmd() {
    printf '+ '
    printf '%q ' "$@"
    printf '\n'
}

run_cmd() {
    if [[ "$DRY_RUN" == "1" ]]; then
        print_cmd "$@"
        return 0
    fi
    "$@"
}

run_in_dir() {
    local dir="$1"
    shift
    if [[ "$DRY_RUN" == "1" ]]; then
        printf '+ (cd %q && ' "$dir"
        printf '%q ' "$@"
        printf ')\n'
        return 0
    fi
    (
        cd "$dir"
        "$@"
    )
}

require_arg() {
    local flag="$1"
    local value="${2:-}"
    if [[ -z "$value" || "$value" == --* ]]; then
        echo "[ERROR] ${flag} requires a value" >&2
        exit 2
    fi
}

expand_path() {
    local raw="$1"
    if [[ "$raw" == "~" ]]; then
        echo "$HOME"
        return 0
    fi
    if [[ "$raw" == "~/"* ]]; then
        echo "$HOME/${raw#\~/}"
        return 0
    fi
    echo "$raw"
}

ensure_cmd() {
    local cmd="$1"
    command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: ${cmd}"
}

resolve_openclaw_bin() {
    if command -v openclaw >/dev/null 2>&1; then
        echo "openclaw"
        return 0
    fi
    if command -v clawdbot >/dev/null 2>&1; then
        echo "clawdbot"
        return 0
    fi
    echo ""
}

plugin_dir_for() {
    local plugin="$1"
    case "$plugin" in
        dingtalk)
            echo "${REPO_ROOT}/extensions/dingtalk"
            ;;
        *)
            return 1
            ;;
    esac
}

read_package_name() {
    local package_json="$1"
    node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(String(pkg.name || ""));
' "$package_json"
}

read_package_tarball_basename() {
    local package_json="$1"
    node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const name = String(pkg.name || "").replace(/^@/, "").replace(/\//g, "-");
const version = String(pkg.version || "0.0.0");
process.stdout.write(`${name}-${version}.tgz`);
' "$package_json"
}

pack_plugin() {
    local plugin_dir="$1"
    local simulated_tgz="$2"

    if [[ "$DRY_RUN" == "1" ]]; then
        run_in_dir "$plugin_dir" npm pack --silent >&2
        echo "${plugin_dir}/${simulated_tgz}"
        return 0
    fi

    local pack_output=""
    pack_output="$(
        cd "$plugin_dir"
        npm pack --silent
    )"
    local pack_name=""
    pack_name="$(printf '%s\n' "$pack_output" | tail -n 1 | tr -d '\r')"
    if [[ -z "$pack_name" ]]; then
        fail "npm pack did not return a package filename"
    fi
    local pack_path="${plugin_dir}/${pack_name}"
    [[ -f "$pack_path" ]] || fail "Packed file not found: ${pack_path}"
    echo "$pack_path"
}

update_openclaw_config_load_paths() {
    local config_path="$1"
    local plugin_pkg_name="$2"
    local global_plugin_dir="$3"
    local config_dir=""
    config_dir="$(dirname "$config_path")"

    if [[ "$DRY_RUN" == "1" ]]; then
        run_cmd mkdir -p "$config_dir"
        if [[ ! -f "$config_path" ]]; then
            info "Config not found; would create minimal config at ${config_path}"
        fi
        info "Would ensure plugins.load.paths contains: ${global_plugin_dir}"
        return 0
    fi

    run_cmd mkdir -p "$config_dir"

    CONFIG_FILE="$config_path" PKG_NAME="$plugin_pkg_name" GLOBAL_PLUGIN_DIR="$global_plugin_dir" node - <<'NODE'
const fs = require("fs");
const path = require("path");

const configFile = String(process.env.CONFIG_FILE || "").trim();
const pkgName = String(process.env.PKG_NAME || "").trim();
const globalPluginDir = String(process.env.GLOBAL_PLUGIN_DIR || "").trim();

if (!configFile || !pkgName || !globalPluginDir) {
  process.exit(1);
}

let config = {};
if (fs.existsSync(configFile)) {
  try {
    config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  } catch (error) {
    console.error(`[config] Invalid JSON in ${configFile}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

if (!config || typeof config !== "object" || Array.isArray(config)) {
  config = {};
}

config.plugins ||= {};
config.plugins.load ||= {};
let paths = Array.isArray(config.plugins.load.paths) ? config.plugins.load.paths : [];

const resolvedGlobalDir = path.resolve(globalPluginDir);
const normalize = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return path.resolve(trimmed);
  } catch {
    return "";
  }
};

const looksLikeGlobalPkgPath = (value) => {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\\/g, "/");
  return normalized.includes("/node_modules/") && normalized.endsWith(`/${pkgName}`);
};

const next = [];
const seen = new Set();
for (const entry of paths) {
  if (typeof entry !== "string") continue;
  const trimmed = entry.trim();
  if (!trimmed) continue;
  const normalized = normalize(trimmed);
  if (!normalized) continue;

  // Keep only one global install path for the same package to avoid duplicate plugin ids.
  if (looksLikeGlobalPkgPath(trimmed) && normalized !== resolvedGlobalDir) continue;

  if (normalized === resolvedGlobalDir) continue;
  if (seen.has(normalized)) continue;
  seen.add(normalized);
  next.push(trimmed);
}

config.plugins.load.paths = [globalPluginDir, ...next];

fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`, "utf8");
NODE
}

verify_plugin_loaded() {
    local openclaw_bin="$1"
    local plugin_pkg_name="$2"

    if [[ "$DO_VERIFY" != "1" ]]; then
        info "Verification skipped by --skip-verify"
        return 0
    fi

    if [[ -z "$openclaw_bin" ]]; then
        warn "openclaw/clawdbot command not found, skipping verification"
        return 0
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        info "Dry-run: would verify via '${openclaw_bin} plugins list --json'"
        return 0
    fi

    local raw_output=""
    raw_output="$("$openclaw_bin" plugins list --json 2>/dev/null || true)"
    if [[ -z "$raw_output" ]]; then
        fail "Plugin verification failed: ${openclaw_bin} plugins list --json returned empty output"
    fi

    # Some Openclaw builds print log lines before JSON. Keep only JSON payload.
    local json_payload=""
    json_payload="$(printf '%s\n' "$raw_output" | sed -n '/^[[:space:]]*{/,$p')"
    if [[ -z "$json_payload" ]]; then
        fail "Plugin verification failed: could not locate JSON payload in '${openclaw_bin} plugins list --json' output"
    fi

    local verify_status=0
    printf '%s' "$json_payload" | PKG_NAME="$plugin_pkg_name" node -e '
const fs = require("fs");
const pkgName = String(process.env.PKG_NAME || "");
const raw = fs.readFileSync(0, "utf8");
let data;
try {
  data = JSON.parse(raw);
} catch {
  process.exit(2);
}
const plugins = Array.isArray(data?.plugins) ? data.plugins : [];
const found = plugins.some((plugin) => {
  if (!plugin || typeof plugin !== "object") return false;
  const id = typeof plugin.id === "string" ? plugin.id : "";
  const name = typeof plugin.name === "string" ? plugin.name : "";
  const source = typeof plugin.source === "string" ? plugin.source : "";
  return id === pkgName || name === pkgName || source.includes(`/${pkgName}/`);
});
if (!found) process.exit(1);
' || verify_status=$?
    if [[ "$verify_status" -ne 0 ]]; then
        if [[ "$verify_status" -eq 2 ]]; then
            warn "Invalid JSON from '${openclaw_bin} plugins list --json'"
            warn "First lines:"
            printf '%s\n' "$raw_output" | head -n 10 >&2
        fi
        warn "Plugin not visible in '${openclaw_bin} plugins list --json'"
        warn "Try: restart gateway, then run '${openclaw_bin} plugins list --json'"
        fail "Post-install verification failed for ${plugin_pkg_name}"
    fi

    info "Verification passed: ${plugin_pkg_name} is visible to ${openclaw_bin}"
}

restart_gateway_after_install() {
    local openclaw_bin="$1"

    if [[ -z "$openclaw_bin" ]]; then
        warn "openclaw/clawdbot command not found, skipping gateway restart"
        return 0
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        info "Dry-run: would restart gateway via '${openclaw_bin} gateway restart'"
        return 0
    fi

    info "Restarting gateway service..."
    if "$openclaw_bin" gateway restart >/dev/null 2>&1; then
        info "Gateway restarted"
        return 0
    fi

    warn "Gateway restart failed, trying to start gateway service..."
    if "$openclaw_bin" gateway start >/dev/null 2>&1; then
        info "Gateway started"
        return 0
    fi

    warn "Could not restart/start gateway service automatically"
    warn "Please run manually: ${openclaw_bin} gateway restart"
    return 0
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --plugin)
                require_arg "$1" "${2:-}"
                PLUGIN="$2"
                shift 2
                ;;
            --config)
                require_arg "$1" "${2:-}"
                RAW_CONFIG_PATH="$2"
                shift 2
                ;;
            --no-build)
                DO_BUILD=0
                shift
                ;;
            --skip-verify)
                DO_VERIFY=0
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --verbose)
                VERBOSE=1
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                echo "[ERROR] Unknown option: $1" >&2
                usage >&2
                exit 2
                ;;
        esac
    done
}

main() {
    parse_args "$@"

    if [[ "$VERBOSE" == "1" ]]; then
        set -x
    fi

    if [[ "$PLUGIN" != "dingtalk" ]]; then
        echo "[ERROR] Unsupported plugin '${PLUGIN}'. Supported values: dingtalk" >&2
        exit 2
    fi

    ensure_cmd node
    ensure_cmd npm

    local openclaw_bin=""
    openclaw_bin="$(resolve_openclaw_bin)"
    if [[ -z "$openclaw_bin" && "$DO_VERIFY" == "1" ]]; then
        warn "openclaw/clawdbot not found; install will continue but verification will be skipped"
    fi

    local plugin_dir=""
    plugin_dir="$(plugin_dir_for "$PLUGIN")" || fail "Unsupported plugin: ${PLUGIN}"
    local package_json="${plugin_dir}/package.json"
    [[ -f "$package_json" ]] || fail "Missing package.json: ${package_json}"

    local config_path=""
    config_path="$(expand_path "$RAW_CONFIG_PATH")"

    local plugin_pkg_name=""
    plugin_pkg_name="$(read_package_name "$package_json")"
    [[ -n "$plugin_pkg_name" ]] || fail "Could not read package name from ${package_json}"

    local simulated_tgz_name=""
    simulated_tgz_name="$(read_package_tarball_basename "$package_json")"
    [[ -n "$simulated_tgz_name" ]] || fail "Could not read package tarball basename from ${package_json}"

    info "Repo root: ${REPO_ROOT}"
    info "Plugin dir: ${plugin_dir}"
    info "Package: ${plugin_pkg_name}"
    info "Config: ${config_path}"

    if [[ "$DO_BUILD" == "1" ]]; then
        if [[ -f "${plugin_dir}/package-lock.json" ]]; then
            run_in_dir "$plugin_dir" npm ci
        else
            run_in_dir "$plugin_dir" npm install
        fi
        run_in_dir "$plugin_dir" npm run build
    else
        info "Skipping build due to --no-build"
    fi

    local pack_path=""
    pack_path="$(pack_plugin "$plugin_dir" "$simulated_tgz_name")"
    info "Packed plugin tarball: ${pack_path}"

    run_cmd npm install -g "$pack_path" --legacy-peer-deps --no-fund --no-audit

    local npm_root=""
    npm_root="$(npm root -g 2>/dev/null || true)"
    [[ -n "$npm_root" ]] || fail "Unable to resolve npm global root via 'npm root -g'"

    local global_plugin_dir="${npm_root%/}/${plugin_pkg_name}"
    if [[ "$DRY_RUN" != "1" && ! -d "$global_plugin_dir" ]]; then
        fail "Global plugin directory not found after install: ${global_plugin_dir}"
    fi

    update_openclaw_config_load_paths "$config_path" "$plugin_pkg_name" "$global_plugin_dir"
    restart_gateway_after_install "$openclaw_bin"

    verify_plugin_loaded "$openclaw_bin" "$plugin_pkg_name"

    info "Local plugin installation completed: ${plugin_pkg_name}"
}

main "$@"
