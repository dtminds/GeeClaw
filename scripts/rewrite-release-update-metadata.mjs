import { rewriteMacUpdateMetadataToArchiveUrl } from './lib/release-update-metadata.mjs';

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    throw new Error(`Missing required flag: ${name}`);
  }
  return process.argv[index + 1];
}

try {
  const result = rewriteMacUpdateMetadataToArchiveUrl({
    metadataPath: readFlag('--metadata'),
    baseUrl: readFlag('--base-url'),
    tag: readFlag('--tag'),
    artifactDirectory: readFlag('--artifact-directory'),
  });

  console.log(`Rewrote update metadata to ${result.url}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
