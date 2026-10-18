import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider, type ApiKeyAuth, type Message, type Model } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { buildSessionProjection, convertToLlm, type BeforeAgentStartEvent, type ExtensionAPI, type ExtensionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';
import { createBridge, prepareRecovery, sdkEnvironment, type RecoveryPlan } from './bridge.ts';

const exec = promisify(execFile);
const providerId = 'claude-sdk';

export const localLogin: ApiKeyAuth = {
  name: 'Local Claude Code login',
  async resolve({ credential, signal }) {
    signal.throwIfAborted();
    if (credential?.key) return undefined;
    try {
      const { stdout } = await exec('claude', ['auth', 'status', '--json'], {
        env: sdkEnvironment(credential?.env), signal, timeout: 5000, maxBuffer: 65536,
      });
      const status = JSON.parse(stdout);
      if (status.loggedIn === true && status.authMethod === 'claude.ai' && status.apiProvider === 'firstParty') {
        return { auth: {}, env: credential?.env, source: 'Claude Code login' };
      }
    } catch {
      signal.throwIfAborted();
    }
    return undefined;
  },
};

export default function (pi: ExtensionAPI, createQuery?: Parameters<typeof createBridge>[1]) {
  let bridge: ReturnType<typeof createBridge> | undefined;
  let checkpoint: unknown;
  let recovery: RecoveryPlan | undefined;
  let compaction: { entryId: string; state: unknown } | undefined, compacting = false;
  let activeSession: string | undefined;
  let ownerId: string | undefined, ownerCwd: string;
  const borrowed = new Map<string, ReturnType<typeof createBridge>>();
  let promptSource: Pick<BeforeAgentStartEvent, 'systemPrompt' | 'systemPromptOptions'> | undefined;
  const restore = (ctx: ExtensionContext) => {
    ownerId = ctx.sessionManager.getSessionId(); ownerCwd = ctx.cwd;
    bridge?.close();
    bridge = createBridge(ctx.cwd, createQuery, { persistSession: Boolean(ctx.sessionManager.getSessionFile()), checkpoint, recovery, compaction: compaction ? compaction.state ?? null : undefined,
      compactionSource: () => {
        const branch = ctx.sessionManager.getBranch(), end = branch.findIndex(entry => entry.type === 'compaction' && entry.id === compaction?.entryId);
        if (end < 0) throw new Error('SDK compaction source is unavailable.');
        return projectionMessages(branch.slice(0, end), true);
      },
      promptSource: () => promptSource, historySource: () => recoveryMessages(ctx, true),
      onRecoveryStart: (id, sdkSessionId) => { pi.appendEntry('claude-sdk-recovery-started', { id, sdkSessionId }); recovery = undefined; },
      onRecoverySession: (id, sdkSessionId) => { pi.appendEntry('claude-sdk-recovery-session', { id, sdkSessionId }); } });
  };
  const projectionMessages = (branch: SessionEntry[], includeSystem = false): Message[] =>
    convertToLlm(buildSessionProjection(branch).entries.flatMap(entry => entry.messages)).filter(message => includeSystem || message.role !== 'system');
  const recoveryMessages = (ctx: ExtensionContext, includeSystem = false): Message[] => projectionMessages(ctx.sessionManager.getBranch(), includeSystem);
  const streamSimple: ReturnType<typeof createBridge>['streamSimple'] = (...args) => {
    if (!bridge) throw new Error('Claude SDK requires an active Pi session.');
    const sessionId = args[2]?.sessionId;
    if (sessionId && sessionId !== ownerId) {
      // Foreground Pi children borrow the provider, not its session hooks; retain their entire prompt verbatim.
      // shortcut: fresh borrowed children only; durable child resumes need their own provider session hooks.
      let child = borrowed.get(sessionId);
      if (!child) { child = createBridge(ownerCwd, createQuery); borrowed.set(sessionId, child); }
      const stream = child.streamSimple(...args), current = child;
      const release = () => { current.close(); if (borrowed.get(sessionId) === current) borrowed.delete(sessionId); };
      void stream.result().then(message => { if (message.stopReason !== 'toolUse') release(); }, release);
      return stream;
    }
    return bridge.streamSimple(...args);
  };
  const catalog = getBuiltinModels('anthropic');
  const models = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'].map((id): Model<'claude-sdk'> => {
    const model = catalog.find(model => model.id === id);
    if (!model) throw new Error(`This experiment requires Pi model metadata for ${id}.`);
    const { compat: _compat, ...metadata } = model;
    return { ...metadata, provider: providerId, api: 'claude-sdk', baseUrl: '',
      name: `Claude SDK ${metadata.name.replace(/^Claude /, '')} (experimental)`, promptCache: undefined };
  });
  pi.registerProvider(createProvider({
    id: providerId, name: 'Claude SDK experiment', auth: { apiKey: localLogin },
    models,
    api: { stream: streamSimple, streamSimple },
  }));
  pi.registerCommand('sdk-recover', {
    description: 'Start a new SDK context from saved Pi history without replaying tools',
    handler: async (_args, ctx) => {
      if (!ctx.isIdle() || ctx.model?.provider !== providerId || !ctx.sessionManager.getSessionFile()) {
        ctx.ui.notify('Select an idle, saved Claude SDK conversation before requesting recovery.', 'warning'); return;
      }
      if (!ctx.hasUI) { ctx.ui.notify('SDK recovery requires interactive confirmation.', 'warning'); return; }
      if (typeof ctx.sessionManager.buildSessionProjection !== 'function') { ctx.ui.notify('Update Pi to use SDK recovery.', 'error'); return; }
      try {
        const originalSession = activeSession;
        const plan = prepareRecovery(checkpoint, recoveryMessages(ctx));
        const confirmed = await ctx.ui.confirm('Recover SDK conversation?',
          `This starts a new SDK context from saved Pi history. It does not resume the old native SDK context or retry past commands.\n\n` +
          `${plan.interrupted.length} tool result(s) are missing. Their effects remain unknown; no success or exit status will be invented.\n\n` +
          'This does not delete or rewind Pi history or previous native SDK transcripts. New tools follow your normal Pi permission policy. Continue?');
        if (!confirmed) return;
        const current = prepareRecovery(checkpoint, recoveryMessages(ctx));
        if (!ctx.isIdle() || activeSession !== originalSession || current.checkpointHash !== plan.checkpointHash || JSON.stringify(current.history) !== JSON.stringify(plan.history)) {
          ctx.ui.notify('The conversation changed during confirmation. Request recovery again.', 'warning'); return;
        }
        pi.appendEntry('claude-sdk-recovery', plan);
        recovery = plan;
        restore(ctx);
        ctx.ui.notify('Recovery requested. Send a new message. The next SDK context will use saved Pi history and your normal Pi permission policy.', 'info');
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : 'Could not prepare SDK recovery.', 'error');
      }
    },
  });
  // Rows use pi-usage's "Label: [bar] N% left (reset)" shape so the host's existing parser renders them.
  pi.registerCommand('claude-usage', {
    description: 'Show Claude plan limits for the SDK experiment',
    handler: async (_args, ctx) => {
      let lines: string[] = [];
      try {
        const report = await bridge?.usage();
        const limits = report?.rate_limits;
        const windows: [string, { utilization: number | null; resets_at: string | null } | null | undefined][] = limits ? [
          ['5-hour', limits.five_hour], ['Weekly', limits.seven_day], ['Weekly Opus', limits.seven_day_opus],
          ['Weekly Sonnet', limits.seven_day_sonnet], ...(limits.model_scoped ?? []).map((item): [string, typeof item] => [`Weekly ${item.display_name}`, item]),
        ] : [];
        for (const [label, window] of windows) {
          if (window?.utilization == null) continue;
          const left = Math.max(0, Math.min(100, Math.round(100 - window.utilization)));
          const filled = Math.round(left / 10);
          const reset = window.resets_at ? ` (resets ${new Date(window.resets_at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })})` : '';
          lines.push(`${label}: [${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${left}% left${reset}`);
        }
        if (!lines.length) lines = [report ? 'Plan limits are not available for this Claude login.' : 'Send a message first, then check again.'];
      } catch {
        lines = ['Could not read Claude plan limits.'];
      }
      await ctx.ui.select(['Provider usage', ...lines].join('\n'), ['Close']);
    },
  });
  pi.on('session_start', (_event, ctx) => {
    activeSession = ctx.sessionManager.getSessionFile();
    const branch = ctx.sessionManager.getBranch();
    const entry = branch.findLast(entry => entry.type === 'custom' && entry.customType === 'claude-sdk-checkpoint');
    const decision = branch.findLast(entry => entry.type === 'custom' && entry.customType === 'claude-sdk-recovery');
    checkpoint = entry?.type === 'custom' ? entry.data : undefined;
    const compact = branch.findLast(row => row.type === 'compaction');
    const receipt = branch.findLast(row => row.type === 'custom' && row.customType === 'claude-sdk-compaction');
    const data = receipt?.type === 'custom' ? receipt.data as { entryId?: unknown; state?: unknown } : undefined;
    const needsReceipt = compact && (!entry || branch.indexOf(compact) > branch.indexOf(entry)) &&
      (data?.entryId === compact.id || branch.some(row => row.type === 'message' && row.message.role === 'assistant' && row.message.provider === providerId));
    compaction = needsReceipt ? { entryId: compact.id,
      state: data?.entryId === compact.id && receipt && branch.indexOf(receipt) > branch.indexOf(compact) ? data.state : null } : undefined;
    if (compaction) checkpoint = undefined;
    compacting = false;
    const plan = decision?.type === 'custom' ? decision.data as RecoveryPlan : undefined;
    const started = plan && branch.some(row => row.type === 'custom' && row.customType === 'claude-sdk-recovery-started' && (row.data as { id?: unknown })?.id === plan.id);
    recovery = plan && !started && (!entry || branch.indexOf(decision!) > branch.indexOf(entry)) ? plan : undefined;
    restore(ctx);
  });
  pi.on('before_agent_start', (event, ctx) => {
    promptSource = event;
    if (ctx.model?.provider === providerId && bridge?.closed) restore(ctx);
  });
  pi.on('turn_start', (_event, ctx) => {
    if (promptSource) promptSource = { systemPrompt: ctx.getSystemPrompt(), systemPromptOptions: promptSource.systemPromptOptions };
  });
  pi.on('agent_settled', (_event, ctx) => {
    const next = bridge?.checkpoint();
    if (next) { checkpoint = next; compaction = undefined; pi.appendEntry('claude-sdk-checkpoint', next); }
    if (process.env.PI_REMOTE_WORKER === '1' && ctx.model?.provider === providerId) {
      ctx.ui.setStatus('claude-sdk-checkpoint', next ? 'saved' : 'unavailable');
      ctx.ui.setStatus('claude-sdk-checkpoint', undefined);
    }
  });
  pi.on('session_shutdown', () => {
    for (const child of borrowed.values()) child.close(); borrowed.clear();
    bridge?.close(); bridge = undefined; checkpoint = undefined; recovery = undefined; compaction = undefined; compacting = false;
    activeSession = undefined; ownerId = undefined; promptSource = undefined;
  });
  pi.on('message_end', (event, ctx) => {
    const message = event.message;
    // Pi's lazy auth wrapper reports cancellation before our stream as a setup error.
    if (message.role === 'assistant' && message.provider === providerId && message.stopReason === 'error' && ctx.signal?.aborted) {
      bridge?.close();
      return { message: { ...message, content: [], stopReason: 'aborted', errorMessage: 'Cancelled.' } };
    }
  });
  pi.on('model_select', (event, ctx) => {
    if (event.previousModel?.provider === providerId && event.model.provider !== providerId && !ctx.isIdle()) bridge?.close();
    // Return through the completed native checkpoint; Pi-only turns become context, never replayed tools.
    if (event.previousModel?.provider !== providerId && event.model.provider === providerId && ctx.isIdle() && checkpoint) restore(ctx);
  });
  pi.on('session_before_compact', (event, ctx) => {
    const sdkHistory = event.branchEntries.some(row => row.type === 'message' && row.message.role === 'assistant' && row.message.provider === providerId);
    if (ctx.model?.provider !== providerId && !checkpoint && !compaction && !sdkHistory) return;
    try {
      if (!bridge) throw new Error('No SDK session.');
      bridge.prepareCompaction(projectionMessages(event.branchEntries, true));
      compacting = true;
    } catch (error) {
      console.error('[claude-sdk:compaction] Preparation rejected:', error);
      ctx.ui.notify('Cannot compact SDK history safely. Finish or recover the interrupted turn first.', 'warning');
      return { cancel: true };
    }
  });
  pi.on('session_compact_failed', () => { compacting = false; });
  pi.on('session_compact', (event, ctx) => {
    if (!compacting) return;
    compacting = false;
    try {
      const branch = ctx.sessionManager.getBranch();
      // Pi can report an older entry when summaries repeat; bind the latest persisted compaction.
      const entry = branch.findLast(row => row.type === 'compaction');
      const end = entry ? branch.indexOf(entry) : -1;
      if (!bridge || !entry || entry.type !== 'compaction' || entry.summary !== event.compactionEntry.summary) throw new Error('No SDK compaction source.');
      const state = bridge.prepareCompaction(projectionMessages(branch.slice(0, end), true), recoveryMessages(ctx));
      const receipt = { entryId: entry.id, state };
      pi.appendEntry('claude-sdk-compaction', receipt);
      checkpoint = undefined; recovery = undefined; compaction = receipt;
      restore(ctx);
    } catch (error) {
      console.error('[claude-sdk:compaction] Checkpoint rejected:', error);
      const entry = ctx.sessionManager.getBranch().findLast(row => row.type === 'compaction');
      if (entry) { compaction = { entryId: entry.id, state: null }; checkpoint = undefined; recovery = undefined; restore(ctx); }
      else bridge?.close();
      ctx.ui.notify('SDK compaction checkpoint could not be recorded. Start a fresh session before continuing.', 'error');
    }
  });
  const blockHistoryChange = (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.model?.provider !== providerId) return;
    if (ctx.hasUI) ctx.ui.notify('Claude SDK experiment does not support branching or forks. Start a new session.', 'warning');
    return { cancel: true };
  };
  pi.on('session_before_tree', blockHistoryChange);
  pi.on('session_before_fork', blockHistoryChange);
}
