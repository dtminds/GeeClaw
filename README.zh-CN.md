
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="GeeClaw Logo" />
</p>

<h1 align="center">GeeClaw</h1>

<p align="center">
  <strong>OpenClaw AI 智能体的桌面客户端</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#为什么选择-GeeClaw">为什么选择 GeeClaw</a> •
  <a href="#快速上手">快速上手</a> •
  <a href="#系统架构">系统架构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/github/downloads/dtminds/GeeClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-GPL%20v3-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

---

## 概述

**GeeClaw** 是连接强大 AI 智能体与普通用户之间的桥梁。基于 [OpenClaw](https://github.com/OpenClaw) 构建，它将命令行式的 AI 编排转变为易用、美观的桌面体验——无需使用终端。

无论是自动化工作流、连接通讯软件，还是调度智能定时任务，GeeClaw 都能提供高效易用的图形界面，帮助你充分发挥 AI 智能体的能力。

---

## 为什么选择 GeeClaw

构建 AI 智能体不应该需要精通命令行。GeeClaw 的设计理念很简单：**强大的技术值得拥有一个尊重用户时间的界面。**

| 痛点 | GeeClaw 解决方案 |
|------|----------------|
| 复杂的命令行配置 | 一键安装，配合更简洁的启动流程 |
| 手动编辑配置文件 | 可视化设置界面，实时校验 |
| 进程管理繁琐 | 自动管理网关生命周期 |
| 多 AI 供应商切换 | 每个模型都有其擅长的一面，你可以自由切换 |
| 技能/插件安装复杂 | 内置技能市场与管理界面 |

### 内置 OpenClaw 核心

GeeClaw 直接基于官方 **OpenClaw** 核心构建。无需单独安装，我们将运行时嵌入应用内部，提供开箱即用的无缝体验。
GeeClaw 始终运行应用内置的 OpenClaw，如果你的系统里已经安装了原生的 `openclaw` 或者别的claw类产品，GeeClaw 不会接管或改写它。

我们致力于与上游 OpenClaw 项目保持严格同步，确保你始终可以使用官方发布的最新功能、稳定性改进和生态兼容性。

---

## 功能特性

### 🎯 零配置门槛
从安装到第一次 AI 对话，全程通过直观的图形界面完成。无需终端命令，无需 YAML 文件，无需到处寻找环境变量。

### 💬 智能聊天界面
通过现代化的聊天体验与 AI 智能体交互。与此同时，也支持类似 Codex 的 `/` 技能搜索，可持续筛选、键盘导航，并以内嵌 skill token 的形式把已选中的启用技能直接插入到句子里。这意味着，你无需开启一堆skills来干扰上下文（实验证明，启用超过20个技能，Agent的回答质量会明显下降），而是通过指定技能来执行专业任务。
当 Hermes 进化流程面向桌面端发出 `evolution_proposal` 工具调用时，对话区会直接渲染可 review 的原生提案卡片，支持 tab 切换和一键确认进化。
每个 Agent 还会在 **Agent 设置 → 通用** 中提供一个 **主动进化** 开关。GeeClaw 会把这个偏好持久化到本地 agent store，同时同步该 Agent 自身的 `tools.deny`，并且只在该 Agent 已经存在显式 `agents.list[].skills` 时才维护 `hermes-evolution`。

### ✅ 全局审批弹窗
当 OpenClaw 发起 exec 或 plugin 审批请求时，GeeClaw 现在会在应用任意页面之上显示阻塞式审批弹窗，包括启动页和设置层。

### 🧠 官方 Agent 广场
现在可以在广场里浏览官方精选 Agent，并按需下载安装，而不是把所有 Agent 都直接打进桌面安装包。

### 📡 多频道管理
已内置飞书、钉钉、企业微信、微信、QQ Bot 等主流IM的官方 OpenClaw 插件的打包与安装支持，一键开启，企微和微信更支持一键扫码秒级完成配置。支持每个 IM 账号都可以单独路由到不同 Agent，部署一个GeeClaw，即可拥有多个在线的IM Agent。

### ⏰ 定时任务自动化
调度 AI 任务自动执行。定义触发器、设置时间间隔，让 AI 智能体 7×24 小时不间断工作。现在定时任务表单支持选择外部投递通道，并且在多账号通道下显式选择发送账号，确保消息送达。并提供了任务运行历史记录方便查看运行状态。

### 🧩 可扩展技能系统
通过预构建的技能扩展 AI 智能体的能力。在集成的技能面板中浏览和安装技能，并按 Agent 维度管理启用状态、发现结果与筛选——无需包管理器。
技能市场现在会检测是否已具备国内优化的 `skillhub` CLI，并提供一键引导安装；若 `skillhub` 不可用，GeeClaw 会自动回退到内置的 `clawhub` 安装器。

### ⚙️ 环境变量管理
现在也可以直接在 **设置 → 环境变量** 中管理 GeeClaw 自己托管运行时使用的全局环境变量。GeeClaw 会把这批变量注入到托管的 Gateway / Agent 运行时中，并在检查 preset 的 `requires.env` 时一并考虑；保存后会自动重启 Gateway 使其立即生效。

### 🌙 自适应主题
支持浅色模式、深色模式或跟随系统主题。GeeClaw 自动适应你的偏好设置。

### 📦 内置 OpenClaw Runtime
GeeClaw 固定使用内置 OpenClaw Runtime，避免依赖系统 PATH 或覆盖已有的系统 OpenClaw 安装。

---

## 快速上手

### 系统要求

- **操作系统**：macOS 11+、Windows 10+
- **内存**：最低 4GB RAM（推荐 8GB）
- **存储空间**：2GB 可用磁盘空间

### GPU 加速

GeeClaw 现在默认启用 Electron 的 GPU 加速，如果某台机器上出现驱动相关的渲染问题，可以在启动时追加 `--disable-gpu`，回退到软件渲染。

### 安装方式

#### 预构建版本（推荐）

从 [Releases](https://github.com/dtminds/GeeClaw/releases) 页面下载适用于你平台的最新版本。

#### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/dtminds/GeeClaw.git
cd GeeClaw

# 初始化项目
pnpm run init

# 以开发模式启动
pnpm dev
```

如果你想在开发模式下验证线上智能体广场 catalog，可以这样启动：

```bash
GEECLAW_AGENT_MARKETPLACE_CATALOG_URL=https://www.geeclaw.cn/res/agent-marketplace-catalog-v2.json pnpm dev
```

### 首次启动

首次启动 GeeClaw 时，应用会先用更简洁的启动流程完成这些事：

1. **检查登录状态** – 先确认是否已登录
2. **准备运行环境** – 自动准备内置 OpenClaw 运行环境
3. **安装默认工具/技能** – 完成默认本地工具链准备
4. **进入主界面** – 准备完成后直接进入应用

模型相关配置现在统一放到主界面内完成：

- 打开 **设置 → 模型服务商** 添加 provider 账号及其可用模型目录。
- 打开 **设置 → 模型配置** 选择默认聊天模型，以及图像理解 / PDF / 生图 / 生视频等模型槽位。
- 如果当前还没有任何可用模型，聊天输入框会保持禁用，并直接引导你去 **模型服务商**。
- 如果已经有可用模型，但还没有设置默认聊天模型，聊天输入框会改为引导你去 **模型配置**。

> Moonshot（Kimi）说明：GeeClaw 默认保持开启 Kimi 的 web search。  
> 当配置 Moonshot 后，GeeClaw 也会将 OpenClaw 配置中的 Kimi web search 同步到中国区端点（`https://api.moonshot.cn/v1`）。

GeeClaw 会自行管理 OpenClaw 运行时和状态目录。首次启动时，在完成登录态检查后，会先改写 `~/.openclaw-geeclaw/openclaw.json`，安全配置都会持久化到应用 store，并在启动时重新校验回写到 `openclaw.json`。
你也可以在 **设置 → 高级** 里直接复制终端命令，或安装一个用户级的 `geeclaw` 命令，以托管的 `geeclaw` profile 运行应用内置 OpenClaw，而不需要把 `openclaw` 注册到全局 PATH。

### 代理设置

GeeClaw 内置了代理设置，适用于需要通过本地代理客户端访问外网的场景，包括 Electron 本身、OpenClaw Gateway，以及 Telegram 这类频道的联网请求。

打开 **设置 → 网关 → 代理**，配置以下内容：

- **代理服务器**：所有请求默认使用的代理
- **绕过规则**：需要直连的主机，使用分号、逗号或换行分隔
- 在 **开发者模式** 下，还可以单独覆盖：
  - **HTTP 代理**
  - **HTTPS 代理**
  - **ALL_PROXY / SOCKS**

本地代理的常见填写示例：

```text
代理服务器: http://127.0.0.1:7890
```
说明：

- 只填写 `host:port` 时，会按 HTTP 代理处理。
- 高级代理项留空时，会自动回退到“代理服务器”。
- 保存代理设置后，Electron 网络层会立即重新应用代理，并自动重启 Gateway。
- 如果启用了 Telegram，GeeClaw 还会把代理同步到 OpenClaw 的 Telegram 频道配置中。
- 在 Windows 打包版本中，内置的 `openclaw` CLI/TUI 会通过随包分发的 `node.exe` 入口运行，以保证终端输入行为稳定。
- GeeClaw 提供的 `openclaw` wrapper 还会固定 `OPENCLAW_STATE_DIR=~/.openclaw-geeclaw`、`OPENCLAW_CONFIG_PATH=~/.openclaw-geeclaw/openclaw.json`，并在未显式传入时自动补上 `--profile geeclaw`，确保终端里的行为与应用内托管运行时一致。
- 在 Windows 打包版本中，卸载 GeeClaw 时可以按提示移除 `%LOCALAPPDATA%\\geeclaw`、`%APPDATA%\\geeclaw` 和 `~/.geeclaw`，但会保留 `~/.openclaw-geeclaw`，因此托管的 OpenClaw 状态会在重装后继续保留，除非你手动删除它。
- 在打包版本里，这些 wrapper 会优先使用应用用户数据目录下已经解压好的 OpenClaw sidecar；如果 sidecar 还没 materialize，才会回退到旧的 `resources/openclaw` 布局。

### OpenCLI Browser Bridge 检查

打开 **设置 → OpenCLI** 可以：

- 检查系统 PATH 中是否已经有 `opencli`
- 查看检测到的 OpenCLI 版本、后台服务状态，以及 Chrome Browser Bridge 插件连通状态
- 在 Gateway 启动后由 GeeClaw 后台预热一次 `opencli doctor --no-live`，让 daemon 在进入设置页前就先拉起
- 如果还没安装 `opencli`，直接跳到 **设置 → CLI 市场**
- 在 Chrome 未连通时，直接下载 Chrome 插件包或跳转到上游安装说明

### MCP Runtime 检查

打开 **设置 → MCP** 可以查看系统 PATH 中是否已经有 `mcporter`。如果 GeeClaw 还没有检测到它，页面会优先引导你前往 **设置 → CLI 市场** 一键安装，同时保留上游项目链接作为辅助信息。

### 环境变量

打开 **设置 → 环境变量** 可以管理 GeeClaw 托管运行时使用的应用级环境变量。

- 这些值会注入到托管 Gateway，并由托管 Agent 运行时继承。
- preset 安装前的 `requires.env` 检查会同时读取这批应用级变量与当前进程环境。
- 保存后会自动重启 Gateway，让变更立即生效。

### Memory 设置

打开 **设置 → Memory**，可以用更易懂的方式管理一小部分 OpenClaw 记忆能力，而不需要手动修改 `openclaw.json`。

- 当前页面只暴露 **Dreaming**、**Active Memory**、**Lossless Claw** 三张卡片。
- Dreaming 会写入 `plugins.entries["memory-core"].config.dreaming.enabled`。
- GeeClaw 启动时会默认开启 Dreaming；如果 `openclaw.json` 没有显式启用 Active Memory，则会把它初始化为关闭。
- Active Memory 会写入 `plugins.entries["active-memory"].config.enabled`、可选的 `config.model`，并在启用时补齐 `config.agents = ["main"]`。
- Lossless Claw 会写入 `plugins.entries["lossless-claw"].config.summaryModel`，并在插件已安装时把 `plugins.slots.contextEngine` 在 `lossless-claw` 与 `legacy` 之间切换。
- 在启动 Gateway 之前，GeeClaw 会先检查 `~/.openclaw-geeclaw/extensions/lossless-claw/package.json`；只有当 `lossless-claw` 缺失或版本与 pin 不一致时，才会重新安装或升级。
- 如果 `lossless-claw` 在启动阶段安装失败，GeeClaw 会阻止 Gateway 启动，清理 `extensions/lossless-claw` 目录以避免残留半安装状态，并在下次启动时再次重试。
- 保存 Memory 设置后，GeeClaw 会对托管 Gateway 做一次 debounce 热重载，让配置立即生效。

### 联网搜索提供商

打开 **设置 → 联网搜索**，可以直接管理 OpenClaw 的 `web_search` 提供商，而不需要手动编辑 `openclaw.json`。

- 启用状态、提供商选择、最大结果数、超时和缓存 TTL 等共享设置会写入 canonical 的 `tools.web.search`。
- 各提供商的 API Key 和高级字段会保存到 `plugins.entries.<pluginId>.config.webSearch.*`，不再依赖旧的 legacy path。
- 设置面板会根据 GeeClaw 归一化后的 provider registry 动态渲染提供商专属字段；当你选择 Firecrawl 时，也会自动启用内置的 Firecrawl plugin entry。

### CLI 市场

打开 **设置 → CLI 市场** 可以查看一组 GeeClaw 会检测、并可辅助安装的精选 CLI。

- GeeClaw 仍然是通过检查目标命令是否已经存在于系统中，来判断这个 CLI 是否已安装。
- 某些条目是 GeeClaw 托管的 npm 安装。命令缺失时，GeeClaw 会使用应用内置的 Node/npm，把它安装到 GeeClaw 自己管理的用户级前缀目录，而不是要求你执行系统级 `npm install -g`。
- 第一次通过 GeeClaw 托管安装时，GeeClaw 还会把这个托管目录自动加入用户 PATH，这样新开的终端也可以直接使用这些命令。
- 其他条目也可以提供 `brew`、`curl` 之类的手动安装命令。GeeClaw 只会在系统里已经存在对应安装器命令时，才展示这些手动安装命令。
- 对于系统中已经安装好的 CLI，这个页面只会把它们视为“已检测到”的命令，不会尝试替你卸载。
- 这个页面暂时不会比较版本；每次点击重新安装时，都会按当时 npm 上可获取到的最新包版本重新安装。
- 托管 npm 条目现在还可以声明结构化的后安装动作。GeeClaw 可以自动安装相关 skills，或者对刚装好的 CLI 执行受控的后续命令，例如把技能安装到 `~/.openclaw-geeclaw/skills`，而不需要在 catalog 里写任意 shell script。
- 托管安装成功后，GeeClaw 会给出下一步提示，例如打开文档继续安装浏览器扩展或 bridge，或者跳到技能页手动开启刚安装好的 skills。
- 托管安装和卸载都会打开日志弹窗，把 `npm`、`npx skills` 以及托管后安装动作的输出放在一起展示。

托管安装目录：

- macOS / Linux：`~/.geeclaw/npm-global`
- Windows：`%APPDATA%\\GeeClaw\\npm-global`

---

## 系统架构

GeeClaw 采用 **双进程 + Host API 统一接入架构**。渲染进程只调用统一客户端抽象，协议选择与进程生命周期由 Electron 主进程统一管理。

### 设计原则

- **进程隔离**：AI 运行时在独立进程中运行，确保即使在高负载计算期间 UI 也能保持响应
- **前端调用单一入口**：渲染层统一走 host-api/api-client，不感知底层协议细节
- **主进程掌控传输策略**：WS/HTTP 选择与 IPC 回退在主进程集中处理，提升稳定性
- **审批通道单一化**：OpenClaw 的审批请求与 resolved 事件统一复用 Gateway 通知流，审批决策统一通过 `gateway:rpc` 回传，不额外新增第二套审批桥接链路
- **优雅恢复**：内置重连、超时、退避逻辑，自动处理瞬时故障
- **安全存储**：API 密钥和敏感数据利用操作系统原生的安全存储机制
- **CORS 安全**：本地 HTTP 请求由主进程代理，避免渲染进程跨域问题

### 进程模型与 Gateway 排障

- GeeClaw 基于 Electron，**单个应用实例出现多个系统进程是正常现象**（main/renderer/zygote/utility）。
- 单实例保护同时使用 Electron 自带锁与本地进程文件锁回退机制，可在桌面 IPC 或会话总线异常时避免重复启动。
- 滚动升级期间若新旧版本混跑，单实例保护仍可能出现不对称行为。为保证稳定性，建议桌面客户端尽量统一升级到同一版本。
- 但 OpenClaw Gateway 监听应始终保持**单实例**：`127.0.0.1:28788` 只能有一个监听者。
- 可用以下命令确认监听进程：
  - macOS/Linux：`lsof -nP -iTCP:28788 -sTCP:LISTEN`
  - Windows（PowerShell）：`Get-NetTCPConnection -LocalPort 28788 -State Listen`
- 点击窗口关闭按钮（`X`）默认只是最小化到托盘，并不会完全退出应用。请在托盘菜单中选择 **Quit GeeClaw** 执行完整退出。

---

## 使用场景

### 🤖 个人 AI 助手
配置一个通用 AI 智能体，可以回答问题、撰写邮件、总结文档并协助处理日常任务——全部通过简洁的桌面界面完成。

### 📊 自动化监控
设置定时智能体来监控新闻动态、追踪价格变动或监听特定事件。结果将推送到你偏好的通知渠道。

### 💻 开发者效率工具
将 AI 融入你的开发工作流。使用智能体进行代码审查、生成文档或自动化重复性编码任务。

### 🔄 工作流自动化
将多个技能串联起来，创建复杂的自动化流水线。处理数据、转换内容、触发操作——全部通过可视化方式编排。

---

## 开发指南

### 前置要求

- **Node.js**：22+（推荐 LTS 版本）
- **包管理器**：pnpm 9+（推荐）或 npm

### 项目结构

```GeeClaw/
├── electron/                 # Electron 主进程
│   ├── api/                 # 主进程 API 路由与处理器
│   │   └── routes/          # RPC/HTTP 代理路由模块
│   ├── services/            # Provider、Secrets 与运行时服务
│   │   ├── providers/       # Provider/account 模型同步逻辑
│   │   └── secrets/         # 系统钥匙串与密钥存储
│   ├── shared/              # 共享 Provider schema/常量
│   │   └── providers/
│   ├── main/                # 应用入口、窗口、IPC 注册
│   ├── gateway/             # OpenClaw 网关进程管理
│   ├── preload/             # 安全 IPC 桥接
│   └── utils/               # 工具模块（存储、认证、路径）
├── src/                      # React 渲染进程
│   ├── lib/                 # 前端统一 API 与错误模型
│   ├── stores/              # Zustand 状态仓库（settings/chat/gateway）
│   ├── components/          # 可复用 UI 组件，包含设置工作区分区
│   ├── pages/               # Setup/Dashboard/Chat/Skills/Cron/Settings 弹窗外壳
│   ├── i18n/                # 国际化资源
│   └── types/               # TypeScript 类型定义
├── tests/
│   ├── e2e/                 # Playwright Electron smoke 测试
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```
### 常用命令

```bash
# 开发
pnpm run init             # 安装依赖并下载 uv 与内置 Node/npm
pnpm dev                  # 以热重载模式启动（优先使用仓库内 openclaw-runtime）

# 代码质量
pnpm lint                 # 运行 ESLint 检查
pnpm run lint:check       # 运行不修改文件的 ESLint 检查
pnpm typecheck            # TypeScript 类型检查

# 测试
pnpm test                 # 运行单元测试
pnpm run test:e2e         # 运行仅限 macOS 的 Electron smoke E2E
pnpm run test:e2e:headed  # 用可见窗口运行同一组 Electron smoke E2E
pnpm run verify           # 运行 lint + typecheck + 单元测试

# 构建与打包
pnpm run build:vite       # 仅构建前端
pnpm run openclaw-runtime:prepare  # 确保本地开发所需的仓库内 runtime 已就绪
pnpm run openclaw-runtime:install  # 刷新开发态和非 sidecar 打包使用的仓库内 OpenClaw runtime
pnpm run bundle:openclaw-plugins  # 重新生成内置 OpenClaw plugin 镜像
pnpm run openclaw-sidecar:build -- --target darwin-arm64 --version 2026.4.10-r1  # 构建独立的 OpenClaw sidecar 产物
pnpm run openclaw-sidecar:download -- --target darwin-x64  # 下载已 pin 的 sidecar archive 到 build/prebuilt-sidecar/
pnpm package:dev          # 为非 sidecar 的本地开发打包准备资源
pnpm package:mac:dir      # 基于仓库内 runtime 构建本地 macOS 目录包
pnpm package:mac:dir:quick # 本地快速验证 macOS 目录包；复用已有 build/openclaw*、plugin、skill 资源
```

### Electron E2E Smoke 测试

GeeClaw 现在提供了基于 Playwright 的 macOS Electron 冒烟测试，用来覆盖桌面主壳启动链路。

- `pnpm run test:e2e` 会先构建应用，再从 `dist-electron/main/index.js` 启动真实的 Electron 主进程。
- 在 Electron 启动前，E2E 流程会先把当前平台已 pin 的 OpenClaw sidecar archive 下载到 `build/prebuilt-sidecar/`，再解压还原到 `build/prebuilt-sidecar-runtime/`，并带着 `GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR=1` 启动。
- 测试会使用独立的临时 `HOME` 和 Electron `userData` 目录，不会污染你平时使用的 GeeClaw 配置。
- E2E 模式只会跳过 setup / 登录 / provider 这几道前置门槛；进入主界面前仍然要求真实的托管 OpenClaw/Gateway 成功启动。
- 当前 smoke 覆盖会验证应用能够进入主界面，并在 Dashboard、Skills、Channels 之间完成基础导航。

### 自动更新发布日志

准备打包发布前，请先更新 [`resources/release-notes.md`](resources/release-notes.md)。`electron-builder` 会把这份 Markdown 写入自动更新元数据，GeeClaw 检测到新版本时就能在启动弹窗里直接显示更新日志。

Release CI 在 OSS 上会把 channel 元数据和不可变版本产物分开发布。`latest/darwin-*` 或 `beta/darwin-*` 下只保留 `*-mac.yml`；这份元数据会被改写为指向 `releases/vX.Y.Z/release-mac-*` 下唯一的一份 zip，避免在 OSS 上为每个 channel 重复存放 macOS 自动更新 payload。

现在开发态和任何未显式启用 sidecar 的本地打包流程，都统一以仓库内的 `openclaw-runtime/` 独立安装结果作为唯一来源，不再依赖重复的根级 `node_modules/openclaw`。这样可以保留 OpenClaw 自己的安装期脚本，也能降低构建对包管理器布局细节的耦合。

正式打包时，GeeClaw 也不再把完整 OpenClaw runtime 直接保留在 `Contents/Resources/openclaw` 下。`after-pack` 会先把准备好的 runtime 归档到 `Contents/Resources/runtime/openclaw/payload.tar.gz`，再在签名前删除原始目录；应用首次启动时再把它解压到当前用户的数据目录中使用。这样既能保留完整运行时内容，也能避开 macOS 对 OpenClaw 内部符号链接和二进制做深度签名校验时触发的问题。

对于 release CI，GeeClaw 现在要求直接消费 GitHub Releases 上预先构建好的 OpenClaw sidecar，而不是在每个主包 release job 里重复打同一份 runtime。精确 pin 的产物定义放在 [`openclaw-runtime/version.json`](openclaw-runtime/version.json)。当前支持发布的 sidecar 目标是 `darwin-arm64`、`darwin-x64` 和 `win32-x64`；Windows on Arm 机器统一使用 GeeClaw 的 x64 安装包，并沿用同一条 x64 自动更新链路。如果这个追踪文件被禁用、缺失，或者没有当前目标对应的 sidecar 资产，release workflow 会直接失败，不再回退到现场重打 runtime。

### OpenClaw Runtime 工作流

本地开发时，推荐这样初始化和启动：

```bash
pnpm install
pnpm run openclaw-runtime:prepare
pnpm dev
```

- `pnpm dev` 和 `openclaw-runtime:prepare` 使用的是仓库内的 `openclaw-runtime/` 安装结果。当已安装 OpenClaw 版本或直接依赖集合与 `openclaw-runtime/package.json` 不一致时，`prepare` 会自动刷新；默认不会下载 sidecar。
- 设置 `GEECLAW_AGENT_MARKETPLACE_CATALOG_URL` 可以让开发模式优先从远程 URL 加载智能体广场 catalog，而不是读取 `site/res/agent-marketplace-catalog-v2.json`。
- 当你需要干净重装，或者想明确刷新本地 runtime 时，再执行 `pnpm run openclaw-runtime:install`。
- sidecar 应该被视为 release 产物，而不是默认的开发输入。

要更新 release CI 使用的 sidecar pin 版本，可以这样做：

```bash
gh release download openclaw-sidecar-v2026.4.10-r1 \
  --pattern openclaw-sidecar-version.json \
  --dir /tmp/openclaw-sidecar-v2026.4.10-r1
cp /tmp/openclaw-sidecar-v2026.4.10-r1/openclaw-sidecar-version.json \
  openclaw-runtime/version.json
```

- 把上面的 tag 换成你要 pin 的精确 sidecar release tag。
- 更新完 [`openclaw-runtime/version.json`](openclaw-runtime/version.json) 后，和消费它的 release 改动一起提交。

要在本地验证 sidecar release 产物是否可用于正式打包，可以执行：

```bash
pnpm run openclaw-sidecar:download -- --target darwin-arm64
pnpm run build:vite
pnpm run package:resources
GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR=1 pnpm exec electron-builder --config scripts/electron-builder-config.mjs --mac --arm64 --dir --config.mac.identity=null
```

- 验证其他目标时，把 `darwin-arm64` 换成 `darwin-x64` 或 `win32-x64`。
- `package:release:*` 流程默认从 `build/prebuilt-sidecar/<target>/` 读取预构建 sidecar archive。
- 打出来的包里要确认存在 `Contents/Resources/runtime/openclaw/payload.tar.gz`，并且日志里出现 `Using prebuilt OpenClaw sidecar`。

未发布到 npm 的 OpenClaw plugin 也可以直接放到
`plugins/openclaw/<plugin-id>/` 下参与打包，而不需要安装到应用顶层
`node_modules/`。目录里至少要有 `openclaw.plugin.json`；如果 plugin 有运行时
依赖，建议把依赖也放在该目录可解析的位置，通常就是它自己的
`node_modules/`。

### GitHub Pages 落地页

仓库现在还包含一套位于 [`site/`](site/) 下的静态营销落地页。

- 本地预览时可直接打开 [`site/index.html`](site/index.html)。
- 部署时可将仓库的 `site/` 目录直接作为 GitHub Pages 发布源。
- 页面使用相对本地资源路径，并通过配置注入外部图片和链接，因此同一份文件既能跑在 GitHub Pages 项目地址下，也能直接绑定到 `www.geeclaw.cn` 这类自定义域名。

### 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Electron 40+ |
| UI 框架 | React 19 + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand |
| 构建工具 | Vite + electron-builder |
| 测试 | Vitest + Playwright |
| 动画 | Framer Motion |
| 图标 | Lucide React |

---

## 参与贡献

欢迎社区贡献各种改进。关于本地开发、校验命令和项目边界约束，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

补充的维护与协作文档：

- [SUPPORT.md](SUPPORT.md)：问题分流与支持预期
- [SECURITY.md](SECURITY.md)：安全漏洞提交流程
- [docs/release-checklist.md](docs/release-checklist.md)：发布前检查清单

Pull Request 的基本预期：

- 遵循当前由 ESLint 和 TypeScript 约束的代码风格。
- 行为变更时补充或更新测试。
- 涉及用户流程或架构调整时，同时更新 `README.md` 和 `README.zh-CN.md`。
- 保持提交和 PR 聚焦、描述清晰。

---

## 致谢

GeeClaw 构建于以下优秀的开源项目之上：

- [OpenClaw](https://github.com/OpenClaw) – AI 智能体运行时
- [Electron](https://www.electronjs.org/) – 跨平台桌面框架
- [React](https://react.dev/) – UI 组件库
- [shadcn/ui](https://ui.shadcn.com/) – 精美设计的组件库
- [Zustand](https://github.com/pmndrs/zustand) – 轻量级状态管理
- [ClawX](https://github.com/ValueCell-ai/ClawX) – 基于OpenClaw构建的一款开源桌面APP

---

## 许可证

GeeClaw 基于 OpenClaw、ClawX 修改，并以 GPL v3 协议发布

---

<p align="center">
  <sub>由 dtminds 团队用 ❤️ 打造</sub>
</p>
