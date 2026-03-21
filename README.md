
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
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
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

GeeClaw comes pre-configured with best-practice model providers and natively supports Windows as well as multi-language settings. The app provides a dedicated **Dashboard** workspace in the sidebar, including gateway/channel overviews, quick actions, and an inspiration plaza for common AI task ideas. Inspiration cards can open a detail dialog and jump straight into the default agent chat with the recommended prompt prefilled, while app preferences, Models, and Channels stay centralized in the **Settings** modal workspace. You can still fine-tune gateway-related advanced configurations via **Settings → OpenClaw → Advanced → Developer Mode**.

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
Configure and monitor multiple AI channels from the dedicated Channels workspace in the sidebar. Each channel can now host multiple accounts, and every account can be routed to a different agent with an explicit default account per channel type. The desktop app includes bundled plugin support for DingTalk, WeCom, QQ Bot, and the official Feishu/Lark OpenClaw plugin.
At startup, GeeClaw now writes those bundled channel plugins into `openclaw.json.plugins.load.paths` from the app's own resources directory, so they no longer depend on mirrored copies under `~/.openclaw-geeclaw/extensions`.
GeeClaw also supports an always-enabled bundled plugin policy on startup. Current protected plugin: `lossless-claw`, which is auto-corrected into `plugins.allow`, `plugins.entries.lossless-claw`, and `plugins.slots.contextEngine`, including `enabled: true`, `config.dbPath` pointing at GeeClaw's managed OpenClaw config directory (`<openclaw-config-dir>/lcm.db`), `contextEngine: "lossless-claw"`, and its guarded session-pattern config defaults.
For WeCom, the channel dialog now supports QR-based one-click binding: scan and the app auto-fills/saves `botId` + `secret` directly.

### ⏰ Cron-Based Automation
Schedule AI tasks to run automatically. Define triggers, set intervals, and let your AI agents work around the clock without manual intervention.
Each task also includes a dedicated run-history view with a breadcrumb/back header, a left-side execution list, and a right-side read-only message transcript so you can inspect recent cron runs without mixing them into the main agent chat list.

### 🧩 Extensible Skill System
Extend your AI agents with pre-built skills. Browse, install, and manage skills through the integrated skill panel—no package managers required.
GeeClaw also pre-bundles full document-processing skills (`pdf`, `xlsx`, `docx`, `pptx`), deploys them automatically to the managed skills directory (default `~/.openclaw-geeclaw/skills`) on startup, and enables them by default on first install. Additional bundled skills (`find-skills`, `self-improving-agent`, `tavily-search`, `brave-web-search`, `bocha-skill`) are also enabled by default; if required API keys are missing, OpenClaw will surface configuration errors in runtime.
The Skills page can display skills discovered from multiple OpenClaw sources (managed dir, workspace, and extra skill dirs), and now shows each skill's actual location so you can open the real folder directly.
When startup discovery finds a new skill key that is not yet present in `openclaw.json`, GeeClaw writes that newly discovered skill into `skills.entries` with `enabled: false` by default. Explicit user skill toggles are also persisted in the app settings store and replayed back into `openclaw.json` before Gateway launch, so manually enabled skills stay enabled across restarts without making brand-new `.agents` skills auto-enable.
GeeClaw also enforces an always-enabled policy list on every startup (cold/hot). Current protected skills: `pdf`, `xlsx`, `docx`, `pptx`. They are auto-corrected to `enabled: true` in `openclaw.json` and cannot be disabled from the Skills page.

Environment variables for bundled search skills:
- `BRAVE_SEARCH_API_KEY` for `brave-web-search`
- `TAVILY_API_KEY` for `tavily-search` (OAuth may also be supported by upstream skill runtime)
- `BOCHA_API_KEY` for `bocha-skill`
- `find-skills` and `self-improving-agent` do not require API keys

### 🔐 Secure Provider Integration
Connect to multiple AI providers (OpenAI, Anthropic, GeekAI, and more) with credentials stored securely in your system's native keychain. Provider settings focus on base config plus model catalogs, while agent-level primary and fallback models are configured independently.

### 🌙 Adaptive Theming
Light mode, dark mode, or system-synchronized themes. GeeClaw adapts to your preferences automatically.

### 📦 Bundled OpenClaw Runtime
GeeClaw always launches its bundled OpenClaw runtime and keeps managed runtime state under `~/.openclaw-geeclaw`. On first launch, after the app resolves session state, it rewrites `~/.openclaw-geeclaw/openclaw.json` so `agents.defaults.workspace` points to `~/.openclaw-geeclaw/workspace`, runs `openclaw.mjs --profile geeclaw setup`, then starts the Gateway with `openclaw.mjs --profile geeclaw gateway --port 28788`. Existing system `openclaw` installations and `~/Library/LaunchAgents/ai.openclaw.gateway.plist` are left untouched.

You can inspect the managed OpenClaw state directory from **Settings → Safety**. GeeClaw keeps `openclaw.json -> tools.fs.workspaceOnly` fixed at `false`, and that page controls the deny/exec/elevated safety policy written under `tools`. These safety values are persisted in the app settings store and validated back into `openclaw.json` on startup.

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
2. **AI Provider** – Enter your API keys for supported providers
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

---

## Architecture

GeeClaw employs a **dual-process architecture** with a unified host API layer. The renderer talks to a single client abstraction, while Electron Main owns protocol selection and process lifecycle:

```┌─────────────────────────────────────────────────────────────────┐
│                       GeeClaw Desktop App                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron Main Process                          │  │
│  │  • Window & application lifecycle management               │  │
│  │  • Gateway process supervision                              │  │
│  │  • System integration (tray, notifications, keychain)       │  │
│  │  • Auto-update orchestration                                │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC (authoritative control plane)  │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React Renderer Process                         │  │
│  │  • Modern component-based UI (React 19)                     │  │
│  │  • State management with Zustand                            │  │
│  │  • Unified host-api/api-client calls                        │  │
│  │  • Rich Markdown rendering                                  │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ Main-owned transport strategy
                               │ (WS first, HTTP then IPC fallback)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                Host API & Main Process Proxies                  │
│                                                                  │
│  • hostapi:fetch (Main proxy, avoids CORS in dev/prod)          │
│  • gateway:httpProxy (Renderer never calls Gateway HTTP direct)  │
│  • Unified error mapping & retry/backoff                         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ WS / HTTP / IPC fallback
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                             │
│                                                                  │
│  • AI agent runtime and orchestration                           │
│  • Message channel management                                    │
│  • Skill/plugin execution environment                           │
│  • Provider abstraction layer                                    │
└─────────────────────────────────────────────────────────────────┘
```
### Design Principles

- **Process Isolation**: The AI runtime operates in a separate process, ensuring UI responsiveness even during heavy computation
- **Single Entry for Frontend Calls**: Renderer requests go through host-api/api-client; protocol details are hidden behind a stable interface
- **Main-Process Transport Ownership**: Electron Main controls WS/HTTP usage and fallback to IPC for reliability
- **Graceful Recovery**: Built-in reconnect, timeout, and backoff logic handles transient failures automatically
- **Secure Storage**: API keys and sensitive data leverage the operating system's native secure storage mechanisms
- **CORS-Safe by Design**: Local HTTP access is proxied by Main, preventing renderer-side CORS issues

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
pnpm typecheck            # TypeScript validation

# Testing
pnpm test                 # Run unit tests

# Build & Package
pnpm run build:vite       # Build frontend only
pnpm run bundle:openclaw-plugins  # Refresh bundled OpenClaw plugin mirrors
pnpm build                # Full production build (with packaging assets)
pnpm package              # Package for current platform
pnpm package:mac          # Package for macOS
pnpm package:win          # Package for Windows
pnpm package:linux        # Package for Linux
```

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

We welcome contributions from the community! Whether it's bug fixes, new features, documentation improvements, or translations—every contribution helps make GeeClaw better.

### How to Contribute

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes with clear messages
4. **Push** to your branch
5. **Open** a Pull Request

### Guidelines

- Follow the existing code style (ESLint + Prettier)
- Write tests for new functionality
- Update documentation as needed
- Keep commits atomic and descriptive

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
