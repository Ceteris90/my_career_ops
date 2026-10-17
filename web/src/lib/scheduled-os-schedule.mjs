// Pure status helpers for the macOS (launchd) and Linux (cron) scan schedule.
// The install scripts write CRON_MARKER on the crontab line they own.
export const CRON_MARKER = "# career-ops recurring scan";

const EMPTY_TASK = { exists: false, enabled: false, status: null, nextRun: null, lastRun: null };

export function parseCrontab(text) {
  const line = String(text).split("\n").map((l) => l.trimEnd()).find((l) => l.endsWith(CRON_MARKER));
  if (line === undefined) return { exists: false, enabled: false };
  return { exists: true, enabled: !line.trimStart().startsWith("#") };
}

export function parseLaunchctlPrint(exitCode) {
  const loaded = exitCode === 0;
  return { exists: loaded, enabled: loaded };
}

// Next */15 boundary strictly after `now`, as an ISO string.
export function nextQuarterHour(now) {
  const next = new Date(now);
  next.setMinutes(15 * (Math.floor(now.getMinutes() / 15) + 1), 0, 0);
  return next.toISOString();
}

export function osScheduleStatus({ platform, crontabText, launchctlExitCode, tickMtimeMs, now }) {
  let parsed;
  if (platform === "linux") parsed = parseCrontab(crontabText);
  else if (platform === "darwin") parsed = parseLaunchctlPrint(launchctlExitCode);
  else return { ...EMPTY_TASK };

  if (!parsed.exists) return { ...EMPTY_TASK };
  const lastRun = typeof tickMtimeMs === "number" ? new Date(tickMtimeMs).toISOString() : null;
  if (!parsed.enabled) return { exists: true, enabled: false, status: "Disabled", nextRun: null, lastRun };
  return { exists: true, enabled: true, status: "Ready", nextRun: nextQuarterHour(now), lastRun };
}
