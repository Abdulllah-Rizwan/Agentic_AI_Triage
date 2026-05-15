/**
 * Parse a datetime string returned by the FastAPI backend.
 *
 * The server stores timestamps with datetime.utcnow() (tz-naive UTC).
 * Pydantic serialises these as ISO strings without a timezone indicator,
 * e.g. "2024-01-15T10:30:00". JavaScript's Date() treats such strings as
 * *local* time, which causes a UTC+5 user to see timestamps shifted 5 hours
 * into the past. Appending "Z" forces UTC interpretation.
 */
export function parseAPIDate(s: string | null | undefined): Date {
  if (!s) return new Date(NaN);
  // Already has timezone info — leave it alone.
  if (/[Zz]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  return new Date(s + "Z");
}
