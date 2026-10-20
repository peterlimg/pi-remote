export const sessionGroup = item => ['working', 'waiting', 'starting'].includes(item.status) ? 'now' : item.pinned ? 'pinned' : 'recent';
export const activityOrder = (a, b) => (b.status === 'waiting') - (a.status === 'waiting') ||
  (b.lastPromptAt ?? b.updatedAt) - (a.lastPromptAt ?? a.updatedAt) || a.id.localeCompare(b.id);

export function loadedSkill(message) {
  if (message?.role !== 'user') return;
  const text = message.text || '';
  const header = text.match(/^<skill name="([^"]+)" location="[^"]+">\r?\n/);
  if (!header) return;
  const end = text.indexOf('\n</skill>', header[0].length);
  // The mobile history limit can cut off a long skill before its closing tag.
  if (end < 0 && !message.truncated) return;
  return { name: header[1], text: end < 0 ? '' : text.slice(end + '\n</skill>'.length).trim() };
}

export function taskText(message) {
  const skill = loadedSkill(message);
  if (skill) return skill.text || 'Skill: ' + skill.name;
  const name = message?.role === 'user' && message.truncated && rawSkillName(message.text);
  return name ? 'Skill: ' + name : message?.text || '';
}

const rawSkillName = title => title?.match(/^<skill name="([^"]+)"/)?.[1];
export const unnamed = title => !title || title === 'Untitled session' || title.startsWith('Pi · ') || !!rawSkillName(title);

// A stable fallback until Pi can name the task. Never turn a follow-up into its identity.
export function sessionTitle(title, messages = []) {
  if (!unnamed(title)) return title;
  const skillName = rawSkillName(title);
  const first = messages.find(message => message.role === 'user' && message.text?.trim());
  // Old bridges can keep sending a raw fallback after the original request leaves the last 100 messages.
  const text = skillName ? messages.map(loadedSkill).find(skill => skill?.name === skillName)?.text || 'Skill: ' + skillName : taskText(first);
  const line = text.replace(/\s+/g, ' ').trim();
  return line ? (line.length > 80 ? line.slice(0, 79) + '…' : line) : title || 'Untitled session';
}

// Older terminal bridges lack retry metadata; a completed reply in the same turn resolves its failed attempts.
export function replyAttempts(state, messages = state.messages || []) {
  const recovered = new Set(); let current = [];
  for (const message of messages) {
    if (message.retryAttempt) recovered.add(message.id);
    if (message.role === 'user') current = [];
    else if (message.role === 'assistant') {
      if (message.stopReason === 'error') current.push(message.id);
      else if (['stop', 'length', 'toolUse'].includes(message.stopReason)) {
        for (const id of current) recovered.add(id);
        current = [];
      }
    }
  }
  const retrying = state.retrying === true || !state.pendingReply && state.status === 'working' && current.length > 0;
  if (retrying) for (const id of current) recovered.add(id);
  return { recovered, retrying };
}

// Live events predate their JSONL entry IDs; history uses this alias only at the live boundary.
export const messageKey = message => `${message.role}:${message.timestamp ?? message.id}:${message.toolCallId || ''}`;

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
