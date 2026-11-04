import { Type } from '@earendil-works/pi-ai';
import { createHash } from 'node:crypto';
import { realpathSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep, join } from 'node:path';
import { loadConfig, dataDir } from '../src/config.mjs';
import { sessionKey, sessionCapability } from '../src/locks.mjs';

const guidance = [
  'The user gives all instructions and replies in this main conversation. Worker logs are read-only inspection views. Never ask the user to enter a worker session to answer it or give it commands.',
  'Use remote_tasks to dispatch independent read-only investigations when the user asks for workers or explicitly authorizes delegation. Do not start workers merely because a report arrived or a message mentions workers.',
  'Keep this conversation available. Assign returns after dispatch; do not wait for a worker to finish before answering another user message. Carry the user’s goals and relevant constraints into every assignment.',
  'Inspect worker questions, resolve routine clarifications from existing instructions, and present only missing user decisions here. Relay answers with remote_tasks message to the intended task. Clarify ambiguous references rather than guessing.',
  'Inspect complete reports before summarizing or accepting them. Review their evidence, accept a supported result, and synthesize useful findings here. Idle is not proof of completion, and a report is not permission for new work.',
  'Address follow-ups and Stop to explicit task IDs. Stopping your response does not stop workers. Never approve permission dialogs automatically or replay an uncertain dispatch or notification.',
  'Workers in this version cannot edit files, run commands, or delegate. Your own tools and permissions are unchanged. Speak briefly, report evidence accurately, and do not expose private reasoning.'
].join('\n');
const toolResult = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], details: value });
const extendPrompt = (event, section) => {
  if (event.systemPromptOptions?.sections && !event.systemPromptOptions.forceSystemPrompt) event.systemPromptOptions.sections.pi_remote_coordination = section;
  else return { systemPrompt: event.systemPrompt + '\n\n' + section };
};
const taskContext = snapshot => snapshot.tasks.slice(-30).map(({ id, title, state, question, result, delivery }) => ({ id, title, state, question: !!question, result: !!result, delivery }));
async function callHost(origin, headers, input, signal, toolCallId) {
  const signals = [AbortSignal.timeout(input ? 30000 : 3000)]; if (signal) signals.push(signal);
  let result;
  try {
    const response = await fetch(origin + '/_pi/coordinator', {
      method: input ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.any(signals),
      headers: { ...headers, ...(input ? { 'Content-Type': 'application/json' } : {}) },
      ...(input ? { body: JSON.stringify({ ...input, requestId: createHash('sha256').update(toolCallId).digest('hex') }) } : {})
    });
    result = await response.json();
  } catch { throw new Error('Cannot reach the coordinator host. Inspect existing tasks before repeating an action.'); }
  if (!result.ok) throw new Error(result.error || 'Coordinator action failed. Inspect the task before retrying.');
  return result.value;
}
function registerTasks(pi, call) {
  pi.registerTool({
    name: 'remote_tasks', label: 'Background workers', exposure: 'direct', executionMode: 'sequential',
    description: 'Delegate user-requested read-only investigations from this conversation. List tasks, assign workers, inspect reports, send task-specific instructions, stop one task, or accept a reviewed result. Assign returns immediately after dispatch. At most two tasks may be active. The optional worker model must be an available native Pi provider/model; the parent session model does not change.',
    parameters: Type.Object({
      action: Type.Union(['list', 'assign', 'inspect', 'message', 'stop', 'accept'].map(value => Type.Literal(value))),
      taskId: Type.Optional(Type.String({ maxLength: 100 })), title: Type.Optional(Type.String({ maxLength: 120 })),
      instruction: Type.Optional(Type.String({ maxLength: 8000 })), text: Type.Optional(Type.String({ maxLength: 10000 })),
      model: Type.Optional(Type.String({ maxLength: 500 }))
    }, { additionalProperties: false }),
    async execute(id, input, signal, _update, context) { return toolResult(await call(input, signal, id, context)); }
  });
}
function sessionAccess(context) {
  try {
    const file = context.sessionManager.getSessionFile();
    if (!file) throw new Error('No saved session');
    const dir = dataDir(), id = sessionKey(file), lock = JSON.parse(readFileSync(join(dir, 'locks', id + '.json'), 'utf8'));
    if ((lock.kind === 'rpc' ? lock.workerPid : lock.pid) !== process.pid || sessionKey(lock.file) !== id || !lock.nonce) throw new Error('Session owner changed');
    const config = loadConfig(dir);
    return { origin: 'http://127.0.0.1:' + config.port, headers: {
      Authorization: 'Bearer ' + sessionCapability(config.bridgeToken, id, lock.nonce), 'X-Pi-Remote-Session': id
    } };
  } catch { throw new Error('This session has no active Pi Remote connection. Reload its Pi Remote extension or resume it from the phone.'); }
}
export function registerSessionCoordinator(pi) {
  const call = (input, signal, id, context) => {
    const { origin, headers } = sessionAccess(context);
    return callHost(origin, headers, input, signal, id);
  };
  registerTasks(pi, call);
  pi.on('before_agent_start', async (event, context) => {
    let snapshot;
    try { snapshot = await call(undefined, undefined, undefined, context); } catch { return; }
    const models = context.modelRegistry.getAvailable().filter(model => model.provider !== 'claude-sdk').slice(0, 8).map(model => model.provider + '/' + model.id);
    const modelGuidance = 'Workers inherit your native Pi model unless you specify another. A parent using an extension-only provider can still coordinate, but needs a native worker model. Ask before choosing a different worker model unless the user already authorized it. Available native worker models: ' + models.join(', ');
    return extendPrompt(event, guidance + '\n' + modelGuidance + '\n\nDurable task context:\n' + JSON.stringify(taskContext(snapshot)));
  });
}
export default function coordinatorExtension(pi) {
  const role = process.env.PI_REMOTE_COORDINATOR_ROLE, token = process.env.PI_REMOTE_COORDINATOR_TOKEN;
  const origin = process.env.PI_REMOTE_COORDINATOR_URL, privateDir = realpathSync(process.env.PI_REMOTE_COORDINATOR_DATA);
  if (!['coordinator', 'worker'].includes(role) || !token || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || '')) throw new Error('This extension requires a host-owned coordinator session.');
  const allowed = role === 'coordinator' ? ['remote_tasks'] : ['read', 'grep', 'find', 'ls', 'task_report'];
  const call = (input, signal, id) => callHost(origin, { Authorization: 'Bearer ' + token }, input, signal, id);
  let reported = false;
  const inside = (path, dir) => { const rel = relative(dir, path); return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep); };
  if (role === 'coordinator') registerTasks(pi, call);
  else pi.registerTool({
    name: 'task_report', label: 'Report to coordinator', exposure: 'direct', executionMode: 'sequential',
    description: 'Persist a question or final result for your assigned task and return it to the owning coordinator. Include evidence and unresolved limits. A question waits for an explicit reply. This tool ends the current turn; do not continue working after reporting.',
    parameters: Type.Object({ kind: Type.Union([Type.Literal('question'), Type.Literal('result')]), text: Type.String({ minLength: 1, maxLength: 10000 }) }, { additionalProperties: false }),
    async execute(id, input, signal) {
      const value = await call(input, signal, id); reported = true;
      return { ...toolResult(value), terminate: true };
    }
  });
  pi.on('session_start', () => pi.setActiveTools(allowed));
  pi.on('input', (event, ctx) => {
    reported = false;
    if (role === 'coordinator' && event.text.startsWith('[Pi Remote task events]\n')) {
      const marker = 'pi-remote-extension-input';
      pi.appendEntry(marker, { text: event.text }); ctx.ui.setStatus(marker, event.text);
    }
  });
  pi.on('tool_call', (event, ctx) => {
    if (!allowed.includes(event.toolName)) return { block: true, reason: 'This session cannot use that tool.' };
    if (role === 'coordinator') return;
    if (reported) return { block: true, reason: 'The task has reported. Wait for a new instruction.' };
    if (event.toolName === 'task_report') return;
    try {
      const root = realpathSync(ctx.cwd), target = realpathSync(resolve(root, event.input.path || '.'));
      if (!inside(target, root) || inside(target, privateDir) || ['grep', 'find'].includes(event.toolName) && inside(privateDir, target)) {
        return { block: true, reason: 'Read-only workers may inspect only their project, excluding private host data.' };
      }
    } catch { return { block: true, reason: 'The requested project path is unavailable.' }; }
  });
  pi.on('before_agent_start', async event => {
    pi.setActiveTools(allowed);
    const snapshot = await call();
    const section = role === 'coordinator'
      ? 'This is a legacy restricted coordinator. You have only remote_tasks, not shell or editing tools.\n' + guidance + '\n\nDurable task context:\n' + JSON.stringify(taskContext(snapshot))
      : [
        'You are an independent, read-only Pi worker assigned by a Pi Remote coordinator. Your task and latest status are below.',
        'Inspect only this project with read, grep, find and ls. Do not edit files, run commands, install anything, access private host data, or delegate.',
        'Use task_report with kind question when you need a decision, or result when your assignment is complete. Include useful findings, file references, and what remains unverified.',
        'A question does not grant permission. After reporting, stop this turn and wait for an explicit reply. Never claim that tests ran or changes were applied.'
      ].join('\n') + '\n\nDurable task context:\n' + JSON.stringify(snapshot);
    return extendPrompt(event, section);
  });
}
