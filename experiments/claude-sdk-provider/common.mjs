// Opt-in SDK controls proof. Only synthetic images and in-memory tools; uses Claude plan usage.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Agent } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import extension from './index.ts';
import { createBridge } from './bridge.ts';

const cwd = mkdtempSync(join(tmpdir(), 'pi-sdk-common-'));
const evidence = { fixture: 'real SDK, synthetic images and in-memory Pi tools', controls: [], models: [], executions: 0 };
let provider;
extension({ registerProvider: p => { provider = p; }, on: () => {} });
const model = name => provider.getModels().find(m => m.id === `claude-${name}-5-5`);
const marker = `COMMON_${randomUUID()}`;
const browser = await chromium.launch();
let image;
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 160 } });
  await page.setContent('<style>body{margin:0;display:flex}div{width:160px;height:160px}</style><div style="background:red"></div><div style="background:blue"></div>');
  image = { type: 'image', mimeType: 'image/png', data: (await page.screenshot()).toString('base64') };
} finally { await browser.close(); }
const factory = args => {
  evidence.models.push({ model: args.options.model, thinking: args.options.thinking.type, effort: args.options.effort,
    maxTokens: args.options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, resumed: Boolean(args.options.resume), tools: Object.keys(args.options.mcpServers ?? {}) });
  const run = query({ ...args, options: { ...args.options, maxTurns: 8, maxBudgetUsd: 0.5 } });
  for (const method of ['setModel', 'applyFlagSettings', 'setMaxThinkingTokens']) {
    const original = run[method].bind(run);
    run[method] = async (...values) => { await original(...values); evidence.controls.push({ method, values }); };
  }
  return run;
};
const systemPrompt = 'Synthetic integration check. Follow the requested response format. Remember markers. Never call tools unless explicitly asked. Never retry errors.';
const tools = [{ name: 'probe', label: 'Image probe', description: 'Return the synthetic image.',
  parameters: Type.Object({ label: Type.Literal('image') }, { additionalProperties: false }),
  execute: async () => { evidence.executions++; return { content: [image], details: undefined }; } }];
const sdkResults = [];
const onProviderStreamEvent = event => {
  if (event.type === 'result') sdkResults.push(event);
};
const createAgent = (bridge, selected = model('opus')) => new Agent({ sessionId: 'common-controls', streamFn: bridge.streamSimple,
  onProviderStreamEvent, initialState: { model: selected, systemPrompt, thinkingLevel: 'high', tools } });
let bridge = createBridge(cwd, factory, { persistSession: true });
let agent = createAgent(bridge);
const final = () => agent.state.messages.findLast(m => m.role === 'assistant');
const text = () => final().content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
const check = () => assert.equal(final().stopReason, 'stop', final().errorMessage);
const timer = setTimeout(() => agent.abort(), 240000);
try {
  await agent.prompt([{ role: 'user', timestamp: Date.now(), content: [{ type: 'text', text: `Remember ${marker}. Identify the left and right colors in this image. Reply with both colors and the marker. Do not call tools.` }, image] }]);
  check(); assert.match(text(), /red/i); assert.match(text(), /blue/i); assert(text().includes(marker));
  evidence.imageInput = true;
  agent.state.model = model('sonnet');
  agent.state.thinkingLevel = 'max';
  await agent.prompt('Reply only with the remembered marker. Do not call tools.');
  check(); assert.equal(text(), marker);
  evidence.modelAndEffortSwitch = true;
  const title = await bridge.streamSimple(model('opus'), { messages: [
    { role: 'system', content: 'Produce only a short session title of at most four words, no quotes. Do not use tools.', toolsAdded: tools, timestamp: Date.now() },
    { role: 'user', content: 'We are testing SDK integration and image inputs.', timestamp: Date.now() },
  ] }, { reasoning: 'minimal', maxTokens: 120, timeoutMs: 60000 }).result();
  assert.equal(title.stopReason, 'stop', title.errorMessage);
  assert(title.content.some(b => b.type === 'text' && b.text.trim()));
  assert.equal(evidence.executions, 0);
  evidence.independentTitle = true;
  agent.state.model = model('haiku');
  agent.state.thinkingLevel = 'low';
  await agent.prompt('Call probe exactly once with {"label":"image"}, then identify the left and right colors in its returned image. Do not retry.');
  check(); assert.match(text(), /red/i); assert.match(text(), /blue/i);
  assert.equal(evidence.executions, 1);
  evidence.imageToolResult = true;
  for (const level of ['off', 'medium']) {
    agent.state.thinkingLevel = level;
    await agent.prompt('Reply only with the original remembered marker. Do not call tools.');
    check(); assert.equal(text(), marker);
  }
  evidence.thinkingOffAndBackOn = true;
  const checkpoint = bridge.checkpoint();
  assert(checkpoint);
  const history = structuredClone(agent.state.messages);
  bridge.close();
  bridge = createBridge(cwd, factory, { persistSession: true, checkpoint });
  agent = createAgent(bridge, model('haiku'));
  agent.state.thinkingLevel = 'low';
  agent.state.messages = history;
  await agent.prompt('Reply only with the original remembered marker. Do not call tools.');
  check(); assert.equal(text(), marker);
  assert.equal(evidence.executions, 1);
  evidence.completedCheckpointResume = true;
  const assistants = agent.state.messages.filter(m => m.role === 'assistant');
  const sdk = sdkResults.at(-1);
  evidence.piCost = assistants.reduce((sum, m) => sum + m.usage.cost.total, 0);
  evidence.sdkCost = sdk.total_cost_usd;
  assert(Math.abs(evidence.piCost - evidence.sdkCost) < 1e-10);
  evidence.piTokens = Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite'].map(key => [key, assistants.reduce((sum, m) => sum + m.usage[key], 0)]));
  evidence.sdkTokens = Object.values(sdk.modelUsage).reduce((total, usage) => ({ input: total.input + usage.inputTokens,
    output: total.output + usage.outputTokens, cacheRead: total.cacheRead + usage.cacheReadInputTokens,
    cacheWrite: total.cacheWrite + usage.cacheCreationInputTokens }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(evidence.piTokens, evidence.sdkTokens);
  evidence.pass = true;
} catch (error) {
  evidence.pass = false;
  evidence.error = error.message;
  throw error;
} finally {
  clearTimeout(timer); bridge.close();
  const path = join(cwd, 'evidence.json');
  writeFileSync(path, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...evidence, evidencePath: path }, null, 2));
}
