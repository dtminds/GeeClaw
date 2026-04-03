
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
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
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

### 🧠 官方 Agent 广场
现在可以在广场里浏览官方精选 Agent，并按需下载安装，而不是把所有 Agent 都直接打进桌面安装包。当前 catalog 仍随应用一起分发，但每次安装或升级都会单独拉取对应 Agent 的打包内容，只覆盖该 Agent 受管的 `files` 和 `skills`。
升级官方 Agent 时，GeeClaw 会先提示确认，再仅覆盖受管内容；不会重新初始化 workspace，也不会影响已有聊天记录。每次安装或升级成功后，都会弹出完成提示；如果包内提供了后续引导文案，GeeClaw 还会把这段纯文本预填到聊天输入框，方便你继续和 Agent 交互。

### 📡 多频道管理
在侧边栏的独立频道工作区中统一配置和监控多个 AI 频道。现在单个 Channel 下可以配置多个账号，并且每个账号都可以单独路由到不同 Agent，同时保留可切换的默认账号。桌面端已内置钉钉、企业微信、微信、QQ Bot，以及飞书/Lark 官方 OpenClaw 插件的打包与安装支持。

### ⏰ 定时任务自动化
调度 AI 任务自动执行。定义触发器、设置时间间隔，让 AI 智能体 7×24 小时不间断工作。

### 🧩 可扩展技能系统
通过预构建的技能扩展 AI 智能体的能力。在集成的技能面板中浏览、安装和管理技能——无需包管理器。
对于全新安装环境，技能市场现在会检测是否已具备国内优化的 `skillhub` CLI，并提供一键引导安装；安装过程复用 GeeClaw 自带的 `uv` 与托管 Python 运行时。若 `skillhub` 不可用，GeeClaw 会自动回退到内置的 `clawhub` 安装器。
打包进应用的预装 skills 现在会通过 `skills.load.extraDirs` 直接从应用内目录加载，因此应用升级时可以同步刷新这些 skills，而不再复制一份托管副本到 `~/.openclaw-geeclaw/skills`。

重点搜索技能所需环境变量：
- `BRAVE_SEARCH_API_KEY`：用于 `brave-web-search`
- `TAVILY_API_KEY`：用于 `tavily-search`（上游运行时也可能支持 OAuth）
- `BOCHA_API_KEY`：用于 `bocha-skill`

现在也可以直接在 **设置 → 环境变量** 中管理 GeeClaw 自己托管运行时使用的全局环境变量。GeeClaw 会把这批变量注入到托管的 Gateway / Agent 运行时中，并在检查 preset 的 `requires.env` 时一并考虑；保存后会自动重启 Gateway 使其立即生效。

### 🔐 安全的供应商集成
连接多个 AI 供应商（OpenAI、Anthropic 等），凭证安全存储在系统原生密钥链中。OpenAI 同时支持 API Key 与浏览器 OAuth（Codex 订阅）登录。

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

### GPU 加速

GeeClaw 现在默认启用 Electron 的 GPU 加速，因此品牌动画等依赖加速渲染的界面效果无需额外参数即可工作。

如果某台机器上出现驱动相关的渲染问题，可以在启动时追加 `--disable-gpu`，回退到软件渲染。

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
3. **连接 AI 服务** – 如果还没有可用 provider，再引导你补充；OpenAI 支持 API Key 或浏览器 OAuth 登录
4. **进入主界面** – 准备完成后直接进入应用

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

### CLI 市场

打开 **设置 → CLI 市场** 可以查看一组 GeeClaw 已知如何检测、安装、重装和卸载的 npm CLI。

- GeeClaw 会先检测系统里是否已经存在对应命令；如果已存在，就直接标记为已安装。
- 如果命令不存在，GeeClaw 会使用应用内置的 Node/npm，把它安装到 GeeClaw 自己管理的用户级前缀目录，而不是要求你执行系统级 `npm install -g`。
- 第一次通过 GeeClaw 托管安装时，GeeClaw 还会把这个托管目录自动加入用户 PATH，这样新开的终端也可以直接使用这些命令。
- 当前界面刻意保持状态简洁，只显示 `已安装 / 未安装`。未安装时右侧展示 `安装`，已安装时把 `重新安装` 和 `卸载` 收进一个紧凑的更多操作菜单。
- 这个页面暂时不会比较版本；每次点击重新安装时，都会按当时 npm 上可获取到的最新包版本重新安装。
- 某些 catalog 条目还可以声明安装后的 Skills。GeeClaw 会在 CLI 安装完成后自动执行 `npx skills add ... -y -g`，在卸载时自动执行 `npx skills remove ... -y -g`。
- 安装和卸载都会打开日志弹窗，把 CLI 本身和 Skills 的完整 `npm` / `npx` 输出放在一起展示。

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
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```
### 常用命令

```bash
# 开发
pnpm run init             # 安装依赖并下载 uv 与内置 Node/npm
pnpm dev                  # 以热重载模式启动

# 代码质量
pnpm lint                 # 运行 ESLint 检查
pnpm run lint:check       # 运行不修改文件的 ESLint 检查
pnpm typecheck            # TypeScript 类型检查

# 测试
pnpm test                 # 运行单元测试
pnpm run verify           # 运行 lint + typecheck + 单元测试

# 构建与打包
pnpm run build:vite       # 仅构建前端
pnpm run bundle:openclaw-plugins  # 重新生成内置 OpenClaw plugin 镜像
pnpm build                # 完整生产构建（含打包资源）
pnpm package              # 为当前平台打包
pnpm package:mac          # 为 macOS 打包
pnpm package:win          # 为 Windows 打包
pnpm package:linux        # 为 Linux 打包
```

### 自动更新发布日志

准备打包发布前，请先更新 [`resources/release-notes.md`](resources/release-notes.md)。`electron-builder` 会把这份 Markdown 写入自动更新元数据，GeeClaw 检测到新版本时就能在启动弹窗里直接显示更新日志。

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

GeeClaw 基于 [MIT 许可证](LICENSE) 发布。你可以自由地使用、修改和分发本软件。

---

<p align="center">
  <sub>由 dtminds 团队用 ❤️ 打造</sub>
</p>
