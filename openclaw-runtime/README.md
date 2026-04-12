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
pnpm run openclaw-runtime:prune
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
- 安装完成后执行一次保守裁剪，删除已确认不参与运行的文档/静态资源目录

什么时候用：

- 你改了 [`openclaw-runtime/package.json`](./package.json)
- 你更新了 [`openclaw-runtime/package-lock.json`](./package-lock.json)
- 你想重新安装一份干净的 runtime

### `prune-runtime.mjs`

职责：

- 删除一小批已确认不参与运行的文档目录和静态资源
- 删除 GeeClaw 当前不随包分发的 Tlon skill 及其平台二进制包
- 当前只做保守裁剪，不删除任何 `.node`、`.dylib` 或其他运行时原生库
- 主要参考 `nexu` 的 runtime 安装后清理思路，但范围更保守

当前会裁剪的内容包括：

- `@tloncorp/tlon-skill` 及其平台二进制包
- 若干第三方依赖的 `docs/`
- `openclaw/docs/assets`
- `openclaw/docs/images`
- `openclaw/docs/zh-CN`
- `openclaw/docs/ja-JP`

不会裁剪：

- `openclaw/docs/reference/templates/`
- 任何运行时原生二进制
- 任何 OpenClaw extension 源码目录

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

## 本地开发如何验证升级

如果你刚升级了 `openclaw` 版本，先验证 repo-local runtime 本身是否正常：

```bash
pnpm install
pnpm run openclaw-runtime:install
pnpm run openclaw-runtime:prepare
pnpm dev
```

建议按这个顺序理解：

1. 修改 [`openclaw-runtime/package.json`](./package.json)
2. 在 `openclaw-runtime/` 里刷新 lockfile
3. 回到仓库根目录执行 `pnpm run openclaw-runtime:install`
4. 用 `pnpm dev` 验证开发态是否能正常启动

如果只是想强制刷新本地 runtime，不需要动 sidecar，直接执行：

```bash
pnpm run openclaw-runtime:clean
pnpm run openclaw-runtime:install
```

这里的开发态验证始终使用 repo-local `openclaw-runtime/` 安装结果，不会默认下载 sidecar。

## 本地打包如何验证升级

如果你要验证“升级后的 OpenClaw 是否能正常打进 GeeClaw 包里”，有两条路径：

### 1. 普通本地打包链路

这条链路会走：

- `openclaw-runtime/node_modules/openclaw`
- `scripts/bundle-openclaw.mjs`
- `build/openclaw`
- `after-pack` 归档成 `Contents/Resources/runtime/openclaw/payload.tar.gz`

可直接执行：

```bash
pnpm run package:mac:dir
```

或者根据需要改成别的平台目标。

### 2. sidecar release 链路

这条链路用来验证 release CI 消费的预构建 sidecar 是否可用。

如果你本地自己构 sidecar：

```bash
pnpm run openclaw-sidecar:build -- --target darwin-arm64 --version 2026.4.12-r1
pnpm run package:release:resources
GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR=1 pnpm exec electron-builder --config scripts/electron-builder-config.mjs --mac --arm64 --dir --config.mac.identity=null
```

如果你是验证已经发布的 sidecar：

```bash
pnpm run openclaw-sidecar:download -- --target darwin-arm64
pnpm run package:release:resources
GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR=1 pnpm exec electron-builder --config scripts/electron-builder-config.mjs --mac --arm64 --dir --config.mac.identity=null
```

验证其他目标时，把 `darwin-arm64` 换成：

- `darwin-x64`
- `win32-x64`

验证完成后，重点检查：

- 打包日志里出现 `Using prebuilt OpenClaw sidecar`
- 包内存在 `Contents/Resources/runtime/openclaw/payload.tar.gz`
- 不再依赖 `Contents/Resources/openclaw`

## 如何更新 sidecar pin 版本

主 release workflow 读取的是：

- [`runtime-artifacts/openclaw-sidecar/version.json`](../runtime-artifacts/openclaw-sidecar/version.json)

如果 sidecar release 已经发布，要把新的 pin 版本同步回仓库：

```bash
gh release download openclaw-sidecar-v2026.4.12-r1 \
  --pattern openclaw-sidecar-version.json \
  --dir /tmp/openclaw-sidecar-v2026.4.12-r1

cp /tmp/openclaw-sidecar-v2026.4.12-r1/openclaw-sidecar-version.json \
  ./runtime-artifacts/openclaw-sidecar/version.json
```

然后提交更新后的：

- [`runtime-artifacts/openclaw-sidecar/version.json`](../runtime-artifacts/openclaw-sidecar/version.json)

注意：

- sidecar 是 release 产物，不是默认开发输入
- 开发态和普通本地打包默认仍然走 repo-local `openclaw-runtime/`
- 只有 `package:release:*` 或显式设置 `GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR=1` 时，才会切到 prebuilt sidecar 模式

## 为什么要这样做

独立 runtime 的收益是把“依赖安装”还给包管理器，把“打包拷贝”限制为纯文件搬运。
