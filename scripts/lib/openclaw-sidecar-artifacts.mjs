import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_OPENCLAW_SIDECAR_REPO = 'dtminds/GeeClaw';
export const TRACKED_OPENCLAW_SIDECAR_VERSION_PATH = path.join('runtime-artifacts', 'openclaw-sidecar', 'version.json');
export const GENERATED_OPENCLAW_SIDECAR_VERSION_PATH = path.join('build', 'openclaw-sidecar-version.json');
export const SUPPORTED_OPENCLAW_SIDECAR_TARGETS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-x64',
]);

export function resolveOpenClawSidecarTarget(platform = process.platform, arch = process.arch) {
  const normalizedPlatform = platform === 'mac' ? 'darwin' : platform;
  const normalizedArch = arch === 'amd64' ? 'x64' : arch;
  const target = `${normalizedPlatform}-${normalizedArch}`;
  if (!SUPPORTED_OPENCLAW_SIDECAR_TARGETS.has(target)) {
    throw new Error(`Unsupported OpenClaw sidecar target: ${target}`);
  }
  return target;
}

export function parseOpenClawSidecarTarget(target) {
  const normalizedTarget = typeof target === 'string' ? target.trim() : '';
  if (!SUPPORTED_OPENCLAW_SIDECAR_TARGETS.has(normalizedTarget)) {
    throw new Error(`Unsupported OpenClaw sidecar target: ${normalizedTarget || '<empty>'}`);
  }

  const [platform, arch] = normalizedTarget.split('-', 2);
  return { target: normalizedTarget, platform, arch };
}

export function getTrackedOpenClawSidecarVersionManifestPath(projectRoot) {
  return path.join(projectRoot, TRACKED_OPENCLAW_SIDECAR_VERSION_PATH);
}

export function getGeneratedOpenClawSidecarVersionManifestPath(projectRoot) {
  return path.join(projectRoot, GENERATED_OPENCLAW_SIDECAR_VERSION_PATH);
}

export function getOpenClawSidecarVersionManifestPath(projectRoot) {
  const generatedPath = getGeneratedOpenClawSidecarVersionManifestPath(projectRoot);
  if (fs.existsSync(generatedPath)) {
    return generatedPath;
  }

  return getTrackedOpenClawSidecarVersionManifestPath(projectRoot);
}

export function readOpenClawSidecarVersionManifest(projectRoot) {
  const manifestPath = getOpenClawSidecarVersionManifestPath(projectRoot);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`OpenClaw sidecar version manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return normalizeOpenClawSidecarVersionManifest(manifest, manifestPath);
}

export function normalizeOpenClawSidecarVersionManifest(manifest, manifestPath = '<inline>') {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`Invalid OpenClaw sidecar version manifest at ${manifestPath}`);
  }

  const repo = typeof manifest.repo === 'string' && manifest.repo.length > 0
    ? manifest.repo
    : DEFAULT_OPENCLAW_SIDECAR_REPO;
  const assets = manifest.assets && typeof manifest.assets === 'object' && !Array.isArray(manifest.assets)
    ? manifest.assets
    : {};

  return {
    enabled: manifest.enabled === undefined ? true : Boolean(manifest.enabled),
    repo,
    version: typeof manifest.version === 'string' ? manifest.version : null,
    releaseTag: typeof manifest.releaseTag === 'string' ? manifest.releaseTag : null,
    assets,
  };
}

export function assertPinnedOpenClawSidecarManifest(manifest) {
  if (!manifest.enabled) {
    throw new Error('OpenClaw sidecar manifest is disabled. Enable runtime-artifacts/openclaw-sidecar/version.json to consume prebuilt sidecars.');
  }
  if (!manifest.version) {
    throw new Error('OpenClaw sidecar manifest is missing version.');
  }
  if (!manifest.releaseTag) {
    throw new Error('OpenClaw sidecar manifest is missing releaseTag.');
  }
  return manifest;
}

export function getOpenClawSidecarAsset(manifest, target) {
  const normalizedTarget = parseOpenClawSidecarTarget(target).target;
  const asset = manifest.assets?.[normalizedTarget];
  if (!asset || typeof asset !== 'object') {
    throw new Error(`OpenClaw sidecar manifest is missing asset metadata for ${normalizedTarget}.`);
  }
  if (typeof asset.name !== 'string' || asset.name.length === 0) {
    throw new Error(`OpenClaw sidecar asset ${normalizedTarget} is missing a release asset name.`);
  }
  if (typeof asset.sha256 !== 'string' || asset.sha256.length === 0) {
    throw new Error(`OpenClaw sidecar asset ${normalizedTarget} is missing a sha256 checksum.`);
  }

  return {
    name: asset.name,
    sha256: asset.sha256,
    size: typeof asset.size === 'number' ? asset.size : undefined,
    openclawVersion: typeof asset.openclawVersion === 'string' ? asset.openclawVersion : undefined,
  };
}

export function requirePinnedOpenClawSidecarAsset(manifest, target) {
  const pinnedManifest = assertPinnedOpenClawSidecarManifest(manifest);
  return getOpenClawSidecarAsset(pinnedManifest, target);
}

export function getOpenClawSidecarAssetDownloadUrl(manifest, target) {
  const asset = getOpenClawSidecarAsset(manifest, target);
  const { releaseTag, repo } = assertPinnedOpenClawSidecarManifest(manifest);
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(asset.name)}`;
}

export function writeGeneratedOpenClawSidecarVersionManifest(projectRoot, manifest) {
  const outputPath = getGeneratedOpenClawSidecarVersionManifestPath(projectRoot);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return outputPath;
}
