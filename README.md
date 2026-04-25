
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
  <img src="https://img.shields.io/badge/license-GPL%20v3-green" alt="License" />
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
| Multiple AI providers | Separate Model Providers and Model Config settings |
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
Communicate with AI agents through a modern chat experience. Supports Codex-style `/` skill search with continuous filtering, keyboard navigation, and inline skill tokens for enabled skills inserted directly into the composer. This lets you invoke specific skills for specialized tasks without enabling a large number of skills that would dilute the agent's focus—studies show that enabling more than 20 skills noticeably degrades response quality.
When the Hermes evolution workflow emits an `evolution_proposal` tool call for desktop delivery, the chat renders it as a native review card with proposal tabs and a one-click approval action.
Each agent also exposes an **Active Evolution** toggle in **Agent Settings → General**. GeeClaw persists that preference in its local agent store, keeps `evolution_proposal` aligned in the agent-local `tools.deny` list, and only mutates `agents.list[].skills` when that agent already has an explicit skill array.

### ✅ Global Approval Prompts
When OpenClaw requests exec or plugin approval, GeeClaw displays a blocking approval dialog above any page, including startup and settings screens.

### 🧠 Official Agent Marketplace
Browse and install curated official agents from the Plaza on demand, instead of bundling every agent into the desktop package.

### 📡 Multi-Channel Management
Built-in bundled plugin support for Feishu/Lark, DingTalk, WeCom, Weixin, and QQ Bot official OpenClaw plugins with one-click installation. WeCom and Weixin support instant QR-code scanning for configuration. Each IM account can be routed to a different agent independently—deploy one GeeClaw instance to run multiple online IM agents simultaneously.

### ⏰ Cron-Based Automation
Schedule AI tasks to run automatically. Define triggers, set intervals, and let your AI agents work around the clock. The cron task form supports choosing an external delivery channel and selecting the sending account for multi-account channels. A task run history view makes it easy to check execution status.

### 🧩 Extensible Skill System
Extend your AI agents with pre-built skills. Browse and install skills from the integrated skill panel, then manage enablement per agent with agent-aware discovery and filtering—no package managers required.
The marketplace detects whether the China-optimized `skillhub` CLI is available and offers a one-click guided install; if `skillhub` is unavailable, GeeClaw falls back to the built-in `clawhub` installer automatically.

### ⚙️ Environment Variable Management
Manage global environment variables for GeeClaw's managed runtime directly in **Settings → Environment**. GeeClaw injects these variables into the managed Gateway and Agent runtimes, considers them when checking preset `requires.env` dependencies, and automatically restarts the Gateway after saving.

### 🌙 Adaptive Theming
Light mode, dark mode, or system-synchronized themes. GeeClaw adapts to your preferences automatically.

### 📦 Bundled OpenClaw Runtime
GeeClaw always uses its bundled OpenClaw runtime, avoiding dependency on system PATH or conflicts with an existing system `openclaw` installation.

---

## Getting Started

### System Requirements

- **Operating System**: macOS 11+, Windows 10+
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 2GB available disk space

### GPU Acceleration

GeeClaw now enables Electron GPU acceleration by default. If you hit driver-specific rendering issues on a particular machine, launch the app with `--disable-gpu` to force software rendering.

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

To validate the hosted agent marketplace catalog during development, start the app with:

```bash
GEECLAW_AGENT_MARKETPLACE_CATALOG_URL=https://www.geeclaw.cn/res/agent-marketplace-catalog.json pnpm dev
```

To validate the hosted GeeClaw provider proxy config during development, start the app with:

```bash
GEECLAW_PROVIDER_CONFIG_URL=https://www.geeclaw.cn/res/geeclaw-provider-config.json pnpm dev
```

### First Launch

When you launch GeeClaw for the first time, the app completes these steps through a streamlined flow:

1. **Check Login Status** – Confirm whether you are already signed in
2. **Runtime Preparation** – Automatically prepare the bundled OpenClaw runtime
3. **Install Default Tools/Skills** – Complete the default local toolchain setup
4. **Enter the App** – Launch directly into the main interface once ready

Model setup is now handled inside the main app:

- Open **Settings → Model Providers** to add providers and their model catalogs.
- Open **Settings → Model Config** to choose the default chat model and optional image/video-generation model slots.
- GeeClaw's built-in provider includes an `auto` model. The local transparent proxy refreshes `site/res/geeclaw-provider-config.json` or the hosted config every 30 minutes to choose the upstream URL, enforce the allowed model list, and resolve `auto` from the first `autoModels` entry that this app version already has in the provider registry. This proxy config does not publish new UI models or rewrite OpenClaw runtime config; new visible models still require updating the provider registry in the app.

- If no provider models exist, the chat composer stays disabled and links you to **Model Providers**.
- If provider models exist but no default chat model is configured, the chat composer links you to **Model Config** instead.

> Note for Moonshot (Kimi): GeeClaw keeps Kimi web search enabled by default.
> When Moonshot is configured, GeeClaw also syncs Kimi web search to the China endpoint (`https://api.moonshot.cn/v1`) in OpenClaw config.

GeeClaw manages its own OpenClaw runtime and state directory. You can also go to **Settings → Advanced** to copy a terminal command or install a user-level `geeclaw` command that runs the bundled OpenClaw under the `geeclaw` profile without registering `openclaw` to your global PATH.

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

### OpenCLI Browser Bridge Check

Open **Settings → OpenCLI** to:

- verify whether `opencli` is installed on your system PATH
- inspect the detected OpenCLI version, daemon status, and Chrome Browser Bridge connectivity
- jump to **Settings → CLI Market** when `opencli` is missing
- download the Chrome extension package or jump to the upstream install guide when Chrome is not connected

### MCP Runtime Check

Open **Settings → MCP** to review whether `mcporter` is installed on your system PATH. If GeeClaw cannot find it, the page sends you to **Settings → CLI Market** for one-click installation and still offers the upstream project links as secondary references.

### Environment Variables

Open **Settings → Environment** to manage app-level environment variables for GeeClaw's managed runtime. These values are merged into the managed Gateway process, inherited by managed Agent runs, and considered when checking preset `requires.env` dependencies. Saving changes restarts the Gateway automatically.

### Memory Settings

Open **Settings → Memory** to manage a beginner-friendly subset of OpenClaw memory features without editing `openclaw.json` directly.

- The page exposes **Dreaming**, **Active Memory**, and **Lossless Claw**.
- On startup, GeeClaw keeps **Dreaming** enabled by default, but initializes **Active Memory** as off unless `openclaw.json` explicitly enables it.
- Saving Memory settings triggers a managed Gateway hot-reload so the updated config takes effect immediately.

### Web Search Providers

Open **Settings → Web Search** to manage OpenClaw `web_search` providers without editing `openclaw.json` by hand.

- Shared tool settings such as enablement, provider selection, max results, timeout, and cache TTL are written under the canonical `tools.web.search` keys.
- Provider-specific API keys are saved under `plugins.entries.<pluginId>.config.webSearch.*`.
- The settings panel renders provider-specific fields dynamically and selecting Firecrawl also enables the bundled Firecrawl plugin entry automatically.

### CLI Market

Open **Settings → CLI Market** to review a curated set of CLIs that GeeClaw can detect and help install.

- GeeClaw still determines install state by checking whether the target command already exists on your system.
- Some entries are GeeClaw-managed npm installs. When those commands are missing, GeeClaw installs them with the bundled Node/npm runtime into a GeeClaw-managed user-level prefix instead of requiring a system-wide `npm install -g`.
- On the first managed install, GeeClaw also adds that managed directory to your user PATH so newly opened terminals can use the command directly.
- Other entries can expose manual install commands such as `brew` or `curl`. GeeClaw only surfaces those commands when the required installer command is already available on the machine.
- System-installed CLIs are treated as read-only detections in this view. GeeClaw will not try to uninstall them for you.
- GeeClaw does not compare versions in this view yet. Reinstall always uses the latest package version available from npm at the time you click it.
- Managed npm entries can declare structured post-install actions. GeeClaw can auto-install related skills or run the freshly installed CLI against managed paths such as `~/.openclaw-geeclaw/skills` without relying on user-authored shell scripts.
- After a managed install succeeds, GeeClaw shows a completion prompt with the next step: open the docs for browser extensions or bridge setup, or jump to the Skills page to enable newly installed skills.
- Managed install and uninstall actions open a live log dialog so you can watch the full bundled `npm`, `npx skills`, and managed follow-up command output in one place.

Managed install locations:

- macOS / Linux: `~/.geeclaw/npm-global`
- Windows: `%APPDATA%\\GeeClaw\\npm-global`

---

## Architecture

GeeClaw employs a **dual-process + unified Host API architecture**. The renderer calls a single client abstraction; protocol selection and process lifecycle are managed by Electron Main.

### Design Principles

- **Process Isolation**: The AI runtime operates in a separate process, ensuring UI responsiveness even during heavy computation
- **Single Entry for Frontend Calls**: Renderer requests go through host-api/api-client; protocol details are hidden behind a stable interface
- **Main-Process Transport Ownership**: Electron Main controls WS/HTTP usage and fallback to IPC for reliability
- **Single Approval Transport**: OpenClaw approval requests and resolutions ride over the generic Gateway notification stream, and approval decisions return through `gateway:rpc` instead of a second approval-specific bridge
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
│   ├── e2e/                 # Playwright Electron smoke coverage
│   └── unit/                # Vitest unit/integration-like tests
├── resources/                # Static assets (icons/images)
└── scripts/                  # Build and utility scripts
```
### Available Commands

```bash
# Development
pnpm run init             # Install dependencies + download uv and bundled Node/npm
pnpm dev                  # Start with hot reload (prefers repo-local openclaw-runtime)

# Quality
pnpm lint                 # Run ESLint
pnpm run lint:check       # Run ESLint without modifying files
pnpm typecheck            # TypeScript validation

# Testing
pnpm test                 # Run unit tests
pnpm run test:e2e         # Run macOS-only Electron smoke E2E (downloads the pinned OpenClaw sidecar first)
pnpm run test:e2e:headed  # Run the same Electron smoke E2E with a visible window
pnpm run verify           # Lint + typecheck + unit tests

# Build & Package
pnpm run build:vite       # Build frontend only
pnpm run openclaw-runtime:prepare  # Ensure the repo-local runtime exists for local development
pnpm run openclaw-runtime:install  # Refresh the repo-local OpenClaw runtime used by development and non-sidecar packaging
pnpm run bundle:openclaw-plugins  # Refresh bundled OpenClaw plugin mirrors
pnpm run openclaw-sidecar:build -- --target darwin-arm64 --version 2026.4.10-r1  # Build a standalone OpenClaw sidecar artifact
pnpm run openclaw-sidecar:download -- --target darwin-x64  # Download the pinned sidecar archive into build/prebuilt-sidecar/
pnpm package:dev          # Prepare local packaging assets for non-sidecar development packaging
pnpm package:mac:dir      # Build a local macOS dir package against the repo-local runtime
pnpm package:mac:dir:quick # Fast local macOS dir packaging; reuses existing build/openclaw*, plugins, and skills assets
```

### Electron E2E Smoke Test

GeeClaw includes a Playwright-driven Electron smoke test for the desktop shell on macOS.

- `pnpm run test:e2e` builds the app and launches the real Electron main process from `dist-electron/main/index.js`.
- The test uses isolated temporary `HOME` and Electron `userData` directories so it does not touch your normal GeeClaw profile.
- In E2E mode, GeeClaw skips setup/login/provider gating only. It still starts the real managed OpenClaw/Gateway stack before entering the main UI.
- The current smoke coverage verifies that the app can boot into the main shell and navigate between Dashboard, Skills, and Channels.

### Release Notes For Auto-Update

Before packaging a release, update [`resources/release-notes.md`](resources/release-notes.md). `electron-builder` embeds that Markdown into the auto-update metadata, and GeeClaw shows it in the startup update dialog when a newer version is available.

Release CI publishes channel metadata and immutable payload archives separately on OSS. macOS channel feeds under `latest/darwin-*` or `beta/darwin-*` only contain `*-mac.yml`; the metadata is rewritten to point at the single archived zip in `releases/vX.Y.Z/release-mac-*` so OSS does not store duplicate macOS updater payloads per channel.

### OpenClaw Runtime Workflow

For local development, initialize and refresh the runtime like this:

```bash
pnpm install
pnpm run openclaw-runtime:prepare
pnpm dev
```

- `pnpm dev` and `openclaw-runtime:prepare` use the repo-local `openclaw-runtime/` install. They do not download a sidecar by default.
- Set `GEECLAW_AGENT_MARKETPLACE_CATALOG_URL` to force development builds to load the agent marketplace catalog from a remote URL instead of `site/res/agent-marketplace-catalog.json`.
- Set `GEECLAW_PROVIDER_CONFIG_URL` to force development builds to load the GeeClaw provider proxy config from a remote URL instead of `site/res/geeclaw-provider-config.json`.
- Use `pnpm run openclaw-runtime:install` when you change `openclaw-runtime/package.json`, need a clean reinstall, or want to refresh the local runtime explicitly.

### GitHub Pages Landing Page

This repository also ships a static marketing landing page under [`site/`](site/).

- Open [`site/index.html`](site/index.html) directly for local preview.
- Publish the repository's `site/` directory with GitHub Pages to host it.
- The page uses relative local asset paths plus config-driven external URLs so the same files work under both a GitHub Pages project URL and a custom domain such as `www.geeclaw.cn`.

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

GeeClaw is based on OpenClaw and ClawX, and is released under the GPL v3 License.

---

<p align="center">
  <sub>Built with ❤️ by the dtminds Team</sub>
</p>
