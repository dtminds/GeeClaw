
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
Communicate with AI agents through a modern chat experience. The sidebar now follows OpenClaw's native session model by listing agents and entering each agent's canonical main chat (`agent:{agentId}:geeclaw_main`) directly, while each chat page includes a left-side session panel for that agent's main session and temporary chats, with temporary chats created inline from the panel. GeeClaw still keeps desktop-managed chat entries separate from the raw Gateway session registry and offers an additional read-only view for browsing all Gateway sessions and transcripts. Multi-agent setups are supported, and you can route the next message directly into another agent's main session with `@agent-id` from the main composer. The composer model switcher is now built from each provider's configured model catalog, while the agent primary model and fallback chain are managed separately in Settings. Codex-style `/` skill search with keyboard navigation, filtering, and inline skill tokens for enabled skills is also supported.

### ✅ Global Approval Prompts
When OpenClaw asks for exec or plugin approval, GeeClaw now shows a blocking in-app approval dialog above every page, including startup and settings overlays. Decisions are sent back through the existing Gateway RPC channel, and the dialog stays visible until Gateway emits the corresponding resolved event or the request expires.

### 🧠 Official Agent Marketplace
Browse a curated set of official agents from the Plaza and install them on demand from packaged downloads instead of shipping every agent inside the desktop bundle. The current catalog is still bundled with the app, but each install/update fetches the agent package separately and applies only the managed `files` and `skills` content for that agent.
Updating an installed marketplace agent now overwrites only its managed content after confirmation. GeeClaw does not reinitialize the workspace and does not touch existing chat history. After every successful install or update, GeeClaw shows a completion dialog and can prefill a plain-text follow-up message in the chat composer when the package provides one.

### 📡 Multi-Channel Management
Configure and monitor multiple AI channels from the dedicated Channels workspace in the sidebar. Each channel can now host multiple accounts, and every account can be routed to a different agent with an explicit default account per channel type. The desktop app includes bundled plugin support for DingTalk, WeCom, Weixin, QQ Bot, and the official Feishu/Lark OpenClaw plugin.
Custom channel account IDs now enforce a canonical OpenClaw-compatible format: lowercase letters, numbers, hyphens, and underscores only, starting with a letter or number, up to 64 characters.

### ⏰ Cron-Based Automation
Schedule AI tasks to run automatically. Define triggers, set intervals, and let your AI agents work around the clock without manual intervention.
The Cron task form now supports choosing an external delivery channel, selecting the sending account for multi-account channels, and reusing known session targets as suggestions.
It also offers three schedule editor modes: `Every`, `Fixed Time`, and `Cron`, with weekly schedules shown using weekday names in the task list for easier scanning.

### 🧩 Extensible Skill System
Extend your AI agents with pre-built skills. Browse, install, and manage skills through the integrated skill panel—no package managers required.
On fresh installs, the marketplace can now detect whether the China-optimized `skillhub` CLI is available and offer a one-click guided install that uses GeeClaw's bundled `uv` + managed Python runtime. If `skillhub` is unavailable, GeeClaw automatically falls back to the bundled `clawhub` installer.
Packaged preinstalled skills are now loaded directly from the app bundle via `skills.load.extraDirs`, so app updates can refresh those skills without copying managed duplicates into `~/.openclaw-geeclaw/skills`.

Environment variables for bundled search skills:
- `BRAVE_SEARCH_API_KEY` for `brave-web-search`
- `TAVILY_API_KEY` for `tavily-search` (OAuth may also be supported by upstream skill runtime)
- `BOCHA_API_KEY` for `bocha-skill`

Global runtime environment variables can now be managed directly in **Settings → Environment**. GeeClaw injects them into its managed Gateway and Agent runtimes, uses them when checking preset install requirements such as `requires.env`, and restarts the Gateway automatically after you save changes.

### 🔐 Secure Provider Integration
Connect to multiple AI providers (OpenAI, Anthropic and more) with credentials stored securely in your system's native keychain. OpenAI supports both API key and browser OAuth (Codex subscription) sign-in.

### 🌙 Adaptive Theming
Light mode, dark mode, or system-synchronized themes. GeeClaw adapts to your preferences automatically.

### 📦 Bundled OpenClaw Runtime
GeeClaw always launches its bundled OpenClaw runtime and keeps managed runtime state under `~/.openclaw-geeclaw`.
The packaged runtime currently excludes the upstream Tlon skill binaries so macOS signing and notarization remain stable.

---

## Getting Started

### System Requirements

- **Operating System**: macOS 11+, Windows 10+, or Linux (Ubuntu 20.04+)
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 1GB available disk space

### GPU Acceleration

GeeClaw now enables Electron GPU acceleration by default so animated brand surfaces and other accelerated rendering paths work without extra flags.

If you hit driver-specific rendering issues on a particular machine, launch the app with `--disable-gpu` to force software rendering again.

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

Open **Settings → OpenCLI** to:

- verify whether `opencli` is installed on your system PATH
- inspect the detected OpenCLI version, daemon status, and Chrome Browser Bridge connectivity
- let GeeClaw warm up `opencli doctor --no-live` in the background after Gateway startup so the daemon is ready before you open the page
- jump to **Settings → CLI Market** when `opencli` is missing
- download the Chrome extension package or jump to the upstream install guide when Chrome is not connected

### MCP Runtime Check

Open **Settings → MCP** to review whether `mcporter` is installed on your system PATH. If GeeClaw cannot find it, the page sends you to **Settings → CLI Market** for one-click installation and still offers the upstream project links as secondary references.

### Environment Variables

Open **Settings → Environment** to manage app-level environment variables for GeeClaw's managed runtime.

- These values are merged into the managed Gateway process and inherited by managed Agent runs.
- Preset install checks now read both the app-managed variables and the current process environment for `requires.env`.
- Saving changes restarts the Gateway automatically so the updated environment takes effect immediately.

### Web Search Providers

Open **Settings → Web Search** to manage OpenClaw `web_search` providers without editing `openclaw.json` by hand.

- Shared tool settings such as enablement, provider selection, max results, timeout, and cache TTL are written under the canonical `tools.web.search` keys.
- Provider-specific credentials and advanced fields are saved under `plugins.entries.<pluginId>.config.webSearch.*`, so GeeClaw no longer needs to rely on deprecated legacy paths.
- The settings panel renders provider-specific fields dynamically from GeeClaw's normalized provider registry, and selecting Firecrawl also enables the bundled Firecrawl plugin entry automatically.

### CLI Market

Open **Settings → CLI Market** to review a curated set of npm-based CLIs that GeeClaw knows how to detect, install, reinstall, and uninstall.

- GeeClaw first checks whether the command already exists on your system and marks it as installed if found.
- If the command is missing, GeeClaw installs it with the bundled Node/npm runtime into a GeeClaw-managed user-level prefix instead of requiring a system-wide `npm install -g`.
- On the first managed install, GeeClaw also adds that managed directory to your user PATH so newly opened terminals can use the command directly.
- The current UI intentionally keeps the status simple: it shows only `Installed` / `Not installed`. Missing CLIs show an `Install` button; installed CLIs move `Reinstall` and `Uninstall` into a compact actions menu.
- GeeClaw does not compare versions in this view yet. Reinstall always uses the latest package version available from npm at the time you click it.
- Some catalog entries can also declare follow-up Skills. GeeClaw automatically runs `npx skills add ... -y -g` after install and `npx skills remove ... -y -g` during uninstall.
- Install and uninstall open a live log dialog so you can watch the full bundled `npm` and `npx skills` output in one place.

Managed install locations:

- macOS / Linux: `~/.geeclaw/npm-global`
- Windows: `%APPDATA%\\GeeClaw\\npm-global`

---

## Architecture

GeeClaw employs a **dual-process architecture** with a unified host API layer. The renderer talks to a single client abstraction, while Electron Main owns protocol selection and process lifecycle.

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
pnpm run test:e2e         # Run macOS-only Electron smoke E2E
pnpm run test:e2e:headed  # Run the same Electron smoke E2E with a visible window
pnpm run verify           # Lint + typecheck + unit tests

# Build & Package
pnpm run build:vite       # Build frontend only
pnpm run openclaw-runtime:prepare  # Ensure the repo-local runtime exists for local development
pnpm run openclaw-runtime:install  # Refresh the repo-local OpenClaw runtime used by development and non-sidecar packaging
pnpm run bundle:openclaw-plugins  # Refresh bundled OpenClaw plugin mirrors
pnpm run openclaw-sidecar:build -- --target darwin-arm64 --version 2026.4.10-r1  # Build a standalone OpenClaw sidecar artifact
pnpm run openclaw-sidecar:download -- --target darwin-x64  # Download the pinned sidecar into build/prebuilt-sidecar/
pnpm build                # Full production build (with packaging assets)
pnpm package              # Package for current platform
pnpm package:mac          # Package for macOS
pnpm package:mac:dir:quick # Fast local macOS dir packaging; reuses existing build/openclaw*, plugins, and skills assets
pnpm package:win          # Package for Windows
pnpm package:linux        # Package for Linux
```

### Electron E2E Smoke Test

GeeClaw now includes a Playwright-driven Electron smoke test for the desktop shell on macOS.

- `pnpm run test:e2e` builds the app and launches the real Electron main process from `dist-electron/main/index.js`.
- The test uses isolated temporary `HOME` and Electron `userData` directories so it does not touch your normal GeeClaw profile.
- In E2E mode, GeeClaw skips setup/login/provider gating only. It still starts the real managed OpenClaw/Gateway stack before entering the main UI.
- The current smoke coverage verifies that the app can boot into the main shell and navigate between Dashboard, Skills, and Channels.

### Release Notes For Auto-Update

Before packaging a release, update [`resources/release-notes.md`](resources/release-notes.md). `electron-builder` embeds that Markdown into the auto-update metadata, and GeeClaw shows it in the startup update dialog when a newer version is available.

Packaging now uses the repo-local `openclaw-runtime/` install as the single source of truth for development and for any local packaging flow that does not explicitly opt into a prebuilt sidecar. This keeps OpenClaw's own install-time scripts intact and removes dependence on a duplicate root-level `node_modules/openclaw`.

In packaged builds, GeeClaw no longer leaves the full OpenClaw runtime directly under `Contents/Resources/openclaw`. `after-pack` now archives that prepared runtime into `Contents/Resources/runtime/openclaw/payload.tar.gz`, removes the raw bundle before code signing, and the app hydrates it into the per-user runtime directory on first launch. This keeps the shipped runtime complete while avoiding macOS signing issues caused by deep-scanning OpenClaw's internal symlinks and binaries.

For release CI, GeeClaw now requires a prebuilt OpenClaw sidecar from GitHub Releases instead of rebuilding the same runtime on every app release job. The exact pinned artifact lives in [`runtime-artifacts/openclaw-sidecar/version.json`](runtime-artifacts/openclaw-sidecar/version.json). The supported release targets are currently `darwin-arm64`, `darwin-x64`, and `win32-x64`; Windows on Arm uses the x64 GeeClaw package and follows the same x64 auto-update channel. If that tracked pin file is disabled, missing, or missing the current target asset, the release workflow fails fast instead of falling back to a local runtime rebuild.

### OpenClaw Runtime Workflow

For local development, initialize and refresh the runtime like this:

```bash
pnpm install
pnpm run openclaw-runtime:prepare
pnpm dev
```

- `pnpm dev` and `openclaw-runtime:prepare` use the repo-local `openclaw-runtime/` install. They do not download a sidecar by default.
- Use `pnpm run openclaw-runtime:install` when you change `openclaw-runtime/package.json`, need a clean reinstall, or want to refresh the local runtime explicitly.
- Treat sidecars as release artifacts, not as the default development input.

To update the pinned sidecar version used by release CI:

```bash
gh release download openclaw-sidecar-v2026.4.10-r1 \
  --pattern openclaw-sidecar-version.json \
  --dir /tmp/openclaw-sidecar-v2026.4.10-r1
cp /tmp/openclaw-sidecar-v2026.4.10-r1/openclaw-sidecar-version.json \
  runtime-artifacts/openclaw-sidecar/version.json
```

- Replace the tag with the exact sidecar release tag you want to pin.
- Commit the updated [`runtime-artifacts/openclaw-sidecar/version.json`](runtime-artifacts/openclaw-sidecar/version.json) alongside the release change that should consume it.

To verify a sidecar release artifact locally before running the full release workflow:

```bash
pnpm run openclaw-sidecar:download -- --target darwin-arm64
pnpm run package:release:resources
pnpm exec electron-builder --mac --arm64 --dir --config.mac.identity=null
```

- Swap `darwin-arm64` for `darwin-x64` or `win32-x64` when validating another target.
- The `package:release:*` flows expect the prebuilt sidecar under `build/prebuilt-sidecar/<target>/`.
- In the packaged app, confirm `Contents/Resources/runtime/openclaw/payload.tar.gz` exists and that the log shows `Using prebuilt OpenClaw sidecar`.

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
