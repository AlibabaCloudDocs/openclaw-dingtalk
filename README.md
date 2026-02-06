# Openclaw DingTalk Extension Pack

This repo bundles the DingTalk channel plugin for Openclaw/Clawdbot, an optional DashScope thinking proxy, an installer script, and deployment docs.

**Key Pieces**
- `extensions/dingtalk` - DingTalk Stream API channel plugin (npm: `clawdbot-dingtalk`)
- `extensions/dashscope-proxy` - local proxy that injects DashScope thinking params (npm: `clawdbot-dashscope-proxy`)
- `openclaw_installer.sh` - interactive/CLI installer and manager for Openclaw + plugins
- `docs/` - deployment guide and FAQ
- `CLAWDBOT_CHEAT_SHEET.md` - CLI and plugin quick reference
- `tests/` - installer test suite (BATS + expect)

**Quick Start**
Install Openclaw and the DingTalk channel using the installer:

```bash
bash openclaw_installer.sh --install
```

Or install manually via npm:

```bash
npm install -g openclaw clawdbot-dingtalk --legacy-peer-deps
```

Install the DingTalk plugin from this local repository source code:

```bash
bash scripts/install-local-plugins.sh
```

This script automatically restarts the gateway after installation.

Useful options:

```bash
# Preview actions without changing your system
bash scripts/install-local-plugins.sh --dry-run

# Use a custom config path
bash scripts/install-local-plugins.sh --config ~/.clawdbot/clawdbot.json
```

Configure `~/.openclaw/openclaw.json` (or `~/.clawdbot/clawdbot.json` if you use the legacy CLI):

```json
{
  "extensions": ["clawdbot-dingtalk"],
  "channels": {
    "clawdbot-dingtalk": {
      "enabled": true,
      "clientId": "your-dingtalk-client-id",
      "clientSecret": "your-dingtalk-client-secret"
    }
  }
}
```

Start the gateway:

```bash
openclaw gateway
```

If your install uses the legacy CLI name, run:

```bash
clawdbot gateway
```

**Docs**
- `docs/deploy-extension.md` - deployment guide
- `docs/FAQ.md` - common issues and fixes
- `extensions/dingtalk/README.md` - plugin config, commands, and options
- `extensions/dashscope-proxy/README.md` - proxy setup
- `CLAWDBOT_CHEAT_SHEET.md` - CLI cheat sheet
- `FEATURE_RESEARCH.md` - product research and roadmap notes

**Tests**
Installer tests:

```bash
cd tests
cp ../openclaw_installer.sh .
bash run_all.sh
```

**Development Notes**
- `extensions/dingtalk` targets Node.js >=20 and expects Openclaw >=2026.1.0.
- `openclaw/` in this workspace is a local checkout used for development and is not required for runtime installation.
