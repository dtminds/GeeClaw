# OpenClaw Runtime

`openclaw-runtime/` 是 GeeClaw 的独立 OpenClaw 安装单元。

目的只有一个：让打包阶段消费一份真实安装出来的 runtime，而不是再从 workspace 的 `pnpm` 虚拟仓库里递归拼装 `build/openclaw/`。

## 当前阶段

这是第一阶段验证版：

- 使用独立 `npm install` 安装 `openclaw@2026.4.9`
- 允许 OpenClaw 自己的 `postinstall` 正常执行
- 让 `scripts/bundle-openclaw.mjs` 在该 runtime 存在时优先使用它
- 如果该 runtime 尚未准备好，则回退到当前 workspace `node_modules/openclaw`

## 常用命令

```bash
pnpm run openclaw-runtime:prepare
pnpm run openclaw-runtime:install
pnpm run openclaw-runtime:clean
```

安装完成后，`openclaw-runtime/node_modules/openclaw/` 会成为打包输入源。

开发态现在也会优先使用这份 runtime。`pnpm dev` 会先执行一次 `openclaw-runtime:prepare`：

- 已安装时直接复用
- 尚未安装时自动补装

## 为什么要这样做

当前 GeeClaw 的旧方案有两个天然脆弱点：

1. 它依赖 `pnpm` 的虚拟 store 结构，打包脚本必须自己推导整棵依赖图。
2. 它绕过了 OpenClaw 包本身的安装期副作用，尤其是 bundled plugins 的安装与修复逻辑。

独立 runtime 的收益是把“依赖安装”还给包管理器，把“打包拷贝”限制为纯文件搬运。
