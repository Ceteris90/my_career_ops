// tests/freemotion-tool-errors.test.mjs — freemotion-night/tool-errors.mjs: tool calls and failed tool calls
// per job, read from each driver's own log (agy transcript steps, a Claude Code session, a codex exec log).
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\ntool errors — tool calls and failures per job, per driver');

const { agyStats, claudeStats, codexStats } = await import(pathToFileURL(join(ROOT, 'freemotion-night/tool-errors.mjs')).href);
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass(label); else fail(`${label} => ${a}, expected ${e}`);
};

const agySteps = [
  { type: 'USER_INPUT', content: 'Read the file job-3474.md ... <USER_SETTINGS_CHANGE>The user changed setting `Model Selection` from None to Gemini 3.8 Flash (High). No need to comment on this change' },
  { type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'browser_click' }, { name: 'browser_snapshot' }] },
  { type: 'GENERIC', status: 'ERROR', content: 'Invalid arguments for tool "browser_click"' },
  { type: 'GENERIC', status: 'DONE', content: '### Result' },
  { type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'browser_evaluate' }] },
  { type: 'GENERIC', status: 'INVALID', content: 'SyntaxError' },
  { type: 'ERROR_MESSAGE', content: 'model error' },
];
check('agy: calls, failures and the model', agyStats(agySteps), { calls: 3, failed: 3, model: 'Gemini 3.8 Flash (High)' });
check('agy: no model line, model empty', agyStats([{ type: 'PLANNER_RESPONSE', tool_calls: [{}] }]).model, '');

const claude = [
  JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-4-6', content: [{ type: 'tool_use' }] } }),
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true }, { type: 'tool_result' }] } }),
  '{"type":"user","message":{"content":[{"type":"tool_result"', // torn line
  JSON.stringify({ type: 'user', message: { content: 'tool_result mentioned in plain text' } }),
].join('\n');
check('claude: tool results, is_error counted', [claudeStats(claude).calls, claudeStats(claude).failed], [2, 1]);

const codex = [
  JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', status: 'completed' } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', status: 'failed' } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', status: 'completed', exit_code: 1 } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', status: 'completed', exit_code: 0 } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message' } }),
  JSON.stringify({ type: 'item.started', item: { type: 'mcp_tool_call', status: 'in_progress' } }),
].join('\n');
check('codex: tool calls and commands, failed or non-zero exit', [codexStats(codex).calls, codexStats(codex).failed], [4, 2]);
