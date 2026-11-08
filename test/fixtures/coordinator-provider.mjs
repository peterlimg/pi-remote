import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getCurrentTools } from '@earendil-works/pi-ai';
import { parseTaskInput, taskInputText } from '../../src/task-input.mjs';

export default function verificationProvider(pi) {
  const root = process.env.PI_COORDINATOR_FIXTURE_ROOT;
  if (!root || JSON.parse(readFileSync(join(root, '.coordinator-fixture.json'), 'utf8')).version !== 1) throw new Error('An isolated coordinator fixture is required.');
  const role = process.env.PI_REMOTE_COORDINATOR_ROLE || 'session';
  const audit = value => appendFileSync(join(root, 'provider.jsonl'), JSON.stringify({ ...value, pid: process.pid, role, at: Date.now() }) + '\n');
  const text = message => typeof message?.content === 'string' ? message.content : (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  let sequence = 0;
  pi.on('session_start', () => audit({ kind: 'boot', cwd: process.cwd() }));
  pi.registerProvider('coordinator-fixture', {
    api: 'coordinator-fixture', apiKey: 'fixture-only-no-network', baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'fixture', name: 'Coordinator verification model', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 3000 }],
    streamSimple(model, context, options = {}) {
      const messages = context.messages, index = messages.findLastIndex(message => message.role === 'user');
      const envelope = parseTaskInput(text(messages[index]));
      const input = envelope ? taskInputText(envelope) : text(messages[index]), results = messages.slice(index + 1).filter(message => message.role === 'toolResult');
      const original = messages.filter(message => message.role === 'user').map(message => parseTaskInput(text(message))).find(item => item?.messages.length)?.messages[0]?.text || input;
      const recovering = !!envelope?.note; let failure;
      const naming = messages.some(message => message.role === 'system' && text(message).startsWith('Name this coding session from the first user request'));
      audit({ kind: 'request', purpose: naming ? 'session-title' : 'agent', input, tools: getCurrentTools(context.messages).map(tool => tool.name),
        results: results.map(message => ({ name: message.toolName, isError: !!message.isError, text: text(message) })) });
      const call = (name, args) => ({ type: 'toolCall', id: 'fixture-' + process.pid + '-' + (++sequence), name, arguments: args });
      const words = value => [{ type: 'text', text: value }];
      const decoded = message => { try { return JSON.parse(text(message)); } catch { return {}; } };
      const choose = async () => {
        if (naming) return words('Independent inspection session');
        if (!['worker', 'coder'].includes(role) && input.startsWith('SDK proof: ')) {
          audit({ kind: 'sdk-sources', commands: pi.getCommands().filter(command => command.source === 'extension' && command.sourceInfo.origin === 'package').map(({ name, source, sourceInfo }) => ({ name, source, sourceInfo })) });
          return results.length ? words('SDK proof complete.') : [call('remote_tasks', JSON.parse(input.slice('SDK proof: '.length)))];
        }
        if (['worker', 'coder'].includes(role)) {
          if (original.includes('recovery budget')) { failure = 'Injected provider failure for recovery budget.'; return []; }
          if (original.includes('recovery inbox')) {
            if (recovering) {
              audit({ kind: 'recovery-holding' });
              while (!existsSync(join(root, 'release-inbox')) && !options.signal?.aborted) await delay(20);
              return options.signal?.aborted ? [] : [call('task_report', { kind: 'result', text: 'Recovered inbox with queued instruction: ' + input })];
            }
            audit({ kind: 'holding' }); while (!options.signal?.aborted) await delay(20); return [];
          }
          if (original.includes('uncertain write')) {
            if (!results.length) return [call('bash', { command: `node -e 'const fs=require("node:fs");fs.writeFileSync("effect-pid.txt",String(process.pid));fs.appendFileSync("partial-marker.txt","once\\n");setTimeout(()=>{},600000)' ${JSON.stringify(root)}`, timeout: 120 })];
            return [call('task_report', { kind: 'result', text: 'Unexpected completion of uncertain-write fixture.' })];
          }
          if (original.includes('recovery counter')) {
            if (!recovering && !results.length) return [call('bash', { command: `node -e 'require("node:fs").appendFileSync("counter.txt","once\\n")'` })];
            if (!recovering) { failure = 'Injected transient provider failure after a saved tool result.'; return []; }
            if (!results.length) return [call('read', { path: 'counter.txt' })];
            if (results.length === 1) return [call('write', { path: 'recovered.txt', content: 'Continued from saved results.\n' })];
            return [call('task_report', { kind: 'result', text: 'Recovered the same session/worktree without repeating the counter command.' })];
          }
        }
        if (role === 'coder') {
          if (input === 'Revise calculation fixture.') {
            if (!results.length) return [call('write', { path: 'review-marker.txt', content: 'Reviewed revision changed.\n' })];
            return [call('task_report', { kind: 'result', text: 'Added review-marker.txt; the calculation checks still pass.' })];
          }
          if (input.includes('notes worker') || recovering && original.includes('notes worker')) {
            if (!results.length && !recovering) return [call('write', { path: 'worker-notes.md', content: 'Independent coding work in its own worktree.\n' })];
            audit({ kind: 'holding' });
            while (!options.signal?.aborted) await delay(20);
            audit({ kind: 'aborted' }); return [];
          }
          const steps = [
            () => call('read', { path: 'calc.mjs' }),
            () => call('edit', { path: 'calc.mjs', edits: [{ oldText: 'a - b', newText: 'a + b' }] }),
            () => call('bash', { command: `node --input-type=module -e 'import assert from "node:assert/strict"; import {add} from "./calc.mjs"; assert.equal(add(2,3),5); assert.equal(process.env.PI_REMOTE_COORDINATOR_TOKEN,undefined); console.log("calculation checks passed");'` }),
            () => call('write', { path: join(root, 'outside.txt'), content: 'Outside writes must be blocked.' }),
            () => call('write', { path: 'dangling.txt', content: 'Dangling symlink writes must be blocked.' }),
            () => call('write', { path: 'checks.txt', content: 'calculation checks passed\n' })
          ];
          if (results.some((result, index) => result.isError && ![3, 4].includes(index))) return [call('task_report', { kind: 'question', text: 'A coding tool failed: ' + text(results.find(result => result.isError)) })];
          if (results.length < steps.length) return [steps[results.length]()];
          return [call('task_report', { kind: 'result', text: 'Fixed calc.mjs and added checks.txt. Ran node assertions: calculation checks passed. Changes remain in this worktree pending review.' })];
        }
        if (role !== 'worker') {
          if (input === 'Fix the fixture calculation with two workers.') {
            if (!results.length) return [
              call('remote_tasks', { action: 'assign', kind: 'code', title: 'Calculation fix', instruction: 'Fix add in calc.mjs and run its focused Node check.' }),
              call('remote_tasks', { action: 'assign', kind: 'code', title: 'Coding notes', instruction: 'Be the notes worker, write worker-notes.md, then wait until stopped.' })
            ];
            return words('Started two coding workers in separate worktrees.');
          }
          if (['Review and integrate the calculation fix.', 'Stop the coding notes worker.'].includes(input)) {
            if (!results.length) return [call('remote_tasks', { action: 'list' })];
            const latest = decoded(results.at(-1));
            if (latest.tasks) {
              const task = latest.tasks.find(task => task.title === (input.startsWith('Stop') ? 'Coding notes' : 'Calculation fix'));
              return [call('remote_tasks', { action: input.startsWith('Stop') ? 'stop' : 'inspect', taskId: task.id })];
            }
            if (latest.review) return [call('remote_tasks', { action: 'integrate', taskId: latest.id, revision: latest.review.revision })];
            return words(input.startsWith('Stop') ? 'Stopped the notes worker only.' : 'Reviewed and integrated the calculation fix.');
          }
          if (input === 'Read alpha before delegating.') {
            if (!results.length) return [call('read', { path: 'alpha.txt' })];
            return words('Read ALPHA_VALUE=stable in this existing conversation. No workers were started.');
          }
          if (input === 'Start independent inspection.') {
            if (!results.length) return [call('remote_tasks', { action: 'assign', title: 'Independent inspection', instruction: 'Inspect alpha.txt and ask whether to keep its original identifier.', model: 'coordinator-fixture/fixture' })];
            return words('Started an independent worker under this conversation.');
          }
          if (input === 'Investigate both fixture files.') {
            if (!results.length) return [
              call('remote_tasks', { action: 'assign', title: 'First inspection', instruction: 'Inspect alpha.txt and ask whether to keep its original identifier.' }),
              call('remote_tasks', { action: 'assign', title: 'Second inspection', instruction: 'Inspect beta.txt and keep investigating until stopped.' })
            ];
            return words('Started two independent read-only investigations. You can keep talking here.');
          }
          if (['Keep the original identifier.', 'Review and accept the first result.', 'Stop Second inspection.'].includes(input)) {
            if (!results.length) return [call('remote_tasks', { action: 'list' })];
            const latest = decoded(results.at(-1));
            if (Array.isArray(latest.tasks)) {
              const task = latest.tasks.find(task => task.title === (input === 'Stop Second inspection.' ? 'Second inspection' : 'First inspection'));
              return [call('remote_tasks', { taskId: task.id, ...(input === 'Keep the original identifier.'
                ? { action: 'message', text: input } : { action: input === 'Stop Second inspection.' ? 'stop' : 'inspect' }) })];
            }
            if (input === 'Review and accept the first result.' && latest.state === 'reported') return [call('remote_tasks', { action: 'accept', taskId: latest.id })];
            return words(input === 'Keep the original identifier.' ? 'I sent your answer to First inspection. Second inspection is unchanged.'
              : input === 'Stop Second inspection.' ? 'I stopped Second inspection only. First inspection is unchanged.'
              : 'I reviewed and accepted First inspection: ALPHA_VALUE=stable. The original identifier is preserved.');
          }
          if (input === 'Start an interrupted task.') {
            if (!results.length) return [call('remote_tasks', { action: 'assign', title: 'Interrupted inspection', instruction: 'Inspect beta.txt and keep investigating until stopped.' })];
            return words('Started the interrupted-work inspection.');
          }
          if (input.startsWith('[Pi Remote task events]') || input === 'Which tasks are still open?') {
            if (!results.length) return [call('remote_tasks', { action: 'list' })];
            const latest = decoded(results.at(-1));
            if (Array.isArray(latest.tasks)) {
              if (input === 'Which tasks are still open?') {
                const states = Object.fromEntries(latest.tasks.map(task => [task.title, task.state]));
                return words('First inspection ' + (states['First inspection'] === 'waiting' ? 'needs an answer' : states['First inspection']) +
                  '. Second inspection is ' + states['Second inspection'] + '.');
              }
              const task = latest.tasks.find(task => ['waiting', 'reported'].includes(task.state) || task.recovery?.phase === 'blocked');
              if (task) return [call('remote_tasks', { action: 'inspect', taskId: task.id })];
              return words('Task update received. Existing assignments are unchanged.');
            }
            return words(latest.state === 'waiting' || latest.recovery?.phase === 'blocked' ? latest.title + ' asks: ' + latest.question
              : latest.state === 'reported' ? latest.title + ' returned: ' + latest.result : 'Task update received.');
          }
          return words('Ready. The existing background tasks are unchanged.');
        }
        if (input.includes('beta.txt') || recovering && original.includes('beta.txt')) {
          if (!results.length && !recovering) return [call('read', { path: 'beta.txt' })];
          audit({ kind: 'holding' });
          while (!options.signal?.aborted) await delay(20);
          audit({ kind: 'aborted' });
          return [];
        }
        if (input.startsWith('Read-only assignment')) {
          const attempts = [
            () => call('read', { path: 'alpha.txt' }),
            () => call('read', { path: join(root, 'outside.txt') }),
            () => call('read', { path: 'escape.txt' }),
            () => call('write', { path: 'damage.txt', content: 'This must never be written.' }),
            () => call('bash', { command: 'touch shell-damage.txt' })
          ];
          if (results.length < attempts.length) return [attempts[results.length]()];
          return [call('task_report', { kind: 'question', text: 'Should I keep the original identifier in alpha.txt?' })];
        }
        if (!results.length) return [call('read', { path: 'alpha.txt' })];
        return [call('task_report', { kind: 'result', text: 'Alpha inspection complete: ALPHA_VALUE=stable. The original identifier is preserved. No project files were changed.' })];
      };
      const result = (async () => {
        const content = await choose(), aborted = options.signal?.aborted;
        return { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), content,
          errorMessage: failure, stopReason: aborted ? 'aborted' : failure ? 'error' : content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      })();
      return { result: () => result, async *[Symbol.asyncIterator]() {
        const message = await result;
        yield { type: 'start', partial: message };
        if (message.stopReason === 'error') yield { type: 'error', reason: 'error', error: message };
        else if (message.stopReason === 'aborted') yield { type: 'error', reason: 'aborted', error: message };
        else yield { type: 'done', reason: message.stopReason, message };
      } };
    }
  });
}
