export function shouldDisableHardwareAcceleration(argv: string[]): boolean {
  const hasDisableFlag = argv.includes('--disable-gpu');
  const hasEnableFlag = argv.includes('--enable-gpu');

  if (hasEnableFlag) {
    return false;
  }

  return hasDisableFlag;
}
