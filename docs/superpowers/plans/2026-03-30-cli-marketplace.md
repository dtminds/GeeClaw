# CLI Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated npm CLI marketplace that detects installed commands, installs missing ones with GeeClaw's bundled npm runtime, and exposes a simple `已安装 / 未安装` + `安装 / 重新安装` settings UI.

**Architecture:** Electron Main owns the catalog, detection, and install flow through a new `CliMarketplaceService`. The renderer gets a dedicated settings section that talks only to host API routes. Installation uses a GeeClaw-controlled user-level npm prefix and never compares versions or surfaces upgrade state.

**Tech Stack:** Electron, React 19, TypeScript, Node child_process, Vitest, Testing Library, i18next

---

## File Structure

### Create

- `docs/superpowers/plans/2026-03-30-cli-marketplace.md`
  Purpose: Record the implementation steps for the CLI marketplace.
- `resources/cli-marketplace/catalog.json`
  Purpose: Store the curated CLI whitelist that product can edit without touching renderer logic.
- `electron/utils/cli-marketplace.ts`
  Purpose: Load the catalog, detect install state, resolve bundled npm paths, and run install/reinstall.
- `electron/api/routes/cli-marketplace.ts`
  Purpose: Expose catalog and install routes through the host API.
- `src/components/settings/CliMarketplaceSettingsSection.tsx`
  Purpose: Render the CLI marketplace UI inside Settings.
- `tests/unit/cli-marketplace-service.test.ts`
  Purpose: Lock catalog validation, install-state detection, and bundled install behavior.
- `tests/unit/cli-marketplace-routes.test.ts`
  Purpose: Lock host API route behavior for catalog and install.
- `tests/unit/cli-marketplace-settings-section.test.tsx`
  Purpose: Lock the renderer behavior for `已安装 / 未安装` and `安装 / 重新安装`.

### Modify

- `scripts/download-bundled-node.mjs`
  Purpose: Preserve a minimal npm-capable runtime instead of extracting only `node`.
- `electron/utils/managed-bin.ts`
  Purpose: Resolve bundled npm and npx command paths alongside bundled node.
- `electron/api/context.ts`
  Purpose: Extend the host API context with the CLI marketplace service.
- `electron/api/server.ts`
  Purpose: Register the new CLI marketplace route handler.
- `electron/main/index.ts`
  Purpose: Instantiate `CliMarketplaceService` and pass it into the host API server.
- `src/lib/settings-modal.ts`
  Purpose: Add a dedicated settings route section for the CLI marketplace.
- `src/pages/Settings/index.tsx`
  Purpose: Add the new settings navigation item and mount the CLI marketplace section.
- `src/i18n/locales/en/settings.json`
  Purpose: Add English navigation, status, button, empty-state, and error strings for the CLI marketplace.
- `src/i18n/locales/zh/settings.json`
  Purpose: Add Chinese navigation, status, button, empty-state, and error strings for the CLI marketplace.
- `tests/unit/managed-bin.test.ts`
  Purpose: Lock bundled npm command-path resolution.
- `tests/unit/settings-modal.test.ts`
  Purpose: Lock the new settings route path and resolution behavior.
- `README.md`
  Purpose: Document the curated CLI marketplace and controlled user-level npm prefix.
- `README.zh-CN.md`
  Purpose: Document the same behavior in Chinese.

## Task 1: Preserve A Bundled npm Runtime

**Files:**
- Modify: `tests/unit/managed-bin.test.ts`
- Modify: `electron/utils/managed-bin.ts`
- Modify: `scripts/download-bundled-node.mjs`

- [ ] **Step 1: Write the failing path-resolution test**

Add a test that expects bundled npm command resolution on both packaged Windows and packaged macOS:

```ts
it('resolves bundled npm command paths for packaged Windows builds', async () => {
  setPlatform('win32');
  setArch('x64');
  mockIsPackagedGetter.value = true;
  Object.defineProperty(process, 'resourcesPath', {
    value: 'C:\\Program Files\\GeeClaw\\resources',
    configurable: true,
    writable: true,
  });
  mockExistsSync.mockImplementation((value: string) => (
    value === 'C:\\Program Files\\GeeClaw\\resources\\bin\\npm.cmd'
    || value === 'C:\\Program Files\\GeeClaw\\resources\\bin\\npx.cmd'
  ));

  const { getBundledNpmPath, getBundledNpxPath } = await import('@electron/utils/managed-bin');

  expect(getBundledNpmPath()).toBe('C:\\Program Files\\GeeClaw\\resources\\bin\\npm.cmd');
  expect(getBundledNpxPath()).toBe('C:\\Program Files\\GeeClaw\\resources\\bin\\npx.cmd');
});
```

- [ ] **Step 2: Run the managed-bin test to verify it fails**

Run: `pnpm exec vitest run tests/unit/managed-bin.test.ts`

Expected: FAIL because `getBundledNpmPath` and `getBundledNpxPath` do not exist yet.

- [ ] **Step 3: Add bundled npm path helpers**

Extend `electron/utils/managed-bin.ts` with npm and npx helpers that follow the existing bundled bin conventions:

```ts
export function getBundledNpmPath(): string | null {
  const fileName = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npmPath = join(getBundledBinDir(), fileName);
  return existsSync(npmPath) ? npmPath : null;
}

export function getBundledNpxPath(): string | null {
  const fileName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const npxPath = join(getBundledBinDir(), fileName);
  return existsSync(npxPath) ? npxPath : null;
}
```

- [ ] **Step 4: Make the Node download preserve npm**

Replace the current single-binary move logic in `scripts/download-bundled-node.mjs` with a minimal runtime copy list:

```js
const REQUIRED_RUNTIME_FILES = {
  'win32-x64': ['node.exe', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'node_modules/npm'],
  'win32-arm64': ['node.exe', 'npm', 'npm.cmd', 'npx', 'npx.cmd', 'node_modules/npm'],
  'darwin-x64': ['bin/node', 'bin/npm', 'bin/npx', 'lib/node_modules/npm'],
  'darwin-arm64': ['bin/node', 'bin/npm', 'bin/npx', 'lib/node_modules/npm'],
};

for (const relativePath of REQUIRED_RUNTIME_FILES[id]) {
  const sourcePath = path.join(tempDir, target.sourceDir, relativePath);
  const outputPath = path.join(targetDir, relativePath);
  await fs.ensureDir(path.dirname(outputPath));
  await fs.copy(sourcePath, outputPath, { overwrite: true });
}
```

- [ ] **Step 5: Re-run the managed-bin test**

Run: `pnpm exec vitest run tests/unit/managed-bin.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the runtime-prep slice**

```bash
git add tests/unit/managed-bin.test.ts electron/utils/managed-bin.ts scripts/download-bundled-node.mjs
git commit -m "feat: preserve bundled npm runtime"
```

## Task 2: Add The Main-Owned CLI Marketplace Service

**Files:**
- Create: `resources/cli-marketplace/catalog.json`
- Create: `electron/utils/cli-marketplace.ts`
- Create: `tests/unit/cli-marketplace-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

Create `tests/unit/cli-marketplace-service.test.ts` with one catalog-loading test and one install-state test:

```ts
it('marks a CLI as installed when a system command is detected', async () => {
  const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

  const service = new CliMarketplaceService({
    catalogEntries: [
      { id: 'feishu', title: 'Feishu CLI', packageName: '@geeclaw-test/feishu-cli', binNames: ['feishu'] },
    ],
    findCommand: vi.fn(async (bin: string) => (bin === 'feishu' ? '/usr/local/bin/feishu' : null)),
    commandExistsInManagedPrefix: vi.fn(async () => false),
  });

  await expect(service.getCatalog()).resolves.toEqual([
    expect.objectContaining({
      id: 'feishu',
      installed: true,
      actionLabel: '重新安装',
      source: 'system',
    }),
  ]);
});

it('installs a curated package into the GeeClaw prefix', async () => {
  const installWithBundledNpm = vi.fn(async () => undefined);
  const { CliMarketplaceService } = await import('@electron/utils/cli-marketplace');

  const service = new CliMarketplaceService({
    catalogEntries: [
      { id: 'wecom', title: 'WeCom CLI', packageName: '@geeclaw-test/wecom-cli', binNames: ['wecom'] },
    ],
    findCommand: vi.fn(async () => null),
    commandExistsInManagedPrefix: vi.fn(async () => true),
    installWithBundledNpm,
  });

  await service.install({ id: 'wecom' });

  expect(installWithBundledNpm).toHaveBeenCalledWith(
    '@geeclaw-test/wecom-cli',
    [],
    expect.objectContaining({ prefixDir: expect.any(String) }),
  );
});
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/cli-marketplace-service.test.ts`

Expected: FAIL because `@electron/utils/cli-marketplace` does not exist yet.

- [ ] **Step 3: Create the bundled catalog file**

Seed `resources/cli-marketplace/catalog.json` with an initially empty curated list so product can add entries without changing code:

```json
[]
```

- [ ] **Step 4: Implement the service, catalog types, and install-state resolution**

Create `electron/utils/cli-marketplace.ts` with a service that loads the manifest, checks system commands first, then checks GeeClaw's managed prefix, and normalizes the renderer payload:

```ts
export type CliMarketplaceCatalogItem = {
  id: string;
  title: string;
  packageName: string;
  binNames: string[];
  description?: string;
  homepage?: string;
  platforms?: Array<'darwin' | 'win32' | 'linux'>;
  installArgs?: string[];
};

export type CliMarketplaceStatusItem = {
  id: string;
  title: string;
  description: string;
  homepage?: string;
  installed: boolean;
  actionLabel: '安装' | '重新安装';
  source: 'system' | 'geeclaw' | 'none';
};

export class CliMarketplaceService {
  async getCatalog(): Promise<CliMarketplaceStatusItem[]> {
    const entries = await this.loadCatalogEntries();
    return Promise.all(entries.map((entry) => this.resolveEntryStatus(entry)));
  }

  async install({ id }: { id: string }): Promise<CliMarketplaceStatusItem> {
    const entry = await this.getEntryById(id);
    await this.installWithBundledNpm(entry.packageName, entry.installArgs ?? [], {
      prefixDir: this.getManagedPrefixDir(),
    });
    return this.resolveEntryStatus(entry);
  }
}
```

- [ ] **Step 5: Re-run the service tests**

Run: `pnpm exec vitest run tests/unit/cli-marketplace-service.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the service slice**

```bash
git add resources/cli-marketplace/catalog.json electron/utils/cli-marketplace.ts tests/unit/cli-marketplace-service.test.ts
git commit -m "feat: add CLI marketplace service"
```

## Task 3: Expose The Marketplace Through Host API

**Files:**
- Create: `electron/api/routes/cli-marketplace.ts`
- Create: `tests/unit/cli-marketplace-routes.test.ts`
- Modify: `electron/api/context.ts`
- Modify: `electron/api/server.ts`
- Modify: `electron/main/index.ts`

- [ ] **Step 1: Write the failing route tests**

Create `tests/unit/cli-marketplace-routes.test.ts` using the same pattern as `tests/unit/opencli-routes.test.ts`:

```ts
it('returns CLI marketplace catalog for GET /api/cli-marketplace/catalog', async () => {
  const getCatalog = vi.fn(async () => [
    { id: 'feishu', title: 'Feishu CLI', installed: true, actionLabel: '重新安装', source: 'system' },
  ]);

  const { handleCliMarketplaceRoutes } = await import('@electron/api/routes/cli-marketplace');

  const handled = await handleCliMarketplaceRoutes(
    { method: 'GET' } as IncomingMessage,
    {} as ServerResponse,
    new URL('http://127.0.0.1:3210/api/cli-marketplace/catalog'),
    { cliMarketplaceService: { getCatalog } } as never,
  );

  expect(handled).toBe(true);
  expect(getCatalog).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the route tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/cli-marketplace-routes.test.ts`

Expected: FAIL because the route file and `cliMarketplaceService` context field do not exist yet.

- [ ] **Step 3: Extend the host API context and route registration**

Add the new service to `electron/api/context.ts` and register the route in `electron/api/server.ts`:

```ts
export interface HostApiContext {
  gatewayManager: GatewayManager;
  clawHubService: ClawHubService;
  cliMarketplaceService: CliMarketplaceService;
  eventBus: HostEventBus;
  mainWindow: BrowserWindow | null;
}
```

```ts
import { handleCliMarketplaceRoutes } from './routes/cli-marketplace';

const routeHandlers: RouteHandler[] = [
  handleAppRoutes,
  handleGatewayRoutes,
  handleSettingsRoutes,
  handleProviderRoutes,
  handleChannelRoutes,
  handleCliMarketplaceRoutes,
  handleOpenCliRoutes,
  handleMcpRoutes,
  handleSkillRoutes,
  handleFileRoutes,
  handleAuthSessionRoutes,
  handleDesktopSessionRoutes,
  handleAgentRoutes,
  handleSessionRoutes,
  handleCronRoutes,
  handleLogRoutes,
  handleUsageRoutes,
];
```

- [ ] **Step 4: Create the route handler and wire the service into main startup**

Create `electron/api/routes/cli-marketplace.ts` and instantiate the service in `electron/main/index.ts`:

```ts
export async function handleCliMarketplaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: HostApiContext,
): Promise<boolean> {
  if (url.pathname === '/api/cli-marketplace/catalog' && req.method === 'GET') {
    sendJson(res, 200, await ctx.cliMarketplaceService.getCatalog());
    return true;
  }

  if (url.pathname === '/api/cli-marketplace/install' && req.method === 'POST') {
    const body = await parseJsonBody<{ id: string }>(req);
    sendJson(res, 200, await ctx.cliMarketplaceService.install(body));
    return true;
  }

  return false;
}
```

```ts
const cliMarketplaceService = new CliMarketplaceService();

hostApiServer = startHostApiServer({
  gatewayManager,
  clawHubService,
  cliMarketplaceService,
  eventBus: hostEventBus,
  mainWindow,
});
```

- [ ] **Step 5: Re-run the route tests**

Run: `pnpm exec vitest run tests/unit/cli-marketplace-routes.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the API slice**

```bash
git add electron/api/routes/cli-marketplace.ts tests/unit/cli-marketplace-routes.test.ts electron/api/context.ts electron/api/server.ts electron/main/index.ts
git commit -m "feat: expose CLI marketplace host api"
```

## Task 4: Add The Settings UI And Route

**Files:**
- Create: `src/components/settings/CliMarketplaceSettingsSection.tsx`
- Create: `tests/unit/cli-marketplace-settings-section.test.tsx`
- Modify: `src/lib/settings-modal.ts`
- Modify: `src/pages/Settings/index.tsx`
- Modify: `src/i18n/locales/en/settings.json`
- Modify: `src/i18n/locales/zh/settings.json`
- Modify: `tests/unit/settings-modal.test.ts`

- [ ] **Step 1: Write the failing settings-route and renderer tests**

Extend `tests/unit/settings-modal.test.ts`:

```ts
it('builds the cli marketplace settings path', () => {
  expect(getSettingsModalPath('cliMarketplace')).toBe('/settings/cli-marketplace');
});

it('resolves the cli marketplace settings section from the route', () => {
  expect(resolveSettingsSection('/settings/cli-marketplace')).toBe('cliMarketplace');
});
```

Create `tests/unit/cli-marketplace-settings-section.test.tsx`:

```tsx
it('renders installed and missing CLI entries with the correct action labels', async () => {
  hostApiFetchMock.mockResolvedValue([
    { id: 'feishu', title: 'Feishu CLI', description: 'Docs', installed: true, actionLabel: '重新安装' },
    { id: 'wecom', title: 'WeCom CLI', description: 'Docs', installed: false, actionLabel: '安装' },
  ]);

  const { CliMarketplaceSettingsSection } = await import('@/components/settings/CliMarketplaceSettingsSection');

  render(<CliMarketplaceSettingsSection />);

  expect(await screen.findByText('Feishu CLI')).toBeInTheDocument();
  expect(screen.getByText('已安装')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新安装' })).toBeInTheDocument();
  expect(screen.getByText('未安装')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '安装' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the settings tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/settings-modal.test.ts tests/unit/cli-marketplace-settings-section.test.tsx`

Expected: FAIL because the new section key and component do not exist yet.

- [ ] **Step 3: Add the new settings route key and mount point**

Update `src/lib/settings-modal.ts` and `src/pages/Settings/index.tsx`:

```ts
export type SettingsModalSection =
  | 'appearance'
  | 'models'
  | 'safety'
  | 'gateway'
  | 'cliMarketplace'
  | 'opencli'
  | 'mcp'
  | 'general';

if (pathname.startsWith('/settings/cli-marketplace')) return 'cliMarketplace';
```

```tsx
{ key: 'cliMarketplace', title: t('nav.cliMarketplace'), icon: <Terminal className="h-4 w-4" /> },

{section === 'cliMarketplace' && <CliMarketplaceSettingsSection />}
```

- [ ] **Step 4: Add the dedicated settings UI and translations**

Implement `src/components/settings/CliMarketplaceSettingsSection.tsx` with `hostApiFetch` reads and install actions:

```tsx
export function CliMarketplaceSettingsSection() {
  const { t } = useTranslation('settings');
  const [items, setItems] = useState<CliMarketplaceItem[]>([]);

  const loadCatalog = useCallback(async () => {
    const response = await hostApiFetch<CliMarketplaceItem[]>('/api/cli-marketplace/catalog');
    setItems(response);
  }, []);

  const handleInstall = useCallback(async (id: string) => {
    await hostApiFetch('/api/cli-marketplace/install', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
    await loadCatalog();
  }, [loadCatalog]);

  return (
    <div className="flex flex-col gap-6">
      {items.map((item) => (
        <div key={item.id} className="modal-section-surface rounded-3xl border p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
            </div>
            <Button onClick={() => void handleInstall(item.id)}>{item.actionLabel}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

Add matching translation keys in `src/i18n/locales/en/settings.json` and `src/i18n/locales/zh/settings.json` for:

```json
{
  "nav": {
    "cliMarketplace": "CLI Market"
  },
  "cliMarketplace": {
    "title": "CLI Market",
    "description": "Install curated npm CLIs that GeeClaw can detect and manage.",
    "installed": "Installed",
    "missing": "Not installed",
    "install": "Install",
    "reinstall": "Reinstall"
  }
}
```

- [ ] **Step 5: Re-run the settings tests**

Run: `pnpm exec vitest run tests/unit/settings-modal.test.ts tests/unit/cli-marketplace-settings-section.test.tsx`

Expected: PASS

- [ ] **Step 6: Commit the UI slice**

```bash
git add src/components/settings/CliMarketplaceSettingsSection.tsx tests/unit/cli-marketplace-settings-section.test.tsx src/lib/settings-modal.ts src/pages/Settings/index.tsx src/i18n/locales/en/settings.json src/i18n/locales/zh/settings.json tests/unit/settings-modal.test.ts
git commit -m "feat: add CLI marketplace settings UI"
```

## Task 5: Document The Feature And Run Focused Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Update the English README**

Add a short section in `README.md` that matches the shipped behavior:

```md
### CLI Marketplace

GeeClaw can surface a curated set of npm-based CLIs, detect whether they are already available, and install missing tools with one click using GeeClaw's bundled Node.js and npm runtime. Installs use a GeeClaw-managed user-level npm prefix, so admin rights are not required.
```

- [ ] **Step 2: Update the Chinese README**

Add the matching Chinese section in `README.zh-CN.md`:

```md
### CLI 市场

GeeClaw 可以展示一组内置白名单 CLI，检测这些命令是否已存在，并用内置的 Node.js 与 npm 运行时一键安装缺失工具。安装会写入 GeeClaw 管理的用户级 npm 目录，因此不需要管理员权限。
```

- [ ] **Step 3: Run the focused verification suite**

Run:

```bash
pnpm exec vitest run tests/unit/managed-bin.test.ts tests/unit/cli-marketplace-service.test.ts tests/unit/cli-marketplace-routes.test.ts tests/unit/settings-modal.test.ts tests/unit/cli-marketplace-settings-section.test.tsx
pnpm exec tsc --noEmit
```

Expected: all tests PASS and TypeScript exits successfully with no errors.

- [ ] **Step 4: Commit the docs and verification slice**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: describe curated CLI marketplace"
```

## Spec Coverage Check

- Bundled npm runtime: Task 1
- Main-owned CLI marketplace service: Task 2
- Host API routes and context wiring: Task 3
- Dedicated settings UI with `已安装 / 未安装`: Task 4
- README and README.zh-CN updates: Task 5
- Focused verification for Windows-sensitive helpers and UI behavior: Tasks 1, 2, 3, 4, and 5
