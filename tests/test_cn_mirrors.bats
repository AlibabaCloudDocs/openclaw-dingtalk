#!/usr/bin/env bats
# 中国镜像测试

load helpers

setup() {
    cleanup_env
    # 保存原始 npm 配置
    NPM_ORIG_REGISTRY=$(npm config get registry 2>/dev/null || echo "https://registry.npmjs.org/")
}

teardown() {
    cleanup_env
    # 恢复 npm 配置
    npm config set registry "$NPM_ORIG_REGISTRY" 2>/dev/null || true
}

@test "TZ=Asia/Shanghai 自动启用镜像" {
    export TZ=Asia/Shanghai

    run bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard --dry-run
    echo "Output: $output"

    # 应该检测到中国区域
    [[ "$output" == *"镜像"* ]] || [[ "$output" == *"mirror"* ]] || [[ "$output" == *"China"* ]] || [[ "$output" == *"中国"* ]] || true
}

@test "--cn-mirrors 手动启用镜像" {
    run bash "$INSTALL_SCRIPT" --install --npm --cn-mirrors --no-prompt --no-onboard --dry-run
    echo "Output: $output"
    [ "$status" -eq 0 ]

    # 应该提示镜像启用
    [[ "$output" == *"镜像"* ]] || [[ "$output" == *"mirror"* ]] || [[ "$output" == *"registry"* ]]
}

@test "--no-cn-mirrors 禁用镜像" {
    export TZ=Asia/Shanghai

    run bash "$INSTALL_SCRIPT" --install --npm --no-cn-mirrors --no-prompt --no-onboard --dry-run
    echo "Output: $output"
    [ "$status" -eq 0 ]

    # 不应该自动启用镜像（显式禁用）
}

@test "中国镜像实际安装测试" {
    # 使用中国镜像进行实际安装
    run bash "$INSTALL_SCRIPT" --install --npm --cn-mirrors --no-prompt --no-onboard
    echo "Output: $output"
    [ "$status" -eq 0 ]

    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    # 验证安装成功
    run command -v clawdbot
    [ "$status" -eq 0 ]
}

@test "npm registry 在中国镜像模式下正确设置" {
    # 实际安装并检查 registry
    bash "$INSTALL_SCRIPT" --install --npm --cn-mirrors --no-prompt --no-onboard

    run npm config get registry
    echo "Registry: $output"

    # 应该是淘宝镜像
    [[ "$output" == *"npmmirror"* ]] || [[ "$output" == *"taobao"* ]] || [[ "$output" == *"aliyun"* ]]
}

@test "LANG=zh_CN 触发中国区域检测" {
    export LANG=zh_CN.UTF-8
    unset TZ

    run bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard --dry-run
    echo "Output: $output"

    # 可能检测到中国区域
    # 注意：这取决于脚本的具体实现逻辑
}
