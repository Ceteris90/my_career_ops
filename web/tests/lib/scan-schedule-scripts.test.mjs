import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const skip = process.platform === "win32";
const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."));
const installScript = path.join(repo, "web", "scripts", "install-scan-schedule.sh");
const uninstallScript = path.join(repo, "web", "scripts", "uninstall-scan-schedule.sh");
const MARKER = "# career-ops recurring scan";
const LABEL = "io.career-ops.scheduled-scan";

const STUBS = {
  uname: 'echo "${FAKE_UNAME:-Linux}"',
  id: `if [ "\${1:-}" = "-u" ]; then echo "\${FAKE_UID:-1000}"; else exit 1; fi`,
  crontab: [
    'echo "$*" >> "$FAKE_CRON.calls"',
    'case "${1:-}" in',
    '  -l) if [ -f "$FAKE_CRON" ]; then cat "$FAKE_CRON"; else echo "no crontab for user" >&2; exit 1; fi ;;',
    '  -) cat > "$FAKE_CRON" ;;',
    '  -r) rm -f "$FAKE_CRON" ;;',
    "esac",
  ].join("\n"),
  launchctl: [
    'echo "$*" >> "$FAKE_LAUNCHCTL_LOG"',
    'if [ "${1:-}" = "print" ]; then exit "${FAKE_PRINT_EXIT:-0}"; fi',
  ].join("\n"),
};

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "co-sched-"));
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  for (const [name, body] of Object.entries(STUBS)) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  const cron = path.join(dir, "crontab");
  const launchctlLog = path.join(dir, "launchctl.log");
  const plist = path.join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const run = (script, env = {}) => {
    const base = { ...process.env };
    // Keep the host's path overrides out of the install under test.
    for (const key of ["CAREER_OPS_ROOT", "CAREER_OPS_DATA_DIR", "CAREER_OPS_SCHEDULED_JOBS_PATH"]) delete base[key];
    const result = spawnSync("sh", [script], {
      encoding: "utf8",
      env: {
        ...base,
        HOME: home,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        FAKE_CRON: cron,
        FAKE_LAUNCHCTL_LOG: launchctlLog,
        ...env,
      },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, out: result.stdout + result.stderr };
  };
  const cronLines = () => fs.readFileSync(cron, "utf8").split("\n").filter(Boolean);
  const cronCalls = () => (fs.existsSync(`${cron}.calls`) ? fs.readFileSync(`${cron}.calls`, "utf8").split("\n").filter(Boolean) : []);
  const launchctlCalls = () => (fs.existsSync(launchctlLog) ? fs.readFileSync(launchctlLog, "utf8").split("\n").filter(Boolean) : []);
  return { dir, cron, plist, run, cronLines, cronCalls, launchctlCalls, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function withSandbox(fn) {
  const sb = sandbox();
  const dataDir = path.join(repo, "data");
  const tick = path.join(dataDir, "scheduled-jobs.json.tick");
  const dataExisted = fs.existsSync(dataDir);
  const tickExisted = fs.existsSync(tick);
  try {
    return fn(sb);
  } finally {
    if (!tickExisted) fs.rmSync(tick, { force: true });
    // Leave a pre-existing data/ alone; remove the one the installer created if still empty.
    if (!dataExisted) {
      try {
        fs.rmdirSync(dataDir);
      } catch {
        // Not empty: something else wrote there, so keep it.
      }
    }
    sb.cleanup();
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

test("linux install writes one marked cron line", { skip }, () => withSandbox((sb) => {
  const result = sb.run(installScript);
  assert.equal(result.status, 0, result.out);
  const lines = sb.cronLines();
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`^\\*/15 \\* \\* \\* \\* cd '${escapeRe(repo)}' && .* ${escapeRe(MARKER)}$`));
  assert.ok(lines[0].includes("scheduled-jobs-runner.mjs"));
  assert.ok(lines[0].includes(`touch '${path.join(repo, "data", "scheduled-jobs.json.tick")}'`), lines[0]);
  assert.ok(!lines[0].includes("CAREER_OPS_"), lines[0]);
}));

test("linux install is idempotent", { skip }, () => withSandbox((sb) => {
  assert.equal(sb.run(installScript).status, 0);
  assert.equal(sb.run(installScript).status, 0);
  assert.equal(sb.cronLines().filter((l) => l.endsWith(MARKER)).length, 1);
}));

test("linux install keeps unrelated cron lines", { skip }, () => withSandbox((sb) => {
  fs.writeFileSync(sb.cron, "0 8 * * * echo hi\n");
  assert.equal(sb.run(installScript).status, 0);
  const lines = sb.cronLines();
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "0 8 * * * echo hi");
  assert.ok(lines[1].endsWith(MARKER));
}));

test("linux install bakes path overrides into the command and moves the tick", { skip }, () => withSandbox((sb) => {
  const store = path.join(sb.dir, "custom", "jobs.json");
  const result = sb.run(installScript, { CAREER_OPS_SCHEDULED_JOBS_PATH: store, CAREER_OPS_DATA_DIR: sb.dir });
  assert.equal(result.status, 0, result.out);
  const [line] = sb.cronLines();
  assert.ok(line.includes(`touch '${store}.tick'`), line);
  assert.ok(line.includes(`CAREER_OPS_SCHEDULED_JOBS_PATH='${store}'`), line);
  assert.ok(line.includes(`CAREER_OPS_DATA_DIR='${sb.dir}'`), line);
  assert.ok(line.includes(`2>>'${path.dirname(store)}/scheduled-jobs.log'`), line);
  assert.ok(fs.statSync(path.dirname(store)).isDirectory());
}));

test("install rejects a path override containing a single quote", { skip }, () => withSandbox((sb) => {
  const result = sb.run(installScript, { CAREER_OPS_DATA_DIR: "/tmp/it's" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /single quote/);
  assert.ok(!fs.existsSync(sb.cron));
}));

test("linux uninstall removes only the marked line", { skip }, () => withSandbox((sb) => {
  fs.writeFileSync(sb.cron, "0 8 * * * echo hi\n");
  assert.equal(sb.run(installScript).status, 0);
  const result = sb.run(uninstallScript);
  assert.equal(result.status, 0, result.out);
  assert.equal(fs.readFileSync(sb.cron, "utf8"), "0 8 * * * echo hi\n");
  assert.match(result.out, /Removed/);
}));

test("linux uninstall with no crontab does nothing", { skip }, () => withSandbox((sb) => {
  const result = sb.run(uninstallScript);
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /not installed/);
  assert.ok(!sb.cronCalls().includes("-"));
  assert.ok(!sb.cronCalls().includes("-r"));
}));

test("macos install writes the plist and bootstraps after bootout", { skip }, () => withSandbox((sb) => {
  const result = sb.run(installScript, { FAKE_UNAME: "Darwin" });
  assert.equal(result.status, 0, result.out);
  const plist = fs.readFileSync(sb.plist, "utf8");
  assert.match(plist, /<key>StartCalendarInterval<\/key>[\s\S]*<integer>0<\/integer>[\s\S]*<integer>15<\/integer>[\s\S]*<integer>30<\/integer>[\s\S]*<integer>45<\/integer>/);
  assert.match(plist, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${escapeRe(repo)}</string>`));
  const calls = sb.launchctlCalls();
  const bootout = calls.findIndex((l) => l.startsWith("bootout "));
  const bootstrap = calls.findIndex((l) => l === `bootstrap gui/1000 ${sb.plist}`);
  assert.ok(bootout >= 0 && bootstrap > bootout, calls.join("\n"));
  assert.equal(sb.cronCalls().length, 0);
}));

test("macos uninstall removes the plist and boots out the job", { skip }, () => withSandbox((sb) => {
  assert.equal(sb.run(installScript, { FAKE_UNAME: "Darwin" }).status, 0);
  const result = sb.run(uninstallScript, { FAKE_UNAME: "Darwin" });
  assert.equal(result.status, 0, result.out);
  assert.ok(!fs.existsSync(sb.plist));
  assert.ok(sb.launchctlCalls().includes(`bootout gui/1000/${LABEL}`));
  assert.match(result.out, /Removed/);
}));

test("install refuses to run as root", { skip }, () => withSandbox((sb) => {
  for (const uname of ["Linux", "Darwin"]) {
    const result = sb.run(installScript, { FAKE_UID: "0", FAKE_UNAME: uname });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not run as root/);
  }
  assert.ok(!fs.existsSync(sb.plist));
  assert.ok(!fs.existsSync(sb.cron));
}));

test("install rejects an unsupported OS without writing", { skip }, () => withSandbox((sb) => {
  const result = sb.run(installScript, { FAKE_UNAME: "FreeBSD" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsupported OS/);
  assert.ok(!fs.existsSync(sb.plist));
  assert.ok(!fs.existsSync(sb.cron));
  assert.equal(sb.launchctlCalls().length, 0);
}));

test("install creates data/ and does not run a tick", { skip }, () => withSandbox((sb) => {
  const tick = path.join(repo, "data", "scheduled-jobs.json.tick");
  const tickExisted = fs.existsSync(tick);
  assert.equal(sb.run(installScript).status, 0);
  assert.ok(fs.statSync(path.join(repo, "data")).isDirectory());
  assert.equal(fs.existsSync(tick), tickExisted);
}));
