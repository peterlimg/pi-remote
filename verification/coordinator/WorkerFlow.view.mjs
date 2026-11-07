const labels = {
  starting: 'Starting worker', working: 'Worker running', waiting: 'Question waiting',
  reported: 'Result ready', completed: 'Result accepted', stopping: 'Stop pending',
  stopped: 'Worker stopped', unknown: 'Needs inspection'
};
export const title = 'Coordinator and worker task flow';
export const state = v => v.acceptedValid && v.taskState !== 'completed'
  ? 'Accepted result lost' : labels[v.taskState];
const steps = {
  BeginPrompt: 'coordinator sends an instruction', BeginStop: 'coordinator requests Stop',
  PromptAcknowledged: 'instruction acknowledgement arrives', StopAcknowledged: 'Stop acknowledgement arrives',
  PromptFails: 'instruction reply fails or times out', StopFails: 'Stop reply fails or times out',
  ReportQuestion: 'worker asks a question', ReportResult: 'worker returns a result',
  AcceptResult: 'coordinator accepts the result', Restart: 'host restarts', Inspect: 'inspect task'
};
export const step = (action, from) => {
  if (action === 'StopFails') return null;
  if (action === 'BeginStop' && ['starting', 'stopped', 'unknown'].includes(from.taskState)) return null;
  if (action === 'PromptFails' && !from.acceptedValid && from.taskState !== 'working') return null;
  if (action === 'StopAcknowledged' && from.taskState !== 'stopping' && !from.acceptedValid) return null;
  return steps[action] || action;
};
