#!/usr/bin/env zx

/**
 * bundle-openclaw-plugins.mjs
 *
 * Build self-contained OpenClaw plugin mirrors for packaging.
 * npm-backed plugins are resolved from the app's node_modules/.
 * Local unpublished plugins can be dropped into plugins/openclaw/<plugin-id>/.
 * Current plugins:
 *   - @soimy/dingtalk -> build/openclaw-plugins/dingtalk
 *   - @wecom/wecom-openclaw-plugin -> build/openclaw-plugins/wecom-openclaw-plugin
 *
 * The output plugin directory contains:
 *   - plugin source files (index.ts, openclaw.plugin.json, package.json, ...)
 *   - plugin runtime deps copied from either pnpm virtual store or the local
 *     plugin's own self-contained directory
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pluginBundler from './lib/openclaw-plugin-bundler.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'openclaw-plugins');
const { bundlePluginMirrors } = pluginBundler;

console.log('📦 Bundling OpenClaw plugin mirrors...');
bundlePluginMirrors({
  rootDir: ROOT,
  outputRoot: OUTPUT_ROOT,
  logger: console,
});
console.log(`✅ Plugin mirrors ready: ${OUTPUT_ROOT}`);
