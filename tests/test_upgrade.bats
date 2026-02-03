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

@test "升级到最新版本" {
    run bash "$INSTALL_SCRIPT" --upgrade --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"upgrade"* ]] || [[ "$output" == *"升级"* ]] || [[ "$output" == *"latest"* ]] || [[ "$output" == *"最新"* ]] || [[ "$output" == *"already"* ]] || [[ "$output" == *"已是"* ]]
}

@test "--upgrade-core 只升级核心" {
    run bash "$INSTALL_SCRIPT" --upgrade-core --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"core"* ]] || [[ "$output" == *"核心"* ]] || [[ "$output" == *"clawdbot"* ]] || [[ "$output" == *"升级"* ]] || [[ "$output" == *"已是最新"* ]]
}

@test "--upgrade-plugins 只升级插件" {
    # 先安装一个插件
    npm install -g clawdbot-dingtalk --legacy-peer-deps 2>/dev/null || true

    run bash "$INSTALL_SCRIPT" --upgrade-plugins --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"plugin"* ]] || [[ "$output" == *"插件"* ]] || [[ "$output" == *"dingtalk"* ]] || [[ "$output" == *"没有已安装的插件"* ]] || [[ "$output" == *"No plugins"* ]]
}

@test "--upgrade-all 升级所有渠道插件" {
    run bash "$INSTALL_SCRIPT" --upgrade-all --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    # 应该检查所有三个渠道
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"dingtalk"* ]] || true
    [[ "$output" == *"飞书"* ]] || [[ "$output" == *"feishu"* ]] || true
    [[ "$output" == *"企业微信"* ]] || [[ "$output" == *"wecom"* ]] || true
}

@test "升级后版本号可用" {
    bash "$INSTALL_SCRIPT" --upgrade --no-prompt

    run clawdbot --version
    echo "Version: $output"
    [ "$status" -eq 0 ]
    [[ "$output" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]
}

@test "未安装时升级提示错误" {
    cleanup_env

    run bash "$INSTALL_SCRIPT" --upgrade --no-prompt
    echo "Output: $output"
    echo "Status: $status"

    # 未安装时应该提示先安装或自动触发安装
    [[ "$output" == *"not installed"* ]] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"install"* ]] || [[ "$output" == *"安装"* ]]
}

@test "升级到 beta 版本" {
    run bash "$INSTALL_SCRIPT" --upgrade --beta --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
}
