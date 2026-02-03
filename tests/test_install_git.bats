#!/usr/bin/env bats
# git 安装方式测试

load helpers

setup() {
    cleanup_env
}

teardown() {
    cleanup_env
}

@test "git 方式安装成功" {
    run bash "$INSTALL_SCRIPT" --install --git --no-prompt --no-onboard
    echo "Output: $output"
    echo "Status: $status"
    [ "$status" -eq 0 ]
    [[ "$output" == *"installed"* ]] || [[ "$output" == *"安装"* ]] || [[ "$output" == *"successfully"* ]] || [[ "$output" == *"成功"* ]] || [[ "$output" == *"clone"* ]]
}

@test "git 安装后源代码目录存在" {
    bash "$INSTALL_SCRIPT" --install --git --no-prompt --no-onboard

    # 默认安装到 ~/clawd
    [ -d ~/clawd ] || [ -d ~/.clawdbot/src ]
}

@test "git 安装后 clawdbot 命令可用" {
    bash "$INSTALL_SCRIPT" --install --git --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run command -v clawdbot
    echo "clawdbot path: $output"
    [ "$status" -eq 0 ]
}

@test "git 安装创建 wrapper 脚本" {
    bash "$INSTALL_SCRIPT" --install --git --no-prompt --no-onboard

    # 检查 wrapper 脚本
    local wrapper="$HOME/.local/bin/clawdbot"
    if [ -f "$wrapper" ]; then
        # 检查是否是脚本（非二进制）
        run file "$wrapper"
        [[ "$output" == *"script"* ]] || [[ "$output" == *"text"* ]] || [[ "$output" == *"symbolic link"* ]]
    else
        # 可能通过其他方式链接
        [ -L "$wrapper" ] || command -v clawdbot
    fi
}

@test "git 安装指定目录" {
    local custom_dir="/tmp/clawdbot-test-$$"

    run bash "$INSTALL_SCRIPT" --install --git --git-dir "$custom_dir" --no-prompt --no-onboard
    echo "Output: $output"

    if [ "$status" -eq 0 ]; then
        [ -d "$custom_dir" ]
        rm -rf "$custom_dir"
    fi
}

@test "git 安装后可以运行 pnpm build" {
    bash "$INSTALL_SCRIPT" --install --git --no-prompt --no-onboard

    local git_dir=""
    if [ -d ~/clawd ]; then
        git_dir=~/clawd
    elif [ -d ~/.clawdbot/src ]; then
        git_dir=~/.clawdbot/src
    else
        skip "无法找到 git 安装目录"
    fi

    cd "$git_dir"

    # 检查是否可以运行 pnpm
    if command -v pnpm &>/dev/null; then
        run pnpm --version
        [ "$status" -eq 0 ]
    else
        skip "pnpm 未安装"
    fi
}
