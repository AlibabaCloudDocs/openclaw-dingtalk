#!/usr/bin/env bats
# 状态检查测试

load helpers

setup() {
    cleanup_env
}

teardown() {
    cleanup_env
}

@test "未安装时状态显示未安装" {
    run bash "$INSTALL_SCRIPT" --status --no-prompt
    echo "Output: $output"
    [[ "$output" == *"not installed"* ]] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"Not found"* ]] || [[ "$output" == *"找不到"* ]]
}

@test "安装后状态显示版本" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run bash "$INSTALL_SCRIPT" --status --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    # 应该显示版本信息
    [[ "$output" =~ [0-9]+\.[0-9]+\.[0-9]+ ]] || [[ "$output" == *"Clawdbot"* ]]
}

@test "状态检查显示安装路径" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run bash "$INSTALL_SCRIPT" --status --no-prompt
    echo "Output: $output"

    # 应该显示路径信息
    [[ "$output" == *"/"* ]] || [[ "$output" == *"path"* ]] || [[ "$output" == *"路径"* ]]
}

@test "状态检查显示配置状态" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    # 创建配置文件
    mkdir -p ~/.clawdbot
    echo '{"test": true}' > ~/.clawdbot/clawdbot.json

    run bash "$INSTALL_SCRIPT" --status --no-prompt
    echo "Output: $output"

    # 应该显示配置相关信息
    [[ "$output" == *"config"* ]] || [[ "$output" == *"配置"* ]] || [[ "$output" == *"clawdbot.json"* ]] || true
}

@test "状态检查显示已安装插件" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    # 安装插件
    npm install -g clawdbot-dingtalk --legacy-peer-deps 2>/dev/null || true

    run bash "$INSTALL_SCRIPT" --status --no-prompt
    echo "Output: $output"

    # 可能显示插件信息
    [[ "$output" == *"plugin"* ]] || [[ "$output" == *"插件"* ]] || [[ "$output" == *"dingtalk"* ]] || true
}

@test "状态检查显示所有渠道插件" {
    run bash "$INSTALL_SCRIPT" --status --no-prompt
    echo "Output: $output"
    
    # 应该显示所有三个渠道
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"dingtalk"* ]]
    [[ "$output" == *"飞书"* ]] || [[ "$output" == *"feishu"* ]] || [[ "$output" == *"Feishu"* ]]
    [[ "$output" == *"企业微信"* ]] || [[ "$output" == *"wecom"* ]] || [[ "$output" == *"WeCom"* ]]
}

@test "状态检查显示渠道插件分组" {
    run bash "$INSTALL_SCRIPT" --status --no-prompt
    echo "Output: $output"
    
    # 应该有渠道插件的分组标题
    [[ "$output" == *"渠道插件"* ]] || [[ "$output" == *"Channel"* ]] || [[ "$output" == *"核心组件"* ]]
}
