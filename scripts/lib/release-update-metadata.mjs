import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function basenameFromUrlLike(value) {
  const raw = String(value || '').split(/[?#]/, 1)[0];
  try {
    return path.posix.basename(new URL(raw).pathname);
  } catch {
    return path.posix.basename(raw.replace(/\\/g, '/'));
  }
}

function isZipUrl(value) {
  return basenameFromUrlLike(value).toLowerCase().endsWith('.zip');
}

function archiveUrlForZip({ baseUrl, tag, artifactDirectory, zipFilename }) {
  if (!baseUrl || !tag || !artifactDirectory || !zipFilename) {
    throw new Error('baseUrl, tag, artifactDirectory, and zipFilename are required.');
  }

  return [
    normalizeBaseUrl(baseUrl),
    'releases',
    encodeURIComponent(tag),
    encodeURIComponent(artifactDirectory),
    encodeURIComponent(zipFilename),
  ].join('/');
}

function requireObject(value, metadataPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${metadataPath} to contain a YAML object.`);
  }
  return value;
}

function resolveZipFilename(updateInfo) {
  const files = Array.isArray(updateInfo.files) ? updateInfo.files : [];
  const zipFiles = files.filter((fileInfo) => fileInfo && isZipUrl(fileInfo.url));

  if (zipFiles.length > 1) {
    throw new Error(`Expected exactly one zip entry in files[], found ${zipFiles.length}.`);
  }

  if (zipFiles.length === 1) {
    return basenameFromUrlLike(zipFiles[0].url);
  }

  if (isZipUrl(updateInfo.path)) {
    return basenameFromUrlLike(updateInfo.path);
  }

  throw new Error('Expected mac update metadata to reference exactly one zip payload.');
}

export function rewriteMacUpdateMetadataToArchiveUrl({
  metadataPath,
  baseUrl,
  tag,
  artifactDirectory,
}) {
  const updateInfo = requireObject(
    yaml.load(readFileSync(metadataPath, 'utf8')),
    metadataPath,
  );
  const zipFilename = resolveZipFilename(updateInfo);
  const url = archiveUrlForZip({
    baseUrl,
    tag,
    artifactDirectory,
    zipFilename,
  });

  if (Array.isArray(updateInfo.files)) {
    updateInfo.files = updateInfo.files.map((fileInfo) => {
      if (!fileInfo || !isZipUrl(fileInfo.url)) {
        return fileInfo;
      }
      return {
        ...fileInfo,
        url,
      };
    });
  }

  if (isZipUrl(updateInfo.path)) {
    updateInfo.path = url;
  }

  writeFileSync(metadataPath, yaml.dump(updateInfo, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  }), 'utf8');

  return { url };
}
