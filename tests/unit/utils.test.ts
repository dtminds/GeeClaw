/**
 * Utility Functions Tests
 */
import { beforeEach, describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import { cn, formatDuration, formatRelativeTime, truncate } from '@/lib/utils';

describe('cn (class name merge)', () => {
  it('should merge class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });
  
  it('should handle conditional classes', () => {
    expect(cn('base', 'active')).toBe('base active');
    expect(cn('base', false)).toBe('base');
  });
  
  it('should merge tailwind classes correctly', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });
});

describe('formatDuration', () => {
  it('should format seconds only', () => {
    expect(formatDuration(45)).toBe('45s');
  });
  
  it('should format minutes and seconds', () => {
    expect(formatDuration(125)).toBe('2m 5s');
  });
  
  it('should format hours and minutes', () => {
    expect(formatDuration(3725)).toBe('1h 2m');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
  });

  it('formats relative time in English', () => {
    const result = formatRelativeTime('2024-01-01T11:58:00Z', {
      now: '2024-01-01T12:00:00Z',
      locale: 'en',
      style: 'long',
    });

    expect(result).toContain('2');
    expect(result.toLowerCase()).toContain('minute');
  });

  it('formats relative time in Chinese', () => {
    const result = formatRelativeTime('2024-01-01T11:58:00Z', {
      now: '2024-01-01T12:00:00Z',
      locale: 'zh',
      style: 'long',
    });

    expect(result).toContain('2');
    expect(result).toContain('分钟');
  });

  it('supports Unix timestamps in seconds', () => {
    const result = formatRelativeTime(1704110280, {
      now: 1704110400,
      locale: 'en',
      style: 'short',
    });

    expect(result).toContain('2');
    expect(result.toLowerCase()).toContain('min');
  });

  it('falls back to absolute formatting after the threshold', () => {
    const result = formatRelativeTime('2024-01-01T10:00:00Z', {
      now: '2024-01-02T12:00:00Z',
      locale: 'en',
      absoluteAfterMs: 86_400_000,
      absoluteFormatter: () => 'ABSOLUTE',
    });

    expect(result).toBe('ABSOLUTE');
  });
});

describe('truncate', () => {
  it('should not truncate short text', () => {
    expect(truncate('Hello', 10)).toBe('Hello');
  });
  
  it('should truncate long text with ellipsis', () => {
    expect(truncate('Hello World!', 8)).toBe('Hello...');
  });
});
