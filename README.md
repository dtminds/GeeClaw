
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="GeeClaw Logo" />
</p>

<h1 align="center">GeeClaw</h1>

<p align="center">
  <strong>The Desktop Interface for OpenClaw AI Agents</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#why-geeclaw">Why GeeClaw</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/github/downloads/dtminds/GeeClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a>
</p>

---

## Overview

**GeeClaw** bridges the gap between powerful AI agents and everyday users. Built on top of [OpenClaw](https://github.com/OpenClaw), it transforms command-line AI orchestration into an accessible, beautiful desktop experience—no terminal required.

Whether you're automating workflows, managing AI-powered channels, or scheduling intelligent tasks, GeeClaw provides the interface you need to harness AI agents effectively.

---

## Why GeeClaw

Building AI agents shouldn't require mastering the command line. GeeClaw was designed with a simple philosophy: **powerful technology deserves an interface that respects your time.**

| Challenge | GeeClaw Solution |
|-----------|----------------|
| Complex CLI setup | One-click installation with a simplified startup flow |
| Configuration files | Visual settings with real-time validation |
| Process management | Automatic gateway lifecycle management |
| Multiple AI providers | Unified provider configuration panel |
| Skill/plugin installation | Built-in skill marketplace and management |

### OpenClaw Inside

GeeClaw is built directly upon the official **OpenClaw** core. Instead of requiring a separate installation, we embed the runtime within the application to provide a seamless "battery-included" experience.
GeeClaw always runs the bundled runtime and stores managed OpenClaw state under `~/.openclaw-geeclaw`, using the dedicated `geeclaw` OpenClaw profile so an existing system `openclaw` installation stays untouched.

We are committed to maintaining strict alignment with the upstream OpenClaw project, ensuring that you always have access to the latest capabilities, stability improvements, and ecosystem compatibility provided by the official releases.

---

## Features

### 🎯 Zero Configuration Barrier
Move from launch to your first AI interaction through a simplified sign-in-first flow. No terminal commands, no YAML files, no environment variable hunting.

### 💬 Intelligent Chat Interface
Communicate with AI agents through a modern chat experience. The sidebar now follows OpenClaw's native session model by listing agents and entering each agent's canonical main chat (`agent:{agentId}:main`) directly, while each chat page includes a left-side session panel for that agent's main session and temporary chats, with temporary chats created inline from the panel. GeeClaw still keeps desktop-managed chat entries separate from the raw Gateway session registry and offers an additional read-only view for browsing all Gateway sessions and transcripts. Multi-agent setups are supported, and you can route the next message directly into another agent's main session with `@agent-id` from the main composer. The composer model switcher is now built from each provider's configured model catalog, while the agent primary model and fallback chain are managed separately in Settings. Codex-style `/` skill search with keyboard navigation, filtering, and inline skill tokens for enabled skills is also supported.

### 📡 Multi-Channel Management
Configure and monitor multiple AI channels from the dedicated Channels workspace in the sidebar. Each channel can now host multiple accounts, and every account can be routed to a different agent with an explicit default account per channel type. The desktop app includes bundled plugin support for DingTalk, WeCom, Weixin, QQ Bot, and the official Feishu/Lark OpenClaw plugin.

### ⏰ Cron-Based Automation
Schedule AI tasks to run automatically. Define triggers, set intervals, and let your AI agents work around the clock without manual intervention.

### 🧩 Extensible Skill System
Extend your AI agents with pre-built skills. Browse, install, and manage skills through the integrated skill panel—no package managers required.
On fresh installs, the marketplace can now detect whether the China-optimized `skillhub` CLI is available and offer a one-click guided install that uses GeeClaw's bundled `uv` + managed Python runtime. If `skillhub` is unavailable, GeeClaw automatically falls back to the bundled `clawhub` installer.
Packaged preinstalled skills are now loaded directly from the app bundle via `skills.load.extraDirs`, so app updates can refresh those skills without copying managed duplicates into `~/.openclaw-geeclaw/skills`.

Environment variables for bundled search skills:
- `BRAVE_SEARCH_API_KEY` for `brave-web-search`
- `TAVILY_API_KEY` for `tavily-search` (OAuth may also be supported by upstream skill runtime)
- `BOCHA_API_KEY` for `bocha-skill`

Packaged builds also ship managed `opencli` and `mcporter` CLIs on the internal PATH so bundled skill / exec flows do not depend on separate system installs.

### 🔐 Secure Provider Integration
Connect to multiple AI providers (OpenAI, Anthropic and more) with credentials stored securely in your system's native keychain. OpenAI supports both API key and browser OAuth (Codex subscription) sign-in.

### 🌙 Adaptive Theming
Light mode, dark mode, or system-synchronized themes. GeeClaw adapts to your preferences automatically.

### 📦 Bundled OpenClaw Runtime
GeeClaw always launches its bundled OpenClaw runtime and keeps managed runtime state under `~/.openclaw-geeclaw`. On first launch, after the app resolves session state, it rewrites `~/.openclaw-geeclaw/openclaw.json` so `agents.defaults.workspace` points to `~/.openclaw-geeclaw/workspace`, `agents.defaults.heartbeat.every` is fixed to `"2h"`, and `agents.defaults.maxConcurrent` is fixed to `3`, then runs `openclaw.mjs --profile geeclaw setup`, then starts the Gateway with `openclaw.mjs --profile geeclaw gateway --port 28788`. Existing system `openclaw` installations and `~/Library/LaunchAgents/ai.openclaw.gateway.plist` are left untouched.

You can inspect the managed OpenClaw state directory from **Settings → Safety**. GeeClaw keeps `openclaw.json -> tools.fs.workspaceOnly` fixed at `false`, and that page controls the deny/exec/elevated safety policy written under `tools`. These safety values are persisted in the app settings store and validated back into `openclaw.json` on startup.
Open **Settings → Advanced** to copy a terminal command that runs GeeClaw's bundled OpenClaw with the managed `geeclaw` profile, or install a user-level `geeclaw` command for terminal use without registering `openclaw` on your global PATH.

---

## Getting Started

### System Requirements

- **Operating System**: macOS 11+, Windows 10+, or Linux (Ubuntu 20.04+)
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 1GB available disk space

### Installation

#### Pre-built Releases (Recommended)

Download the latest release for your platform from the [Releases](https://github.com/dtminds/GeeClaw/releases) page.

#### Build from Source

```bash
# Clone the repository
git clone https://github.com/dtminds/GeeClaw.git
cd GeeClaw

# Initialize the project
pnpm run init

# Start in development mode
pnpm dev
```
### First Launch

When you launch GeeClaw for the first time, the **Setup Wizard** will guide you through:

1. **Language & Region** – Configure your preferred locale
2. **AI Provider** – Add providers with API keys or OAuth (for providers that support browser/device login)
3. **Skill Bundles** – Select pre-configured skills for common use cases
4. **Verification** – Test your configuration before entering the main interface

GeeClaw manages its own OpenClaw runtime and state directory. If you already have legacy OpenClaw data under `~/.openclaw`, keep it as-is for migration or manual import; GeeClaw does not switch over to your system `openclaw` command for normal runtime operation.

> Note for Moonshot (Kimi): GeeClaw keeps Kimi web search enabled by default.  
> When Moonshot is configured, GeeClaw also syncs Kimi web search to the China endpoint (`https://api.moonshot.cn/v1`) in OpenClaw config.

### Proxy Settings

GeeClaw includes built-in proxy settings for environments where Electron, the OpenClaw Gateway, or channels such as Telegram need to reach the internet through a local proxy client.

Open **Settings → Gateway → Proxy** and configure:

- **Proxy Server**: the default proxy for all requests
- **Bypass Rules**: hosts that should connect directly, separated by semicolons, commas, or new lines
- In **Developer Mode**, you can optionally override:
  - **HTTP Proxy**
  - **HTTPS Proxy**
  - **ALL_PROXY / SOCKS**

Recommended local examples:

```text
Proxy Server: http://127.0.0.1:7890
```
Notes:

- A bare `host:port` value is treated as HTTP.
- If advanced proxy fields are left empty, GeeClaw falls back to `Proxy Server`.
- Saving proxy settings reapplies Electron networking immediately and restarts the Gateway automatically.
- GeeClaw also syncs the proxy to OpenClaw's Telegram channel config when Telegram is enabled.
- On packaged Windows builds, the bundled `openclaw` CLI/TUI runs via the shipped `node.exe` entrypoint to keep terminal input behavior stable.
- The managed `openclaw` wrappers also pin `OPENCLAW_STATE_DIR=~/.openclaw-geeclaw`, `OPENCLAW_CONFIG_PATH=~/.openclaw-geeclaw/openclaw.json`, and default to `--profile geeclaw` so terminal usage matches GeeClaw's managed runtime.

### OpenCLI Browser Bridge Check

GeeClaw also ships a bundled `opencli` runtime for skill/exec environments that rely on OpenCLI. Open **Settings → OpenCLI** to:

- verify that the bundled OpenCLI runtime is present
- inspect the bundled runtime version, daemon status, and Chrome Browser Bridge connectivity
- let GeeClaw warm up `opencli doctor --no-live` in the background after Gateway startup so the daemon is ready before you open the page
- browse supported OpenCLI sites and commands grouped by site from the Settings page
- download the Chrome extension package or jump to the upstream install guide when Chrome is not connected

### MCP Runtime Check

Open **Settings → MCP** to review whether `mcporter` is installed in the standard way on your system PATH. If GeeClaw cannot find a standard installation, the page links to the official installation guide and still shows whether the bundled fallback runtime is available.

---

## Architecture

GeeClaw employs a **dual-process architecture** with a unified host API layer. The renderer talks to a single client abstraction, while Electron Main owns protocol selection and process lifecycle.

### Design Principles

- **Process Isolation**: The AI runtime operates in a separate process, ensuring UI responsiveness even during heavy computation
- **Single Entry for Frontend Calls**: Renderer requests go through host-api/api-client; protocol details are hidden behind a stable interface
- **Main-Process Transport Ownership**: Electron Main controls WS/HTTP usage and fallback to IPC for reliability
- **Graceful Recovery**: Built-in reconnect, timeout, and backoff logic handles transient failures automatically
- **Secure Storage**: API keys and sensitive data leverage the operating system's native secure storage mechanisms
- **CORS-Safe by Design**: Local HTTP access is proxied by Main, preventing renderer-side CORS issues

### Process Model & Gateway Troubleshooting

- GeeClaw is an Electron app, so **one app instance normally appears as multiple OS processes** (main/renderer/zygote/utility). This is expected.
- Single-instance protection uses Electron's lock plus a local process-file lock fallback, preventing duplicate launches in environments where desktop IPC or the session bus is unstable.
- During rolling upgrades, mixed old/new app versions can still produce asymmetric protection behavior. For best reliability, upgrade all desktop clients to the same version.
- The OpenClaw Gateway listener should still be **single-owner**: only one process should listen on `127.0.0.1:28788`.
- To verify the active listener:
  - macOS/Linux: `lsof -nP -iTCP:28788 -sTCP:LISTEN`
  - Windows (PowerShell): `Get-NetTCPConnection -LocalPort 28788 -State Listen`
- Clicking the window close button (`X`) hides GeeClaw to tray; it does **not** fully quit the app. Use tray menu **Quit GeeClaw** for a complete shutdown.

---

## Use Cases

### 🤖 Personal AI Assistant
Configure a general-purpose AI agent that can answer questions, draft emails, summarize documents, and help with everyday tasks—all from a clean desktop interface.

### 📊 Automated Monitoring
Set up scheduled agents to monitor news feeds, track prices, or watch for specific events. Results are delivered to your preferred notification channel.

### 💻 Developer Productivity
Integrate AI into your development workflow. Use agents to review code, generate documentation, or automate repetitive coding tasks.

### 🔄 Workflow Automation
Chain multiple skills together to create sophisticated automation pipelines. Process data, transform content, and trigger actions—all orchestrated visually.

---

## Development

### Prerequisites

- **Node.js**: 22+ (LTS recommended)
- **Package Manager**: pnpm 9+ (recommended) or npm

### Project Structure

```GeeClaw/
├── electron/                 # Electron Main Process
│   ├── api/                 # Main-side API router and handlers
│   │   └── routes/          # RPC/HTTP proxy route modules
│   ├── services/            # Provider, secrets and runtime services
│   │   ├── providers/       # Provider/account model sync logic
│   │   └── secrets/         # OS keychain and secret storage
│   ├── shared/              # Shared provider schemas/constants
│   │   └── providers/
│   ├── main/                # App entry, windows, IPC registration
│   ├── gateway/             # OpenClaw Gateway process manager
│   ├── preload/             # Secure IPC bridge
│   └── utils/               # Utilities (storage, auth, paths)
├── src/                      # React Renderer Process
│   ├── lib/                 # Unified frontend API + error model
│   ├── stores/              # Zustand stores (settings/chat/gateway)
│   ├── components/          # Reusable UI components, including settings workspace sections
│   ├── pages/               # Setup/Dashboard/Chat/Skills/Cron/Settings modal shell
│   ├── i18n/                # Localization resources
│   └── types/               # TypeScript type definitions
├── tests/
│   └── unit/                # Vitest unit/integration-like tests
├── resources/                # Static assets (icons/images)
└── scripts/                  # Build and utility scripts
```
### Available Commands

```bash
# Development
pnpm run init             # Install dependencies + download uv
pnpm dev                  # Start with hot reload

# Quality
pnpm lint                 # Run ESLint
pnpm run lint:check       # Run ESLint without modifying files
pnpm typecheck            # TypeScript validation

# Testing
pnpm test                 # Run unit tests
pnpm run verify           # Lint + typecheck + unit tests

# Build & Package
pnpm run build:vite       # Build frontend only
pnpm run bundle:opencli   # Refresh the bundled opencli runtime
pnpm run bundle:mcporter  # Refresh the bundled mcporter runtime
pnpm run bundle:openclaw-plugins  # Refresh bundled OpenClaw plugin mirrors
pnpm build                # Full production build (with packaging assets)
pnpm package              # Package for current platform
pnpm package:mac          # Package for macOS
pnpm package:win          # Package for Windows
pnpm package:linux        # Package for Linux
```

### Release Notes For Auto-Update

Before packaging a release, update [`resources/release-notes.md`](resources/release-notes.md). `electron-builder` embeds that Markdown into the auto-update metadata, and GeeClaw shows it in the startup update dialog when a newer version is available.

Unpublished OpenClaw plugins can be bundled from `plugins/openclaw/<plugin-id>/`
without adding the plugin package to the app's top-level `node_modules/`. The
directory must include `openclaw.plugin.json`; if the plugin has runtime
dependencies, keep them available from that plugin directory, typically via its
own `node_modules/`.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Electron 40+ |
| UI Framework | React 19 + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| State | Zustand |
| Build | Vite + electron-builder |
| Testing | Vitest + Playwright |
| Animation | Framer Motion |
| Icons | Lucide React |

---

## Contributing

We welcome contributions from the community. For local setup, validation commands, and project guardrails, start with [CONTRIBUTING.md](CONTRIBUTING.md).

Additional maintainer and contributor docs:

- [SUPPORT.md](SUPPORT.md) for issue routing and support expectations
- [SECURITY.md](SECURITY.md) for vulnerability reporting
- [docs/release-checklist.md](docs/release-checklist.md) for release prep

Quick expectations for pull requests:

- Follow the existing code style enforced by ESLint and TypeScript.
- Add or update tests when behavior changes.
- Update `README.md` and `README.zh-CN.md` when user-facing flows or architecture change.
- Keep commits and pull requests focused and well-described.

---

## Acknowledgments

GeeClaw is built on the shoulders of excellent open-source projects:

- [OpenClaw](https://github.com/OpenClaw) – The AI agent runtime
- [Electron](https://www.electronjs.org/) – Cross-platform desktop framework
- [React](https://react.dev/) – UI component library
- [shadcn/ui](https://ui.shadcn.com/) – Beautifully designed components
- [Zustand](https://github.com/pmndrs/zustand) – Lightweight state management
- [ClawX](https://github.com/ValueCell-ai/ClawX) – An Desktop App built on top of OpenClaw

---

## License

GeeClaw is released under the [MIT License](LICENSE). You're free to use, modify, and distribute this software.

---

<p align="center">
  <sub>Built with ❤️ by the dtminds Team</sub>
</p>
