import { config } from "../config.ts";

/** Concise per-driver debug logging to stdout (toggle with DRIVER_DEBUG). */
export function driverLog(driver: string, msg: string): void {
  if (!config.driverDebug) return;
  const t = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  console.log(`[${t}][driver:${driver}] ${msg}`);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  return `${(n / 1024).toFixed(1)}KB`;
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
