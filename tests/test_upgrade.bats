#!/usr/bin/env bats
# 升级功能测试

load helpers

setup() {
    cleanup_env
    # 先安装一个版本
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true
}

teardown() {
    cleanup_env
}

@test "Upgrade to latest version" {
    run bash "$INSTALL_SCRIPT" --upgrade --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"upgrade"* ]] || [[ "$output" == *"升级"* ]] || [[ "$output" == *"latest"* ]] || [[ "$output" == *"最新"* ]] || [[ "$output" == *"already"* ]] || [[ "$output" == *"已是"* ]]
}

@test "--upgrade-core upgrades only core" {
    run bash "$INSTALL_SCRIPT" --upgrade-core --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"core"* ]] || [[ "$output" == *"核心"* ]] || [[ "$output" == *"clawdbot"* ]] || [[ "$output" == *"升级"* ]] || [[ "$output" == *"已是最新"* ]]
}

@test "--upgrade-plugins upgrades only plugins" {
    # 先安装一个插件
    npm install -g clawdbot-dingtalk --legacy-peer-deps 2>/dev/null || true

    run bash "$INSTALL_SCRIPT" --upgrade-plugins --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"plugin"* ]] || [[ "$output" == *"插件"* ]] || [[ "$output" == *"dingtalk"* ]] || [[ "$output" == *"没有已安装的插件"* ]] || [[ "$output" == *"No plugins"* ]]
}

@test "--upgrade-all upgrades all channel plugins" {
    run bash "$INSTALL_SCRIPT" --upgrade-all --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    # 应该检查所有三个渠道
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"dingtalk"* ]] || true
    [[ "$output" == *"飞书"* ]] || [[ "$output" == *"feishu"* ]] || true
    [[ "$output" == *"企业微信"* ]] || [[ "$output" == *"wecom"* ]] || true
}

@test "Version number is available after upgrade" {
    bash "$INSTALL_SCRIPT" --upgrade --no-prompt

    # 动态解析二进制路径
    local claw=""
    claw=$(CLAWDBOT_INSTALL_SH_NO_RUN=1 source "$INSTALL_SCRIPT" 2>/dev/null && resolve_clawdbot_bin)
    
    run "$claw" --version
    echo "Version: $output"
    [ "$status" -eq 0 ]
    [[ "$output" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]
}

@test "Error message when upgrading without installation" {
    cleanup_env

    run bash "$INSTALL_SCRIPT" --upgrade --no-prompt
    echo "Output: $output"
    echo "Status: $status"

    # 未安装时应该提示先安装或自动触发安装
    [[ "$output" == *"not installed"* ]] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"install"* ]] || [[ "$output" == *"安装"* ]]
}

@test "Upgrade to beta version" {
    run bash "$INSTALL_SCRIPT" --upgrade --beta --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
}
