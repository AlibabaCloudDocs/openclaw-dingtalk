#!/bin/bash
# 远程服务器测试环境准备脚本
set -euo pipefail

echo "==========================================="
echo "  Clawdbot 测试环境准备"
echo "==========================================="
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 检测包管理器
detect_package_manager() {
    if command -v apt-get &>/dev/null; then
        echo "apt"
    elif command -v yum &>/dev/null; then
        echo "yum"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    elif command -v apk &>/dev/null; then
        echo "apk"
    else
        echo "unknown"
    fi
}

PKG_MANAGER=$(detect_package_manager)

install_package() {
    local pkg="$1"
    echo -e "${YELLOW}→${NC} 安装 $pkg..."

    case "$PKG_MANAGER" in
        apt)
            apt-get update -qq && apt-get install -y -qq "$pkg"
            ;;
        yum)
            yum install -y -q "$pkg"
            ;;
        dnf)
            dnf install -y -q "$pkg"
            ;;
        apk)
            apk add --quiet "$pkg"
            ;;
        *)
            echo -e "${RED}无法自动安装 $pkg，请手动安装${NC}"
            return 1
            ;;
    esac
}

# 安装 BATS
echo "检查 BATS..."
if command -v bats &>/dev/null; then
    echo -e "${GREEN}✓${NC} BATS 已安装: $(bats --version)"
else
    echo -e "${YELLOW}→${NC} 安装 BATS..."

    # 尝试通过包管理器安装
    case "$PKG_MANAGER" in
        apt)
            apt-get update -qq
            if apt-get install -y -qq bats 2>/dev/null; then
                echo -e "${GREEN}✓${NC} BATS 通过 apt 安装成功"
            else
                # 从源码安装
                git clone --depth 1 https://github.com/bats-core/bats-core.git /tmp/bats-core
                cd /tmp/bats-core && ./install.sh /usr/local
                rm -rf /tmp/bats-core
                echo -e "${GREEN}✓${NC} BATS 从源码安装成功"
            fi
            ;;
        *)
            # 从源码安装
            git clone --depth 1 https://github.com/bats-core/bats-core.git /tmp/bats-core
            cd /tmp/bats-core && ./install.sh /usr/local
            rm -rf /tmp/bats-core
            echo -e "${GREEN}✓${NC} BATS 从源码安装成功"
            ;;
    esac
fi

# 安装 expect
echo ""
echo "检查 expect..."
if command -v expect &>/dev/null; then
    echo -e "${GREEN}✓${NC} expect 已安装"
else
    install_package expect
    echo -e "${GREEN}✓${NC} expect 安装成功"
fi

# 安装 git
echo ""
echo "检查 git..."
if command -v git &>/dev/null; then
    echo -e "${GREEN}✓${NC} git 已安装: $(git --version)"
else
    install_package git
    echo -e "${GREEN}✓${NC} git 安装成功"
fi

# 检查 Node.js
echo ""
echo "检查 Node.js..."
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓${NC} Node.js 已安装: $NODE_VERSION"

    # 检查版本是否 >= 22
    MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
    if [[ "$MAJOR_VERSION" -lt 22 ]]; then
        echo -e "${YELLOW}!${NC} Node.js 版本低于 22，某些功能可能不可用"
    fi
else
    echo -e "${YELLOW}→${NC} 安装 Node.js 22..."

    # 使用 NodeSource 安装
    case "$PKG_MANAGER" in
        apt)
            curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
            apt-get install -y nodejs
            ;;
        yum|dnf)
            curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
            $PKG_MANAGER install -y nodejs
            ;;
        *)
            echo -e "${RED}请手动安装 Node.js 22+${NC}"
            ;;
    esac

    if command -v node &>/dev/null; then
        echo -e "${GREEN}✓${NC} Node.js 安装成功: $(node --version)"
    fi
fi

# 检查 npm
echo ""
echo "检查 npm..."
if command -v npm &>/dev/null; then
    echo -e "${GREEN}✓${NC} npm 已安装: $(npm --version)"
else
    echo -e "${RED}✗${NC} npm 未安装，请检查 Node.js 安装"
fi

# 创建测试快照
echo ""
echo "创建环境快照..."
mkdir -p /tmp/clawdbot-test-snapshot

# 记录 npm 全局包
npm list -g --depth=0 2>/dev/null > /tmp/clawdbot-test-snapshot/npm-global.txt || true

# 记录 clawdbot 目录状态
ls -la ~/.clawdbot 2>/dev/null > /tmp/clawdbot-test-snapshot/clawdbot-dir.txt || true

echo -e "${GREEN}✓${NC} 快照已保存到 /tmp/clawdbot-test-snapshot/"

echo ""
echo "==========================================="
echo -e "${GREEN}  测试环境准备完成${NC}"
echo "==========================================="
echo ""
echo "现在可以运行: bash run_all.sh"
