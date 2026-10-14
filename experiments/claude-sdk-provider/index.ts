import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider, type ApiKeyAuth } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
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
  const streamSimple: ReturnType<typeof createBridge>['streamSimple'] = (...args) => {
    if (!bridge) throw new Error('Claude SDK requires an active Pi session.');
    return bridge.streamSimple(...args);
  };
  const catalog = anthropicProvider().getModels().find(model => model.id === 'claude-haiku-5-5');
  if (!catalog) throw new Error('This experiment requires Pi 1.1.0 with Claude Haiku 5.5 metadata.');
  const { compat: _compat, ...metadata } = catalog;
  pi.registerProvider(createProvider({
    id: providerId, name: 'Claude SDK experiment', auth: { apiKey: localLogin },
    models: [{ ...metadata, provider: providerId, api: 'claude-sdk', baseUrl: '',
      name: 'Claude SDK Haiku 5.5 (experimental)', input: ['text'], reasoning: false,
      thinkingLevelMap: { off: null }, promptCache: undefined, maxTokens: 4096 }],
    api: { stream: streamSimple, streamSimple },
  }));
  pi.on('session_start', (_event, ctx) => { bridge?.close(); bridge = createBridge(ctx.cwd); });
  pi.on('session_shutdown', () => { bridge?.close(); bridge = undefined; });
  pi.on('message_end', (event, ctx) => {
    const message = event.message;
    // Pi 1.1.0's lazy auth wrapper reports cancellation before our stream as a setup error.
    if (message.role === 'assistant' && message.provider === providerId && message.stopReason === 'error' && ctx.signal?.aborted) {
      bridge?.close();
      return { message: { ...message, content: [], stopReason: 'aborted', errorMessage: 'Cancelled.' } };
    }
  });
  pi.on('model_select', event => {
    if (event.previousModel?.provider === providerId && event.model.provider !== providerId) bridge?.close();
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
