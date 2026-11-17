import { test, expect } from '@playwright/test';
import { diffState } from '../../web/protocol.js';

const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';

test('worker sheet scopes history and images without disturbing the live parent', async ({ page }, info) => {
  const parentImage = { id: 'a'.repeat(64), mimeType: 'image/png' }, workerImage = { id: 'b'.repeat(64), mimeType: 'image/png' };
  const task = { id: 'task', sessionId: 'worker', title: 'Messaging and recovery inspection with a long worker name', state: 'working', instruction: 'Inspect screenshot.png.', readOnly: true };
  const parent = { id: 'parent', title: 'Main conversation', cwd: '/project', status: 'idle', updatedAt: Date.now(), messages: [
    { id: 'parent-note', role: 'user', text: 'Keep the main image.', images: [parentImage] }
  ], coordination: { role: 'coordinator', readOnly: false, tasks: [task, { ...task, id: 'recovery-task', sessionId: 'recovery', title: 'Model the worker lifecycle and generate a statechart', state: 'completed', workspace: { integration: 'applied' } }] } };
  let worker = { id: 'worker', title: task.title, cwd: '/project', status: 'working', historyTruncated: true, messages: [
    { id: 'ls-first', role: 'toolResult', toolCallId: 'ls-first', toolName: 'ls', text: 'Source unavailable.', isError: true },
    { id: 'ls-second', role: 'toolResult', toolCallId: 'ls-second', toolName: 'ls', text: 'Source unavailable.', isError: true },
    { id: 'find-failed', role: 'toolResult', toolCallId: 'find-failed', toolName: 'find', text: 'Source unavailable.', isError: true },
    { id: 'worker-call', role: 'assistant', toolCalls: [{ id: 'read-image', name: 'read', text: '{"path":"screenshot.png"}' }] },
    { id: 'worker-result', role: 'toolResult', toolCallId: 'read-image', toolName: 'read', text: 'Image output.', images: [workerImage] }
  ] };
  const older = { messages: [{ id: 'older-worker', role: 'assistant', text: 'Earlier worker finding.' }], older: false, newer: true, tip: 'worker-tip' };
  let client, parentVersion = 0, workerVersion = 0;
  const requests = [], errors = [];
  const checkFloatingSheet = async (roster) => {
    await expect.poll(() => page.locator('#coordinator-sheet').evaluate(node => node.getBoundingClientRect().bottom - innerHeight)).toBeCloseTo(0, 0);
    const geometry = await page.locator('.coordinator-sheet').evaluate(node => {
      const box = node.getBoundingClientRect(), title = node.querySelector('.coordinator-heading').getBoundingClientRect();
      const close = node.querySelector('#coordinator-done'), button = close.getBoundingClientRect();
      return { left: box.left, right: innerWidth - box.right, bottom: innerHeight - box.bottom,
        centered: title.x + title.width / 2 - (box.x + box.width / 2), closeOnLeft: button.x < title.x,
        corners: [getComputedStyle(node).borderTopLeftRadius, getComputedStyle(node).borderBottomLeftRadius],
        button: { width: button.width, height: button.height, radius: getComputedStyle(close).borderRadius } };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(8); expect(geometry.right).toBeGreaterThanOrEqual(8);
    expect(geometry.bottom).toBeGreaterThanOrEqual(8); expect(Math.abs(geometry.centered)).toBeLessThanOrEqual(1);
    expect(geometry.closeOnLeft).toBe(roster); expect(geometry.corners).toEqual(['28px', '28px']);
    expect(geometry.button).toEqual({ width: 44, height: 44, radius: '50%' });
    const control = await page.locator('#coordinator-done').evaluate(node => {
      const circle = getComputedStyle(node, '::before');
      return { width: circle.width, height: circle.height, border: getComputedStyle(node).borderWidth };
    });
    expect(control).toEqual({ width: '32px', height: '32px', border: '0px' });
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw); requests.push(packet);
      let value = [];
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsCoordinator: true, supportsWorkerInspection: true, supportsHistory: true, supportsImages: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [parent, { id: 'other', title: 'Another conversation', cwd: '/project', status: 'idle', updatedAt: Date.now() }] }));
      } else if (packet.op === 'watch') {
        ws.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: parentVersion, state: parent }));
      } else if (packet.op === 'inspectWorker' && packet.sessionId) {
        workerVersion = 0;
        ws.send(JSON.stringify({ type: 'workerSnapshot', sessionId: worker.id, version: workerVersion, state: worker }));
      } else if (packet.op === 'image') {
        value = { type: 'image', mimeType: 'image/png', data: pixel };
      } else if (packet.op === 'history') {
        value = packet.before ? older : { messages: worker.messages, older: true, newer: false, tip: older.tip };
      }
      if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.locator('#sessions .session').filter({ hasText: parent.title }).click();
  const mainImage = page.locator('#transcript .thread-image img');
  await expect(mainImage).toBeVisible(); await expect.poll(() => mainImage.evaluate(node => node.naturalWidth)).toBe(1);
  const mainURL = await mainImage.getAttribute('src');
  await page.locator('#prompt').fill('Keep this main draft.');
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  for (const [name, width, height, colorScheme] of [['phone-light', 390, 844, 'light'], ['phone-dark', 390, 844, 'dark'], ['narrow', 320, 740, 'light'], ['short', 390, 510, 'dark'], ['desktop', 1440, 900, 'dark']]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
    for (const state of ['completed', 'working', 'waiting', 'unknown']) {
      task.state = state;
      client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
      await expect(page.locator('#coordinator-worker-summary')).toHaveText(state === 'working' ? '1 working' : state === 'waiting' ? '1 needs answer' : state === 'unknown' ? '1 need inspection' : 'No active work');
      const box = await page.locator('#coordinator-open').boundingBox();
      expect(box.height).toBe(44); expect(box.width).toBeLessThan(145);
      const composer = await page.locator('#composer').boundingBox();
      const center = composer.x + composer.width / 2;
      expect(Math.abs(box.x + box.width / 2 - center)).toBeLessThanOrEqual(1);
      const dots = await page.locator('#session-swipe').boundingBox();
      expect(dots.height).toBe(28);
      expect(dots.y + dots.height).toBeLessThanOrEqual(box.y + 1);
      expect(Math.abs(dots.x + dots.width / 2 - center)).toBeLessThanOrEqual(1);
      const slots = page.locator('#coordinator-worker-slots');
      await expect(slots).toBeVisible();
      await expect(slots.locator('i')).toHaveCount(2);
      await expect(slots.locator('i[data-working=true]')).toHaveCount(state === 'working' ? 1 : 0);
      await expect(slots.locator('i').first()).toHaveCSS('width', '8px');
      await expect(slots.locator('i').first()).toHaveCSS('height', '4px');
      const alignment = await page.locator('#coordinator-open').evaluate(button => {
        const label = button.firstElementChild.getBoundingClientRect(), mark = button.querySelector('i').getBoundingClientRect();
        const path = button.querySelector('svg path'), ink = path.getBBox();
        const chevron = new DOMPoint(ink.x + ink.width / 2, ink.y + ink.height / 2).matrixTransform(path.getScreenCTM());
        return { label: label.y + label.height / 2, mark: mark.y + mark.height / 2, chevron: chevron.y };
      });
      expect(alignment.mark - alignment.label).toBeCloseTo(1, 1);
      expect(alignment.chevron - alignment.label).toBeCloseTo(1, 1);
      await expect(page.locator('#coordinator-open > span').first()).toHaveText('workers');
      await expect(page.locator('#coordinator-open')).not.toContainText('Idle');
      const fills = await slots.locator('i').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
      expect(fills[1]).toBe('rgba(0, 0, 0, 0)');
      if (state === 'working') expect(fills[0]).not.toBe(fills[1]);
      for (const [selector, rect] of [['#session-swipe', dots], ['#coordinator-open', box]]) {
        expect(await page.evaluate(([selector, x, y]) => document.querySelector(selector).contains(document.elementFromPoint(x, y)),
          [selector, rect.x + rect.width / 2, rect.y + rect.height / 2])).toBe(true);
      }
      await expect(page.locator('#coordinator-worker-attention')).toBeVisible({ visible: ['waiting', 'unknown'].includes(state) });
      await expect(page.locator('#coordinator-open')).toHaveAccessibleName(/workers.*2 total/);
      expect(await page.locator('#coordinator-open').evaluate(node => {
        const pill = getComputedStyle(node, '::before');
        return parseFloat(pill.height) + parseFloat(pill.borderTopWidth) + parseFloat(pill.borderBottomWidth);
      })).toBe(32);
      expect(box.y + box.height).toBeLessThanOrEqual((await page.locator('#composer').boundingBox()).y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: info.outputPath(`worker-entry-${name}-${state}.png`) });
    }
  }
  const allTasks = parent.coordination.tasks;
  parent.coordination.tasks = [task];
  await page.setViewportSize({ width: 390, height: 844 });
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    for (const state of ['completed', 'working']) {
      task.state = state;
      client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
      await expect(page.locator('#coordinator-worker-slots i')).toHaveCount(1);
      await expect(page.locator('#coordinator-worker-slots i')).toHaveAttribute('data-working', String(state === 'working'));
      await page.screenshot({ path: info.outputPath(`single-worker-${colorScheme}-${state}.png`) });
    }
  }
  await page.locator('#coordinator-open').tap();
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  expect((await page.locator('.coordinator-sheet').boundingBox()).height).toBeCloseTo(844 * .52, 0);
  await page.screenshot({ path: info.outputPath('single-worker-roster.png') });
  await page.getByRole('button', { name: 'Close workers', exact: true }).tap();
  parent.coordination.tasks = allTasks;
  task.state = 'working';
  client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
  await expect(page.locator('#coordinator-context button')).toHaveCount(1);
  await expect(page.locator('#coordinator-workers, #coordinator-owner')).toHaveCount(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('#coordinator-open').tap();
  const sheet = page.locator('#coordinator-sheet'), close = page.getByRole('button', { name: 'Close workers', exact: true });
  await expect(sheet).toBeFocused(); await expect(close).not.toBeFocused();
  await expect(close).toHaveCSS('outline-style', 'none');
  await expect(page.locator('#coordinator-task-list > div')).toHaveCount(2);
  const borders = await page.locator('.coordinator-sheet, .coordinator-sheet > header, #coordinator-task-list > div').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).borderWidth));
  expect(borders.every(width => width === '0px')).toBe(true);
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  const workingStatus = page.getByRole('button', { name: task.title + ', Working', exact: true }).locator('small');
  const finishedStatus = page.getByRole('button', { name: /, Integrated$/ }).locator('small');
  for (const [name, width, height, colorScheme] of [['phone-light', 390, 844, 'light'], ['phone-dark', 390, 844, 'dark'], ['narrow', 320, 740, 'light'], ['short', 390, 510, 'light'], ['desktop-light', 1440, 900, 'light'], ['desktop-dark', 1440, 900, 'dark']]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
    const marker = await workingStatus.evaluate(node => {
      const dot = getComputedStyle(node, '::before');
      return { content: dot.content, width: dot.width, height: dot.height, color: dot.backgroundColor, text: getComputedStyle(node).color, animation: dot.animationName };
    });
    expect(marker).toMatchObject({ content: '""', width: '8px', height: '8px', animation: 'none' });
    expect(marker.color).toBe(marker.text);
    const [r, g, b] = marker.color.match(/[\d.]+/g).map(Number); expect(g).toBeGreaterThan(r); expect(g).toBeGreaterThan(b);
    await expect(workingStatus).toHaveText('Working'); await expect(finishedStatus).toHaveText('Integrated');
    expect(await finishedStatus.evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    const roster = await page.locator('.coordinator-sheet').evaluate(node => {
      const list = node.querySelector('#coordinator-task-list');
      return {
        targets: [...list.querySelectorAll('button')].every(button => button.getBoundingClientRect().height >= 44) };
    });
    await checkFloatingSheet(true);
    const cards = await page.locator('.coordinator-worker').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node);
      return { radius: style.borderRadius, border: style.borderWidth, fill: style.backgroundColor, shadow: style.boxShadow };
    }));
    for (const card of cards) {
      expect(card).toMatchObject({ radius: '12px', border: '0px', shadow: 'none' });
      expect(card.fill).not.toBe('rgba(0, 0, 0, 0)');
    }
    await expect(page.locator('#coordinator-task-list')).toHaveCSS('gap', '8px');
    await expect.poll(async () => (await page.locator('.coordinator-sheet').boundingBox()).height).toBeCloseTo(Math.min(height * .52, 640), 0);
    expect(roster.targets).toBe(true);
    await page.screenshot({ path: info.outputPath('worker-roster-' + name + '.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: info.outputPath('worker-roster-touch.png') });
  await page.keyboard.press('Tab'); await expect(close).toBeFocused();
  await expect(close).toHaveCSS('outline-style', 'solid'); await expect(close).toHaveCSS('outline-width', '2px');
  await page.screenshot({ path: info.outputPath('worker-roster-keyboard.png') });
  await page.getByRole('button', { name: task.title + ', Working', exact: true }).tap();
  await expect(sheet).toBeFocused();
  await expect(page.getByRole('button', { name: 'Back to workers', exact: true })).toHaveCSS('outline-style', 'none');
  const log = page.locator('#coordinator-log'), read = log.locator('details').filter({ has: page.locator('summary', { hasText: 'read · screenshot.png' }) });
  await read.locator('summary').click();
  const image = read.locator('img');
  await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(1);
  const workerURL = await image.getAttribute('src');
  const layout = [];
  for (const [name, width, height, colorScheme] of [['phone', 390, 844, 'light'], ['dark', 390, 844, 'dark'], ['narrow', 320, 740, 'light'], ['short', 390, 510, 'light'], ['desktop', 1440, 900, 'light']]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
    await expect.poll(async () => (await page.locator('.coordinator-sheet').boundingBox()).height).toBeCloseTo(Math.min(height * .52, 640), 0);
    const space = await page.locator('.coordinator-sheet').evaluate(node => ({
      sheet: node.getBoundingClientRect().height, header: node.querySelector('header').getBoundingClientRect().height,
      body: node.querySelector('#coordinator-scroll').getBoundingClientRect().height, safeBottom: parseFloat(getComputedStyle(node).paddingBottom),
      overflow: document.documentElement.scrollWidth > innerWidth,
      targets: [...node.querySelectorAll('header button')].every(button => { const box = button.getBoundingClientRect(); return box.width >= 44 && box.height >= 44; })
    }));
    await checkFloatingSheet(false);
    expect(space.header).toBeLessThanOrEqual(80); expect(space.targets).toBe(true); expect(space.overflow).toBe(false);
    expect(space.body).toBeGreaterThan(space.sheet - space.header - space.safeBottom - 3);
    const rows = await log.locator(':scope > .coordinator-log-detail').evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node);
      return { top: style.borderTopWidth, bottom: style.borderBottomWidth, margin: style.marginBottom,
        touchHeight: node.querySelector('summary').getBoundingClientRect().height };
    }));
    expect(rows.length).toBeGreaterThan(3);
    for (const row of rows) { expect(row.top).toBe('0px'); expect(row.bottom).toBe('0px'); expect(row.margin).toBe('0px'); expect(row.touchHeight).toBeGreaterThanOrEqual(44); }
    await expect(read.locator('.tool-input')).toHaveCSS('border-bottom-width', '0px');
    await expect(page.locator('.coordinator-sheet > footer')).toHaveCount(0);
    await expect(page.locator('#coordinator-sheet')).toHaveAccessibleDescription('Read-only inspection. Give instructions in the main conversation.');
    await expect(page.locator('#coordinator-title')).toHaveText(task.title);
    await page.screenshot({ path: info.outputPath(`worker-sheet-${name}.png`) }); layout.push({ name, width, height, ...space });
  }
  await info.attach('compact-worker-layout', { body: JSON.stringify(layout, null, 2), contentType: 'application/json' });
  await page.setViewportSize({ width: 390, height: 844 });
  parent.messages.push({ id: 'parent-live', role: 'assistant', text: 'The parent is still live.' });
  client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
  const next = { ...worker, messages: [...worker.messages, { id: 'worker-live', role: 'assistant', text: 'Latest worker finding.' }] };
  client.send(JSON.stringify({ type: 'workerPatch', sessionId: worker.id, version: ++workerVersion, patch: diffState(worker, next) })); worker = next;
  await expect(log).toContainText('Latest worker finding.');
  await expect(page.locator('#transcript')).toContainText('The parent is still live.');
  await expect(read).toHaveJSProperty('open', true);
  await expect(image).toHaveAttribute('src', workerURL); await expect(mainImage).toHaveAttribute('src', mainURL);
  await read.getByRole('link', { name: 'Open image' }).click();
  await expect(page.locator('#image-viewer')).toBeVisible();
  await page.locator('#image-close').click(); await expect(page.locator('#coordinator-sheet')).toBeVisible();
  await log.getByRole('button', { name: 'Earlier messages', exact: true }).click();
  await expect(log).toContainText('Earlier worker finding.'); await expect(log).not.toContainText('Latest worker finding.');
  const newer = { ...worker, messages: [...worker.messages, { id: 'worker-newer', role: 'assistant', text: 'A newer live finding.' }] };
  client.send(JSON.stringify({ type: 'workerPatch', sessionId: worker.id, version: ++workerVersion, patch: diffState(worker, newer) })); worker = newer;
  await expect(log).toContainText('Earlier worker finding.'); await expect(log).not.toContainText('A newer live finding.');
  await log.getByRole('button', { name: 'Newer messages', exact: true }).click();
  await expect(log).toContainText('A newer live finding.');
  await log.getByRole('button', { name: 'Latest messages', exact: true }).click();
  await expect(log.getByRole('button', { name: 'Latest messages', exact: true })).toHaveCount(0);
  const back = page.getByRole('button', { name: 'Back to workers', exact: true });
  await back.tap(); await expect(sheet).toBeFocused();
  await expect(page.locator('#coordinator-title')).toHaveText('Workers');
  expect((await page.locator('.coordinator-sheet').boundingBox()).height).toBeCloseTo(844 * .52, 0);
  const workerButton = page.getByRole('button', { name: task.title + ', Working', exact: true });
  await workerButton.focus(); await page.keyboard.press('Enter');
  await expect(back).toBeFocused(); await expect(back).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter'); await expect(workerButton).toBeFocused();
  await close.tap();
  await expect(page.locator('#prompt')).toHaveValue('Keep this main draft.'); await expect(page.locator('#title')).toHaveText(parent.title);
  await expect(mainImage).toHaveAttribute('src', mainURL); await expect.poll(() => mainImage.evaluate(node => node.naturalWidth)).toBe(1);
  expect(requests.filter(packet => packet.op === 'history').map(packet => packet.sessionId)).toEqual(['worker', 'worker']);
  expect(requests.filter(packet => packet.op === 'image').some(packet => packet.sessionId === 'worker' && packet.imageId === workerImage.id)).toBe(true);
  expect(requests.filter(packet => packet.op === 'watch').every(packet => packet.sessionId === 'parent')).toBe(true);
  expect(requests.some(packet => ['command', 'answer', 'taskAction'].includes(packet.op) && packet.sessionId === 'worker')).toBe(false);
  await expect.poll(() => requests.some(packet => packet.op === 'inspectWorker' && packet.sessionId === null)).toBe(true);
  await page.locator('#coordinator-open').click();
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  const touchClient = await page.context().newCDPSession(page), header = await page.locator('.coordinator-sheet > header').boundingBox();
  const x = header.x + header.width / 2, y = header.y + 32;
  await touchClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await touchClient.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 30 }] });
  await touchClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  await expect(sheet).toBeVisible();
  await touchClient.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const dy of [30, 90, 150]) await touchClient.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + dy }] });
  await touchClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#coordinator-sheet')).toBeHidden(); await touchClient.detach();
  await expect(page.locator('#prompt')).toHaveValue('Keep this main draft.');
  task.state = 'reported';
  client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
  await page.locator('#coordinator-open').tap();
  const returnedStatus = page.getByRole('button', { name: task.title + ', Result ready', exact: true }).locator('small');
  await expect(returnedStatus).toHaveText('Result ready');
  expect(await returnedStatus.evaluate(node => getComputedStyle(node, '::before').content)).toBe('none');
  await close.tap();
  await expect(sheet).toBeHidden();
  await page.locator('#session-swipe').hover();
  await page.mouse.down();
  await expect(page.locator('#session-swipe')).toHaveClass(/pressing/);
  await expect(page.locator('#nearby-sessions')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('#nearby-list button')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#nearby-sessions')).toBeHidden();
  await expect(page.locator('#prompt')).toHaveValue('Keep this main draft.');
  parent.coordination.tasks = [
    { ...task, id: 'activity', title: 'Show parent session working while its workers run', state: 'completed', workspace: { integration: 'applied' } },
    { ...task, id: 'brainstorm', title: 'Brainstorm compact worker access above the composer', state: 'completed' },
    { ...task, id: 'prototypes', title: 'Build compact worker-launcher prototypes', state: 'completed', workspace: { integration: 'applied' } }
  ];
  client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
  await page.locator('#coordinator-open').tap();
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  await expect(page.locator('#coordinator-subtitle')).toBeHidden();
  await expect(page.locator('#coordinator-worker-summary')).toHaveText('No active work');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    await checkFloatingSheet(true);
    const header = await page.locator('.coordinator-sheet').evaluate(node => {
      const close = node.querySelector('#coordinator-done').getBoundingClientRect(), title = node.querySelector('h2').getBoundingClientRect();
      const row = node.querySelector('.coordinator-worker').getBoundingClientRect();
      return { alignment: close.y + close.height / 2 - title.y - title.height / 2, inset: close.x + 6 - row.x };
    });
    expect(Math.abs(header.alignment)).toBeLessThanOrEqual(1); expect(Math.abs(header.inset)).toBeLessThanOrEqual(1);
    await expect(page.locator('.coordinator-worker').last()).toBeInViewport();
    await expect(page.locator('.coordinator-worker strong').last()).toHaveCSS('text-decoration-line', 'none');
    await page.screenshot({ path: info.outputPath(`worker-roster-real-titles-${colorScheme}.png`) });
  }
  await close.tap();
  parent.coordination.tasks = [...Array.from({ length: 10 }, (_, i) => ({ ...task, id: 'old-' + i, state: 'completed' })), { ...task, state: 'working' }];
  client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator('#coordinator-worker-slots i')).toHaveCount(8);
  await expect(page.locator('#coordinator-worker-slots i[data-working=true]')).toHaveCount(1);
  await expect(page.locator('#coordinator-worker-slots > span')).toHaveText('+3');
  await expect(page.locator('#coordinator-open')).toHaveAccessibleName(/11 total.*1 working/);
  expect((await page.locator('#coordinator-open').boundingBox()).width).toBeLessThan(200);
  await page.screenshot({ path: info.outputPath('worker-slots-history.png') });
  await page.locator('#coordinator-open').tap();
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  for (const height of [740, 510]) {
    await page.setViewportSize({ width: 320, height });
    await expect.poll(async () => (await page.locator('.coordinator-sheet').boundingBox()).height).toBeCloseTo(height * .52, 0);
    const scroll = page.locator('#coordinator-scroll');
    expect(await scroll.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await page.locator('#coordinator-task-list button').last().scrollIntoViewIfNeeded();
    expect(await scroll.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(close).toBeInViewport();
    await checkFloatingSheet(true);
    await page.screenshot({ path: info.outputPath(`worker-roster-many-${height}.png`) });
  }
  await close.tap();
  parent.coordination.tasks = [];
  client.send(JSON.stringify({ type: 'snapshot', sessionId: parent.id, version: ++parentVersion, state: parent }));
  await expect(page.locator('#coordinator-context')).toBeHidden();
  await expect(page.locator('#coordinator-worker-slots i')).toHaveCount(0);
  await expect(page.locator('#session-swipe')).toHaveCSS('height', '28px');
  expect(errors).toEqual([]);
});
