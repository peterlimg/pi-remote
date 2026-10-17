// Opt-in live SDK reproduction. Uses local login, no tools, and only public documentation text.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { sdkEnvironment } from './bridge.ts';

const evidence = mkdtempSync(join(tmpdir(), 'pi-sdk-billing-repro-'));
const sdk = JSON.parse(readFileSync(new URL('./package.json', import.meta.resolve('@anthropic-ai/claude-agent-sdk')), 'utf8'));
const first = 'providers (docs/custom-provider.md)', second = 'pi packages (docs/packages.md)';
const result = { sdkVersion: sdk.version, cliVersion: sdk.claudeCodeVersion, pass: false, cases: [] };
console.log('Evidence: ' + evidence);
async function probe(name, systemPrompt) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
  const row = { name, systemPrompt, markerMatched: false, extraUsageRejected: false, toolRequests: 0 };
  let run;
  async function* input() {
    yield { type: 'user', session_id: '', parent_tool_use_id: null, client_composed: true,
      message: { role: 'user', content: [{ type: 'text', text: 'Reply exactly SDK_SESSION_OK. Do not use tools.' }] } };
  }
  try {
    run = query({ prompt: input(), options: {
      cwd: evidence, model: 'claude-sonnet-5-5', systemPrompt,
      env: { ...sdkEnvironment(), CLAUDE_CODE_MAX_OUTPUT_TOKENS: '16000' },
      tools: [], strictMcpConfig: true, settingSources: [], persistSession: false,
      abortController: controller, maxTurns: 1, thinking: { type: 'disabled' }, effort: 'low',
      settings: { disableAllHooks: true, autoMemoryEnabled: false, autoCompactEnabled: false, idleCompaction: false },
      canUseTool: async () => { row.toolRequests++; return { behavior: 'deny', message: 'No tools in this diagnostic.' }; },
    } });
    for await (const event of run) {
      if (event.type === 'system' && event.subtype === 'init') {
        assert.equal(event.apiKeySource, 'none'); assert.deepEqual(event.tools, []);
      }
      if (event.type === 'assistant') {
        const content = event.message?.content ?? [];
        assert(!content.some(block => block.type === 'tool_use'));
        const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n');
        if (event.error) {
          row.errorType = event.error;
          row.extraUsageRejected = text.includes('Third-party apps now draw from extra usage, not plan limits.');
        } else row.markerMatched ||= text.trim() === 'SDK_SESSION_OK';
      }
      if (event.type === 'result') { row.terminalSubtype = event.subtype; break; }
    }
    assert.equal(row.toolRequests, 0);
  } finally {
    controller.abort(); run?.close(); clearTimeout(timer);
    result.cases.push(row);
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(row));
  }
  return row;
}
try {
  const before = await probe('first reference alone', first);
  const combined = await probe('same references together', first + ', ' + second);
  const after = await probe('second reference alone', second);
  assert(before.markerMatched && after.markerMatched, 'Control requests failed; the comparison is inconclusive.');
  assert(combined.markerMatched, combined.extraUsageRejected
    ? 'The SDK rejected the combined documentation references with the reported extra-usage error, while both controls succeeded.'
    : 'The combined request did not return the diagnostic marker.');
  result.pass = true;
} catch (error) {
  result.error = error.name === 'AssertionError' ? error.message : 'The SDK diagnostic did not complete.';
  process.exitCode = 1;
} finally {
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...result, evidencePath: evidence }, null, 2));
}
