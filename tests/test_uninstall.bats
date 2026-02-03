#!/usr/bin/env bats
# 卸载功能测试

load helpers

setup() {
    cleanup_env
    # 先安装
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    # 创建配置文件
    mkdir -p ~/.clawdbot
    echo '{"test": true}' > ~/.clawdbot/clawdbot.json
}

teardown() {
    cleanup_env
}

@test "标准卸载成功" {
    run bash "$INSTALL_SCRIPT" --uninstall --no-prompt
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"卸载"* ]] || [[ "$output" == *"uninstall"* ]] || [[ "$output" == *"removed"* ]] || [[ "$output" == *"完成"* ]]
}

@test "卸载后 clawdbot 命令不可用" {
    bash "$INSTALL_SCRIPT" --uninstall --no-prompt
    hash -r 2>/dev/null || true

    run command -v clawdbot
    echo "clawdbot path after uninstall: $output"
    [ "$status" -ne 0 ]
}

@test "--keep-config 保留配置文件" {
    bash "$INSTALL_SCRIPT" --uninstall --keep-config --no-prompt

    # 配置文件应该还在
    [ -f ~/.clawdbot/clawdbot.json ]

    # 验证内容
    run cat ~/.clawdbot/clawdbot.json
    [[ "$output" == *"test"* ]]
}

@test "--purge 完全清除所有数据" {
    bash "$INSTALL_SCRIPT" --uninstall --purge --no-prompt

    # 配置目录应该不存在
    [ ! -d ~/.clawdbot ]
}

@test "卸载后重新安装成功" {
    bash "$INSTALL_SCRIPT" --uninstall --no-prompt

    run bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    echo "Reinstall output: $output"
    [ "$status" -eq 0 ]

    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run command -v clawdbot
    [ "$status" -eq 0 ]
}

@test "未安装时卸载不报错" {
    cleanup_env

    run bash "$INSTALL_SCRIPT" --uninstall --no-prompt
    echo "Output: $output"
    # 即使未安装，也应该正常退出或提示未安装
    [[ "$output" == *"not installed"* ]] || [[ "$output" == *"未安装"* ]] || [ "$status" -eq 0 ]
}

@test "卸载清理 npm 全局包" {
    bash "$INSTALL_SCRIPT" --uninstall --no-prompt

    run npm list -g clawdbot --depth=0
    # 应该找不到 clawdbot
    [[ "$output" == *"empty"* ]] || [[ "$output" == *"(empty)"* ]] || [ "$status" -ne 0 ]
}

@test "卸载后 systemd 服务被清理" {
    # 先检查是否有 systemd
    if ! command -v systemctl &>/dev/null; then
        skip "systemctl 不可用"
    fi

    bash "$INSTALL_SCRIPT" --uninstall --purge --no-prompt

    # 用户服务文件应该不存在
    [ ! -f ~/.config/systemd/user/clawdbot-gateway.service ]
}
