#!/bin/bash
# 将测试文件同步到远程服务器并执行
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# 远程服务器配置
REMOTE_HOST="${REMOTE_HOST:-REDACTED_IP}"
REMOTE_USER="${REMOTE_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="${REMOTE_DIR:-/tmp/clawdbot-tests}"

# SSH 选项
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}  远程测试执行器${NC}"
echo -e "${BLUE}==========================================${NC}"
echo ""
echo "目标: ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
echo ""

# 检查 SSH 密钥
if [[ ! -f "$SSH_KEY" ]]; then
    echo -e "${RED}错误: SSH 密钥不存在: $SSH_KEY${NC}"
    exit 1
fi

# 测试连接
echo -e "${YELLOW}→${NC} 测试 SSH 连接..."
if ! ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "echo 'OK'" &>/dev/null; then
    echo -e "${RED}错误: 无法连接到远程服务器${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} 连接成功"

# 创建远程目录
echo -e "${YELLOW}→${NC} 创建远程目录..."
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "mkdir -p $REMOTE_DIR"
echo -e "${GREEN}✓${NC} 目录已创建"

# 同步测试文件
echo -e "${YELLOW}→${NC} 同步测试文件..."
rsync -avz --delete \
    -e "ssh $SSH_OPTS" \
    --exclude 'credentials.env' \
    --exclude 'test.log' \
    "$SCRIPT_DIR/" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
echo -e "${GREEN}✓${NC} 测试文件已同步"

# 同步安装脚本
echo -e "${YELLOW}→${NC} 同步安装脚本..."
scp $SSH_OPTS "$PROJECT_DIR/openclaw_installer.sh" \
    "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
echo -e "${GREEN}✓${NC} 安装脚本已同步"

# 同步凭据文件（如果存在）
if [[ -f "$SCRIPT_DIR/credentials.env" ]]; then
    echo -e "${YELLOW}→${NC} 同步凭据文件..."
    scp $SSH_OPTS "$SCRIPT_DIR/credentials.env" \
        "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
    echo -e "${GREEN}✓${NC} 凭据文件已同步"
fi

# 设置权限
echo -e "${YELLOW}→${NC} 设置执行权限..."
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "chmod +x ${REMOTE_DIR}/*.sh ${REMOTE_DIR}/*.bats ${REMOTE_DIR}/*.exp 2>/dev/null || true"
echo -e "${GREEN}✓${NC} 权限已设置"

# 准备测试环境
echo ""
echo -e "${BLUE}=== 准备测试环境 ===${NC}"
ssh $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}" "cd $REMOTE_DIR && bash setup_remote.sh"

# 执行测试
echo ""
echo -e "${BLUE}=== 执行测试 ===${NC}"
ssh $SSH_OPTS -t "${REMOTE_USER}@${REMOTE_HOST}" "cd $REMOTE_DIR && bash run_all.sh"

# 获取测试结果
EXIT_CODE=$?

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
    echo -e "${GREEN}远程测试执行完成${NC}"
else
    echo -e "${RED}远程测试执行失败 (退出码: $EXIT_CODE)${NC}"
fi

exit $EXIT_CODE
