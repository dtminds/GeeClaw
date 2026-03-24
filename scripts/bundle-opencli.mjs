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

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build', 'opencli');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const OPENCLI_LINK = path.join(NODE_MODULES, '@jackwener', 'opencli');

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

echo`📦 Bundling opencli for electron-builder...`;

if (!fs.existsSync(OPENCLI_LINK)) {
  echo`❌ node_modules/@jackwener/opencli not found. Run pnpm install first.`;
  process.exit(1);
}

const opencliReal = fs.realpathSync(OPENCLI_LINK);
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
  target: 'node20',
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

echo`   Writing runtime compatibility shims...`;
writeRuntimeCompatShims(OUTPUT);

echo`✅ OpenCLI bundle ready at ${OUTPUT}`;
