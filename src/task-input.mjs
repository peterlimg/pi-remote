export const TASK_INPUT = '[Pi Remote task input]\n';
export function parseTaskInput(text) {
  if (typeof text !== 'string' || !text.startsWith(TASK_INPUT)) return;
  try {
    const value = JSON.parse(text.slice(TASK_INPUT.length));
    if (value.version !== 1 || typeof value.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(value.generation) ||
      !Array.isArray(value.inputIds) || !value.inputIds.length || value.inputIds.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) ||
      new Set(value.inputIds).size !== value.inputIds.length || !Array.isArray(value.messages) ||
      value.messages.some(message => !value.inputIds.includes(message.id) || typeof message.text !== 'string') ||
      typeof value.note !== 'string') return;
    return value;
  } catch { return; }
}
export function taskInputText(value) {
  return [value.note, ...value.messages.map(message => message.text)].filter(Boolean).join('\n\n');
}
export function encodeTaskInput(generation, inputs, recorded, note = '') {
  return TASK_INPUT + JSON.stringify({ version: 1, generation, inputIds: inputs.map(input => input.id), note,
    messages: inputs.filter(input => !recorded.has(input.id)).map(({ id, text }) => ({ id, text })) });
}
