/**
 * Shared "time ago" utility.
 *
 * ClickHouse returns timestamps in UTC but without a timezone suffix
 * (e.g. "2026-03-31 21:15:00"). Without the trailing 'Z', browsers
 * interpret the string as LOCAL time, which causes a +5:30 offset in IST.
 *
 * This function normalizes the timestamp to UTC before computing the diff.
 */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';

  // Normalize ClickHouse UTC timestamps — append 'Z' if no timezone info
  let normalized = dateStr.trim();
  if (!/[Z+\-]\d{0,4}:?\d{0,2}$/.test(normalized)) {
    // Replace space between date and time with 'T', then append 'Z'
    normalized = normalized.replace(' ', 'T') + 'Z';
  }

  const diff = Date.now() - new Date(normalized).getTime();
  if (isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
