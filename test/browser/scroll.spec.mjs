import { test, expect } from '@playwright/test';

const login = '/#token=browser-test-token-only-123456789012345';

test('the bottom button returns to the latest message and resumes following replies', async ({ page }) => {
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
  const button = page.getByRole('button', { name: 'Go to thread bottom' });
  const transcript = page.locator('#transcript');
  const gap = () => transcript.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight);
  await expect(transcript).toContainText('A short reply.');
  await expect(button).toBeHidden();
  state.messages[0].text = 'Thread history\n\n'.repeat(60);
  snapshot();
  await expect(transcript).toContainText('Thread history');
  await expect.poll(gap).toBeLessThan(1);
  await expect(button).toBeHidden();
  for (const [size, theme, name] of [
    [{ width: 390, height: 844 }, 'light', 'mobile'],
    [{ width: 1280, height: 900 }, 'dark', 'desktop']
  ]) {
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: theme });
    await transcript.evaluate(node => { node.scrollTop = 0; });
    await expect(button).toBeVisible();
    state.messages.push({ id: name, role: 'assistant', text: `New ${name} reply` }); snapshot();
    await expect(transcript).toContainText(`New ${name} reply`);
    expect(await transcript.evaluate(node => node.scrollTop)).toBe(0);
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
    state.messages.push({ id: `${name}-next`, role: 'assistant', text: `Following ${name} reply` }); snapshot();
    await expect(transcript).toContainText(`Following ${name} reply`);
    await expect.poll(gap).toBeLessThan(1);
    await expect(button).toBeHidden();
  }
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
  const prompt = page.locator('#prompt');
  const height = () => prompt.evaluate(node => node.getBoundingClientRect().height);
  const compact = await height();
  expect(compact).toBe(44);
  expect((await page.locator('#composer').boundingBox()).width - (await prompt.boundingBox()).width).toBe(18);
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

test('zoom keeps session navigation and composer controls inside the visible viewport', async ({ page }) => {
  const state = { id: 'zoom', title: 'A long conversation title that must leave room for navigation',
    cwd: '/projects/pi-remote', status: 'working', model: 'anthropic/claude-sonnet-4-6', thinkingLevel: 'medium',
    messages: [{ id: 'reply', role: 'assistant', text: 'A reply that should wrap instead of being cut off. '.repeat(40) }] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: Array.from({ length: 21 }, (_, i) => ({ ...state, id: String(i) })) }));
    } else {
      if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 1, state }));
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    }
  }));
  await page.goto(login);
  await expect(page.locator('.session')).toHaveCount(20);
  const cdp = await page.context().newCDPSession(page);
  const fits = async selectors => {
    await expect.poll(() => page.evaluate(selectors => {
      const v = visualViewport;
      return selectors.filter(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return r.left < v.offsetLeft - 1 || r.right > v.offsetLeft + v.width + 1
          || r.top < v.offsetTop - 1 || r.bottom > v.offsetTop + v.height + 1;
      });
    }, selectors)).toEqual([]);
  };
  for (const scale of [1.07, 2, 1]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: scale });
    await page.evaluate(() => document.getElementById('sidebar').scrollTo(0, 0));
    await fits(['#app', '#search-open', '#logout']);
    await page.locator('.session').first().click();
    await page.locator('#prompt').fill('A draft keeps both Send and Abort available');
    await expect(page.locator('#send')).toBeVisible();
    const controls = ['#app', '#back', '.session-info summary', '#transcript', '#composer', '#attach', '#model', '#reasoning-control', '#commands', '#send', '#abort'];
    await fits(controls);
    await page.locator('#prompt').fill('');
    await page.getByRole('button', { name: 'Open slash commands' }).tap();
    await expect(page.locator('#prompt')).toHaveValue('/');
    await fits(controls);
    await page.locator('#prompt').press('Escape');
    await page.locator('.session-info summary').click();
    await fits(['#project']);
    await page.locator('.session-info summary').click();
    expect(await page.locator('#transcript').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    // Preserve browser magnification rather than silently resetting or disabling zoom.
    expect(await page.evaluate(() => visualViewport.scale)).toBeCloseTo(scale, 2);
    await page.locator('#back').click();
  }
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
  await page.locator('#send').click();
  await expect(page.locator('#prompt')).toHaveValue('');
  await page.evaluate(() => window.changeViewport({ width: 195, height: 175, offsetLeft: 25, offsetTop: 90, scale: 2 }));
  expect(await page.locator('#app').boundingBox()).toEqual({ x: 25, y: 90, width: 195, height: 175 });
  await page.evaluate(() => window.changeViewport({ width: innerWidth, height: innerHeight, offsetLeft: 0, offsetTop: 0, scale: 1 }));
  await expect.poll(() => page.locator('#app').evaluate(node => node.getBoundingClientRect().top)).toBe(0);
  expect((await page.locator('#app').boundingBox()).height).toBe(page.viewportSize().height);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.locator('#back').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await page.locator('#logout').click();
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('static');
});
