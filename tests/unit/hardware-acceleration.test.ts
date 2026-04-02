import { describe, expect, it } from 'vitest';
import { shouldDisableHardwareAcceleration } from '../../electron/main/hardware-acceleration';

describe('shouldDisableHardwareAcceleration', () => {
  it('enables GPU by default', () => {
    expect(shouldDisableHardwareAcceleration([])).toBe(false);
  });

  it('disables GPU when the explicit opt-out flag is present', () => {
    expect(shouldDisableHardwareAcceleration(['--disable-gpu'])).toBe(true);
  });

  it('lets the explicit enable flag win if both flags are present', () => {
    expect(shouldDisableHardwareAcceleration(['--disable-gpu', '--enable-gpu'])).toBe(false);
  });
});
