/**
 * Utility Functions
 * Common utility functions for the application
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import i18n from '@/i18n';

/**
 * Merge class names with Tailwind CSS classes
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function toValidDate(value: number | string | Date): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateFromTimestamp(value: number | string | Date): Date | null {
  if (value instanceof Date) {
    return toValidDate(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return toValidDate(value < 1e12 ? value * 1000 : value);
  }

  return toValidDate(value);
}

export function formatShortDateTime(value: number | string | Date): string {
  const date = toValidDate(value);
  if (!date) return '';

  const now = new Date();
  const sameYear = now.getFullYear() === date.getFullYear();
  const sameMonth = now.getMonth() === date.getMonth();
  const sameDate = now.getDate() === date.getDate();

  if (sameYear && sameMonth && sameDate) {
    return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
  }

  if (sameYear) {
    return `${padTwo(date.getMonth() + 1)}/${padTwo(date.getDate())}`;
  }

  return `${padTwo(date.getFullYear() % 100)}/${padTwo(date.getMonth() + 1)}/${padTwo(date.getDate())}`;
}

/**
 * Format relative time with locale-aware Intl.RelativeTimeFormat.
 * Supports Date values, ISO strings, and Unix timestamps in seconds or milliseconds.
 */
export interface FormatRelativeTimeOptions {
  locale?: string;
  now?: number | string | Date;
  style?: Intl.RelativeTimeFormatStyle;
  numeric?: Intl.RelativeTimeFormatNumeric;
  absoluteAfterMs?: number;
  absoluteFormatter?: (date: Date, locale: string) => string;
}

export function formatRelativeTime(
  value: number | string | Date,
  options: FormatRelativeTimeOptions = {},
): string {
  const date = toDateFromTimestamp(value);
  const locale = options.locale
    || i18n.resolvedLanguage
    || i18n.language
    || (typeof navigator !== 'undefined' ? navigator.language : 'en');

  if (!date) return '';

  const now = toDateFromTimestamp(options.now ?? new Date()) ?? new Date();
  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);

  if (typeof options.absoluteAfterMs === 'number' && absMs >= options.absoluteAfterMs) {
    return options.absoluteFormatter
      ? options.absoluteFormatter(date, locale)
      : date.toLocaleDateString(locale);
  }

  const style = options.style ?? 'long';
  const numeric = options.numeric ?? 'auto';
  const rtf = new Intl.RelativeTimeFormat(locale, { style, numeric });

  const divisions: Array<{ amount: number; unit: Intl.RelativeTimeFormatUnit }> = [
    { amount: 1000, unit: 'second' },
    { amount: 60, unit: 'minute' },
    { amount: 60, unit: 'hour' },
    { amount: 24, unit: 'day' },
    { amount: 7, unit: 'week' },
    { amount: 4.34524, unit: 'month' },
    { amount: 12, unit: 'year' },
  ];

  let duration = diffMs;
  for (let index = 0; index < divisions.length; index += 1) {
    const current = divisions[index];
    const next = divisions[index + 1];
    if (!next || Math.abs(duration) < current.amount * next.amount) {
      return rtf.format(Math.round(duration / current.amount), current.unit);
    }
    duration /= current.amount;
  }

  return rtf.format(Math.round(duration), 'year');
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

/**
 * Delay for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + '...';
}
