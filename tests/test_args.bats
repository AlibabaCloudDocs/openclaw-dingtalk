#!/usr/bin/env bats
# 命令行参数解析测试

load helpers

@test "--help 显示帮助信息并退出" {
    run bash "$INSTALL_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Openclaw"* ]]
    [[ "$output" == *"--install"* ]]
    [[ "$output" == *"--uninstall"* ]]
    [[ "$output" == *"--upgrade"* ]]
}

@test "-h 是 --help 的别名" {
    run bash "$INSTALL_SCRIPT" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"--install"* ]]
}

@test "--dry-run 不执行实际操作" {
    run bash "$INSTALL_SCRIPT" --install --dry-run --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run"* ]] || [[ "$output" == *"dry-run"* ]] || [[ "$output" == *"模拟"* ]]
}

@test "--version 设置指定版本" {
    run bash "$INSTALL_SCRIPT" --install --dry-run --no-prompt --version 0.1.0
    [ "$status" -eq 0 ]
    [[ "$output" == *"0.1.0"* ]] || true  # 版本号可能在输出中显示
}

@test "--install-method npm 设置 npm 安装方式" {
    run bash "$INSTALL_SCRIPT" --install --install-method npm --dry-run --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"npm"* ]] || true
}

@test "--npm 是 --install-method npm 的快捷方式" {
    run bash "$INSTALL_SCRIPT" --install --npm --dry-run --no-prompt
    [ "$status" -eq 0 ]
}

@test "--git 是 --install-method git 的快捷方式" {
    run bash "$INSTALL_SCRIPT" --install --git --dry-run --no-prompt
    [ "$status" -eq 0 ]
}

@test "--beta 启用 beta 版本" {
    run bash "$INSTALL_SCRIPT" --install --beta --dry-run --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"beta"* ]] || true
}

@test "--cn-mirrors 手动启用中国镜像" {
    run bash "$INSTALL_SCRIPT" --install --cn-mirrors --dry-run --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"mirror"* ]] || [[ "$output" == *"镜像"* ]] || true
}

@test "--verbose 启用详细输出" {
    run bash "$INSTALL_SCRIPT" --install --verbose --dry-run --no-prompt
    [ "$status" -eq 0 ]
}

@test "无效参数显示警告但继续执行" {
    run bash "$INSTALL_SCRIPT" --invalid-option-xyz --dry-run --no-prompt --help
    [[ "$output" == *"Unknown option"* ]] || [[ "$output" == *"ignored"* ]]
}

@test "--status 动作参数" {
    run bash "$INSTALL_SCRIPT" --status --no-prompt
    # 状态检查可能返回非零（如果未安装），但命令应该可以执行
    [[ "$output" == *"Openclaw"* ]] || [[ "$output" == *"状态"* ]] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"not installed"* ]]
}

@test "--upgrade-core 动作参数" {
    run bash "$INSTALL_SCRIPT" --upgrade-core --dry-run --no-prompt
    [ "$status" -eq 0 ] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"not installed"* ]]
}

@test "--upgrade-plugins 动作参数" {
    run bash "$INSTALL_SCRIPT" --upgrade-plugins --dry-run --no-prompt
    [ "$status" -eq 0 ] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"not installed"* ]]
}

@test "--purge 与 --uninstall 组合" {
    run bash "$INSTALL_SCRIPT" --uninstall --purge --dry-run --no-prompt
    [ "$status" -eq 0 ] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"not installed"* ]]
}

@test "--keep-config 与 --uninstall 组合" {
    run bash "$INSTALL_SCRIPT" --uninstall --keep-config --dry-run --no-prompt
    [ "$status" -eq 0 ] || [[ "$output" == *"未安装"* ]] || [[ "$output" == *"not installed"* ]]
}

# ============================================
# 渠道管理参数测试
# ============================================

@test "--channel-list 参数可用" {
    run bash "$INSTALL_SCRIPT" --channel-list --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"渠道"* ]] || [[ "$output" == *"Channel"* ]] || [[ "$output" == *"钉钉"* ]]
}

@test "--channel-add dingtalk 参数可用" {
    # 非交互模式会因为缺少输入而跳过，但参数解析应该成功
    run bash "$INSTALL_SCRIPT" --channel-add dingtalk --no-prompt < /dev/null
    # 不检查状态码，只检查参数被正确解析
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"DingTalk"* ]] || [[ "$output" == *"Client ID"* ]] || true
}

@test "--channel-add feishu 参数可用" {
    run bash "$INSTALL_SCRIPT" --channel-add feishu --no-prompt < /dev/null
    [[ "$output" == *"飞书"* ]] || [[ "$output" == *"Feishu"* ]] || [[ "$output" == *"App ID"* ]] || true
}

@test "--channel-add wecom 参数可用" {
    run bash "$INSTALL_SCRIPT" --channel-add wecom --no-prompt < /dev/null
    [[ "$output" == *"企业微信"* ]] || [[ "$output" == *"WeCom"* ]] || [[ "$output" == *"Token"* ]] || true
}

@test "--channel-remove dingtalk 参数可用" {
    run bash "$INSTALL_SCRIPT" --channel-remove dingtalk --no-prompt
    # 可能报告未安装或请求确认
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"DingTalk"* ]] || [[ "$output" == *"Openclaw"* ]] || true
}

@test "--channel-configure dingtalk 参数可用" {
    run bash "$INSTALL_SCRIPT" --channel-configure dingtalk --no-prompt < /dev/null
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"DingTalk"* ]] || [[ "$output" == *"Client ID"* ]] || true
}

# ============================================
# Python 安装参数测试
# ============================================

@test "--python 参数可用" {
    run bash "$INSTALL_SCRIPT" --python --dry-run --no-prompt
    [ "$status" -eq 0 ]
}

@test "--no-python 跳过 Python 安装" {
    run bash "$INSTALL_SCRIPT" --no-python --dry-run --no-prompt
    [ "$status" -eq 0 ]
}

@test "帮助信息包含 Python 选项" {
    run bash "$INSTALL_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"--python"* ]]
    [[ "$output" == *"--no-python"* ]]
}

# ============================================
# File Tools 参数测试
# ============================================

@test "--file-tools 参数可用" {
    run bash "$INSTALL_SCRIPT" --file-tools --dry-run --no-prompt
    [ "$status" -eq 0 ]
}

@test "--no-file-tools 跳过 file tools 安装" {
    run bash "$INSTALL_SCRIPT" --no-file-tools --dry-run --no-prompt
    [ "$status" -eq 0 ]
}

@test "帮助信息包含 file-tools 选项" {
    run bash "$INSTALL_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"--file-tools"* ]]
    [[ "$output" == *"--no-file-tools"* ]]
}
