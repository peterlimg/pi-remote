import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('approved characters have readable theme-aware colours and working motion in the app', async ({ page }, testInfo) => {
  const samples = {
    pip: [[136, 136, 136], [245, 245, 245]],
    sprout: [[0, 155, 87], [0, 200, 117]],
    bun: [[255, 35, 69], [255, 35, 69]],
    mochi: [[201, 116, 0], [255, 159, 0]],
    pebble: [[146, 84, 255], [146, 84, 255]],
    wisp: [[0, 153, 138], [0, 185, 164]],
    idea: [[201, 116, 0], [255, 159, 0]],
    fix: [[255, 35, 69], [255, 35, 69]],
    build: [[0, 155, 87], [0, 200, 117]],
    notes: [[136, 136, 136], [245, 245, 245]],
    ship: [[146, 84, 255], [146, 84, 255]],
    miso: [[201, 116, 0], [255, 159, 0]],
    puff: [[136, 136, 136], [245, 245, 245]],
    moss: [[0, 155, 87], [0, 200, 117]],
    jelly: [[0, 153, 138], [0, 185, 164]],
    nim: [[255, 35, 69], [255, 35, 69]],
    zig: [[146, 84, 255], [146, 84, 255]],
  };
  const states = Object.keys(samples).map((id, index) => ({ id, title: 'Character ' + id, status: 'idle', cwd: '/projects/pi-remote', updatedAt: Date.now() - index * 1000, messages: [] }));
  // Existing stored choices make every approved drawing visible without relying on hash collisions.
  await page.addInitScript(kinds => {
    if (!localStorage.getItem('pi-remote-session-icons')) localStorage.setItem('pi-remote-session-icons', JSON.stringify(kinds.map(type => [type, { type }])));
  }, Object.keys(samples));
  let client;
  const publish = () => client.send(JSON.stringify({ type: 'sessions', sessions: states }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') { ws.send(JSON.stringify({ type: 'ready' })); publish(); }
      else if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  for (const [index, theme] of ['light', 'dark'].entries()) {
    await page.setViewportSize({ width: theme === 'light' ? 320 : 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/#token=browser-test-token-only-123456789012345');
    await expect(page.locator('#sessions .session')).toHaveCount(17);
    for (const [kind, colours] of Object.entries(samples)) {
      const bot = page.locator(`#sessions [data-id=${kind}] .session-icon.bot`);
      await expect(bot).toHaveAttribute('data-kind', kind);
      await expect(bot).toHaveCSS('width', '32px');
      await expect(bot.locator('g.bot-body')).toHaveCSS('fill', `rgb(${colours[index].join(', ')})`);
      await expect(bot.locator('.bot-eye')).toHaveCount(2);
      await expect(bot.locator('.bot-frame, .bot-glint')).toHaveCount(0);
      expect(await bot.locator('.bot-eye').evaluateAll((nodes, theme) => nodes.every(node => {
        const style = getComputedStyle(node);
        return style.stroke === 'none' && style.fill === (theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(20, 20, 20)');
      }), theme)).toBe(true);
    }
    const contrasts = await page.locator('#sessions .session-icon.bot').evaluateAll(nodes => {
      const luminance = colour => {
        const [r, g, b] = colour.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return .2126 * r + .7152 * g + .0722 * b;
      };
      const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const background = luminance(getComputedStyle(document.getElementById('sidebar')).backgroundColor);
      return nodes.map(node => {
        const body = luminance(getComputedStyle(node.querySelector('g.bot-body')).fill);
        return { kind: node.dataset.kind, body: ratio(body, background), eyes: ratio(body, luminance(getComputedStyle(node.querySelector('.bot-eye')).fill)) };
      });
    });
    for (const { kind, body, eyes } of contrasts) {
      expect(body, `${theme} ${kind} body/background`).toBeGreaterThanOrEqual(3);
      expect(eyes, `${theme} ${kind} eyes/body`).toBeGreaterThanOrEqual(3);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`approved-family-${theme}.png`) });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  states[0].status = 'working'; publish();
  const pip = page.locator('#sessions [data-id=pip] .bot');
  await expect(pip.locator('.bot-figure')).toHaveCSS('animation-name', 'character-pip');
  await expect(pip.locator('.character-antenna')).toHaveCSS('animation-name', 'character-aerial');
  await expect(pip.locator('.character-antenna')).toHaveCSS('animation-play-state', 'running');
  const initial = await pip.locator('.bot-figure').evaluate(node => getComputedStyle(node).transform);
  await expect.poll(() => pip.locator('.bot-figure').evaluate(node => getComputedStyle(node).transform), { timeout: 5000 }).not.toBe(initial);
  await page.screenshot({ path: testInfo.outputPath('approved-family-working.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(pip.locator('.bot-figure')).toHaveCSS('animation-name', 'none');
  await expect(pip.locator('.character-antenna')).toHaveCSS('animation-name', 'none');
});

test('default characters belong to session IDs and survive renamed titles, activity and reloads', async ({ page }) => {
  const states = Array.from({ length: 18 }, (_, index) => ({ id: 'identity-' + index, title: 'Review the same task', status: 'idle', cwd: '/projects/demo', updatedAt: Date.now() - index * 1000, messages: [] }));
  let client;
  const publish = () => client.send(JSON.stringify({ type: 'sessions', sessions: states }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') { ws.send(JSON.stringify({ type: 'ready' })); publish(); }
      else if (packet.id) ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await expect(page.locator('#sessions .session')).toHaveCount(18);
  const assignments = () => page.locator('#sessions .session').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.id, node.querySelector('.bot').dataset.kind])));
  const original = await assignments();
  // Expanding the picker must not reshuffle the original ID-based defaults.
  expect(states.map(({ id }) => original[id])).toEqual(['pebble', 'wisp', 'bun', 'mochi', 'build', 'notes', 'idea', 'fix', 'sprout', 'bun', 'ship', 'notes', 'sprout', 'pip', 'mochi', 'bun', 'wisp', 'pebble']);
  const approved = ['pip', 'sprout', 'bun', 'mochi', 'pebble', 'wisp', 'idea', 'fix', 'build', 'notes', 'ship'];
  expect(Object.values(original).every(kind => approved.includes(kind))).toBe(true);
  expect(new Set(Object.values(original)).size).toBeGreaterThan(5);
  states.forEach((state, index) => { state.title = index % 2 ? 'Deploy a different task' : 'Write a new draft'; });
  states[0].status = 'working'; publish();
  await expect(page.locator('#sessions [data-id=identity-0] .bot')).toHaveAttribute('data-mood', 'working');
  expect(await assignments()).toEqual(original);
  states[0].status = 'waiting'; publish();
  await expect(page.locator('#sessions [data-id=identity-0] .bot')).toHaveAttribute('data-mood', 'waiting');
  expect(await assignments()).toEqual(original);
  await page.reload();
  await expect(page.locator('#sessions .session')).toHaveCount(18);
  expect(await assignments()).toEqual(original);
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-session-icons'))).toBeNull();
});

test('32px bots stay aligned across session states and preserve icon and emoji choices', async ({ page }, testInfo) => {
  // Reopen a legacy manual icon from the previous catalogue.
  await page.addInitScript(() => {
    if (!localStorage.getItem('pi-remote-session-icons')) localStorage.setItem('pi-remote-session-icons', JSON.stringify([['saved', { type: 'review' }]]));
  });
  const states = [
    { id: 'review', title: 'Review betting legacy removal PR #28', status: 'waiting', cwd: '/projects/primezero', updatedAt: Date.now(), preview: 'Which branch should I review?', previewRole: 'assistant', messages: [] },
    { id: 'normal', title: 'Add session icons for PR review and reconnect recovery without changing the artwork', status: 'idle', cwd: '/projects/pi-remote', updatedAt: Date.now() - 1000, messages: [] },
    { id: 'saved', title: 'Code review for PZ-731', status: 'saved', cwd: '/projects/primezero', updatedAt: Date.now() - 2000, messages: [] },
  ];
  let client;
  const publish = () => client.send(JSON.stringify({ type: 'sessions', sessions: states }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' })); publish();
      } else {
        if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: packet.sessionId, version: 0, state: states.find(s => s.id === packet.sessionId) }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  const review = page.locator('.session', { hasText: states[0].title });
  const normal = page.locator('.session', { hasText: states[1].title });
  const saved = page.locator('.session', { hasText: states[2].title });
  await expect(saved.locator('.session-indicators').getByRole('img', { name: 'Review', exact: true })).toBeVisible();
  // The session ID, not a verb or a review mentioned in the title, picks the default.
  await expect(normal.locator('.session-indicators').getByRole('img', { name: 'Mochi', exact: true })).toBeVisible();
  expect((await normal.locator('.session-indicators .bot svg').boundingBox()).width).toBe(32);
  await expect(page.locator('.session-indicators .bot')).toHaveCount(3);
  await expect(page.locator('.session-indicators .session-icon')).toHaveCount(3);
  await expect(page.locator('.session-preview')).toHaveCount(0);
  await expect(review.locator('.session-icon')).toHaveAttribute('data-status', 'waiting');
  await expect(review.locator('.session-icon')).toHaveAttribute('data-mood', 'waiting');
  await expect(review.locator('.session-kind')).toHaveCount(0);
  await expect(saved.locator('.session-indicators .bot')).toHaveAttribute('data-mood', 'saved');
  await expect(page.locator('.session-meta [data-kind]')).toHaveCount(0);
  for (const width of [390, 320, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.locator('.session').evaluateAll(rows => rows.every(row => {
      const title = row.querySelector('strong'), meta = row.querySelector('.session-meta').getBoundingClientRect();
      const bot = row.querySelector('.session-indicators .bot').getBoundingClientRect(), box = row.getBoundingClientRect();
      return bot.width === 32 && bot.right <= title.getBoundingClientRect().left && !row.querySelector('.session-kind') && Math.abs(bot.y + bot.height / 2 - box.y - box.height / 2) < 1 && (row.classList.contains('session-busy') || title.clientHeight <= 26) && meta.top >= title.getBoundingClientRect().bottom && row.scrollWidth <= row.clientWidth;
    }))).toBe(true);
    expect((await normal.locator('strong').boundingBox()).height).toBeLessThan(26);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  states[1].status = 'working'; publish();
  await expect(normal.locator('.session-indicators .bot')).toHaveAttribute('data-mood', 'working');
  await expect(normal.locator('.session-kind')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('active-and-finished-mobile.png') });
  states[1].status = 'idle'; publish();
  await expect(normal.locator('.session-indicators .bot')).toHaveAttribute('data-mood', 'idle');
  await expect(normal.locator('.session-indicators .bot')).toHaveAttribute('data-kind', 'mochi');
  await page.screenshot({ path: testInfo.outputPath('icons-mobile.png') });
  await writeFile(testInfo.outputPath('icons-mobile.aria.txt'), await page.locator('body').ariaSnapshot());

  const picker = page.getByRole('dialog', { name: 'Session icon', exact: true });
  const openSettings = async row => {
    await row.click();
    await page.getByLabel('Session details', { exact: true }).click();
    await expect(page.locator('.session-details input, .session-details select')).toHaveCount(0);
    expect((await page.locator('.session-details').boundingBox()).height).toBeLessThan(160);
    await page.getByRole('button', { name: /^Session icon / }).click();
    await expect(picker).toBeVisible();
    await expect(page.getByLabel('Emoji', { exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.activeElement.tagName)).not.toBe('INPUT');
  };
  const backToList = async () => {
    if (await picker.isVisible()) await picker.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Show sessions' }).click();
  };
  await openSettings(saved);
  await page.screenshot({ path: testInfo.outputPath('icon-picker-mobile.png') });
  // A centred card of bots only: the current one is pressed and plays its job.
  const card = await page.locator('.icon-sheet').boundingBox(), viewport = page.viewportSize();
  expect(Math.abs(card.y + card.height / 2 - viewport.height / 2)).toBeLessThan(2);
  await expect(picker.getByRole('button', { name: /Automatic|None/ })).toHaveCount(0);
  await expect(picker.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('#session-kind-options > button:not([hidden])')).toHaveCount(18);
  await expect(picker.locator('[aria-pressed=true] .bot')).toHaveAttribute('data-mood', 'working');
  await expect(picker.locator('[aria-pressed=true] svg')).toHaveAttribute('width', '44');
  await picker.getByRole('button', { name: 'Fix', exact: true }).click();
  await backToList();
  await expect(saved.getByRole('img', { name: 'Fix', exact: true })).toBeVisible();
  await page.reload();
  await expect(saved.getByRole('img', { name: 'Fix', exact: true })).toBeVisible();
  // Picking the session's ID-based default drops the override.
  await openSettings(saved);
  await expect(picker.getByRole('button', { name: 'Review', exact: true })).toBeHidden();
  await picker.getByRole('button', { name: 'Pip', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-session-icons'))).toBe('[]');
  await backToList();
  await expect(saved.getByRole('img', { name: 'Pip', exact: true })).toBeVisible();

  await openSettings(normal);
  await expect(picker.getByRole('button', { name: 'Mochi', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.locator('#session-kind-options > button:not([hidden])')).toHaveCount(17);
  // The header shows the kind next to the project, and follows a new choice straight away.
  await expect(page.locator('#project-name')).toHaveText('pi-remote');
  await expect(page.locator('#title-kind').getByRole('img', { name: 'Mochi', exact: true })).toBeVisible();
  await page.locator('.conversation-header').screenshot({ path: testInfo.outputPath('header-kind.png') });
  for (const [name, motion] of [['Pip', 'pip'], ['Sprout', 'sprout'], ['Bun', 'bun'], ['Mochi', 'mochi'], ['Pebble', 'pebble'], ['Wisp', 'wisp'], ['Miso', 'miso'], ['Puff', 'puff'], ['Moss', 'moss'], ['Jelly', 'jelly'], ['Nim', 'nim'], ['Zig', 'zig']]) {
    const button = picker.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button.locator('.bot')).toHaveClass(/personality-bot/);
    await expect(button.locator('.bot-figure')).toHaveCSS('animation-name', 'character-' + motion);
    await expect(button.locator('.bot-figure')).toHaveCSS('animation-play-state', 'running');
  }
  await backToList();
  await expect(normal.getByRole('img', { name: 'Zig', exact: true })).toBeVisible();
  await page.reload();
  await expect(normal.getByRole('img', { name: 'Zig', exact: true })).toBeVisible();
  await openSettings(normal);
  await picker.getByRole('button', { name: 'Idea', exact: true }).tap();
  await expect(picker.getByRole('button', { name: 'Idea', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#title-kind').getByRole('img', { name: 'Idea', exact: true })).toBeVisible();
  await expect(page.getByLabel('Emoji', { exact: true })).toBeHidden();
  await backToList();
  await expect(normal.locator('.session-indicators').getByRole('img', { name: 'Idea', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('list-kinds.png') });
  await openSettings(normal);
  await picker.getByRole('button', { name: /Other emoji/ }).click();
  await page.getByLabel('Emoji', { exact: true }).fill('👩🏽‍💻');
  // The first version never checked the reduced viewport when the iPhone keyboard opens.
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { value: 360, configurable: true });
    visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(picker.getByRole('button', { name: 'Use emoji', exact: true })).toBeInViewport();
  await expect(picker.getByRole('button', { name: 'Done', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('icon-picker-keyboard-viewport.png') });
  await picker.getByRole('button', { name: 'Use emoji', exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByLabel('Session details', { exact: true })).toBeFocused();
  await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
  await backToList();
  await expect(normal.locator('.session-kind')).toHaveText('👩🏽‍💻');
  publish(); // Live list replacements must retain the device's choice.
  await expect(normal.locator('.session-kind')).toHaveText('👩🏽‍💻');
  await page.reload();
  await expect(normal.locator('.session-kind')).toHaveText('👩🏽‍💻');
  await expect(normal.locator('.session-icon circle')).toHaveCount(1);
  states[1].status = 'working'; publish();
  await expect(normal.locator('.session-icon rect')).toHaveCount(6);
  await expect(normal.locator('.session-kind')).toHaveText('👩🏽‍💻');
  states[1].status = 'idle'; publish();
  await expect(normal.locator('.session-icon circle')).toHaveCount(1);
  await expect(saved.locator('.session-indicators .bot')).toHaveAttribute('aria-label', 'Pip');
  await openSettings(normal);
  await picker.getByRole('button', { name: /Other emoji/ }).click();
  await expect(page.getByLabel('Emoji', { exact: true })).toHaveValue('👩🏽‍💻');
  await page.getByLabel('Emoji', { exact: true }).fill('🔎🐛');
  await picker.getByRole('button', { name: 'Use emoji', exact: true }).click();
  await backToList();
  await expect(normal.locator('.session-kind')).toHaveText('🔎');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openSettings(normal);
  await expect(picker.getByRole('button', { name: /Other emoji/ })).toContainText('🔎');
  await expect(picker.locator('[aria-pressed=true]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('icons-desktop-dark.png') });
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await page.getByLabel('Session details', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('icon-menu-desktop-dark.png') });
  await page.getByRole('button', { name: /^Session icon / }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.locator('.icon-sheet').evaluate(node => {
    const box = node.getBoundingClientRect();
    return box.x >= 0 && box.right <= innerWidth && node.scrollWidth <= node.clientWidth;
  })).toBe(true);
  await page.mouse.click(10, 10); // Tap outside the sheet.
  await expect(picker).toBeHidden();
  await backToList();
  await page.getByRole('button', { name: 'Sign out' }).click();
  expect(await page.evaluate(() => localStorage.getItem('pi-remote-session-icons'))).toBeNull();
});
