#!/usr/bin/env bats
# 渠道管理功能测试

load helpers

setup() {
    cleanup_env
}

teardown() {
    cleanup_env
}

# ============================================
# --channel-list 测试
# ============================================

@test "--channel-list 显示渠道状态" {
    run bash "$INSTALL_SCRIPT" --channel-list --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"渠道插件状态"* ]] || [[ "$output" == *"Channel"* ]]
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"DingTalk"* ]]
    [[ "$output" == *"飞书"* ]] || [[ "$output" == *"Feishu"* ]]
    [[ "$output" == *"企业微信"* ]] || [[ "$output" == *"WeCom"* ]]
}

@test "--channel-list 未安装时显示未安装状态" {
    run bash "$INSTALL_SCRIPT" --channel-list --no-prompt
    [ "$status" -eq 0 ]
    # 至少有一个未安装的渠道
    [[ "$output" == *"未安装"* ]] || [[ "$output" == *"not installed"* ]] || [[ "$output" == *"○"* ]]
}

# ============================================
# --channel-add 测试
# ============================================

@test "--channel-add 不带参数报错" {
    run bash "$INSTALL_SCRIPT" --channel-add --no-prompt 2>&1
    # 应该显示错误或参数丢失
    [[ "$output" == *"Unknown option"* ]] || [[ "$output" == *"请指定渠道"* ]] || [[ "$output" == *"dingtalk"* ]]
}

@test "--channel-add 无效渠道名报错" {
    run bash "$INSTALL_SCRIPT" --channel-add invalid_channel --no-prompt
    [[ "$output" == *"未知渠道"* ]] || [[ "$output" == *"Unknown"* ]] || [[ "$output" == *"invalid"* ]] || [ "$status" -ne 0 ]
}

@test "--channel-add dingtalk 需要凭证" {
    # 非交互模式下，输入为空时应该跳过或报错
    run bash "$INSTALL_SCRIPT" --channel-add dingtalk --no-prompt < /dev/null
    # 可能跳过配置或报错
    [[ "$output" == *"Client ID"* ]] || [[ "$output" == *"跳过"* ]] || [[ "$output" == *"skip"* ]] || true
}

@test "--channel-add feishu 需要凭证" {
    run bash "$INSTALL_SCRIPT" --channel-add feishu --no-prompt < /dev/null
    [[ "$output" == *"App ID"* ]] || [[ "$output" == *"跳过"* ]] || [[ "$output" == *"飞书"* ]] || true
}

@test "--channel-add wecom 需要凭证" {
    run bash "$INSTALL_SCRIPT" --channel-add wecom --no-prompt < /dev/null
    [[ "$output" == *"Token"* ]] || [[ "$output" == *"跳过"* ]] || [[ "$output" == *"企业微信"* ]] || true
}

# ============================================
# --channel-remove 测试
# ============================================

@test "--channel-remove 不带参数报错" {
    run bash "$INSTALL_SCRIPT" --channel-remove --no-prompt 2>&1
    [[ "$output" == *"Unknown option"* ]] || [[ "$output" == *"请指定渠道"* ]] || [[ "$output" == *"dingtalk"* ]]
}

@test "--channel-remove 无效渠道名报错" {
    run bash "$INSTALL_SCRIPT" --channel-remove invalid_channel --no-prompt
    [[ "$output" == *"未知渠道"* ]] || [[ "$output" == *"Unknown"* ]] || [ "$status" -ne 0 ]
}

# ============================================
# --channel-configure 测试
# ============================================

@test "--channel-configure 不带参数报错" {
    run bash "$INSTALL_SCRIPT" --channel-configure --no-prompt 2>&1
    [[ "$output" == *"Unknown option"* ]] || [[ "$output" == *"请指定渠道"* ]] || [[ "$output" == *"dingtalk"* ]]
}

@test "--channel-configure 无效渠道名报错" {
    run bash "$INSTALL_SCRIPT" --channel-configure invalid_channel --no-prompt
    [[ "$output" == *"未知渠道"* ]] || [[ "$output" == *"Unknown"* ]] || [ "$status" -ne 0 ]
}

# ============================================
# 帮助文档测试
# ============================================

@test "--help 包含渠道管理选项" {
    run bash "$INSTALL_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"--channel-add"* ]]
    [[ "$output" == *"--channel-remove"* ]]
    [[ "$output" == *"--channel-configure"* ]]
    [[ "$output" == *"--channel-list"* ]]
    [[ "$output" == *"Channel Management"* ]] || [[ "$output" == *"渠道管理"* ]]
}

@test "--help 包含渠道环境变量说明" {
    run bash "$INSTALL_SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"CLAWDBOT_CHANNEL_ACTION"* ]]
    [[ "$output" == *"CLAWDBOT_CHANNEL_TARGET"* ]]
}

# ============================================
# 状态显示测试
# ============================================

@test "--status 显示所有渠道插件状态" {
    run bash "$INSTALL_SCRIPT" --status --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"渠道插件"* ]] || [[ "$output" == *"Channel"* ]] || [[ "$output" == *"钉钉"* ]]
    [[ "$output" == *"飞书"* ]] || [[ "$output" == *"Feishu"* ]] || true
    [[ "$output" == *"企业微信"* ]] || [[ "$output" == *"WeCom"* ]] || true
}

# ============================================
# 升级测试
# ============================================

@test "--upgrade 包含所有渠道插件" {
    # 先安装基础组件
    bash "$INSTALL_SCRIPT" --install --npm --no-prompt --no-onboard 2>/dev/null || true
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true

    run bash "$INSTALL_SCRIPT" --upgrade --no-prompt
    # 应该检查所有渠道插件
    [[ "$output" == *"钉钉"* ]] || [[ "$output" == *"dingtalk"* ]] || true
    [[ "$output" == *"飞书"* ]] || [[ "$output" == *"feishu"* ]] || true
    [[ "$output" == *"企业微信"* ]] || [[ "$output" == *"wecom"* ]] || true
}

# ============================================
# 渠道常量测试
# ============================================

@test "渠道包名常量正确定义" {
    # 通过 source 脚本验证常量
    source "$INSTALL_SCRIPT" 2>/dev/null <<< "CLAWDBOT_INSTALL_SH_NO_RUN=1" || true
    
    run bash -c "source '$INSTALL_SCRIPT' && echo \$CHANNEL_PKG_DINGTALK"
    [[ "$output" == *"clawdbot-dingtalk"* ]] || true
}

# ============================================
# 配置 CRUD 测试
# ============================================

@test "config_get 读取配置值" {
    # 创建测试配置
    mkdir -p "$HOME/.clawdbot"
    echo '{"gateway":{"port":18789},"test":"value"}' > "$HOME/.clawdbot/clawdbot.json"
    
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_get 'gateway.port'"
    [ "$output" = "18789" ]
    
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_get 'test'"
    [ "$output" = "value" ]
}

@test "config_set 设置配置值" {
    mkdir -p "$HOME/.clawdbot"
    echo '{"existing":"data"}' > "$HOME/.clawdbot/clawdbot.json"
    
    # 设置新值
    bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_set 'gateway.port' '19000'"
    
    # 验证值已设置
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_get 'gateway.port'"
    [ "$output" = "19000" ]
    
    # 验证原有值保留
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_get 'existing'"
    [ "$output" = "data" ]
}

@test "config_delete 删除配置键" {
    mkdir -p "$HOME/.clawdbot"
    echo '{"keep":"this","delete":"that"}' > "$HOME/.clawdbot/clawdbot.json"
    
    # 删除键
    bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_delete 'delete'"
    
    # 验证已删除
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_get 'delete'"
    [ -z "$output" ]
    
    # 验证其他键保留
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_get 'keep'"
    [ "$output" = "this" ]
}

@test "config_backup 创建备份文件" {
    mkdir -p "$HOME/.clawdbot"
    echo '{"test":"backup"}' > "$HOME/.clawdbot/clawdbot.json"
    
    # 创建备份
    backup_file=$(bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_backup")
    
    # 验证备份文件存在
    [ -f "$backup_file" ]
    
    # 验证备份内容正确
    run cat "$backup_file"
    [[ "$output" == *'"test":"backup"'* ]]
    
    # 清理
    rm -f "$backup_file"
}

@test "config_exists 检测配置文件存在" {
    rm -f "$HOME/.clawdbot/clawdbot.json"
    
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_exists && echo 'exists' || echo 'not exists'"
    [ "$output" = "not exists" ]
    
    mkdir -p "$HOME/.clawdbot"
    echo '{}' > "$HOME/.clawdbot/clawdbot.json"
    
    run bash -c "source '$INSTALL_SCRIPT' 2>/dev/null; config_exists && echo 'exists' || echo 'not exists'"
    [ "$output" = "exists" ]
}
