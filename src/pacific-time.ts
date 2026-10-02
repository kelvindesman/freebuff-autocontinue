/**
 * Pacific Time (America/Los_Angeles) calculation for Freebuff midnight credit refills.
 */

export function getPacificDateTimeParts(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  timeZoneName: string;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    timeZoneName: map.timeZoneName || "PT",
  };
}

export function formatPacificTime(date: Date = new Date()): string {
  const p = getPacificDateTimeParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)} ${p.timeZoneName}`;
}

export function getSecondsUntilPacificMidnight(
  now: Date = new Date(),
  bufferSeconds = 60
): number {
  const p = getPacificDateTimeParts(now);

  // Seconds elapsed today in Pacific time
  const secondsElapsedToday = p.hour * 3600 + p.minute * 60 + p.second;
  const totalSecondsInDay = 86400;

  // Seconds remaining until 00:00:00 Pacific tomorrow + buffer
  let secondsRemaining = totalSecondsInDay - secondsElapsedToday + bufferSeconds;

  if (secondsRemaining <= 0) {
    secondsRemaining = bufferSeconds;
  }
  return secondsRemaining;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}
