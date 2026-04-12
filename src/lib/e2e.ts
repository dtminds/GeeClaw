function hasWindowLocation(): boolean {
  return typeof window !== 'undefined' && typeof window.location !== 'undefined';
}

function readFlag(name: string): boolean {
  if (!hasWindowLocation()) {
    return false;
  }

  return new URLSearchParams(window.location.search).get(name) === '1';
}

export function isGeeClawE2E(): boolean {
  return readFlag('e2e');
}

export function shouldSkipE2ESetup(): boolean {
  return isGeeClawE2E() && readFlag('skipSetup');
}

export function shouldSkipE2ELogin(): boolean {
  return isGeeClawE2E() && readFlag('skipLogin');
}

export function shouldSkipE2EProvider(): boolean {
  return isGeeClawE2E() && readFlag('skipProvider');
}
