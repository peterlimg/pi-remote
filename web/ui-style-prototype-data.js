// Public, synthetic fixtures. These credentials unlock only the in-memory preview server.
export const demoToken = 'pi-remote-public-design-preview-only';
export const demoKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const models = [
  { provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { provider: 'anthropic', id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { provider: 'openai', id: 'gpt-5.4', name: 'GPT-5.4' }
];
export function demoSessions() {
  const now = Date.now();
  const tasks = [
    ['mobile', 'Polish the mobile workspace', 'pi-remote', 'working', false, 'Keep the conversation in focus.'],
    ['auth', 'Review authentication flow', 'pi-remote', 'waiting', false, 'Ready for your review of the pairing screen.'],
    ['billing', 'Simplify the checkout flow', 'storefront', 'working', false, 'Checking the mobile payment form.'],
    ['reconnect', 'Make reconnect recovery reliable', 'pi-remote', 'idle', true, 'Your draft stays put when the connection drops.'],
    ['guide', 'Write the getting-started guide', 'docs', 'idle', true, 'The first-run walkthrough is ready to read.'],
    ['keyboard', 'Fix the keyboard safe area', 'pi-remote', 'idle', false, 'The composer follows the visible viewport.'],
    ['cart', 'Review the cart empty state', 'storefront', 'idle', false, 'A clear next step when the cart is empty.'],
    ['commands', 'Make slash commands easier to find', 'pi-remote', 'idle', false, 'Command suggestions stay close to the input.']
  ];
  return tasks.map(([id, title, project, status, pinned, preview], index) => ({
    id, title, cwd: '/sample/projects/' + project, status, pinned, preview, previewRole: 'assistant',
    updatedAt: now - index * 180000, lastPromptAt: now - index * 180000,
    model: 'anthropic/claude-sonnet-4-6', modelName: 'Claude Sonnet 4.6', thinkingLevel: 'high',
    contextUsage: { tokens: 64000, contextWindow: 200000, percent: 32 },
    messages: id === 'mobile' ? [
      { id: 'request', role: 'user', text: 'Make this feel more like a native mobile app, without getting in the way of reading.' },
      { id: 'progress', role: 'assistant', text: 'I’ll keep the chat familiar and give navigation a little more definition.' },
      { id: 'calls', role: 'assistant', toolCalls: [
        { id: 'read-styles', name: 'read', text: JSON.stringify({ path: 'web/style.css' }) },
        { id: 'edit-styles', name: 'edit', text: JSON.stringify({ path: 'web/style.css' }) }
      ] },
      { id: 'read-result', role: 'toolResult', toolCallId: 'read-styles', toolName: 'read', text: 'Existing color tokens, session rows, conversation header, and composer.' },
      { id: 'edit-result', role: 'toolResult', toolCallId: 'edit-styles', toolName: 'edit', text: 'Sample preview only. No source files were changed by this conversation.' },
      { id: 'reply', role: 'assistant', text: '**More room for the conversation.**\n\nThe familiar chat stays at the center. Project filters make sessions easier to find, and quieter surfaces separate controls from content.\n\n- Clear working and waiting states\n- Model and effort within thumb reach\n- One focused sheet at a time\n\nTry another session, open model settings, or compare this with the original below.' }
    ] : [
      { id: id + '-user', role: 'user', text: title + '. Keep the mobile experience simple.' },
      { id: id + '-reply', role: 'assistant', text: '**' + preview + '**\n\nThis is a sample conversation so you can judge the layout with realistic content.\n\nOpen the model or effort controls to explore the sheet design. Anything you change here stays inside this preview.' }
    ], tools: []
  }));
}
