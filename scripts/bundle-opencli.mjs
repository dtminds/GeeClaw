#!/usr/bin/env zx

/**
 * bundle-opencli.mjs
 *
 * Builds a self-contained OpenCLI runtime into build/opencli/ for
 * electron-builder to ship with GeeClaw.
 *
 * We intentionally do not rely on the package's published dist because this
 * repository currently consumes the GitHub source tarball. Instead we compile
 * the runtime with esbuild, preserve the source tree layout under dist/, and
 * copy the unpacked Chrome extension plus YAML registries.
 */

import 'zx/globals';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import windowsPaths from './lib/windows-paths.cjs';

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build', 'opencli');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const OPENCLI_LINK = path.join(NODE_MODULES, '@jackwener', 'opencli');
// Keep the bundled runtime compatible with older Electron Node runtimes that
// still support ESM top-level await but do not parse logical assignment syntax.
const OPENCLI_RUNTIME_TARGET = 'node14.8';
const { realpathCompat } = windowsPaths;

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function walkTsFiles(dir) {
  const entryPoints = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!entry.name.endsWith('.ts')) {
        continue;
      }

      if (
        entry.name.endsWith('.test.ts')
        || entry.name.endsWith('.spec.ts')
        || entry.name.endsWith('.d.ts')
        || entry.name === 'build-manifest.ts'
      ) {
        continue;
      }

      entryPoints.push(fullPath);
    }
  }

  return entryPoints.sort();
}

function extractBalancedBlock(source, startIndex, openChar, closeChar) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }

    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex + 1, i);
      }
    }
  }

  return null;
}

function extractTsArgsBlock(source) {
  const argsMatch = source.match(/args\s*:/);
  if (!argsMatch || argsMatch.index === undefined) {
    return null;
  }

  const bracketIndex = source.indexOf('[', argsMatch.index);
  if (bracketIndex === -1) {
    return null;
  }

  return extractBalancedBlock(source, bracketIndex, '[', ']');
}

function parseInlineChoices(body) {
  const choicesMatch = body.match(/choices\s*:\s*\[([^\]]*)\]/);
  if (!choicesMatch) {
    return undefined;
  }

  const values = choicesMatch[1]
    .split(',')
    .map((value) => value.trim().replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean);

  return values.length > 0 ? values : undefined;
}

function parseTsArgsBlock(argsBlock) {
  const args = [];
  let cursor = 0;

  while (cursor < argsBlock.length) {
    const nameMatch = argsBlock.slice(cursor).match(/\{\s*name\s*:\s*['"`]([^'"`]+)['"`]/);
    if (!nameMatch || nameMatch.index === undefined) {
      break;
    }

    const objectStart = cursor + nameMatch.index;
    const body = extractBalancedBlock(argsBlock, objectStart, '{', '}');
    if (body == null) {
      break;
    }

    const typeMatch = body.match(/type\s*:\s*['"`](\w+)['"`]/);
    const defaultMatch = body.match(/default\s*:\s*([^,}]+)/);
    const requiredMatch = body.match(/required\s*:\s*(true|false)/);
    const helpMatch = body.match(/help\s*:\s*['"`]([^'"`]*)['"`]/);
    const positionalMatch = body.match(/positional\s*:\s*(true|false)/);

    let defaultValue;
    if (defaultMatch) {
      const raw = defaultMatch[1].trim();
      if (raw === 'true') {
        defaultValue = true;
      } else if (raw === 'false') {
        defaultValue = false;
      } else if (/^\d+$/.test(raw)) {
        defaultValue = parseInt(raw, 10);
      } else if (/^\d+\.\d+$/.test(raw)) {
        defaultValue = parseFloat(raw);
      } else {
        defaultValue = raw.replace(/^['"`]|['"`]$/g, '');
      }
    }

    args.push({
      name: nameMatch[1],
      type: typeMatch?.[1] ?? 'str',
      default: defaultValue,
      required: requiredMatch?.[1] === 'true',
      positional: positionalMatch?.[1] === 'true' || undefined,
      help: helpMatch?.[1] ?? '',
      choices: parseInlineChoices(body),
    });

    cursor = objectStart + body.length + 2;
  }

  return args;
}

function shouldReplaceManifestEntry(current, next) {
  if (current.type === next.type) {
    return true;
  }
  return current.type === 'yaml' && next.type === 'ts';
}

function scanYamlCli(filePath, site, yaml) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const def = yaml.load(raw);
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      return null;
    }

    const strategy = String(def.strategy ?? (def.browser === false ? 'public' : 'cookie')).toLowerCase();
    const browser = def.browser ?? (strategy !== 'public');
    const args = [];
    if (def.args && typeof def.args === 'object') {
      for (const [argName, argDef] of Object.entries(def.args)) {
        args.push({
          name: argName,
          type: argDef?.type ?? 'str',
          default: argDef?.default,
          required: argDef?.required ?? false,
          positional: argDef?.positional === true || undefined,
          help: argDef?.description ?? argDef?.help ?? '',
          choices: argDef?.choices,
        });
      }
    }

    return {
      site: def.site ?? site,
      name: def.name ?? path.basename(filePath, path.extname(filePath)),
      description: def.description ?? '',
      domain: def.domain,
      strategy,
      browser,
      args,
      columns: def.columns,
      pipeline: def.pipeline,
      timeout: def.timeout,
      type: 'yaml',
      navigateBefore: def.navigateBefore,
    };
  } catch (error) {
    process.stderr.write(`Warning: failed to parse ${filePath}: ${getErrorMessage(error)}\n`);
    return null;
  }
}

function scanTsCli(filePath, site) {
  const baseName = path.basename(filePath, path.extname(filePath));

  try {
    const src = fs.readFileSync(filePath, 'utf-8');
    if (!/\bcli\s*\(/.test(src)) {
      return null;
    }

    const entry = {
      site,
      name: baseName,
      description: '',
      strategy: 'cookie',
      browser: true,
      args: [],
      type: 'ts',
      modulePath: `${site}/${baseName}.js`,
    };

    const descMatch = src.match(/description\s*:\s*['"`]([^'"`]*)['"`]/);
    if (descMatch) {
      entry.description = descMatch[1];
    }

    const domainMatch = src.match(/domain\s*:\s*['"`]([^'"`]*)['"`]/);
    if (domainMatch) {
      entry.domain = domainMatch[1];
    }

    const strategyMatch = src.match(/strategy\s*:\s*Strategy\.(\w+)/);
    if (strategyMatch) {
      entry.strategy = strategyMatch[1].toLowerCase();
    }

    const browserMatch = src.match(/browser\s*:\s*(true|false)/);
    if (browserMatch) {
      entry.browser = browserMatch[1] === 'true';
    } else {
      entry.browser = entry.strategy !== 'public';
    }

    const columnsMatch = src.match(/columns\s*:\s*\[([^\]]*)\]/);
    if (columnsMatch) {
      entry.columns = columnsMatch[1]
        .split(',')
        .map((value) => value.trim().replace(/^['"`]|['"`]$/g, ''))
        .filter(Boolean);
    }

    const argsBlock = extractTsArgsBlock(src);
    if (argsBlock) {
      entry.args = parseTsArgsBlock(argsBlock);
    }

    const navigateBeforeMatch = src.match(/navigateBefore\s*:\s*(true|false)/);
    if (navigateBeforeMatch) {
      entry.navigateBefore = navigateBeforeMatch[1] === 'true';
    }

    return entry;
  } catch (error) {
    process.stderr.write(`Warning: failed to scan ${filePath}: ${getErrorMessage(error)}\n`);
    return null;
  }
}

function buildCliManifest(srcDir, outputDir, opencliRoot) {
  const clisDir = path.join(srcDir, 'clis');
  const manifestPath = path.join(outputDir, 'cli-manifest.json');
  const manifestEntries = new Map();
  const requireFromOpenCli = createRequire(path.join(opencliRoot, 'package.json'));
  const yaml = requireFromOpenCli('js-yaml');

  if (!fs.existsSync(clisDir)) {
    return { manifestPath, manifestCount: 0, yamlCount: 0, tsCount: 0 };
  }

  for (const site of fs.readdirSync(clisDir)) {
    const siteDir = path.join(clisDir, site);
    if (!fs.statSync(siteDir).isDirectory()) {
      continue;
    }

    for (const file of fs.readdirSync(siteDir)) {
      const filePath = path.join(siteDir, file);
      let entry = null;

      if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        entry = scanYamlCli(filePath, site, yaml);
      } else if (
        (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts') && file !== 'index.ts')
        || (file.endsWith('.js') && !file.endsWith('.d.js') && !file.endsWith('.test.js') && file !== 'index.js')
      ) {
        entry = scanTsCli(filePath, site);
      }

      if (!entry) {
        continue;
      }

      const key = `${entry.site}/${entry.name}`;
      const existing = manifestEntries.get(key);
      if (!existing || shouldReplaceManifestEntry(existing, entry)) {
        if (existing && existing.type !== entry.type) {
          process.stderr.write(`Warning: duplicate adapter ${key}: ${existing.type} superseded by ${entry.type}\n`);
        }
        manifestEntries.set(key, entry);
      }
    }
  }

  const manifest = [...manifestEntries.values()];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return {
    manifestPath,
    manifestCount: manifest.length,
    yamlCount: manifest.filter((entry) => entry.type === 'yaml').length,
    tsCount: manifest.filter((entry) => entry.type === 'ts').length,
  };
}

function copyYamlTree(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    return;
  }

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyYamlTree(srcPath, destPath);
      continue;
    }

    if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
      continue;
    }

    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }
}

async function buildExtensionBundle(opencliRoot, outputDir) {
  const extensionSourceDir = path.join(opencliRoot, 'extension');
  if (!fs.existsSync(extensionSourceDir)) {
    return;
  }

  const extensionOutputDir = path.join(outputDir, 'extension');
  const extensionDistDir = path.join(extensionOutputDir, 'dist');
  fs.mkdirSync(extensionDistDir, { recursive: true });

  for (const fileName of ['manifest.json']) {
    const srcPath = path.join(extensionSourceDir, fileName);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(extensionOutputDir, fileName));
    }
  }

  const iconsDir = path.join(extensionSourceDir, 'icons');
  if (fs.existsSync(iconsDir)) {
    fs.cpSync(iconsDir, path.join(extensionOutputDir, 'icons'), {
      recursive: true,
      dereference: true,
    });
  }

  await build({
    entryPoints: [path.join(extensionSourceDir, 'src', 'background.ts')],
    outfile: path.join(extensionDistDir, 'background.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome114',
    sourcemap: false,
    logLevel: 'silent',
    legalComments: 'none',
  });
}

function writeRuntimeCompatShims(outputDir) {
  const daemonShimPath = path.join(outputDir, 'daemon.js');
  fs.writeFileSync(
    daemonShimPath,
    [
      '#!/usr/bin/env node',
      "import './dist/daemon.js';",
      '',
    ].join('\n'),
    'utf8',
  );
}

function assertNoUnsupportedSyntax(outputDir) {
  const patterns = [/\?\?=/, /\|\|=/, /&&=/];
  const pending = [outputDir];

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !/\.m?js$/i.test(entry.name)) {
        continue;
      }

      const source = fs.readFileSync(fullPath, 'utf8');
      if (patterns.some((pattern) => pattern.test(source))) {
        throw new Error(`Unsupported logical assignment syntax remained in ${fullPath}`);
      }
    }
  }
}

echo`📦 Bundling opencli for electron-builder...`;

if (!fs.existsSync(OPENCLI_LINK)) {
  echo`❌ node_modules/@jackwener/opencli not found. Run pnpm install first.`;
  process.exit(1);
}

const opencliReal = realpathCompat(OPENCLI_LINK);
const srcDir = path.join(opencliReal, 'src');
const distDir = path.join(OUTPUT, 'dist');
const entryPoints = walkTsFiles(srcDir);

if (entryPoints.length === 0) {
  echo`❌ No OpenCLI TypeScript runtime files found in ${srcDir}`;
  process.exit(1);
}

echo`   opencli resolved: ${opencliReal}`;
echo`   runtime entrypoints: ${entryPoints.length}`;

if (fs.existsSync(OUTPUT)) {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT, { recursive: true });

echo`   Copying package metadata...`;
for (const fileName of ['package.json', 'README.md', 'README.zh-CN.md', 'LICENSE']) {
  const srcPath = path.join(opencliReal, fileName);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(OUTPUT, fileName));
  }
}

echo`   Building browser extension...`;
await buildExtensionBundle(opencliReal, OUTPUT);

echo`   Transpiling runtime with esbuild...`;
await build({
  entryPoints,
  outdir: distDir,
  outbase: srcDir,
  platform: 'node',
  target: OPENCLI_RUNTIME_TARGET,
  format: 'esm',
  splitting: true,
  bundle: true,
  sourcemap: false,
  logLevel: 'silent',
  legalComments: 'none',
  banner: {
    js: "import { createRequire as __opencliCreateRequire } from 'node:module'; const require = __opencliCreateRequire(import.meta.url);",
  },
});

echo`   Copying YAML command definitions...`;
copyYamlTree(path.join(srcDir, 'clis'), path.join(distDir, 'clis'));

const externalCliRegistry = path.join(srcDir, 'external-clis.yaml');
if (fs.existsSync(externalCliRegistry)) {
  fs.copyFileSync(externalCliRegistry, path.join(distDir, 'external-clis.yaml'));
}

echo`   Building CLI manifest...`;
const manifestSummary = buildCliManifest(srcDir, OUTPUT, opencliReal);
echo`   Manifest compiled: ${manifestSummary.manifestCount} entries (${manifestSummary.yamlCount} YAML, ${manifestSummary.tsCount} TS)`;

echo`   Writing runtime compatibility shims...`;
writeRuntimeCompatShims(OUTPUT);
assertNoUnsupportedSyntax(distDir);

echo`✅ OpenCLI bundle ready at ${OUTPUT}`;
