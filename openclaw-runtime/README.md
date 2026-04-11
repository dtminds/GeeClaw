# OpenClaw Runtime

`openclaw-runtime/` 是 GeeClaw 的独立 OpenClaw 安装单元。

目的只有一个：让打包阶段消费一份真实安装出来的 runtime。

## 当前阶段

这是第一阶段验证版：

- 使用独立 `npm install` 安装 `openclaw`
- 允许 OpenClaw 自己的 `postinstall` 正常执行
- 让 `scripts/bundle-openclaw.mjs` 和开发态都统一使用它
- 如果该 runtime 尚未准备好，则视为环境未完成

## 常用命令

```bash
pnpm run openclaw-runtime:prepare
pnpm run openclaw-runtime:install
pnpm run openclaw-runtime:clean
```

这里的 `pnpm run ...` 只是从根项目触发脚本，真正执行 runtime 安装的是
`openclaw-runtime/` 目录里的 `npm` 流程，而不是 `pnpm`。

原因是这个目录本身维护的是 [`package-lock.json`](./package-lock.json)，
并且 [`package.json`](./package.json)
明确声明了 `packageManager: "npm@11.6.2"`。所以升级 `openclaw` 版本后，
需要刷新的是这套 npm lockfile，而不是根项目的 `pnpm-lock.yaml`。

## 脚本说明

### `install-runtime.mjs`

职责：

- 在 `openclaw-runtime/` 目录执行真实的 runtime 安装
- 优先跑 `npm ci`
- 如果 `package-lock.json` 和 `package.json` 不匹配，或 `npm ci` 失败，再回退到 `npm install --prefer-offline`
- 把 npm cache 固定到本目录下的 `.npm-cache/`

什么时候用：

- 你改了 [`openclaw-runtime/package.json`](./package.json)
- 你更新了 [`openclaw-runtime/package-lock.json`](./package-lock.json)
- 你想重新安装一份干净的 runtime

### `ensure-runtime.mjs`

职责：

- 检查 `openclaw-runtime/node_modules/openclaw/package.json` 是否已存在
- 已存在就直接复用
- 不存在才调用 `install-runtime.mjs`

什么时候用：

- 开发态启动前做一次“确保 runtime 已就绪”的轻量检查
- 适合接在 `pnpm dev` 这种频繁执行的流程前面

### `clean-node-modules.mjs`

职责：

- 删除 `openclaw-runtime/node_modules`
- 删除 `openclaw-runtime/.npm-cache`

什么时候用：

- 你怀疑 runtime 安装结果被污染了
- 你想强制从零重装
- 你想清理本地占用空间

## 升级版本时要做什么

如果要把 `openclaw` 从一个版本升级到另一个版本，最少需要同步这几步：

1. 修改 [`openclaw-runtime/package.json`](./package.json)
2. 在 `openclaw-runtime/` 目录里运行 `npm install`
3. 提交更新后的 [`openclaw-runtime/package-lock.json`](./package-lock.json)
4. 回到根目录执行 `pnpm run openclaw-runtime:install`

如果只改版本号、不刷新 `package-lock.json`，`install-runtime.mjs` 里的 `npm ci`
就会因为 lockfile 不匹配而报错，然后退回到 `npm install`。

安装完成后，`openclaw-runtime/node_modules/openclaw/` 会成为打包输入源。

开发态现在也会优先使用这份 runtime。`pnpm dev` 会先执行一次 `openclaw-runtime:prepare`：

- 已安装时直接复用
- 尚未安装时自动补装

## 为什么要这样做

当前 GeeClaw 的旧方案有两个天然脆弱点：

1. 它依赖 `pnpm` 的虚拟 store 结构，打包脚本必须自己推导整棵依赖图。
2. 它绕过了 OpenClaw 包本身的安装期副作用，尤其是 bundled plugins 的安装与修复逻辑。

独立 runtime 的收益是把“依赖安装”还给包管理器，把“打包拷贝”限制为纯文件搬运。
