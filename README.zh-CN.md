
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
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/github/downloads/dtminds/GeeClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文
</p>

---

## 概述

**GeeClaw** 是连接强大 AI 智能体与普通用户之间的桥梁。基于 [OpenClaw](https://github.com/OpenClaw) 构建，它将命令行式的 AI 编排转变为易用、美观的桌面体验——无需使用终端。

无论是自动化工作流、连接通讯软件，还是调度智能定时任务，GeeClaw 都能提供高效易用的图形界面，帮助你充分发挥 AI 智能体的能力。

GeeClaw 预置了最佳实践的模型供应商配置，原生支持 Windows 平台以及多语言设置。应用在侧边栏中提供了独立的 **仪表盘** 工作区，集中展示网关/频道概览、快捷操作，以及用于发现常见 AI 任务玩法的灵感广场。灵感卡片现在支持打开详情弹窗，并一键跳转到默认 Agent 对话页且自动预填推荐 prompt，同时将通用设置、Models 与 Channels 统一收纳到 **设置** 弹窗工作区中；当然，你也可以继续通过 **设置 → OpenClaw → 高级 → 开发者模式** 来进行网关相关的精细高级配置。

---

## 为什么选择 GeeClaw

构建 AI 智能体不应该需要精通命令行。GeeClaw 的设计理念很简单：**强大的技术值得拥有一个尊重用户时间的界面。**

| 痛点 | GeeClaw 解决方案 |
|------|----------------|
| 复杂的命令行配置 | 一键安装，配合更简洁的启动流程 |
| 手动编辑配置文件 | 可视化设置界面，实时校验 |
| 进程管理繁琐 | 自动管理网关生命周期 |
| 多 AI 供应商切换 | 统一的供应商配置面板 |
| 技能/插件安装复杂 | 内置技能市场与管理界面 |

### 内置 OpenClaw 核心

GeeClaw 直接基于官方 **OpenClaw** 核心构建。无需单独安装，我们将运行时嵌入应用内部，提供开箱即用的无缝体验。
GeeClaw 始终运行应用内置的 OpenClaw，并将托管运行时状态保存在 `~/.openclaw-geeclaw`，同时使用专用的 `geeclaw` profile。如果你的系统里已经安装了 `openclaw`，GeeClaw 不会接管或改写它。

我们致力于与上游 OpenClaw 项目保持严格同步，确保你始终可以使用官方发布的最新功能、稳定性改进和生态兼容性。

---

## 功能特性

### 🎯 零配置门槛
从安装到第一次 AI 对话，全程通过直观的图形界面完成。无需终端命令，无需 YAML 文件，无需到处寻找环境变量。

### 💬 智能聊天界面
通过现代化的聊天体验与 AI 智能体交互。侧边栏现在遵循 OpenClaw 原生会话模型，展示 Agent 列表并直接进入各 Agent 的主会话（`agent:{agentId}:main`）；进入聊天页后，左侧还会显示当前 Agent 的会话面板，分开展示主会话与临时会话，并可直接在面板内新建临时会话。GeeClaw 仍会将桌面管理的聊天条目与原始 Gateway 会话注册表分离，并额外提供一个只读入口，用于浏览全部 Gateway 会话及其 transcript。现在也支持多 Agent，并且可以在主输入框中通过 `@agent-id` 将下一条消息直接路由到目标 Agent 的主会话。主输入框的模型切换菜单现在基于各个 provider 已配置的模型目录生成，而 Agent 的 primary 模型和 fallback 链路则在设置中独立维护。与此同时，也支持类似 Codex 的 `/` 技能搜索，可持续筛选、键盘导航，并以内嵌 skill token 的形式把已选中的启用技能直接插入到句子里。

### 📡 多频道管理
在侧边栏的独立频道工作区中统一配置和监控多个 AI 频道。现在单个 Channel 下可以配置多个账号，并且每个账号都可以单独路由到不同 Agent，同时保留可切换的默认账号。桌面端已内置钉钉、企业微信、QQ Bot，以及飞书/Lark 官方 OpenClaw 插件的打包与安装支持。
应用启动时，GeeClaw 会把这些内置频道插件以 `plugins.load.paths` 的形式写入 `openclaw.json`，直接从应用资源目录加载，不再依赖 `~/.openclaw-geeclaw/extensions` 里的镜像副本。
GeeClaw 也支持“启动时强制启用”的内置插件策略。当前受保护插件为 `lossless-claw`，启动时会自动补入 `plugins.allow`，并校正 `plugins.entries.lossless-claw` 与 `plugins.slots.contextEngine`，包括 `enabled: true`、指向 GeeClaw 托管 OpenClaw 配置目录的 `config.dbPath`（`<openclaw-config-dir>/lcm.db`）、`contextEngine: "lossless-claw"`，以及受保护的 session pattern 默认配置。
企业微信在频道配置弹窗中新增了“扫码一键绑定”：扫码后会自动回填并保存 `botId` 与 `secret`。

### ⏰ 定时任务自动化
调度 AI 任务自动执行。定义触发器、设置时间间隔，让 AI 智能体 7×24 小时不间断工作。
每个任务现在还提供独立的“运行记录”页面，顶部带返回与 breadcrumb，下方左侧展示执行历史，右侧展示只读消息记录，便于排查最近的定时任务运行，而不会把这些记录混入主智能体会话列表。

### 🧩 可扩展技能系统
通过预构建的技能扩展 AI 智能体的能力。在集成的技能面板中浏览、安装和管理技能——无需包管理器。
GeeClaw 还会内置预装完整的文档处理技能（`pdf`、`xlsx`、`docx`、`pptx`），在启动时自动部署到托管技能目录（默认 `~/.openclaw-geeclaw/skills`），并在首次安装时默认启用。额外预装技能（`find-skills`、`self-improving-agent`、`tavily-search`、`brave-web-search`、`bocha-skill`）也会默认启用；若缺少必需的 API Key，OpenClaw 会在运行时给出配置错误提示。
Skills 页面可展示来自多个 OpenClaw 来源的技能（托管目录、workspace、额外技能目录），并显示每个技能的实际路径，便于直接打开真实安装位置。
当启动阶段扫描到新的 skill key，且该 key 尚未出现在 `openclaw.json` 中时，GeeClaw 会把这个新发现技能写入 `skills.entries`，并默认设置为 `enabled: false`。同时，用户手动开关过的技能状态会额外持久化到应用 settings store，并在 Gateway 启动前回放回 `openclaw.json`，这样手动开启的技能能跨重启保留，而全新的 `.agents` 技能也不会被自动启用。
GeeClaw 还会在每次启动（冷启动/热启动）校验“强制启用技能列表”。当前受保护技能：`pdf`、`xlsx`、`docx`、`pptx`。这些技能会被自动修正为 `enabled: true`，并且在 Skills 页面不可禁用。

重点搜索技能所需环境变量：
- `BRAVE_SEARCH_API_KEY`：用于 `brave-web-search`
- `TAVILY_API_KEY`：用于 `tavily-search`（上游运行时也可能支持 OAuth）
- `BOCHA_API_KEY`：用于 `bocha-skill`
- `find-skills` 与 `self-improving-agent` 不需要 API Key

### 🔐 安全的供应商集成
连接多个 AI 供应商（OpenAI、Anthropic、GeekAI 等），凭证安全存储在系统原生密钥链中。Provider 设置只负责基础连接信息和模型目录，Agent 级别的 primary / fallback 模型会单独配置。

### 🌙 自适应主题
支持浅色模式、深色模式或跟随系统主题。GeeClaw 自动适应你的偏好设置。

### 📦 内置 OpenClaw Runtime
GeeClaw 固定使用内置 OpenClaw Runtime，避免依赖系统 PATH 或覆盖已有的系统 OpenClaw 安装。

---

## 快速上手

### 系统要求

- **操作系统**：macOS 11+、Windows 10+ 或 Linux（Ubuntu 20.04+）
- **内存**：最低 4GB RAM（推荐 8GB）
- **存储空间**：1GB 可用磁盘空间

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
### 首次启动

首次启动 GeeClaw 时，应用会先用更简洁的启动流程完成这些事：

1. **检查登录状态** – 先确认是否已登录
2. **准备运行环境** – 自动准备内置 OpenClaw 运行环境
3. **连接 AI 服务** – 如果还没有可用 provider，再引导你补充
4. **进入主界面** – 准备完成后直接进入应用

> Moonshot（Kimi）说明：GeeClaw 默认保持开启 Kimi 的 web search。  
> 当配置 Moonshot 后，GeeClaw 也会将 OpenClaw 配置中的 Kimi web search 同步到中国区端点（`https://api.moonshot.cn/v1`）。

GeeClaw 会自行管理 OpenClaw 运行时和状态目录。首次启动时，在完成登录态检查后，会先改写 `~/.openclaw-geeclaw/openclaw.json`，确保 `agents.defaults.workspace` 指向 `~/.openclaw-geeclaw/workspace`，然后执行 `openclaw.mjs --profile geeclaw setup` 初始化该 profile，随后再以 `openclaw.mjs --profile geeclaw gateway --port 28788` 启动网关。若你之前已有 `~/.openclaw` 旧数据或 `~/Library/LaunchAgents/ai.openclaw.gateway.plist`，GeeClaw 会保留它们，不会删除或改写系统级安装。

你可以在 **设置 → 安全** 中查看当前托管的 OpenClaw 状态目录；GeeClaw 会将 `openclaw.json -> tools.fs.workspaceOnly` 固定校验为 `false`，该页面负责控制 `tools` 下的 deny / exec / elevated 安全策略。这些安全配置都会持久化到应用 store，并在启动时重新校验回写到 `openclaw.json`。

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

---

## 系统架构

GeeClaw 采用 **双进程 + Host API 统一接入架构**。渲染进程只调用统一客户端抽象，协议选择与进程生命周期由 Electron 主进程统一管理：

```┌─────────────────────────────────────────────────────────────────┐
│                        GeeClaw 桌面应用                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron 主进程                                 │  │
│  │  • 窗口与应用生命周期管理                                      │  │
│  │  • 网关进程监控                                               │  │
│  │  • 系统集成（托盘、通知、密钥链）                                │  │
│  │  • 自动更新编排                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC（权威控制面）                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React 渲染进程                                   │  │
│  │  • 现代组件化 UI（React 19）                                   │  │
│  │  • Zustand 状态管理                                           │  │
│  │  • 统一 host-api/api-client 调用                               │  │
│  │  • Markdown 富文本渲染                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ 主进程统一传输策略
                               │（WS 优先，HTTP 次之，IPC 回退）
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Host API 与主进程代理层                          │
│                                                                  │
│  • hostapi:fetch（主进程代理，规避开发/生产 CORS）                │
│  • gateway:httpProxy（渲染进程不直连 Gateway HTTP）               │
│  • 统一错误映射与重试/退避策略                                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ WS / HTTP / IPC 回退
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw 网关                                 │
│                                                                  │
│  • AI 智能体运行时与编排                                          │
│  • 消息频道管理                                                   │
│  • 技能/插件执行环境                                              │
│  • 供应商抽象层                                                   │
└─────────────────────────────────────────────────────────────────┘
```
### 设计原则

- **进程隔离**：AI 运行时在独立进程中运行，确保即使在高负载计算期间 UI 也能保持响应
- **前端调用单一入口**：渲染层统一走 host-api/api-client，不感知底层协议细节
- **主进程掌控传输策略**：WS/HTTP 选择与 IPC 回退在主进程集中处理，提升稳定性
- **优雅恢复**：内置重连、超时、退避逻辑，自动处理瞬时故障
- **安全存储**：API 密钥和敏感数据利用操作系统原生的安全存储机制
- **CORS 安全**：本地 HTTP 请求由主进程代理，避免渲染进程跨域问题

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
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```
### 常用命令

```bash
# 开发
pnpm run init             # 安装依赖并下载 uv
pnpm dev                  # 以热重载模式启动

# 代码质量
pnpm lint                 # 运行 ESLint 检查
pnpm typecheck            # TypeScript 类型检查

# 测试
pnpm test                 # 运行单元测试

# 构建与打包
pnpm run build:vite       # 仅构建前端
pnpm run bundle:openclaw-plugins  # 重新生成内置 OpenClaw plugin 镜像
pnpm build                # 完整生产构建（含打包资源）
pnpm package              # 为当前平台打包
pnpm package:mac          # 为 macOS 打包
pnpm package:win          # 为 Windows 打包
pnpm package:linux        # 为 Linux 打包
```

未发布到 npm 的 OpenClaw plugin 也可以直接放到
`plugins/openclaw/<plugin-id>/` 下参与打包，而不需要安装到应用顶层
`node_modules/`。目录里至少要有 `openclaw.plugin.json`；如果 plugin 有运行时
依赖，建议把依赖也放在该目录可解析的位置，通常就是它自己的
`node_modules/`。

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

我们欢迎社区的各种贡献！无论是修复 Bug、开发新功能、改进文档还是翻译——每一份贡献都让 GeeClaw 变得更好。

### 如何贡献

1. **Fork** 本仓库
2. **创建** 功能分支（`git checkout -b feature/amazing-feature`）
3. **提交** 清晰描述的变更
4. **推送** 到你的分支
5. **创建** Pull Request

### 贡献规范

- 遵循现有代码风格（ESLint + Prettier）
- 为新功能编写测试
- 按需更新文档
- 保持提交原子化且描述清晰

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

GeeClaw 基于 [MIT 许可证](LICENSE) 发布。你可以自由地使用、修改和分发本软件。

---

<p align="center">
  <sub>由 dtminds 团队用 ❤️ 打造</sub>
</p>
