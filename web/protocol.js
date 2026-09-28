export function diffState(previous, next) {
  const before = new Map((previous.messages || []).map(x => [x.id, JSON.stringify(x)]));
  const messages = next.messages || [];
  const { messages: ignored, ...meta } = next;
  const changed = {};
  for (const [key, value] of Object.entries(meta)) if (JSON.stringify(previous[key]) !== JSON.stringify(value)) changed[key] = value;
  // Undefined fields disappear in JSON, so send their removal explicitly.
  const removed = Object.keys(previous).filter(key => key !== 'messages' && next[key] === undefined);
  return { meta: changed, removed, order: messages.map(x => x.id), upsert: messages.filter(x => before.get(x.id) !== JSON.stringify(x)) };
}
export function patchState(previous, patch) {
  const state = { ...previous, ...patch.meta }, messages = new Map((previous.messages || []).map(x => [x.id, x]));
  for (const key of patch.removed) delete state[key];
  for (const message of patch.upsert) messages.set(message.id, message);
  state.messages = patch.order.map(id => {
    if (!messages.has(id)) throw new Error('Missing message; fetch snapshot');
    return messages.get(id);
  });
  return state;
}
