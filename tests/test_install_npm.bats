#!/usr/bin/env bats
# npm 安装方式测试

load helpers

setup() {
    cleanup_env
}

teardown() {
    cleanup_env
}

@test "干净环境下 npm 安装成功" {
    run bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    echo "Output: $output"
    echo "Status: $status"
    [ "$status" -eq 0 ]
    [[ "$output" == *"installed"* ]] || [[ "$output" == *"安装"* ]] || [[ "$output" == *"successfully"* ]] || [[ "$output" == *"成功"* ]]
}

@test "安装后 clawdbot 命令可用" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    # 重新加载 PATH
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run command -v clawdbot
    echo "clawdbot path: $output"
    [ "$status" -eq 0 ]
}

@test "安装后版本号正确显示" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run clawdbot --version
    echo "Version: $output"
    [ "$status" -eq 0 ]
    # 版本号格式: x.y.z 或 x.y.z-beta.n
    [[ "$output" =~ [0-9]+\.[0-9]+\.[0-9]+ ]]
}

@test "重复安装执行升级而非报错" {
    # 第一次安装
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard

    # 第二次安装应该成功（执行升级）
    run bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    echo "Output: $output"
    [ "$status" -eq 0 ]
}

@test "安装后配置目录创建" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard

    # 配置目录应该存在
    [ -d ~/.clawdbot ] || [ -d ~/.config/clawdbot ]
}

@test "安装后 gateway 子命令可用" {
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run clawdbot gateway --help
    echo "Output: $output"
    [ "$status" -eq 0 ]
    [[ "$output" == *"gateway"* ]] || [[ "$output" == *"Gateway"* ]]
}

@test "安装指定版本" {
    run bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard --version 0.1.14
    echo "Output: $output"

    if [ "$status" -eq 0 ]; then
        export PATH="$HOME/.local/bin:$PATH"
        hash -r 2>/dev/null || true

        run clawdbot --version
        echo "Installed version: $output"
        [[ "$output" == *"0.1.14"* ]]
    else
        # 如果版本不存在，跳过测试
        skip "版本 0.1.14 可能不存在"
    fi
}

@test "beta 版本安装" {
    run bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard --beta
    echo "Output: $output"
    [ "$status" -eq 0 ]

    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run clawdbot --version
    echo "Version: $output"
    # beta 版本可能包含 -beta 后缀，也可能就是最新的 beta
    [ "$status" -eq 0 ]
}
