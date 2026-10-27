import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBash } from './helpers.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NODE = process.execPath;

function runNode(args, env) {
  return spawnSync(NODE, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, CAREER_OPS_PDF_SHARED: '', ...env },
  });
}

test('build-cv-html self-test does not load Playwright', () => {
  const marker = join(tmpdir(), `playwright-marker-${process.pid}.txt`);
  rmSync(marker, { force: true });
  const result = runNode([
    '--import', join(ROOT, 'tests/helpers/block-playwright-register.mjs'),
    'build-cv-html.mjs',
    '--test',
  ], { PLAYWRIGHT_MARKER: marker });
  const loaded = (() => {
    try { return readFileSync(marker, 'utf8'); } catch { return ''; }
  })();
  rmSync(marker, { force: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(loaded, '', 'build-cv-html loaded Playwright');
});

test('one shared browser paints two documents', async () => {
  const serverMod = await import(new URL('../lib/pdf-server.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-pdf-shared-'));
  const socketPath = join(dir, 'pdf.sock');
  let launches = 0;
  const server = await serverMod.startPdfServer({
    socketPath,
    launchBrowser: async () => {
      launches += 1;
      return { async close() {} };
    },
    render: async (_browser, html, outputPath) => {
      writeFileSync(outputPath, html);
      return { outputPath, pageCount: 1, size: Buffer.byteLength(html) };
    },
  });
  try {
    const first = await serverMod.requestPdfRender(socketPath, {
      html: '<p>one</p>',
      outputPath: join(dir, 'one.pdf'),
      opts: {},
    });
    const second = await serverMod.requestPdfRender(socketPath, {
      html: '<p>two</p>',
      outputPath: join(dir, 'two.pdf'),
      opts: {},
    });
    assert.equal(launches, 1);
    assert.equal(first.pageCount, 1);
    assert.equal(second.size, Buffer.byteLength('<p>two</p>'));
    assert.equal(readFileSync(join(dir, 'one.pdf'), 'utf8'), '<p>one</p>');
    assert.equal(readFileSync(join(dir, 'two.pdf'), 'utf8'), '<p>two</p>');
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('renderHtmlToPdf uses the shared browser when the batch asks it to', async () => {
  const serverMod = await import(new URL('../lib/pdf-server.mjs', import.meta.url));
  const { renderHtmlToPdf } = await import(new URL('../generate-pdf.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-pdf-delegate-'));
  const socketPath = join(dir, 'pdf.sock');
  let launches = 0;
  const seen = [];
  const server = await serverMod.startPdfServer({
    socketPath,
    launchBrowser: async () => {
      launches += 1;
      return { async close() {} };
    },
    render: async (_browser, html, outputPath, opts) => {
      seen.push(opts.reportNum);
      writeFileSync(outputPath, 'shared-pdf');
      return { outputPath, pageCount: 1, size: 10 };
    },
  });
  const previousShared = process.env.CAREER_OPS_PDF_SHARED;
  const previousSocket = process.env.CAREER_OPS_PDF_SOCKET;
  process.env.CAREER_OPS_PDF_SHARED = '1';
  process.env.CAREER_OPS_PDF_SOCKET = socketPath;
  try {
    const workspace = join(ROOT, 'output');
    mkdirSync(workspace, { recursive: true });
    const outputPath = join(workspace, `shared-delegate-${process.pid}.pdf`);
    const result = await renderHtmlToPdf('<html><body><p>Casey Example</p></body></html>', outputPath, {
      reportNum: '404',
      workspaceRoot: ROOT,
      baseDir: workspace,
    });
    assert.equal(launches, 1);
    assert.deepEqual(seen, ['404']);
    assert.equal(result.pageCount, 1);
    assert.equal(readFileSync(outputPath, 'utf8'), 'shared-pdf');
    rmSync(outputPath, { force: true });
  } finally {
    if (previousShared === undefined) delete process.env.CAREER_OPS_PDF_SHARED;
    else process.env.CAREER_OPS_PDF_SHARED = previousShared;
    if (previousSocket === undefined) delete process.env.CAREER_OPS_PDF_SOCKET;
    else process.env.CAREER_OPS_PDF_SOCKET = previousSocket;
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function runOneOffer(skipPdf) {
  const dir = mkdtempSync(join(tmpdir(), 'career-ops-batch-pdf-'));
  const batchDir = join(dir, 'batch');
  const binDir = join(dir, 'bin');
  mkdirSync(batchDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(dir, 'reports'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(batchDir, 'batch-runner.sh'), readFileSync(join(ROOT, 'batch/batch-runner.sh')));
  chmodSync(join(batchDir, 'batch-runner.sh'), 0o755);
  writeFileSync(join(batchDir, 'batch-prompt.md'), 'Fixture prompt for {{URL}}\n');
  writeFileSync(join(batchDir, 'batch-input.tsv'), 'id\turl\tsource\tnotes\n1\thttps://example.com/roles/1\tfixture\t-\n');
  writeFileSync(join(dir, 'reserve-report-num.mjs'), [
    "import { readFileSync, writeFileSync, existsSync } from 'node:fs';",
    "if (!process.argv.includes('--release')) {",
    "  const n = (existsSync('counter.txt') ? parseInt(readFileSync('counter.txt', 'utf8'), 10) : 0) + 1;",
    "  writeFileSync('counter.txt', String(n));",
    "  console.log(String(n).padStart(3, '0'));",
    "}",
  ].join('\n') + '\n');
  for (const script of ['merge-tracker', 'reconcile-pipeline', 'verify-pipeline']) {
    writeFileSync(join(dir, `${script}.mjs`), '');
  }
  writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nexit 1\n');
  writeFileSync(join(binDir, 'claude'), `#!/usr/bin/env bash
printf '%s\\n' "\${CAREER_OPS_PDF_SHARED-unset}" > "$FIXTURE_DIR/pdf-shared"
exit 0
`);
  chmodSync(join(binDir, 'curl'), 0o755);
  chmodSync(join(binDir, 'claude'), 0o755);
  const args = ['--max-retries', '0', '--parallel', '1'];
  if (skipPdf) args.push('--skip-pdf');
  const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH}`, FIXTURE_DIR: dir };
  delete env.CAREER_OPS_PDF_SHARED;
  try {
    const result = spawnSync(getBash(), [join(batchDir, 'batch-runner.sh'), ...args], {
      cwd: dir,
      env,
      encoding: 'utf8',
      timeout: 40_000,
    });
    const recorded = (() => {
      try { return readFileSync(join(dir, 'pdf-shared'), 'utf8').trim(); } catch { return ''; }
    })();
    return { status: result.status, stderr: result.stderr, stdout: result.stdout, recorded };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('batch runner shares one PDF browser across offers', () => {
  const shared = runOneOffer(false);
  assert.equal(shared.status, 0, shared.stderr || shared.stdout);
  assert.equal(shared.recorded, '1');
  const skipped = runOneOffer(true);
  assert.equal(skipped.status, 0, skipped.stderr || skipped.stdout);
  assert.equal(skipped.recorded, 'unset');
});

test('the painter socket sits in a directory only this user can open', { skip: process.platform === 'win32' && 'named pipes, no socket directory' }, async () => {
  const serverMod = await import(new URL('../lib/pdf-server.mjs', import.meta.url));
  const base = mkdtempSync(join(tmpdir(), 'career-ops-pdf-dir-'));
  const saved = { TMPDIR: process.env.TMPDIR, SOCKET: process.env.CAREER_OPS_PDF_SOCKET };
  process.env.TMPDIR = base;
  delete process.env.CAREER_OPS_PDF_SOCKET;
  try {
    const socketPath = serverMod.sharedPdfSocketPath('/example/career-ops');
    assert.ok(socketPath.startsWith(base), socketPath);
    // A unix socket path is capped near 104 bytes and the macOS temp dir is about 50.
    assert.ok(socketPath.length - base.length <= 40, `name under the temp dir is short: ${socketPath.slice(base.length)}`);
    const dir = statSync(dirname(socketPath));
    assert.equal(dir.mode & 0o077, 0, 'no group or other access');
    assert.equal(dir.uid, process.getuid());

    // A directory another user could write (or pre-create) is refused, so the
    // CV HTML never goes to a socket someone else planted there.
    chmodSync(dirname(socketPath), 0o777);
    assert.throws(() => serverMod.sharedPdfSocketPath('/example/career-ops'), (err) => err.code === 'PDF_SERVER_UNAVAILABLE');
  } finally {
    if (saved.TMPDIR === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved.TMPDIR;
    if (saved.SOCKET !== undefined) process.env.CAREER_OPS_PDF_SOCKET = saved.SOCKET;
    rmSync(base, { recursive: true, force: true });
  }
});
