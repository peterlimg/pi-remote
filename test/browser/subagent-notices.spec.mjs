import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { acquireLock, sessionKey } from '../../src/locks.mjs';
import { readSession, EXTENSION_INPUT } from '../../src/catalog.mjs';
import { initialState, applyEvent } from '../../src/state.mjs';
import { socket, until } from '../helpers.mjs';

const request = 'Subagent needs a supervisor decision. Run: c9e6c5e0-088d-46a8-8fbf-951636363075\nAgent: reviewer Child index: 0\n\nPlease supply the exact diff.\n\nReply with: subagent_supervisor({ action: "reply", replyTo: "request-id", message: "..." })';
const notice = (customType, details, content = request) => ({ role: 'custom', customType, details, content, display: true });
const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=' };

test('saved subagent notices stay compact after reload and in older history', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-subagent-history-')), file = join(dir, 'session.jsonl');
  let host;
  try {
    const entries = [{ type: 'session', id: 'subagent-history', cwd: dir }];
    const append = fields => entries.push({ id: 'entry-' + entries.length, parentId: entries.at(-1).id, timestamp: new Date().toISOString(), ...fields });
    const saved = (customType, details) => ({ type: 'custom_message', customType, details, content: request, display: true });
    append({ type: 'session_info', name: 'Subagent history' });
    append(saved('subagent_supervisor_request', { agent: 'old reviewer', reason: 'need_decision' }));
    for (let i = 0; i < 110; i++) append({ type: 'message', message: { role: 'toolResult', toolCallId: 'read-' + i, toolName: 'read', content: 'Saved file ' + i, timestamp: i } });
    append(saved('subagent_supervisor_request', { agent: 'reviewer', reason: 'need_decision' }));
    writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const config = loadConfig(dir);
    host = await startHost({ dir, config, port: 0, roots: [dir], relayUrl: '' });
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.getByRole('combobox', { name: 'Filter recent sessions' }).selectOption('offline');
    await page.getByRole('button', { name: /Subagent history/ }).click();
    const transcript = page.locator('#transcript');
    const recent = transcript.locator('details.tool-activity').filter({ has: page.locator('summary', { hasText: /^reviewer requested guidance$/ }) });
    await expect(recent).toHaveCount(1);
    await expect(recent).not.toHaveAttribute('open');
    await expect(recent.locator('.extension-prompt')).toBeHidden();
    await expect(transcript.locator('article.message')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('subagent-collapsed-mobile.png') });
    await page.reload();
    await page.getByRole('combobox', { name: 'Filter recent sessions' }).selectOption('offline');
    await page.getByRole('button', { name: /Subagent history/ }).click();
    await expect(recent).toHaveCount(1);
    await expect(recent).not.toHaveAttribute('open');
    await transcript.hover(); await page.mouse.wheel(0, -100);
    const older = transcript.locator('details.tool-activity').filter({ has: page.locator('summary', { hasText: /^old reviewer requested guidance$/ }) });
    await expect(older).toHaveCount(1);
    await expect(older.locator('.extension-prompt')).toBeHidden();
    await older.locator('summary').click();
    await expect(older.locator('.extension-prompt')).toHaveText(request);
    await expect(older.locator('.extension-prompt')).toBeVisible();
    for (const [width, scheme] of [[320, 'dark'], [1280, 'light']]) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: scheme });
      await older.scrollIntoViewIfNeeded();
      expect(await transcript.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`subagent-expanded-${width}.png`) });
    }
    await testInfo.attach('subagent-history', { body: await transcript.ariaSnapshot(), contentType: 'text/plain' });
  } finally {
    await page.close(); await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('live subagent notice types collapse without hiding replies or unrelated extensions', async ({ page }, testInfo) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-subagent-live-')), file = join(dir, 'session.jsonl');
  let host, agent, lock;
  try {
    writeFileSync(file, [
      { type: 'session', id: 'subagent-live', cwd: dir },
      { type: 'session_info', id: 'name', parentId: null, name: 'Subagent activity' }
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const config = loadConfig(dir), instanceId = 'subagent-live-instance', id = sessionKey(file);
    host = await startHost({ dir, config, port: 0, roots: [dir], relayUrl: '' });
    const state = initialState({ ...readSession(file), instanceId });
    applyEvent(state, { type: 'agent_start' });
    lock = acquireLock(join(dir, 'locks'), id, { file, instanceId });
    agent = await socket(`ws://127.0.0.1:${host.http.address().port}/bridge`, config.bridgeToken);
    agent.ws.send(JSON.stringify({ type: 'register', owner: lock.owner, state }));
    agent.ws.on('message', raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.type === 'command') agent.ws.send(JSON.stringify({ type: 'result', id: packet.id, ok: true, value: { commands: [] } }));
    });
    await until(() => host.service.live.has(id));
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await page.getByRole('button', { name: /Subagent activity/ }).click();
    let timestamp = 1000;
    const publish = message => {
      applyEvent(state, { type: 'message_end', message: { timestamp: ++timestamp, ...message } });
      agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    };
    // Simulate an already-running terminal whose bridge stripped custom metadata before this fix.
    appendFileSync(file, JSON.stringify({ type: 'custom_message', id: 'legacy', parentId: 'name',
      timestamp: new Date(500).toISOString(), customType: 'subagent_supervisor_request',
      details: { agent: 'legacy reviewer', reason: 'need_decision' }, display: true, content: [{ type: 'text', text: request }, image] }) + '\n');
    state.messages.push({ id: 'custom:500:', role: 'custom', text: request + '\n[image]', timestamp: 500 });
    state.revision++; agent.ws.send(JSON.stringify({ type: 'snapshot', state }));
    const transcript = page.locator('#transcript');
    await expect(transcript.locator('details.tool-activity summary')).toHaveText('legacy reviewer requested guidance');
    const cases = [
      ['subagent_supervisor_request', { agent: 'reviewer', reason: 'need_decision' }, 'reviewer requested guidance'],
      ['subagent_supervisor_request', { agent: 'scout', reason: 'interview_request' }, 'scout requested structured guidance'],
      ['subagent_supervisor_request', { agent: 'builder', reason: 'progress_update' }, 'builder sent a progress update'],
      ['subagent-notify', { runs: [{ agent: 'reviewer', status: 'completed' }] }, 'reviewer completed'],
      ['subagent-notify', { runs: [{ agent: 'builder', status: 'failed' }] }, 'builder failed'],
      ['subagent-notify', { runs: [{ agent: 'scout', status: 'completed' }, { agent: 'reviewer', status: 'failed' }] }, '2 subagent results need attention'],
      ['subagent-notify', undefined, 'Subagent result'],
      ['subagent-supervisor-unanswered', undefined, 'Subagent guidance unanswered'],
      ['subagent-supervisor-blocked', undefined, 'Subagent guidance blocked'],
      ['subagent-completion-unanswered', undefined, 'Subagent results awaiting review'],
      ['subagent-completion-unhandled', undefined, 'Subagent results need attention'],
      ['subagent-wait-subscription', undefined, 'Subagent wait finished'],
      ['subagent-incremental-child-notify', { outcome: 'failed' }, 'Subagent workflow failed'],
      ['subagent-workflow-result-write-failed', undefined, 'Subagent result could not be saved'],
      ['subagent_control_notice', { event: { agent: 'builder', type: 'needs_attention' } }, 'builder needs attention'],
      ['subagent_steering_notice', { state: 'failed' }, 'Subagent guidance failed'],
      ['subagent_watchdog_warning', undefined, 'Subagent review warning'],
      ['subagent_watchdog_clarification', undefined, 'Subagent review needs clarification'],
      ['subagent-future-notice', { agent: {}, runs: [null] }, 'Subagent update']
    ];
    for (const [type, details, label] of cases) {
      publish(notice(type, details));
      await expect(transcript.locator('details.tool-activity').last().locator('summary')).toHaveText(label);
    }
    await expect(transcript.locator('details.tool-activity')).toHaveCount(cases.length + 1);
    await expect(transcript.locator('details[open]')).toHaveCount(0);
    await expect(transcript.locator('article.message')).toHaveCount(0);
    const first = transcript.locator('details.tool-activity').first();
    await first.locator('summary').focus(); await page.keyboard.press('Enter');
    await expect(first.locator('.extension-prompt')).toHaveText(request);
    await expect(first.locator('.extension-prompt')).toBeVisible();
    const preview = first.locator('.thread-images img');
    await expect(preview).toBeVisible();
    await expect.poll(() => preview.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    publish({ role: 'assistant', content: 'The review is complete. Here is the useful answer.', stopReason: 'stop' });
    await expect(transcript.getByRole('article', { name: 'Pi', exact: true })).toContainText('The review is complete.');
    await expect(first).toHaveAttribute('open', '');
    await expect(first.locator('summary')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(first).not.toHaveAttribute('open');
    publish(notice('billing_notice', undefined, 'Account usage is available.'));
    publish(notice('subagent-slash-text-result', undefined, 'Requested subagent command output.'));
    publish(notice('subagent-slash-result', undefined, 'Structured subagent command output.'));
    publish({ role: 'assistant', content: request, customType: 'subagent_supervisor_request' });
    publish({ ...notice('subagent-hidden', undefined, 'Model-only subagent context'), display: false });
    const wake = 'Inspect subagent updates above. Answer pending supervisor requests within your authority.';
    applyEvent(state, { type: 'extension_ui_request', method: 'setStatus', statusKey: EXTENSION_INPUT, statusText: wake });
    publish({ role: 'user', content: wake });
    await expect(transcript.locator('article.message')).toHaveCount(5);
    await expect(transcript).toContainText('Account usage is available.');
    await expect(transcript.locator('article.message')).toContainText(['The review is complete.', 'Account usage is available.',
      'Requested subagent command output.', 'Structured subagent command output.', 'Subagent needs a supervisor decision.']);
    await expect(transcript.locator('.message-text').last()).toContainText('subagent_supervisor');
    await expect(transcript).not.toContainText('Model-only subagent context');
    const wakeRow = transcript.locator('details.tool-activity').last();
    await expect(wakeRow.locator('summary')).toHaveText('Prompted by an extension');
    await expect(wakeRow.locator('.extension-prompt')).toBeHidden();
    expect(await transcript.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await testInfo.attach('subagent-live', { body: await transcript.ariaSnapshot(), contentType: 'text/plain' });
  } finally {
    await page.close(); agent?.ws.terminate(); lock?.release(); await host?.close(); rmSync(dir, { recursive: true, force: true });
  }
});
