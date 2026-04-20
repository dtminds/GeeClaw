import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

function parseYamlValueLine(line) {
  const match = line.match(/^(\s*(?:-\s*)?(?:url|path):\s*)(['"]?)([^'"\r\n]+)(\2)(\s*)$/);
  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    quote: match[2],
    value: match[3],
    suffix: match[5],
  };
}

function resolveZipFilename(text, metadataPath) {
  const zipBasenames = new Set();

  for (const line of text.split('\n')) {
    const parsed = parseYamlValueLine(line);
    if (!parsed || !isZipUrl(parsed.value)) {
      continue;
    }

    zipBasenames.add(basenameFromUrlLike(parsed.value));
  }

  if (zipBasenames.size !== 1) {
    throw new Error(`Expected ${metadataPath} to reference exactly one zip payload, found ${zipBasenames.size}.`);
  }

  return [...zipBasenames][0];
}

function rewriteZipReferences(text, url) {
  return text
    .split('\n')
    .map((line) => {
      const parsed = parseYamlValueLine(line);
      if (!parsed || !isZipUrl(parsed.value)) {
        return line;
      }

      return `${parsed.prefix}${parsed.quote}${url}${parsed.quote}${parsed.suffix}`;
    })
    .join('\n');
}

export function rewriteMacUpdateMetadataToArchiveUrl({
  metadataPath,
  baseUrl,
  tag,
  artifactDirectory,
}) {
  const metadataText = readFileSync(metadataPath, 'utf8');
  const zipFilename = resolveZipFilename(metadataText, metadataPath);
  const url = archiveUrlForZip({
    baseUrl,
    tag,
    artifactDirectory,
    zipFilename,
  });
  const rewrittenText = rewriteZipReferences(metadataText, url);

  writeFileSync(metadataPath, rewrittenText, 'utf8');

  return { url };
}
