import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareCliInput } from "../../src/lib/cli-input.mjs";
import { spawnHeadlessCli } from "../../src/lib/spawn-cli.mjs";
import { CAPS } from "../../src/lib/worker-capabilities.mjs";

test("AGY receives literal Unicode, newlines and shell-looking text as one stdin turn", () => {
  const prompt = 'Résumé 🧠\n"quoted" `literal` $(not-a-command)\\path\n--input-format';
  for (const flag of ["-p", "--print", "--prompt"]) {
    const args = ["--dangerously-skip-permissions", "--output-format", "stream-json", flag, prompt];
    const result = prepareCliInput("antigravity", args);
    assert.deepEqual(result.args, ["--dangerously-skip-permissions", "--output-format", "stream-json", "--input-format", "stream-json"]);
    assert.equal(result.stdin.split("\n").length, 2);
    assert.deepEqual(JSON.parse(result.stdin), { event: "user", message: { content: prompt } });
    assert.equal(args.at(-1), prompt, "the caller's argv is unchanged");
  }
});

test("other CLIs, AGY plain output and already-streaming input are unchanged", () => {
  for (const [id, args] of [
    ["codex", ["exec", "--json", "PROMPT"]],
    ["claude", ["--output-format", "stream-json", "-p", "PROMPT"]],
    ["antigravity", ["-p", "PROMPT"]],
    ["antigravity", ["--input-format", "stream-json", "--output-format", "stream-json"]],
  ]) assert.deepEqual(prepareCliInput(id, args), { args, stdin: null });
});

test("a long chat crosses the real process boundary intact without a long command line", { timeout: 10000 }, async () => {
  const prompt = 'Résumé 🧠 "quotes" \\path\n'.repeat(15000);
  const script = `let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{const content=JSON.parse(input).message.content;process.stdout.write(JSON.stringify({argv:process.argv.slice(1),length:content.length,hash:require('node:crypto').createHash('sha256').update(content).digest('hex')}));});`;
  const child = spawnHeadlessCli(process.execPath, ["-e", script, "--", "--output-format", "stream-json", "-p", prompt], {
    env: process.env,
  }, { cliId: "antigravity", capabilities: CAPS.localReadOnly });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => stdout += chunk);
  child.stderr.on("data", chunk => stderr += chunk);
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(code, 0, stderr);
  const result = JSON.parse(stdout);
  assert.equal(result.length, prompt.length);
  assert.equal(result.hash, createHash("sha256").update(prompt).digest("hex"));
  assert.deepEqual(result.argv, ["--output-format", "stream-json", "--input-format", "stream-json"]);
});
