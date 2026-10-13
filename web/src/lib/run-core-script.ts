import { execFile } from "node:child_process";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { parseCliJson, trackerRowArg } from "@/lib/status-cli.mjs";
import { coreScriptHttp } from "@/lib/core-script-result.mjs";

const TIMEOUT_MS = 30_000;
const LOCK_WAIT_DEFAULT_MS = 10_000;
const LOCK_WAIT_CEILING_MS = 25_000;

type CliResult = {
  code: number;
  stdout: string;
  stderr: string;
  spawnFailed: boolean;
  timedOut: boolean;
};

function boundedLockEnv(): Record<string, string> {
  const raw = Number(process.env.CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS);
  const requested = Number.isFinite(raw) && raw > 0 ? raw : LOCK_WAIT_DEFAULT_MS;
  const wait = String(Math.min(requested, LOCK_WAIT_CEILING_MS));
  return {
    CAREER_OPS_TRACKER_LOCK_TIMEOUT_MS: wait,
    CAREER_OPS_FOLLOWUPS_LOCK_TIMEOUT_MS: wait,
  };
}

function runCoreScript(scriptName: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [rootScript(scriptName), ...args],
      {
        cwd: careerOpsRoot(),
        timeout: TIMEOUT_MS,
        env: { ...process.env, ...boundedLockEnv() },
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const timedOut = e?.killed === true;
        const code = typeof e?.code === "number" ? e.code : e ? -1 : 0;
        resolve({
          code,
          stdout: stdout || "",
          stderr: stderr || "",
          spawnFailed: !timedOut && code === -1,
          timedOut,
        });
      },
    );
  });
}

export function digitArg(value: unknown): string | null {
  return trackerRowArg(value);
}

export async function postCoreScript(opts: {
  script: string;
  args: string[];
  logLabel: string;
  fallback: string;
}): Promise<NextResponse> {
  if (!fs.existsSync(rootScript(opts.script))) {
    return NextResponse.json(
      { error: `${opts.logLabel} needs the career-ops scripts`, code: "core-script-missing" },
      { status: 503 },
    );
  }
  const result = await runCoreScript(opts.script, opts.args);
  if (result.spawnFailed) {
    console.error(`/${opts.logLabel}: failed to run: ${result.stderr.trim()}`);
    return NextResponse.json({ error: opts.fallback }, { status: 500 });
  }
  if (result.timedOut) {
    return NextResponse.json(
      { error: `${opts.logLabel} timed out` },
      { status: 504, headers: { "Retry-After": "5" } },
    );
  }
  const parsed = parseCliJson(result.stdout);
  if (result.code !== 0 && result.code !== 1) {
    console.error(`/${opts.logLabel}: exit ${result.code}: ${result.stderr.trim()}`);
  }
  const mapped = coreScriptHttp({ code: result.code, parsed, fallback: opts.fallback });
  return NextResponse.json(mapped.body, { status: mapped.status });
}
