export const title = 'Safe continuation after an interrupted turn';
export const state = v => {
  const bad = [];
  if (Object.values(v.deliveries).some(count => count > 1)) bad.push('Input duplicated');
  if (v.staleAccepted) bad.push('Stale report accepted');
  if (v.stoppedRestart) bad.push('Stopped task restarted');
  if (v.unsafeResume) bad.push('Uncertain work restarted');
  if (v.attempts > 2) bad.push('Retry budget exceeded');
  if (bad.length) return bad.join(' + ');
  if (v.phase === 'working' && v.effect === 'pending') return 'Tool running';
  if (v.phase === 'recovering' && v.effect === 'uncertain') return 'Uncertain tool outcome';
  return { queued: 'Instructions queued', working: 'Worker running', recovering: 'Recovery pending',
    checking: 'Checking saved work', blocked: 'Needs a decision', stopped: 'Stopped', reported: 'Result ready' }[v.phase];
};
export const step = action => ({
  Dispatch: 'deliver unread instructions', ReadInputs: 'worker reads its inputs', Followup: 'you send a follow-up',
  StartTool: 'worker starts a tool', FinishTool: 'tool result saved', Report: 'worker returns its report',
  Interrupt: 'turn interrupted', BeginRecoveryCheck: 'inspect history and workspace',
  FinishRecoveryCheck: 'resume remaining work', BlockRecovery: 'ask one recovery question',
  Stop: 'you stop this task', LateReport: 'an older attempt reports', Inspect: 'inspect task'
})[action] || action;
