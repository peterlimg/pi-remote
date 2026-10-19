import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider, getCurrentSystemMessage, type ApiKeyAuth, type Message, type Model } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { buildSessionProjection, convertToLlm, SessionManager, type BeforeAgentStartEvent, type ExtensionAPI, type ExtensionContext, type SessionEntry } from '@earendil-works/pi-coding-agent';
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
  let clone: { entryId: string; state: unknown } | undefined;
  let tree: { entryId: string; sourceId: string | null; state: unknown } | undefined;
  let treePlan: { oldLeafId: string | null; sourceId: string | null; proof: ReturnType<typeof createBridge>; before: Message[] } | undefined;
  let activeSession: string | undefined;
  let ownerId: string | undefined, ownerCwd: string;
  const borrowed = new Map<string, ReturnType<typeof createBridge>>();
  let promptSource: Pick<BeforeAgentStartEvent, 'systemPrompt' | 'systemPromptOptions'> | undefined;
  const branchBridge = (ctx: ExtensionContext, saved: Pick<ReturnType<typeof readBranch>, 'checkpoint' | 'recovery' | 'compaction' | 'clone' | 'tree'>,
    entries = () => ctx.sessionManager.getBranch()) => createBridge(ctx.cwd, createQuery, {
      persistSession: Boolean(ctx.sessionManager.getSessionFile()), checkpoint: saved.checkpoint, recovery: saved.recovery,
      compaction: saved.compaction ? saved.compaction.state ?? null : undefined,
      compactionSource: () => {
        const branch = entries(), end = branch.findIndex(entry => entry.type === 'compaction' && entry.id === saved.compaction?.entryId);
        if (end < 0) throw new Error('SDK compaction source is unavailable.');
        return projectionMessages(branch.slice(0, end), true);
      },
      clone: saved.clone ? saved.clone.state ?? null : undefined,
      cloneSource: () => {
        const branch = entries(), end = branch.findIndex(entry => entry.id === saved.clone?.entryId);
        if (end < 0) throw new Error('SDK clone source is unavailable.');
        return projectionMessages(branch.slice(0, end), true);
      },
      tree: saved.tree ? saved.tree.state ?? null : undefined,
      treeSource: () => {
        const branch = entries(), end = branch.findIndex(entry => entry.id === saved.tree?.entryId);
        if (end < 0) throw new Error('SDK tree source is unavailable.');
        if (saved.tree?.sourceId === null) return [];
        const source = branch.findIndex(entry => entry.id === saved.tree?.sourceId);
        if (source < 0 || source >= end) throw new Error('Invalid SDK tree source.');
        const selected = branch.slice(0, source + 1);
        if ((saved.tree?.state as { configuration?: unknown } | null)?.configuration === null && selected.some(row => row.type === 'message' &&
          row.message.role === 'assistant' && (row.message.provider === providerId || row.message.api === providerId))) throw new Error('SDK tree configuration is missing.');
        return projectionMessages(selected, true);
      },
      configurationSource: (configuration, accepted) => {
        const branch = entries();
        const end = branch.findLastIndex(row => row.type === 'custom' && row.customType === 'claude-sdk-checkpoint' &&
          (row.data as { configuration?: unknown; prefix?: unknown[] })?.configuration === configuration &&
          (row.data as { prefix?: unknown[] })?.prefix?.length === accepted);
        return end < 0 ? undefined : projectionMessages(branch.slice(0, end), true);
      },
      promptSource: () => promptSource?.systemPromptOptions.forceSystemPrompt === undefined ? promptSource
        : { ...promptSource, canonical: getCurrentSystemMessage(projectionMessages(entries(), true)) },
      historySource: () => projectionMessages(entries(), true),
      retiredToolIds: () => ctx.sessionManager.getEntries().flatMap(row => row.type === 'message' && row.message.role === 'assistant'
        ? row.message.content.filter(block => block.type === 'toolCall').map(block => block.id) : []),
      onRecoveryStart: (id, sdkSessionId) => { pi.appendEntry('claude-sdk-recovery-started', { id, sdkSessionId }); recovery = undefined; },
      onRecoverySession: (id, sdkSessionId) => { pi.appendEntry('claude-sdk-recovery-session', { id, sdkSessionId }); } });
  const restore = (ctx: ExtensionContext) => {
    ownerId = ctx.sessionManager.getSessionId(); ownerCwd = ctx.cwd;
    bridge?.close();
    bridge = branchBridge(ctx, { checkpoint, recovery, compaction, clone, tree });
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
  const readBranch = (branch: SessionEntry[], lineage: SessionEntry[] = branch) => {
    const entry = branch.findLast(entry => entry.type === 'custom' && entry.customType === 'claude-sdk-checkpoint');
    const decision = branch.findLast(entry => entry.type === 'custom' && entry.customType === 'claude-sdk-recovery');
    let checkpoint = entry?.type === 'custom' ? entry.data : undefined;
    const compact = branch.findLast(row => row.type === 'compaction');
    const receipt = branch.findLast(row => row.type === 'custom' && row.customType === 'claude-sdk-compaction');
    const data = receipt?.type === 'custom' ? receipt.data as { entryId?: unknown; state?: unknown } : undefined;
    const needsReceipt = compact && (!entry || branch.indexOf(compact) > branch.indexOf(entry)) &&
      (data?.entryId === compact.id || branch.some(row => row.type === 'message' && row.message.role === 'assistant' && row.message.provider === providerId));
    let compaction = needsReceipt ? { entryId: compact.id,
      state: data?.entryId === compact.id && receipt && branch.indexOf(receipt) > branch.indexOf(compact) ? data.state : null } : undefined;
    const copy = branch.findLast(row => row.type === 'custom' && row.customType === 'claude-sdk-clone');
    const copied = copy?.type === 'custom' ? copy.data as { sessionId?: unknown; state?: unknown } | null : undefined;
    let clone = copy?.type === 'custom' && (!entry || branch.indexOf(copy) > branch.indexOf(entry)) && (!receipt || branch.indexOf(copy) > branch.indexOf(receipt))
      ? { entryId: copy.id, state: copied?.state } : undefined;
    if (clone) compaction = undefined;
    const navigation = branch.findLast(row => row.type === 'custom' && row.customType === 'claude-sdk-tree');
    const navigated = navigation?.type === 'custom' ? navigation.data as { sourceId?: unknown; state?: unknown } | null : undefined;
    const tree = navigation && [entry, copy, receipt, compact].every(row => !row || branch.indexOf(navigation) > branch.indexOf(row))
      ? { entryId: navigation.id, sourceId: navigated?.sourceId as string | null, state: navigated?.state } : undefined;
    if (tree) { clone = undefined; compaction = undefined; }
    if (compaction || clone || tree) checkpoint = undefined;
    if (checkpoint && typeof checkpoint === 'object' && !('piSessionId' in checkpoint)) {
      const configuration = (checkpoint as { configuration?: unknown }).configuration;
      const owners = lineage.flatMap(row => {
        if (row.type !== 'custom' || !['claude-sdk-clone', 'claude-sdk-compaction', 'claude-sdk-tree'].includes(row.customType)) return [];
        const state = (row.data as { state?: { configuration?: unknown; sourceSessionId?: unknown } } | null)?.state;
        return state && state.configuration === configuration && typeof state.sourceSessionId === 'string' ? [state.sourceSessionId] : [];
      });
      if (owners.length) checkpoint = { ...checkpoint, piSessionId: owners.at(-1) };
    }
    const plan = decision?.type === 'custom' ? decision.data as RecoveryPlan : undefined;
    const started = plan && branch.some(row => row.type === 'custom' && row.customType === 'claude-sdk-recovery-started' && (row.data as { id?: unknown })?.id === plan.id);
    const recovery = plan && !started && (!entry || branch.indexOf(decision!) > branch.indexOf(entry)) ? plan : undefined;
    return { checkpoint, compaction, clone, tree, recovery, copySessionId: copied?.sessionId };
  };
  const loadBranch = (ctx: ExtensionContext) => {
    const branch = ctx.sessionManager.getBranch(), all = ctx.sessionManager.getEntries(), saved = readBranch(branch, all);
    if (!saved.tree && !saved.clone && !saved.compaction) {
      const native = (saved.checkpoint as { sdkSessionId?: unknown } | undefined)?.sdkSessionId;
      const retired = all.some(row => {
        if (row.type !== 'custom' || row.customType !== 'claude-sdk-tree-start' || branch.some(entry => entry.id === row.id)) return false;
        const data = row.data as { sdkSessionIds?: unknown[]; sourceId?: unknown } | null;
        if (!data || !Array.isArray(data.sdkSessionIds) || !data.sdkSessionIds.every(id => typeof id === 'string') ||
          data.sourceId !== null && typeof data.sourceId !== 'string') return true;
        return typeof native === 'string' ? data.sdkSessionIds.includes(native) : data.sourceId === null || branch.some(entry => entry.id === data.sourceId);
      });
      if (retired) { saved.checkpoint = undefined; saved.tree = { entryId: '', sourceId: null, state: null }; }
    }
    ({ checkpoint, compaction, clone, tree, recovery } = saved); compacting = false;
    restore(ctx); return saved;
  };
  pi.on('session_start', (event, ctx) => {
    activeSession = ctx.sessionManager.getSessionFile();
    const branch = ctx.sessionManager.getBranch(), saved = loadBranch(ctx);
    if (event.reason === 'fork' && saved.copySessionId !== ctx.sessionManager.getSessionId()) {
      let state: unknown = null;
      try {
        const previous = event.previousSessionFile;
        if (!previous || ctx.sessionManager.getHeader()?.parentSession !== previous) throw new Error('Missing branch lineage.');
        const parent = SessionManager.open(previous), source = parent.getBranch(), header = parent.getHeader();
        if (!header || header.cwd !== ctx.cwd) throw new Error('Invalid branch parent.');
        if (!source.some(row => row.type === 'message' && row.message.role === 'assistant' && row.message.provider === providerId)) return;
        const target = branchBridge(ctx, readBranch(branch, source), () => branch);
        try {
          try { state = target.prepareClone(recoveryMessages(ctx, true), header.id, ctx.sessionManager.getSessionId()); }
          catch {
            const origin = branchBridge(ctx, readBranch(source), () => source);
            try { state = origin.prepareFork(projectionMessages(source, true), recoveryMessages(ctx, true), header.id, ctx.sessionManager.getSessionId()); }
            finally { origin.close(); }
          }
        } finally { target.close(); }
      } catch (error) {
        console.error('[claude-sdk:branch] Checkpoint rejected:', error);
        ctx.ui.notify('SDK branch checkpoint could not be recorded. Start a fresh session before continuing.', 'error');
      }
      pi.appendEntry('claude-sdk-clone', { sessionId: ctx.sessionManager.getSessionId(), state });
      clone = { entryId: ctx.sessionManager.getLeafId()!, state };
      checkpoint = undefined; recovery = undefined; compaction = undefined; tree = undefined;
      restore(ctx);
    }
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
    if (next) { checkpoint = next; compaction = undefined; clone = undefined; tree = undefined; pi.appendEntry('claude-sdk-checkpoint', next); }
    if (process.env.PI_REMOTE_WORKER === '1' && ctx.model?.provider === providerId) {
      ctx.ui.setStatus('claude-sdk-checkpoint', next ? 'saved' : 'unavailable');
      ctx.ui.setStatus('claude-sdk-checkpoint', undefined);
    }
  });
  pi.on('session_shutdown', () => {
    treePlan?.proof.close(); treePlan = undefined;
    for (const child of borrowed.values()) child.close(); borrowed.clear();
    bridge?.close(); bridge = undefined; checkpoint = undefined; recovery = undefined; compaction = undefined; clone = undefined; tree = undefined; compacting = false;
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
    if (ctx.model?.provider !== providerId && !checkpoint && !compaction && !clone && !sdkHistory) return;
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
      checkpoint = undefined; recovery = undefined; clone = undefined; tree = undefined; compaction = receipt;
      restore(ctx);
    } catch (error) {
      console.error('[claude-sdk:compaction] Checkpoint rejected:', error);
      const entry = ctx.sessionManager.getBranch().findLast(row => row.type === 'compaction');
      if (entry) { compaction = { entryId: entry.id, state: null }; clone = undefined; tree = undefined; checkpoint = undefined; recovery = undefined; restore(ctx); }
      else bridge?.close();
      ctx.ui.notify('SDK compaction checkpoint could not be recorded. Start a fresh session before continuing.', 'error');
    }
  });
  pi.on('session_before_tree', (event, ctx) => {
    treePlan?.proof.close(); treePlan = undefined;
    const source = ctx.sessionManager.getBranch(), all = ctx.sessionManager.getEntries();
    const selected = ctx.sessionManager.getBranch(event.preparation.targetId), target = selected.at(-1);
    const sdk = (entries: SessionEntry[]) => entries.some(row => row.type === 'message' && row.message.role === 'assistant' && row.message.provider === providerId);
    if (!sdk(source) && !sdk(selected) && !checkpoint && !clone && !compaction && !tree) return;
    try {
      if (!ctx.sessionManager.getSessionFile() || target?.id !== event.preparation.targetId) throw new Error('Invalid SDK tree point.');
      if (target.type === 'custom_message' || target.type === 'message' && target.message.role === 'user') selected.pop();
      const sourceId = selected.at(-1)?.id ?? null, sessionId = ctx.sessionManager.getSessionId();
      // Pi has already checked idle before entering this hook; its summary controller now makes ctx.isIdle() false.
      const outgoing = projectionMessages(source, true);
      if (!sdk(source) && !checkpoint && !clone && !compaction) {
        bridge!.prepareCompaction(outgoing);
        const accepted = tree && (tree.state as { prefix?: unknown[] } | null)?.prefix?.length;
        if (outgoing.at(-1)?.role !== 'assistant' && outgoing.filter(message => message.role !== 'system').length !== accepted) throw new Error('Incomplete outgoing history.');
      } else bridge!.prepareClone(outgoing, sessionId, `${sessionId}:tree`);
      for (const candidate of [undefined, ...all.filter(row => row.type === 'custom' && row.customType === 'claude-sdk-checkpoint').reverse()]) {
        const branch = candidate ? ctx.sessionManager.getBranch(candidate.id) : selected;
        if (sourceId !== null && !branch.some(row => row.id === sourceId)) continue;
        const saved = readBranch(branch, all);
        if (sdk(branch) && !saved.checkpoint && !saved.compaction && !saved.clone && !saved.tree) continue;
        const proof = branchBridge(ctx, saved, () => branch), before = projectionMessages(branch, true), messages = projectionMessages(selected, true);
        try {
          proof.prepareTree(before, messages, sessionId);
          treePlan = { oldLeafId: event.preparation.oldLeafId, sourceId, proof, before }; break;
        } catch { proof.close(); }
      }
      if (!treePlan) throw new Error('No completed SDK proof for the selected tree history.');
      // A durable intent prevents an older native checkpoint resuming if navigation publishes no receipt.
      pi.appendEntry('claude-sdk-tree-start', { sourceId, sdkSessionIds: [...new Set(all.flatMap(row => row.type === 'custom' && row.customType === 'claude-sdk-checkpoint'
        ? [(row.data as { sdkSessionId?: unknown })?.sdkSessionId] : []).filter(id => typeof id === 'string'))] });
    } catch (error) {
      treePlan?.proof.close(); treePlan = undefined;
      console.error('[claude-sdk:tree] Preparation rejected:', error);
      ctx.ui.notify('Cannot navigate SDK history safely. Finish or recover the interrupted turn, or choose a validated history point.', 'warning');
      return { cancel: true };
    }
  });
  pi.on('session_tree', (event, ctx) => {
    const plan = treePlan; treePlan = undefined;
    if (!plan) { loadBranch(ctx); return; }
    let state: unknown = null;
    try {
      if (event.oldLeafId !== plan.oldLeafId) throw new Error('SDK tree source changed.');
      const branch = ctx.sessionManager.getBranch(), boundary = plan.sourceId === null ? 0 : branch.findIndex(row => row.id === plan.sourceId) + 1;
      const selected = branch.slice(0, boundary), tail = branch.slice(boundary);
      if ((selected.at(-1)?.id ?? null) !== plan.sourceId || tail.some(row => row.type !== 'label' && row.id !== event.summaryEntry?.id) ||
        event.summaryEntry && !tail.some(row => row.type === 'branch_summary' && row.id === event.summaryEntry!.id &&
          row.parentId === plan.sourceId && row.summary === event.summaryEntry!.summary)) throw new Error('SDK tree target changed.');
      state = plan.proof.prepareTree(plan.before, projectionMessages(selected, true), ctx.sessionManager.getSessionId(), recoveryMessages(ctx, true));
      pi.appendEntry('claude-sdk-tree', { sourceId: plan.sourceId, state });
      loadBranch(ctx);
    } catch (error) {
      console.error('[claude-sdk:tree] Checkpoint rejected:', error);
      tree = { entryId: '', sourceId: plan.sourceId, state: null }; checkpoint = undefined; recovery = undefined; clone = undefined; compaction = undefined;
      restore(ctx);
      ctx.ui.notify('SDK tree checkpoint could not be recorded. Start a fresh session before continuing.', 'error');
    } finally { plan.proof.close(); }
  });
  pi.on('session_before_fork', (event, ctx) => {
    const history = recoveryMessages(ctx, true);
    if (ctx.model?.provider !== providerId && !history.some(message => message.role === 'assistant' && message.provider === providerId)) return;
    try {
      if (!ctx.isIdle() || !ctx.sessionManager.getSessionFile()) throw new Error('SDK branching requires an idle saved session.');
      const selected = ctx.sessionManager.getBranch(event.entryId);
      if (selected.at(-1)?.id !== event.entryId || !ctx.sessionManager.getBranch().some(entry => entry.id === event.entryId) ||
        event.position !== 'at' && event.position !== 'before') throw new Error('Invalid SDK branch point.');
      if (event.position === 'before') {
        const entry = selected.pop()!;
        if (entry.type !== 'message' || entry.message.role !== 'user') throw new Error('SDK forks require a user message.');
      }
      bridge!.prepareClone(history, ownerId!, `${ownerId}:branch`);
      const target = branchBridge(ctx, readBranch(selected, ctx.sessionManager.getBranch()), () => selected);
      try {
        try { target.prepareClone(projectionMessages(selected, true), ownerId!, `${ownerId}:branch`); }
        catch { bridge!.prepareFork(history, projectionMessages(selected, true), ownerId!, `${ownerId}:branch`); }
      } finally { target.close(); }
    } catch (error) {
      console.error('[claude-sdk:branch] Preparation rejected:', error);
      ctx.ui.notify('Cannot branch SDK history safely. Finish or recover the interrupted turn, or choose a completed history point.', 'warning');
      return { cancel: true };
    }
  });
}
