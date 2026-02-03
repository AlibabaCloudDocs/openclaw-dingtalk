# Clawdbot 安装脚本测试套件

本目录包含 `clawdbot_install.sh` 安装脚本的完整测试套件。

## 测试框架

- **BATS** (Bash Automated Testing System) - 用于非交互式测试
- **Expect** - 用于交互式菜单和配置向导测试

## 目录结构

```
tests/
├── helpers.sh              # 公共测试函数
├── test_args.bats          # 命令行参数测试
├── test_install_npm.bats   # npm 安装测试
├── test_install_git.bats   # git 安装测试
├── test_upgrade.bats       # 升级测试
├── test_uninstall.bats     # 卸载测试
├── test_status.bats        # 状态检查测试
├── test_cn_mirrors.bats    # 中国镜像测试
├── test_repair.bats        # 修复功能测试
├── test_menu.exp           # 交互式菜单测试
├── test_configure.exp      # 配置向导测试
├── run_all.sh              # 测试执行入口
├── setup_remote.sh         # 远程环境准备
├── credentials.env.example # 凭据模板
└── README.md               # 本文件
```

## 快速开始

### 本地测试

```bash
# 1. 进入测试目录
cd tests

# 2. 复制安装脚本
cp ../clawdbot_install.sh .

# 3. 配置凭据（可选，用于交互式测试）
cp credentials.env.example credentials.env
vim credentials.env

# 4. 运行测试
bash run_all.sh
```

### 远程服务器测试

```bash
# 1. 同步文件到远程服务器
rsync -avz -e "ssh -i ~/.ssh/id_ed25519" \
  tests/ root@REDACTED_IP:/tmp/clawdbot-tests/

scp -i ~/.ssh/id_ed25519 clawdbot_install.sh \
  root@REDACTED_IP:/tmp/clawdbot-tests/

# 2. 连接到远程服务器
ssh -i ~/.ssh/id_ed25519 root@REDACTED_IP

# 3. 准备环境
cd /tmp/clawdbot-tests
bash setup_remote.sh

# 4. 配置凭据
cp credentials.env.example credentials.env
vim credentials.env

# 5. 运行测试
bash run_all.sh
```

## 测试用例说明

### test_args.bats
测试命令行参数解析：
- `--help` / `-h`
- `--install` / `--uninstall` / `--upgrade`
- `--npm` / `--git`
- `--version` / `--beta`
- `--cn-mirrors` / `--no-cn-mirrors`
- `--dry-run` / `--verbose`
- `--purge` / `--keep-config`

### test_install_npm.bats
测试 npm 安装流程：
- 干净环境安装
- 命令可用性验证
- 版本号检查
- 重复安装处理
- 指定版本安装
- Beta 版本安装

### test_install_git.bats
测试 git 源码安装：
- 源码克隆
- Wrapper 脚本创建
- pnpm 依赖
- 自定义安装目录

### test_upgrade.bats
测试升级功能：
- 全量升级
- 核心升级
- 插件升级
- Beta 版本升级

### test_uninstall.bats
测试卸载功能：
- 标准卸载
- 保留配置 (`--keep-config`)
- 完全清除 (`--purge`)
- 重新安装

### test_status.bats
测试状态检查：
- 未安装状态
- 已安装状态
- 版本显示
- 配置状态

### test_cn_mirrors.bats
测试中国镜像：
- 自动检测 (TZ=Asia/Shanghai)
- 手动启用
- 手动禁用
- npm registry 设置

### test_repair.bats
测试修复功能：
- 修复命令执行
- 未安装时提示

### test_menu.exp
测试交互式主菜单（需要 expect）

### test_configure.exp
测试配置向导（需要真实凭据）

## 凭据配置

创建 `credentials.env` 文件：

```bash
# 钉钉凭据（必填）
DINGTALK_CLIENT_ID=your_client_id
DINGTALK_CLIENT_SECRET=your_client_secret

# 百炼凭据（可选）
DASHSCOPE_API_KEY=your_api_key
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1
```

> ⚠️ **安全提示**: `credentials.env` 已加入 `.gitignore`，请勿提交到版本控制。

## 运行单个测试

```bash
# 运行特定测试文件
bats test_args.bats

# 运行特定测试用例
bats test_args.bats --filter "help"

# 运行交互式测试
expect test_menu.exp ./clawdbot_install.sh
```

## 测试环境要求

- **操作系统**: Linux (推荐) / macOS
- **Node.js**: 22+
- **BATS**: 1.x
- **expect**: 用于交互式测试

## 故障排除

### BATS 未安装
```bash
bash setup_remote.sh
```

### 测试失败后环境未清理
```bash
source helpers.sh
cleanup_env
```

### 权限问题
```bash
chmod +x *.sh *.bats *.exp
```

## 添加新测试

1. 创建新的 `.bats` 文件
2. 在文件开头添加 `load helpers`
3. 使用 `@test "描述" { ... }` 定义测试用例
4. 在 `run_all.sh` 中添加新测试文件

示例：
```bash
#!/usr/bin/env bats
load helpers

@test "我的新测试" {
    run bash "$INSTALL_SCRIPT" --my-option --dry-run --no-prompt
    [ "$status" -eq 0 ]
    [[ "$output" == *"expected"* ]]
}
```
