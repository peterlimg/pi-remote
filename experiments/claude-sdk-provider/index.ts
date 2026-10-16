import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider, type ApiKeyAuth, type Model } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createBridge, sdkEnvironment } from './bridge.ts';

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

export default function (pi: ExtensionAPI) {
  let bridge: ReturnType<typeof createBridge> | undefined;
  let checkpoint: unknown;
  const restore = (ctx: ExtensionContext) => {
    bridge?.close();
    bridge = createBridge(ctx.cwd, undefined, { persistSession: Boolean(ctx.sessionManager.getSessionFile()), checkpoint });
  };
  const streamSimple: ReturnType<typeof createBridge>['streamSimple'] = (...args) => {
    if (!bridge) throw new Error('Claude SDK requires an active Pi session.');
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
    const entry = ctx.sessionManager.getBranch().findLast(entry => entry.type === 'custom' && entry.customType === 'claude-sdk-checkpoint');
    checkpoint = entry?.type === 'custom' ? entry.data : undefined;
    restore(ctx);
  });
  pi.on('agent_settled', (_event, ctx) => {
    const next = bridge?.checkpoint();
    if (next) { checkpoint = next; pi.appendEntry('claude-sdk-checkpoint', next); }
    if (process.env.PI_REMOTE_WORKER === '1' && ctx.model?.provider === providerId) {
      ctx.ui.setStatus('claude-sdk-checkpoint', next ? 'saved' : 'unavailable');
      ctx.ui.setStatus('claude-sdk-checkpoint', undefined);
    }
  });
  pi.on('session_shutdown', () => { bridge?.close(); bridge = undefined; checkpoint = undefined; });
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
  const blockHistoryChange = (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.model?.provider !== providerId) return;
    if (ctx.hasUI) ctx.ui.notify('Claude SDK experiment does not support compaction, branching, or forks. Start a new session.', 'warning');
    return { cancel: true };
  };
  pi.on('session_before_compact', blockHistoryChange);
  pi.on('session_before_tree', blockHistoryChange);
  pi.on('session_before_fork', blockHistoryChange);
}
