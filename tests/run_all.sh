#!/bin/bash
# Openclaw 安装脚本测试套件执行入口
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}  Openclaw 安装脚本测试套件${NC}"
echo -e "${BLUE}==========================================${NC}"
echo ""

# 检查 BATS 是否安装
if ! command -v bats &>/dev/null; then
    echo -e "${RED}错误: BATS 测试框架未安装${NC}"
    echo "请运行: bash setup_remote.sh"
    exit 1
fi

# 检查安装脚本是否存在
if [[ ! -f "openclaw_installer.sh" ]]; then
    echo -e "${RED}错误: openclaw_installer.sh 不存在${NC}"
    echo "请确保安装脚本已复制到测试目录"
    exit 1
fi

# 加载凭据
if [[ -f credentials.env ]]; then
    echo -e "${GREEN}✓${NC} 加载凭据文件"
    # shellcheck disable=SC1091
    source credentials.env
    export DINGTALK_CLIENT_ID DINGTALK_CLIENT_SECRET DASHSCOPE_API_KEY DASHSCOPE_BASE_URL
    HAS_CREDENTIALS=1
else
    echo -e "${YELLOW}!${NC} credentials.env 不存在，交互式测试将被跳过"
    HAS_CREDENTIALS=0
fi

# 初始化测试结果
PASSED=0
FAILED=0
SKIPPED=0

# 运行单个测试文件
run_test_file() {
    local test_file="$1"
    local test_name="${test_file%.bats}"

    echo ""
    echo -e "${BLUE}=== 运行 ${test_name} ===${NC}"

    if bats "$test_file"; then
        echo -e "${GREEN}✓${NC} ${test_name} 通过"
        ((PASSED++)) || true
    else
        echo -e "${RED}✗${NC} ${test_name} 失败"
        ((FAILED++)) || true
    fi
}

# 运行 expect 测试
run_expect_test() {
    local test_file="$1"
    local test_name="${test_file%.exp}"

    echo ""
    echo -e "${BLUE}=== 运行 ${test_name} (交互式) ===${NC}"

    if expect "$test_file" ./openclaw_installer.sh; then
        echo -e "${GREEN}✓${NC} ${test_name} 通过"
        ((PASSED++)) || true
    else
        echo -e "${RED}✗${NC} ${test_name} 失败"
        ((FAILED++)) || true
    fi
}

echo ""
echo -e "${BLUE}=== 运行 BATS 测试 ===${NC}"

# 按顺序运行测试（参数测试不需要安装，先运行）
run_test_file "test_args.bats"

# 安装相关测试
run_test_file "test_install_npm.bats"
run_test_file "test_install_git.bats"

# 升级测试
run_test_file "test_upgrade.bats"

# 状态测试
run_test_file "test_status.bats"

# 中国镜像测试
run_test_file "test_cn_mirrors.bats"

# 修复测试
run_test_file "test_repair.bats"

# 卸载测试（最后运行，因为会清理环境）
run_test_file "test_uninstall.bats"

# 运行交互式测试
if [[ "$HAS_CREDENTIALS" == "1" ]]; then
    if command -v expect &>/dev/null; then
        echo ""
        echo -e "${BLUE}=== 运行交互式测试 ===${NC}"

        # 菜单测试
        if [[ -f "test_menu.exp" ]]; then
            run_expect_test "test_menu.exp"
        fi

        # 配置向导测试
        if [[ -f "test_configure.exp" ]]; then
            run_expect_test "test_configure.exp"
        fi
    else
        echo ""
        echo -e "${YELLOW}!${NC} expect 未安装，跳过交互式测试"
        ((SKIPPED++)) || true
    fi
else
    echo ""
    echo -e "${YELLOW}!${NC} 无凭据，跳过交互式测试"
    ((SKIPPED++)) || true
fi

# 最终清理
echo ""
echo -e "${BLUE}=== 清理测试环境 ===${NC}"
# shellcheck disable=SC1091
source helpers.bash
cleanup_env
echo -e "${GREEN}✓${NC} 清理完成"

# 输出结果摘要
echo ""
echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}  测试结果摘要${NC}"
echo -e "${BLUE}==========================================${NC}"
echo ""
echo -e "通过: ${GREEN}${PASSED}${NC}"
echo -e "失败: ${RED}${FAILED}${NC}"
echo -e "跳过: ${YELLOW}${SKIPPED}${NC}"
echo ""

if [[ "$FAILED" -gt 0 ]]; then
    echo -e "${RED}测试未全部通过${NC}"
    exit 1
else
    echo -e "${GREEN}所有测试通过！${NC}"
    exit 0
fi
