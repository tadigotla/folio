import { formatInTimeZone } from 'date-fns-tz';
import { formatDistanceToNowStrict } from 'date-fns';

const TZ = 'America/New_York';

/** Current time as UTC ISO string */
export function nowUTC(): string {
  return new Date().toISOString();
}

/** Format a UTC ISO string for display in America/New_York */
export function toLocal(utcIso: string, fmt: string = 'h:mm a'): string {
  return formatInTimeZone(utcIso, TZ, fmt);
}

/** Format a UTC ISO string as date + time in local time */
export function toLocalDateTime(utcIso: string): string {
  return formatInTimeZone(utcIso, TZ, 'EEE, MMM d h:mm a');
}

/** "in 12 min", "3 hours ago", etc. */
export function relativeTime(utcIso: string): string {
  return formatDistanceToNowStrict(new Date(utcIso), { addSuffix: true });
}

/** Format a duration in seconds as "M:SS" or "H:MM:SS". Returns null if input is nullish. */
export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export { TZ };
