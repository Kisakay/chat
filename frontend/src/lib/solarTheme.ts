/**
 * "Sunset" theme: follows the browser's local time instead of the OS setting.
 * Day (07:00–19:00 local) -> light, night -> dark. No geolocation needed.
 */

export const SOLAR_DAY_START_HOUR = 7;
export const SOLAR_NIGHT_START_HOUR = 19;

/** True when the given local time falls in the night range (dark theme). */
export function isSolarDark(now: Date = new Date()): boolean {
  const h = now.getHours();
  return h < SOLAR_DAY_START_HOUR || h >= SOLAR_NIGHT_START_HOUR;
}

/** Milliseconds from `now` until the next 07:00 / 19:00 local boundary. */
export function msUntilNextSolarSwitch(now: Date = new Date()): number {
  const next = new Date(now);
  const h = now.getHours();
  if (h < SOLAR_DAY_START_HOUR) {
    next.setHours(SOLAR_DAY_START_HOUR, 0, 0, 0);
  } else if (h < SOLAR_NIGHT_START_HOUR) {
    next.setHours(SOLAR_NIGHT_START_HOUR, 0, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(SOLAR_DAY_START_HOUR, 0, 0, 0);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

/** Resolve a stored theme value to dark/light. `sunset` uses local time. */
export function resolveThemeDark(theme: string, now: Date = new Date()): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  if (theme === "sunset") return isSolarDark(now);
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return false;
}
