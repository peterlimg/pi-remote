// Restart safety is separate from the phone's presentation status.
const quiescent = new Set(['suspended', 'ready', 'blocked', 'stopped']);
const checkpointStatus = 'claude-sdk-checkpoint';
const base = state => state.phase === 'input' ? base(state.resume) : state;
const finish = state => state.phase === 'checkpointing' && !state.waitFor.length
  ? { ...state, phase: state.blocked ? 'blocked' : 'ready' } : state;

function transitionSession(state, event) {
  if (event.type === 'worker_exit') return { ...base(state), phase: 'stopped',
    blocked: base(state).pendingTools.length ? 'unknown-tool-result' : base(state).blocked };
  if (event.type === 'restore') {
    // Startup snapshots can arrive after live events; never roll an active run back to idle.
    if (state.phase !== 'starting') return state;
    return { phase: event.streaming ? 'running' : 'suspended', sdk: event.provider === 'claude-sdk', pendingTools: [], receipts: [], waitFor: [] };
  }
  if (state.phase === 'input') {
    if (event.type === 'input_closed' || event.type === 'ui_prompt_end') return state.resume;
    return { phase: 'input', resume: transitionSession(state.resume, event) };
  }
  if (event.type === 'request_rejected') return { ...state, phase: 'blocked', blocked: 'request-rejected', waitFor: [] };
  if (event.type === 'extension_ui_request' && ['select', 'confirm', 'input', 'editor'].includes(event.method)) {
    return { phase: 'input', resume: state };
  }
  if (event.type === 'model_select') return { ...state, sdk: event.model.provider === 'claude-sdk' };
  if (event.type === 'request_started' && state.phase !== 'starting' && !quiescent.has(state.phase)) return state;
  if (event.type === 'agent_start' || event.type === 'request_started') {
    return { ...state, phase: 'running', pendingTools: [], receipts: [], waitFor: [], blocked: undefined };
  }
  if (event.type === 'message_end' && event.message?.role === 'assistant') {
    const message = event.message;
    if (message.provider) state = { ...state, sdk: message.provider === 'claude-sdk' };
    if (['error', 'aborted'].includes(message.stopReason)) {
      return { ...state, phase: 'checkpointing', blocked: state.pendingTools.length ? 'unknown-tool-result' : 'turn-failed', waitFor: ['settled'] };
    }
    const calls = Array.isArray(message.content) ? message.content.filter(block => block.type === 'toolCall').map(block => block.id) : [];
    if (calls.length) {
      if (state.pendingTools.length || calls.some(id => typeof id !== 'string' || !id) || new Set(calls).size !== calls.length) {
        return { ...state, phase: 'checkpointing', blocked: 'invalid-tool-batch', waitFor: ['settled'] };
      }
      return { ...state, phase: 'tools', pendingTools: calls };
    }
  }
  if (event.type === 'message_end' && event.message?.role === 'toolResult') {
    if (!state.pendingTools.includes(event.message.toolCallId)) {
      return { ...state, phase: 'checkpointing', blocked: 'unexpected-tool-result', waitFor: ['settled'] };
    }
    const pendingTools = state.pendingTools.filter(id => id !== event.message.toolCallId);
    return { ...state, pendingTools, phase: pendingTools.length ? 'tools' : 'running' };
  }
  if (event.type === 'agent_end') {
    const blocked = state.blocked || (state.pendingTools.length ? 'unknown-tool-result' : undefined);
    return finish({ ...state, phase: 'checkpointing', blocked,
      waitFor: ['settled', ...(state.sdk && !blocked ? ['checkpoint'] : [])].filter(name => !state.receipts.includes(name)) });
  }
  const receipt = event.type === 'agent_settled' ? 'settled' :
    event.type === 'extension_ui_request' && event.method === 'setStatus' && event.statusKey === checkpointStatus && event.statusText === 'saved' ? 'checkpoint' : undefined;
  if (receipt) {
    const receipts = [...new Set([...state.receipts, receipt])];
    if (receipt === 'settled' && state.phase !== 'checkpointing') {
      return finish({ ...state, phase: 'checkpointing', receipts,
        blocked: state.blocked || (state.pendingTools.length ? 'unknown-tool-result' : undefined),
        waitFor: state.sdk && !state.blocked && !state.pendingTools.length && !receipts.includes('checkpoint') ? ['checkpoint'] : [] });
    }
    return finish({ ...state, receipts, waitFor: state.waitFor.filter(name => name !== receipt) });
  }
  if (event.type === 'extension_ui_request' && event.method === 'setStatus' && event.statusKey === checkpointStatus && event.statusText === 'unavailable') {
    return finish({ ...state, phase: 'checkpointing', blocked: state.blocked || 'checkpoint-unavailable',
      waitFor: state.receipts.includes('settled') ? [] : ['settled'] });
  }
  return state;
}

export function createSessionLifecycle() {
  let state = { phase: 'starting', sdk: false, pendingTools: [], receipts: [], waitFor: [] };
  return {
    get snapshot() {
      const current = base(state);
      return { phase: state.phase, pendingTools: current.pendingTools.length, waitFor: [...current.waitFor],
        blocked: current.blocked, restartSafe: state.phase !== 'input' && quiescent.has(state.phase) };
    },
    send(event) { state = transitionSession(state, event); return this.snapshot; },
  };
}
