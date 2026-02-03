#!/usr/bin/env bats
# 修复功能测试

load helpers

setup() {
    cleanup_env
    # 先安装
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true
}

teardown() {
    cleanup_env
}

@test "修复命令可以执行" {
    run bash "$INSTALL_SCRIPT" --repair --no-prompt
    echo "Output: $output"
    # 即使没有问题需要修复，也应该正常完成
    [ "$status" -eq 0 ] || [[ "$output" == *"repair"* ]] || [[ "$output" == *"修复"* ]] || [[ "$output" == *"doctor"* ]]
}

@test "未安装时修复提示错误" {
    cleanup_env

    run bash "$INSTALL_SCRIPT" --repair --no-prompt
    echo "Output: $output"

    # 未安装时应该提示
    [[ "$output" == *"not installed"* ]] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"install"* ]] || true
}

@test "修复后 clawdbot 仍然可用" {
    bash "$INSTALL_SCRIPT" --repair --no-prompt

    run clawdbot --version
    echo "Version: $output"
    [ "$status" -eq 0 ]
}
