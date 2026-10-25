import { test, expect } from '@playwright/test';

const login = '/#token=browser-test-token-only-123456789012345';

test('the bottom button returns to the latest message and resumes following replies', async ({ page }, testInfo) => {
  const state = { id: 'scroll', title: 'Long thread', cwd: '/project', status: 'idle', messages: [
    { id: 'reply', role: 'assistant', text: 'A short reply.' }
  ] };
  let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw);
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else {
        if (p.op === 'watch') snapshot();
        ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto(login);
  await page.getByRole('button', { name: /Long thread/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const button = page.getByRole('button', { name: 'Go to thread bottom' });
  const transcript = page.locator('#transcript');
  const gap = () => transcript.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
  await expect(transcript).toContainText('A short reply.');
  await expect(button).toBeHidden();
  await expect(transcript).toHaveCSS('mask-image', 'linear-gradient(rgba(0, 0, 0, 0), rgb(0, 0, 0) 72px, rgb(0, 0, 0) calc(100% - 32px), rgba(0, 0, 0, 0))');
  await expect(page.locator('#composer')).toHaveCSS('mask-image', 'none');
  state.messages[0].text = 'Thread history\n\n'.repeat(60);
  snapshot();
  await expect(transcript).toContainText('Thread history');
  await expect.poll(gap).toBeLessThan(1);
  await expect(button).toBeHidden();
  state.status = 'working'; snapshot();
  const activity = page.locator('#agent-activity');
  await expect(activity).toBeVisible();
  await expect.poll(gap).toBeLessThan(1);
  for (const [size, theme, name] of [
    [{ width: 390, height: 844 }, 'light', 'mobile-light'],
    [{ width: 390, height: 844 }, 'dark', 'mobile-dark'],
    [{ width: 1280, height: 900 }, 'light', 'desktop-light'],
    [{ width: 1280, height: 900 }, 'dark', 'desktop-dark']
  ]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: theme });
    await transcript.evaluate(node => { node.scrollTop = 0; });
    await expect(button).toBeVisible();
    await expect(activity).not.toBeInViewport({ timeout: 1000 });
    state.messages.push({ id: name, role: 'assistant', text: `New ${name} reply` }); snapshot();
    await expect(transcript).toContainText(`New ${name} reply`);
    expect(await transcript.evaluate(node => node.scrollTop)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`composer-fade-${name}.png`) });
    const target = await button.boundingBox(), composer = await page.locator('#composer').boundingBox();
    expect(target.width).toBe(44);
    expect(target.height).toBe(44);
    expect(target.y + target.height).toBeLessThan(composer.y);
    expect(Math.abs(target.x + target.width / 2 - composer.x - composer.width / 2)).toBeLessThan(1);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(gap).toBeLessThan(1);
    await expect(button).toBeHidden();
    await expect(transcript).toBeFocused();
    await expect(transcript.locator(':scope > #agent-activity:last-child')).toBeInViewport();
    const message = await transcript.locator('.message').last().boundingBox(), row = await activity.boundingBox();
    expect(message.y + message.height).toBeLessThanOrEqual(row.y);
    const activityText = await activity.locator('.activity-text').boundingBox(), pane = await transcript.boundingBox();
    expect(activityText.y + activityText.height).toBeLessThanOrEqual(pane.y + pane.height - 32);
    await page.screenshot({ path: testInfo.outputPath(`inline-thinking-${name}.png`) });
    state.messages.push({ id: `${name}-next`, role: 'assistant', text: `Following ${name} reply` }); snapshot();
    await expect(transcript).toContainText(`Following ${name} reply`);
    await expect.poll(gap).toBeLessThan(1);
    await expect(button).toBeHidden();
  }
  state.status = 'idle'; snapshot();
  await expect(activity).toBeHidden();
  await expect.poll(gap).toBeLessThan(1);
  const pane = await transcript.boundingBox();
  for (const selector of ['.message-text', '.copy-message svg']) {
    const content = await transcript.locator('.message').last().locator(selector).boundingBox();
    expect(content.y + content.height).toBeLessThanOrEqual(pane.y + pane.height - 32);
  }
});

test('resizing and returning through loaded history keep the live bottom visible', async ({ page }, testInfo) => {
  const state = { id: 'compact', title: 'Compact live thread', cwd: '/project', status: 'working', historyTruncated: true, messages: [
    { id: 'progress', role: 'assistant', text: 'Earlier progress\n\n'.repeat(10) },
    { id: 'latest', role: 'assistant', text: 'The latest progress update.' }
  ] };
  const historyRequests = [];
  let client, version = 0, releaseHistory;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsHistory: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
        return;
      }
      if (packet.op === 'watch') snapshot();
      if (packet.op === 'history') {
        historyRequests.push(packet);
        const older = historyRequests.length === 1;
        const respond = () => ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: {
          messages: [{ id: older ? 'older' : 'late', role: 'assistant', text: older ? 'Saved older progress.' : 'Late older history.' }],
          older, newer: false, tip: 'latest'
        } }));
        if (older) respond(); else releaseHistory = respond;
        return;
      }
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto(login);
  await page.getByRole('button', { name: /Compact live thread/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const transcript = page.locator('#transcript');
  const gap = () => transcript.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
  await expect(page.locator('#agent-activity')).toBeInViewport();
  await expect.poll(gap).toBeLessThan(1);
  expect(await transcript.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(historyRequests).toHaveLength(0);
  const button = page.getByRole('button', { name: 'Go to thread bottom' });
  for (const height of [844, 700, 844]) {
    await page.setViewportSize({ width: 390, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(historyRequests).toHaveLength(0);
    await expect(button).toBeHidden();
    await expect(page.locator('#agent-activity')).toBeInViewport();
    await expect.poll(gap).toBeLessThan(1);
  }
  await page.setViewportSize({ width: 390, height: 700 });
  await expect.poll(gap).toBeLessThan(1);
  await transcript.evaluate(node => { node.scrollTop = 0; });
  await expect(transcript).toContainText('Saved older progress.');
  await expect(button).toBeVisible();
  await transcript.evaluate(node => { node.scrollTop = 0; });
  await expect.poll(() => historyRequests.length).toBe(2);
  await expect(transcript.locator('.history-loading')).toBeVisible();
  state.messages.push({ id: 'newest', role: 'assistant', text: 'A reply while reading history.' }); snapshot();
  await expect.poll(async () => {
    await transcript.evaluate(node => { node.scrollTop = node.scrollHeight; });
    return button.isHidden();
  }).toBe(true);
  await expect(transcript).toContainText('A reply while reading history.');
  await expect(transcript).toHaveAttribute('aria-busy', 'false');
  await expect(transcript.locator('.history-loading')).toHaveCount(0);
  releaseHistory();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(transcript).not.toContainText('Late older history.');
  expect(historyRequests).toHaveLength(2);
  expect(historyRequests.every(packet => packet.before)).toBe(true);
  state.messages.push({ id: 'following', role: 'assistant', text: 'Following live again.' }); snapshot();
  await expect(transcript).toContainText('Following live again.');
  await expect(button).toBeHidden();
  await expect(page.locator('#agent-activity')).toBeInViewport();
  await expect.poll(gap).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath('returned-to-live.png') });
});

test('dragging the composer cannot scroll the page after sending or resizing', async ({ page }) => {
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Long conversation\n'.repeat(80));
  await page.locator('#send').click();
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#transcript')).toContainText('Long conversation');
  const cdp = await page.context().newCDPSession(page);
  const drag = async (selector, distance) => {
    const box = await page.locator(selector).boundingBox();
    const x = box.x + box.width / 2;
    const y = Math.min(box.y + box.height / 2, page.viewportSize().height - 10);
    // Synthetic scroll gestures differ on Linux. Send the same touch path on every OS.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 12; step++) {
      // Slow down before release so momentum cannot leak into the next assertion.
      const offset = distance * (1 - (1 - step / 12) ** 3);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + offset }] });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  for (const height of [220, 844]) {
    await page.setViewportSize({ width: 390, height });
    await page.evaluate(() => scrollTo(0, 0));
    await drag('.composer-actions', -120);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const composer = await page.locator('#composer').boundingBox();
    expect(composer.y + composer.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
  }
  await page.locator('#transcript').evaluate(node => { node.scrollTop = 0; });
  await drag('#transcript', -150);
  await expect.poll(() => page.locator('#transcript').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  const before = await page.locator('#transcript').evaluate(node => node.scrollTop);
  await drag('.composer-actions', -120);
  expect(await page.locator('#transcript').evaluate(node => node.scrollTop)).toBe(before);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator('#prompt').fill('Scrollable draft\n'.repeat(20));
  await page.locator('#prompt').evaluate(node => { node.scrollTop = 0; });
  await drag('#prompt', -120);
  await expect.poll(() => page.locator('#prompt').evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator('#prompt').fill('');
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('#sidebar')).toBeVisible();
});

test('the composer grows with text, caps overflow, and shrinks with edits and restored drafts', async ({ page }) => {
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  const prompt = page.locator('#prompt');
  const height = () => prompt.evaluate(node => node.getBoundingClientRect().height);
  const compact = await height();
  expect(compact).toBe(44);
  expect((await page.locator('#composer').boundingBox()).width - (await prompt.boundingBox()).width).toBeCloseTo(18, 3);
  await prompt.fill('One line');
  await expect(page.locator('#send')).toHaveAccessibleName('Send message');
  for (const id of ['attach', 'send', 'abort']) {
    expect(await page.locator(`#${id}`).evaluate(node => {
      const style = getComputedStyle(node);
      return { radius: style.borderRadius, clip: style.backgroundClip,
        visibleSize: parseFloat(style.width) - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth),
        target: parseFloat(style.width), icon: getComputedStyle(node.querySelector('svg')).width };
    })).toEqual({ radius: '50%', clip: 'padding-box', visibleSize: 32, target: 44, icon: '18px' });
  }
  expect(await height()).toBe(compact);
  await prompt.press('Enter');
  await prompt.pressSequentially('Second line');
  expect(await height()).toBeGreaterThan(compact);
  await prompt.fill('One\nTwo\nThree');
  const threeLines = await height();
  expect(threeLines).toBeGreaterThan(compact);
  await prompt.fill('Long draft\n'.repeat(30));
  const capped = await height();
  expect(capped).toBeGreaterThan(threeLines);
  expect(capped).toBeLessThanOrEqual(216);
  await prompt.pressSequentially('More text');
  expect(await height()).toBe(capped);
  expect(await prompt.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Beta/ }).click();
  await expect.poll(height).toBe(compact);
  await page.locator('#back').click();
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect.poll(height).toBe(capped);
  await prompt.fill('Short again');
  expect(await height()).toBe(compact);
  // Wrapped text must resize after rotation / a change in available width as well.
  await prompt.fill('This sentence wraps across several lines on a phone. '.repeat(3));
  const narrow = await height();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(height).toBeLessThan(narrow);
  await page.locator('#send').click();
  await expect(prompt).toHaveValue('');
  await expect.poll(height).toBe(compact);
});

test('browser zoom stays locked while the message field remains usable', async ({ page, browserName }) => {
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  await expect(page.locator('html')).toHaveCSS('touch-action', 'pan-x pan-y');
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(viewport).toContain('maximum-scale=1');
  expect(viewport).toContain('user-scalable=no');
  expect(await page.evaluate(() => ['gesturestart', 'gesturechange'].map(type => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  }))).toEqual([true, true]);
  // CDP attempts real page magnification; WebKit covers Safari's gesture cancellation above.
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => visualViewport.scale)).toBe(1);
  }
  await page.locator('#prompt').fill('Keep the app at its normal size');
  await expect(page.locator('#prompt')).toHaveValue('Keep the app at its normal size');
  await expect(page.locator('#send')).toBeInViewport();
});

test('the app follows keyboard viewport changes without resizing the document', async ({ page }) => {
  // Desktop automation has no iOS keyboard. Exercise its visual viewport events separately.
  await page.addInitScript(({ width, height }) => {
    const viewport = new EventTarget();
    Object.assign(viewport, { width, height, offsetLeft: 0, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
    window.changeViewport = (values, event = 'resize') => {
      Object.assign(viewport, values);
      viewport.dispatchEvent(new Event(event));
    };
  }, page.viewportSize());
  await page.goto(login);
  await page.getByRole('button', { name: /Project Alpha/ }).click();
  await page.locator('#prompt').fill('Send with the keyboard open');
  await page.evaluate(() => window.changeViewport({ height: 350 }));
  await expect.poll(() => page.locator('#app').evaluate(node => node.getBoundingClientRect().height)).toBe(350);
  await page.evaluate(() => window.changeViewport({ offsetTop: 40 }, 'scroll'));
  expect((await page.locator('#app').boundingBox()).y).toBe(40);
  const composer = await page.locator('#composer').boundingBox();
  expect(composer.y + composer.height).toBeLessThanOrEqual(390);
  expect(composer.height).toBeLessThanOrEqual(110);
  // Working sessions also reserve space for the activity indicator.
  expect((await page.locator('#transcript').boundingBox()).height).toBeGreaterThan(100);
  await page.locator('#prompt').fill('Scrollable draft\n'.repeat(20));
  // Growth must use the keyboard-reduced viewport, not dvh.
  expect((await page.locator('#composer').boundingBox()).height).toBeGreaterThan(composer.height);
  expect((await page.locator('#composer').boundingBox()).height).toBeLessThanOrEqual(175);
  expect(await page.locator('#prompt').evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  expect((await page.locator('#send').boundingBox()).height).toBeGreaterThanOrEqual(44);
  // Sending on touch screens closes the keyboard; the shell fills the screen before iOS finishes resizing.
  await page.locator('#send').dispatchEvent('click');
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#prompt')).not.toBeFocused();
  await page.evaluate(() => window.changeViewport({ width: 195, height: 175, offsetLeft: 25, offsetTop: 90, scale: 2 }));
  expect(await page.locator('#app').boundingBox()).toEqual({ x: 25, y: 90, width: 195, height: page.viewportSize().height / 2 });
  await page.evaluate(() => window.changeViewport({ width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1 }));
  await expect.poll(() => page.locator('#app').evaluate(node => node.getBoundingClientRect().top)).toBe(0);
  expect((await page.locator('#app').boundingBox()).height).toBe(page.viewportSize().height);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  // Native viewers may return via pageshow without a visualViewport resize.
  await page.evaluate(() => {
    window.changeViewport({ width: 195, height: 175, offsetLeft: 25, offsetTop: 90, scale: 2 });
    window.changeViewport({ width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1 }, 'native-return');
    window.dispatchEvent(new Event('pageshow'));
  });
  expect(await page.locator('#app').boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize() });
  await page.locator('#back').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.locator('#logout').click();
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('static');
});
for (const entry of ['foreground return', 'page refresh']) {
  test(`a stale viewport offset cannot push the thread offscreen on ${entry}`, async ({ page }, testInfo) => {
    // iOS can retain its keyboard offset after the visible viewport is full-height again.
    await page.addInitScript(({ width, height, offsetTop }) => {
      const viewport = new EventTarget();
      Object.assign(viewport, { width, height, offsetLeft: 0, offsetTop, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { value: viewport });
      window.changeViewport = values => {
        Object.assign(viewport, values);
        viewport.dispatchEvent(new Event('resize'));
      };
    }, { ...page.viewportSize(), offsetTop: entry === 'page refresh' ? 260 : 0 });
    await page.goto(login);
    if (entry === 'page refresh') await page.reload();
    await page.getByRole('button', { name: /Project Alpha/ }).click();
    await expect(page.locator('#app')).not.toHaveClass(/opening/);
    if (entry === 'foreground return') await page.evaluate(() => {
      Object.assign(visualViewport, { offsetTop: 260 });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.screenshot({ path: testInfo.outputPath('viewport-return.png') });
    expect(await page.locator('#app').boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize() });
    await expect(page.locator('#composer')).toBeInViewport();
    await page.locator('#prompt').fill('Keep this draft');
    expect(await page.locator('#app').boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize() });
    await page.evaluate(() => window.changeViewport({ height: 350, offsetTop: 40 }));
    expect(await page.locator('#app').boundingBox()).toEqual({ x: 0, y: 40, width: page.viewportSize().width, height: 350 });
    // Blur restores the full shell before iOS sends another viewport event.
    await page.locator('#prompt').blur();
    expect(await page.locator('#app').boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize() });
    await expect(page.locator('#send')).toBeInViewport();
    await expect(page.locator('#prompt')).toHaveValue('Keep this draft');
  });
}

test('sending an image keeps the thread bottom visible once Pi starts working', async ({ page }) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64');
  const state = { id: 'send', title: 'Long thread', cwd: '/project', status: 'idle', messages: [
    { id: 'history', role: 'assistant', text: 'Thread history\n\n'.repeat(60) }
  ] };
  let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw);
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
        return;
      }
      if (p.op === 'watch') snapshot();
      ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: p.op === 'command' ? { ok: true } : [] }));
      if (p.op === 'command') setTimeout(() => {
        state.messages.push({ id: 'sent', role: 'user', text: 'testing', images: [{ id: 'a'.repeat(64), mimeType: 'image/png' }] }); snapshot();
        setTimeout(() => { state.status = 'working'; snapshot(); }, 50);
      }, 50);
    });
  });
  await page.goto(login);
  await page.getByRole('button', { name: /Long thread/ }).click();
  const transcript = page.locator('#transcript');
  const gap = () => transcript.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
  await expect.poll(gap).toBeLessThan(1);
  await page.locator('#image-files').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: png });
  await page.locator('#prompt').fill('testing');
  await page.locator('#send').click();
  await expect(page.locator('#agent-activity')).toBeVisible();
  await expect.poll(gap).toBeLessThan(1);
});
