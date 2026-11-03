import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getCurrentTools } from '@earendil-works/pi-ai';

export default function verificationProvider(pi) {
  const root = process.env.PI_COORDINATOR_FIXTURE_ROOT;
  if (!root || JSON.parse(readFileSync(join(root, '.coordinator-fixture.json'), 'utf8')).version !== 1) throw new Error('An isolated coordinator fixture is required.');
  const role = process.env.PI_REMOTE_COORDINATOR_ROLE;
  const audit = value => appendFileSync(join(root, 'provider.jsonl'), JSON.stringify({ ...value, pid: process.pid, role, at: Date.now() }) + '\n');
  const text = message => typeof message?.content === 'string' ? message.content : (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  let sequence = 0;
  pi.on('session_start', () => audit({ kind: 'boot' }));
  pi.registerProvider('coordinator-fixture', {
    api: 'coordinator-fixture', apiKey: 'fixture-only-no-network', baseUrl: 'http://127.0.0.1:1',
    models: [{ id: 'fixture', name: 'Coordinator verification model', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 3000 }],
    streamSimple(model, context, options = {}) {
      const messages = context.messages, index = messages.findLastIndex(message => message.role === 'user');
      const input = text(messages[index]), results = messages.slice(index + 1).filter(message => message.role === 'toolResult');
      audit({ kind: 'request', input, tools: getCurrentTools(context.messages).map(tool => tool.name),
        results: results.map(message => ({ name: message.toolName, isError: !!message.isError, text: text(message) })) });
      const call = (name, args) => ({ type: 'toolCall', id: 'fixture-' + process.pid + '-' + (++sequence), name, arguments: args });
      const words = value => [{ type: 'text', text: value }];
      const decoded = message => { try { return JSON.parse(text(message)); } catch { return {}; } };
      const choose = async () => {
        if (role === 'coordinator') {
          if (input === 'Investigate both fixture files.') {
            if (!results.length) return [
              call('remote_tasks', { action: 'assign', title: 'First inspection', instruction: 'Inspect alpha.txt and ask whether to keep its original identifier.' }),
              call('remote_tasks', { action: 'assign', title: 'Second inspection', instruction: 'Inspect beta.txt and keep investigating until stopped.' })
            ];
            return words('Started two independent read-only investigations. You can keep talking here.');
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
              const task = latest.tasks.find(task => ['waiting', 'reported'].includes(task.state));
              if (task) return [call('remote_tasks', { action: 'inspect', taskId: task.id })];
              return words('Task update received. Existing assignments are unchanged.');
            }
            return words(latest.state === 'waiting' ? latest.title + ' asks: ' + latest.question
              : latest.state === 'reported' ? latest.title + ' returned: ' + latest.result : 'Task update received.');
          }
          return words('Ready. The existing background tasks are unchanged.');
        }
        if (input.includes('beta.txt')) {
          if (!results.length) return [call('read', { path: 'beta.txt' })];
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
          stopReason: aborted ? 'aborted' : content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      })();
      return { result: () => result, async *[Symbol.asyncIterator]() {
        const message = await result;
        yield { type: 'start', partial: message };
        if (message.stopReason === 'aborted') yield { type: 'error', reason: 'aborted', error: message };
        else yield { type: 'done', reason: message.stopReason, message };
      } };
    }
  });
}
