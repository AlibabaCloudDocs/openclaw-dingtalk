#!/bin/bash
# Openclaw 安装脚本测试公共函数

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SCRIPT="${SCRIPT_DIR}/openclaw_installer.sh"

# 测试环境标识
export CLAWDBOT_TEST_MODE=1
export NO_PROMPT=1

# 清理测试环境
cleanup_env() {
    # 停止可能运行的服务
    systemctl --user stop clawdbot-gateway 2>/dev/null || true
    pkill -f "clawdbot gateway" 2>/dev/null || true

    # 卸载 npm 包 (包括所有渠道插件)
    npm uninstall -g clawdbot clawdbot-dingtalk @m1heng-clawd/feishu openclaw-plugin-wecom 2>/dev/null || true

    # 清理目录
    rm -rf ~/.clawdbot 2>/dev/null || true
    rm -rf ~/clawd 2>/dev/null || true
    rm -f ~/.local/bin/clawdbot 2>/dev/null || true
    rm -f ~/.config/systemd/user/clawdbot-gateway.service 2>/dev/null || true

    # 清理 PATH 修改（会在下次 shell 重启后生效）
    # 注意：不删除 profile 文件中的配置，避免破坏其他设置
}

# 检查命令是否存在
command_exists() {
    command -v "$1" &>/dev/null
}

# 获取已安装版本
get_installed_version() {
    clawdbot --version 2>/dev/null | head -n1 || echo ""
}

# 检查 clawdbot 是否已安装
is_clawdbot_installed() {
    command_exists clawdbot
}

# 加载凭据
load_credentials() {
    if [[ -f "${SCRIPT_DIR}/credentials.env" ]]; then
        # shellcheck disable=SC1091
        source "${SCRIPT_DIR}/credentials.env"
        export DINGTALK_CLIENT_ID DINGTALK_CLIENT_SECRET DASHSCOPE_API_KEY DASHSCOPE_BASE_URL
    fi
}

# 检查凭据是否存在
has_credentials() {
    [[ -n "${DINGTALK_CLIENT_ID:-}" && -n "${DINGTALK_CLIENT_SECRET:-}" ]]
}

# 等待进程完成
wait_for_command() {
    local cmd="$1"
    local timeout="${2:-30}"
    local start_time
    start_time=$(date +%s)

    while ! command_exists "$cmd"; do
        local current_time
        current_time=$(date +%s)
        if (( current_time - start_time > timeout )); then
            return 1
        fi
        sleep 1
    done
    return 0
}

# 断言文件存在
assert_file_exists() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        echo "断言失败: 文件 $file 不存在" >&2
        return 1
    fi
}

# 断言目录存在
assert_dir_exists() {
    local dir="$1"
    if [[ ! -d "$dir" ]]; then
        echo "断言失败: 目录 $dir 不存在" >&2
        return 1
    fi
}

# 断言命令成功
assert_success() {
    if [[ $? -ne 0 ]]; then
        echo "断言失败: 上一个命令返回非零状态" >&2
        return 1
    fi
}

# 断言输出包含字符串
assert_output_contains() {
    local output="$1"
    local expected="$2"
    if [[ "$output" != *"$expected"* ]]; then
        echo "断言失败: 输出不包含 '$expected'" >&2
        echo "实际输出: $output" >&2
        return 1
    fi
}

# 创建临时配置文件
create_test_config() {
    mkdir -p ~/.clawdbot
    cat > ~/.clawdbot/clawdbot.json << 'EOF'
{
  "extensions": ["clawdbot-dingtalk"],
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "test_client_id",
      "clientSecret": "test_client_secret"
    }
  }
}
EOF
}

# 执行安装脚本并捕获输出
run_installer() {
    bash "$INSTALL_SCRIPT" "$@" 2>&1
}

# 记录测试日志
log_test() {
    local level="$1"
    local msg="$2"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $msg" >> "${SCRIPT_DIR}/test.log"
}

# 初始化测试日志
init_test_log() {
    echo "=== 测试开始于 $(date) ===" > "${SCRIPT_DIR}/test.log"
}
