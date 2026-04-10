import fs from 'node:fs';

export function cleanDirectorySync(outputDir, fsImpl = fs) {
  if (fsImpl.existsSync(outputDir)) {
    fsImpl.rmSync(outputDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
  fsImpl.mkdirSync(outputDir, { recursive: true });
}
