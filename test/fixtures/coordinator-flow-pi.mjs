#!/usr/bin/env node
// Fault-controlled Pi RPC boundary, not a model or a replacement task state machine.
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseTaskInput } from '../../src/task-input.mjs';

const file = process.argv[process.argv.indexOf('--session') + 1];
const header = JSON.parse(readFileSync(file, 'utf8').split('\n')[0]);
const root = process.env.PI_FORMAL_ROOT, scenario = process.env.PI_FORMAL_SCENARIO;
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const reply = (command, success = true, data = {}) => send({ type: 'response', id: command.id, command: command.type,
  success, ...(success ? { data } : { error: 'Injected instruction acknowledgement failure' }) });
let active = false, prompts = 0, run, originalGeneration;
let parentId = readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).at(-1).id;
const persist = message => {
  const id = randomUUID(); appendFileSync(file, JSON.stringify({ type: 'message', id, parentId, timestamp: new Date().toISOString(), message }) + '\n'); parentId = id;
};
const gate = async name => {
  const deadline = Date.now() + 15000;
  while (!existsSync(join(root, name))) {
    if (Date.now() >= deadline) throw new Error('Formal RPC gate timed out: ' + name);
    await delay(5);
  }
};
const post = async input => {
  const response = await fetch(process.env.PI_REMOTE_COORDINATOR_URL + '/_pi/coordinator', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.PI_REMOTE_COORDINATOR_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: createHash('sha256').update(randomUUID()).digest('hex'), ...input })
  });
  return response.json();
};
const report = async () => { if (!(await post({ kind: 'result', text: 'Formal fixture result.', generation: run.generation })).ok) throw new Error('Fixture result was not accepted'); };
const commands = createInterface({ input: process.stdin });
commands.on('line', line => { void (async () => {
  const command = JSON.parse(line);
  if (command.type === 'get_state') {
    reply(command, true, { sessionId: header.id, sessionFile: file, isStreaming: active, isCompacting: false,
      model: { provider: 'formal', id: 'fixture', name: 'Formal RPC fixture' }, thinkingLevel: 'off' });
  } else if (command.type === 'prompt') {
    prompts++; active = true; run = parseTaskInput(command.message);
    persist({ role: 'user', content: [{ type: 'text', text: command.message }], timestamp: Date.now() });
    send({ type: 'agent_start' });
    if (!(await post({ kind: 'receipt', generation: run.generation, inputIds: run.inputIds })).ok) throw new Error('Fixture receipt was not accepted');
    if (scenario.startsWith('recovery-')) {
      if (prompts === 1) {
        originalGeneration = run.generation;
        if (scenario === 'recovery-effects') persist({ role: 'assistant', content: [{ type: 'toolCall', id: 'uncertain-tool', name: 'bash', arguments: { command: 'outside action' } }], stopReason: 'toolUse', timestamp: Date.now() });
      } else if (scenario !== 'recovery-budget') {
        const stale = await post({ kind: 'result', generation: originalGeneration, text: 'Old attempt result.' });
        writeFileSync(join(root, 'stale-result.json'), JSON.stringify(stale));
        if (!stale.ok) await report();
      }
      active = false; send({ type: 'agent_end' }); send({ type: 'agent_settled' }); reply(command);
    } else if (scenario === 'accepted-stop-ack') {
      if (prompts > 1) await report();
      reply(command);
    } else if (['accepted-prompt-failure', 'accepted-prompt-ack'].includes(scenario)) {
      await report(); await gate('prompt.reply'); reply(command, scenario === 'accepted-prompt-ack'); active = false;
      send({ type: 'agent_end' }); send({ type: 'agent_settled' });
    } else {
      await gate('prompt.finish'); reply(command);
    }
  } else if (command.type === 'clear_queue') reply(command);
  else if (command.type === 'abort') {
    await gate('abort.reply'); active = false;
    send({ type: 'agent_end' }); send({ type: 'agent_settled' }); reply(command);
  } else if (command.type === 'get_session_stats') reply(command, true, { tokens: {}, cost: 0 });
  else reply(command);
})().catch(error => { console.error(error.message); process.exitCode = 1; commands.close(); }); });
