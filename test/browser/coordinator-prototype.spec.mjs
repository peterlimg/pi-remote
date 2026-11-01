import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const route = '/coordinator-prototype.html';
const fixtureToken = 'browser-test-token-only-123456789012345';
const sampleState = () => ({ id: 'review', title: 'Review mobile flow', cwd: '/sample/mobile', status: 'idle',
  model: 'openai/gpt-6.1-sol', modelName: 'GPT-6.1 Sol', thinkingLevel: 'xhigh',
  contextUsage: { tokens: 24000, contextWindow: 200000, percent: 12 }, messages: [
    { id: 'request', role: 'user', text: 'Review the mobile navigation and login flow. Keep the existing controls.' },
    { id: 'handoff', role: 'assistant', text: 'I’ll check Navigation, Login copy, and Touch targets in parallel. I’ll bring the findings back here.' },
    { id: 'summary', role: 'assistant', text: 'The touch-target review is ready. Login copy needs your choice; Navigation is still running.' }
  ] });
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

// Simulate only the external browser WebSocket, as composer.spec.mjs does. The real app renders itself.
async function production(page) {
  const state = sampleState(); let client, version = 0;
  const snapshot = () => client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const p = JSON.parse(raw);
      if (p.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else {
        if (p.op === 'watch') snapshot();
        ws.send(JSON.stringify({ type: 'response', id: p.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=' + fixtureToken);
  await page.getByRole('button', { name: /Review mobile flow/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  await expect(page.locator('#reasoning-value')).toHaveText('XHigh');
  return { state, snapshot };
}
async function tools(page, run) {
  await page.locator('#prototype-tools').click();
  await run();
  await page.locator('#prototype-options').getByRole('button', { name: 'Done', exact: true }).click();
}
async function isolated(page) {
  const errors = [], sockets = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  await page.addInitScript(() => {
    const forbidden = () => { throw new Error('Prototype touched a real capability'); };
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[name] = forbidden;
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) Object.defineProperty(window, name, { get: forbidden });
    Object.defineProperty(document, 'cookie', { get: forbidden, set: forbidden });
    for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'FileReader', 'showOpenFilePicker']) window[name] = forbidden;
    navigator.sendBeacon = forbidden;
    HTMLInputElement.prototype.showPicker = forbidden;
  });
  return () => {
    expect(errors).toEqual([]); expect(sockets).toEqual([]);
    const origin = new URL(page.url()).origin;
    const allowed = [route, '/coordinator-prototype.js', '/coordinator-prototype.css', '/style.css', '/icon.svg'];
    expect(requests.filter(request => new URL(request.url).origin !== origin || !allowed.includes(new URL(request.url).pathname) || request.method !== 'GET' || ['fetch', 'xhr', 'websocket'].includes(request.type))).toEqual([]);
  };
}
async function noOverflow(page) {
  expect(await page.evaluate(() => ({ x: scrollX, y: scrollY, overflow: document.documentElement.scrollWidth > innerWidth,
    taskOverflow: [...document.querySelectorAll('.coordinator-task-body')].some(n => n.scrollWidth > n.clientWidth) }))).toEqual({ x: 0, y: 0, overflow: false, taskOverflow: false });
}
async function composerAppearance(page) {
  return page.locator('#composer').evaluate(root => {
    const properties = ['display', 'position', 'box-sizing', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
      'color', 'background-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-color', 'border-radius',
      'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'gap', 'flex-direction', 'flex-shrink', 'flex-wrap', 'order',
      'align-items', 'justify-content', 'overflow-x', 'overflow-y', 'box-shadow', 'opacity', 'white-space', 'text-align', 'caret-color', '-webkit-tap-highlight-color'];
    return [root, ...root.querySelectorAll('*')].map(node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return { node: node.id || node.tagName + '.' + node.getAttribute('class'),
        css: Object.fromEntries(properties.map(key => [key, style.getPropertyValue(key)])),
        geometry: ['x', 'y', 'width', 'height'].map(key => Math.round(rect[key] * 100) / 100) };
    });
  });
}
async function coordinationAppearance(page) {
  const report = await page.evaluate(() => {
    const roots = document.querySelector('#activity-sheet').open
      ? ['#activity-sheet .coordinator-sheet']
      : ['#inline-activity', '#header-activity', '#prototype-tools', '#prototype-options'];
    const nodes = [...new Set(roots.flatMap(selector => [...document.querySelectorAll(selector)].flatMap(root => [root, ...root.querySelectorAll('*')])))].filter(node => node.checkVisibility() && getComputedStyle(node).visibility === 'visible');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
    const over = (fg, bg) => [...fg.slice(0, 3).map((value, i) => value * fg[3] / 255 + bg[i] * (1 - fg[3] / 255)), 255];
    const luminance = rgb => rgb.slice(0, 3).map(value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const contrast = nodes.filter(node => [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())).map(node => {
      const ancestors = []; for (let current = node; current; current = current.parentElement) ancestors.unshift(current);
      const background = ancestors.reduce((bg, current) => over(rgba(getComputedStyle(current).backgroundColor), bg), [255, 255, 255, 255]);
      const bg = luminance(background), fg = luminance(over(rgba(getComputedStyle(node).color), background));
      return { label: node.textContent.trim().slice(0, 100), ratio: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) };
    });
    const controls = nodes.filter(node => node.matches('button, summary')).map(node => {
      const r = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent.trim(), width: r.width, height: r.height, left: r.left, right: r.right };
    });
    return { contrast, controls, viewportWidth: innerWidth };
  });
  expect(report.contrast.filter(item => item.ratio < 4.5)).toEqual([]);
  expect(report.controls.filter(item => item.width < 44 || item.height < 44 || item.left < 0 || item.right > report.viewportWidth)).toEqual([]);
  return report;
}
async function familiarControls(page) {
  for (const id of ['attach', 'model', 'reasoning-control', 'usage-meter', 'commands']) {
    await expect(page.locator('#' + id)).toBeVisible();
    const box = await page.locator('#' + id).boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('#abort:not([hidden]), #send:not([hidden])')).toHaveCount(1);
}

test('composer source is the exact current production subtree, with no prototype CSS reaching it', async ({ page }) => {
  const real = readFileSync('web/index.html', 'utf8'), prototype = readFileSync('web/coordinator-prototype.html', 'utf8');
  const composer = source => source.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
  expect(composer(prototype)).toBe(composer(real));
  await page.goto(route);
  const matches = await page.locator('#composer').evaluate(root => {
    const sheet = [...document.styleSheets].find(s => s.href?.endsWith('/coordinator-prototype.css'));
    const rules = list => [...list].flatMap(rule => rule.cssRules ? rules(rule.cssRules) : rule.selectorText ? [rule.selectorText] : []);
    return rules(sheet.cssRules).filter(selector => [root, ...root.querySelectorAll('*')].some(node => node.matches(selector)));
  });
  expect(matches).toEqual([]);
});

for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 390, height: 420 }, { width: 1440, height: 900 }]) {
  for (const colorScheme of ['light', 'dark']) {
    test(`actual production composer parity ${viewport.width}x${viewport.height} ${colorScheme}`, async ({ page, context }, testInfo) => {
      test.setTimeout(90000);
      await page.setViewportSize(viewport); await page.emulateMedia({ colorScheme });
      const real = await context.newPage(); await real.setViewportSize(viewport); await real.emulateMedia({ colorScheme });
      const fixture = await production(real);
      const checkIsolation = await isolated(page); await page.goto(route + '?variant=A');
      let comparisons = 0;
      for (const variant of ['A', 'B']) {
        await tools(page, () => page.locator(`input[name="variant"][value="${variant}"]`).check());
        for (const footer of [true, false]) {
          if (footer) fixture.state.contextUsage = sampleState().contextUsage; else delete fixture.state.contextUsage;
          fixture.snapshot();
          if (footer) await expect(real.locator('#status-line')).toBeVisible(); else await expect(real.locator('#status-line')).toBeHidden();
          await tools(page, () => page.locator('#sample-footer').setChecked(footer));
          for (const working of [false, true]) {
            fixture.state.status = working ? 'working' : 'idle'; fixture.snapshot();
            await tools(page, () => page.locator('#sample-working').setChecked(working));
            for (const draft of ['', 'Keep the existing controls.', 'Keep the existing controls.\nReview the back gesture.\nDo not change saved data.\nBring the findings here.']) {
              await real.locator('#prompt').fill(draft); await page.locator('#prompt').fill(draft);
              await expect(real.locator('#prompt')).toHaveAttribute('placeholder', working ? 'Message Pi while it works…' : 'Type / for commands');
              await expect(page.locator('#prompt')).toHaveAttribute('placeholder', working ? 'Message Pi while it works…' : 'Type / for commands');
              await expect(real.locator('#model')).toHaveCSS('opacity', '1');
              expect(await composerAppearance(page), `${variant}, footer=${footer}, working=${working}, draft=${!!draft}`).toEqual(await composerAppearance(real));
              expect(await page.locator('#status-line').boundingBox()).toEqual(await real.locator('#status-line').boundingBox());
              const shell = async p => p.locator('.conversation-header, #back, .session-info summary, #transcript').evaluateAll(nodes => nodes.map(n => {
                const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
              }));
              expect(await shell(page)).toEqual(await shell(real));
              if (variant === 'A') expect(await page.locator('#heading').boundingBox()).toEqual(await real.locator('#heading').boundingBox());
              await familiarControls(page); await noOverflow(page); comparisons++;
            }
          }
        }
      }
      await testInfo.attach('composer-parity.json', { body: JSON.stringify({ viewport, colorScheme, comparisons, source: 'Actual /app.js; deterministic state only at /ws; no DOM/style patches' }), contentType: 'application/json' });
      checkIsolation(); await real.close();
    });
  }
}

for (const variant of ['A', 'B']) test(`variant ${variant}: scoped actions, disclosure, keyboard, drafts and reset stay in one conversation`, async ({ page }) => {
  const checkIsolation = await isolated(page); await page.goto(`${route}?variant=${variant}`);
  const list = page.locator(variant === 'A' ? '#inline-activity' : '#sheet-tasks');
  const open = async () => {
    if (variant === 'A') { if (await list.getAttribute('open') === null) await list.locator(':scope > summary').press('Enter'); }
    else await page.locator('#header-activity').press('Enter');
  };
  await page.locator('#prompt').fill('Keep this coordinator draft.');
  const scroll = await page.locator('#transcript').evaluate(n => n.scrollTop);
  await open();
  if (variant === 'B') {
    await page.keyboard.press('Escape'); await expect(page.locator('#header-activity')).toBeFocused();
    expect(await page.locator('#transcript').evaluate(n => n.scrollTop)).toBe(scroll); await open();
  } else {
    await list.locator(':scope > summary').press('Enter');
    expect(await page.locator('#transcript').evaluate(n => n.scrollTop)).toBe(scroll); await open();
  }
  const login = list.locator('[data-task="login"].coordinator-task');
  await login.locator('summary').press('Enter');
  await expect(login.locator('summary')).toHaveCSS('outline-style', 'solid');
  await expect(login.getByRole('button', { name: 'Login copy: Allow format change', exact: true })).toBeVisible();
  await login.getByRole('button', { name: 'Login copy: Inspect', exact: true }).click();
  await expect(login).toContainText('Read-only sample activity');
  await expect(login).toContainText('Coordinator assignment');
  await login.getByRole('button', { name: 'Login copy: Back to task', exact: true }).press('Enter');
  await expect(login.getByRole('button', { name: 'Login copy: Inspect', exact: true })).toBeFocused();
  await expect(page.locator('#prompt')).toHaveValue('Keep this coordinator draft.');
  await login.getByRole('button', { name: 'Login copy: Discuss', exact: true }).click();
  await expect(page.locator('#transcript .message.user').last()).toContainText('Login copy:');
  await expect(page.locator('#transcript .message.assistant').last()).toContainText('does not approve');
  await expect(page.locator('#prompt')).toHaveValue('Keep this coordinator draft.');
  await expect(page.locator('#send')).toBeVisible(); await expect(page.locator('#abort')).toBeHidden();
  await page.locator('#prompt').fill('Yes, go ahead.'); await page.locator('#send').click();
  await page.locator('#prompt').fill('Keep this coordinator draft.');
  if (variant === 'B') await open();
  await expect(login.locator('.coordinator-task-state')).toHaveText('Needs your choice');
  await login.getByRole('button', { name: 'Login copy: Keep saved format', exact: true }).click();
  await expect(login).toContainText('Saved-login format stays unchanged.');
  await expect(page.locator('#transcript .message.assistant').last()).toContainText('Login copy:');
  const navigation = list.locator('[data-task="navigation"].coordinator-task');
  await navigation.locator('summary').press('Enter');
  await expect(login).not.toHaveAttribute('open');
  await navigation.getByRole('button', { name: 'Navigation: Stop Navigation…', exact: true }).click();
  await expect(navigation.getByRole('button', { name: 'Navigation: Keep running', exact: true })).toBeFocused();
  await navigation.getByRole('button', { name: 'Navigation: Keep running', exact: true }).press('Enter');
  await expect(navigation.locator('.coordinator-task-state')).toHaveText('Running');
  await navigation.getByRole('button', { name: 'Navigation: Stop Navigation…', exact: true }).click();
  await navigation.getByRole('button', { name: 'Navigation: Stop Navigation only', exact: true }).click();
  await expect(navigation.locator('.coordinator-task-state')).toHaveText('Stopped · outcome unknown');
  await expect(login.locator('.coordinator-task-state')).toHaveText('Running');
  const result = list.locator('[data-task="touch"].coordinator-task'); await result.locator('summary').press('Enter');
  await expect(result).toContainText('32 × 32 px'); await expect(result).toContainText('not independently verified');
  await result.getByRole('button', { name: 'Touch targets: Review with coordinator', exact: true }).click();
  await expect(page.locator('#transcript .message.user').last()).toContainText('Touch targets: Sample measurements:');
  await expect(result.locator('.coordinator-task-state')).toHaveText('Report ready');
  await expect(page.locator('#prompt')).toHaveValue('Keep this coordinator draft.');
  await page.locator('#send').click();
  await expect(page.locator('#transcript .message.user').last()).toContainText('Keep this coordinator draft.');
  await page.locator('#prompt').fill('<img src=x onerror=alert(1)>'); await page.locator('#send').click();
  await expect(page.locator('#transcript .message.user').last()).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#transcript img, #transcript script')).toHaveCount(0);
  // Preserve a real scrollback position through inspection and switching, not just scrollTop=0.
  for (let i = 0; i < 6; i++) { await page.locator('#prompt').fill('Another review note ' + i); await page.locator('#send').click(); }
  await page.locator('#prompt').fill('Draft survives switching.');
  await open(); await login.locator('summary').press('Enter');
  await page.locator('#transcript').evaluate(n => { n.scrollTop = 80; });
  const inspect = login.getByRole('button', { name: 'Login copy: Inspect', exact: true });
  await inspect.scrollIntoViewIfNeeded(); const inspectionTop = await page.locator('#transcript').evaluate(n => n.scrollTop);
  expect(inspectionTop).toBeGreaterThan(0); await inspect.click();
  await login.getByRole('button', { name: 'Login copy: Back to task', exact: true }).click();
  expect(await page.locator('#transcript').evaluate(n => n.scrollTop)).toBe(inspectionTop);
  if (variant === 'B') await page.getByRole('button', { name: 'Back to conversation' }).click();
  await page.locator('#transcript').evaluate(n => { n.scrollTop = 80; });
  const before = await page.locator('#transcript').evaluate(n => n.scrollTop);
  await tools(page, () => page.locator(`input[name="variant"][value="${variant === 'A' ? 'B' : 'A'}"]`).check());
  expect(await page.locator('#transcript').evaluate(n => n.scrollTop)).toBe(before);
  await expect(page.locator('#prompt')).toHaveValue('Draft survives switching.');
  await tools(page, () => page.getByRole('button', { name: 'Reset sample' }).click());
  await expect(page.locator('#prompt')).toHaveValue(''); await expect(page.locator('#transcript .message')).toHaveCount(3);
  await tools(page, () => page.locator(`input[name="variant"][value="${variant}"]`).check());
  await open();
  const resetLogin = list.locator('[data-task="login"].coordinator-task'); await resetLogin.locator('summary').press('Enter');
  await resetLogin.getByRole('button', { name: 'Login copy: Allow format change', exact: true }).press('Enter');
  await expect(resetLogin).toContainText('explicitly allowed for Login copy');
  await noOverflow(page); checkIsolation();
});

test('new activity UI has rendered contrast, touch targets, disclosure cues and unclipped native context', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const checkIsolation = await isolated(page), reports = [];
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 420 }, { width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const colorScheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme });
      for (const variant of ['A', 'B']) {
        await page.goto(`${route}?variant=${variant}`);
        if (viewport.width >= 390) expect(await page.locator('#title').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        if (viewport.width > 700) expect(await page.locator('#sessions strong').evaluate(node => node.getBoundingClientRect().height < 30)).toBe(true);
        const marker = await page.locator('#prototype-tools').boundingBox();
        for (const target of await page.locator('#logout, #back, #heading, .session-info > summary, .message.user .message-text, #composer').all()) {
          if (!await target.isVisible()) continue;
          const r = await target.boundingBox();
          expect(marker.x < r.x + r.width && marker.x + marker.width > r.x && marker.y < r.y + r.height && marker.y + marker.height > r.y, 'Prototype control overlaps native content').toBe(false);
        }
        reports.push({ viewport, colorScheme, variant, state: 'collapsed', ...await coordinationAppearance(page) });
        await tools(page, async () => reports.push({ viewport, colorScheme, variant, state: 'prototype controls', ...await coordinationAppearance(page) }));
        if (variant === 'A') await page.locator('#inline-activity > summary').press('Enter'); else await page.locator('#header-activity').press('Enter');
        const list = page.locator(variant === 'A' ? '#inline-activity' : '#sheet-tasks'), login = list.locator('.coordinator-task[data-task="login"]');
        await login.locator('summary').press('Enter');
        expect(await login.locator('summary').evaluate(node => getComputedStyle(node, '::after').borderRightWidth)).toBe('1px');
        reports.push({ viewport, colorScheme, variant, state: 'question', ...await coordinationAppearance(page) });
        const scroller = page.locator(variant === 'A' ? '#transcript' : '#sheet-tasks');
        await scroller.evaluate(node => { node.scrollTop = 16; });
        await login.locator('[data-action="inspect"]').scrollIntoViewIfNeeded(); const top = await scroller.evaluate(node => node.scrollTop);
        await login.locator('[data-action="inspect"]').click();
        reports.push({ viewport, colorScheme, variant, state: 'inspection', ...await coordinationAppearance(page) });
        await login.locator('[data-action="back"]').click(); expect(await scroller.evaluate(node => node.scrollTop)).toBe(top);
        await login.locator('[data-action="stop-review"]').click();
        reports.push({ viewport, colorScheme, variant, state: 'stop confirmation', ...await coordinationAppearance(page) });
        await login.locator('[data-action="stop-cancel"]').click();
        await list.locator('.coordinator-task[data-task="touch"] > summary').press('Enter');
        await expect(login).not.toHaveAttribute('open');
        reports.push({ viewport, colorScheme, variant, state: 'report', ...await coordinationAppearance(page) });
        await noOverflow(page);
      }
    }
  }
  await testInfo.attach('coordination-rendered-checks.json', { body: JSON.stringify(reports), contentType: 'application/json' });
  checkIsolation();
});

test('normal attachment, settings, usage, slash and coordinator Stop controls remain bounded local mocks', async ({ page }) => {
  const checkIsolation = await isolated(page); await page.goto(route);
  await page.locator('#prompt').fill('Keep this draft.');
  for (const id of ['model', 'reasoning-control', 'usage-meter', 'status-line']) {
    await page.locator('#' + id).click(); await expect(page.locator('#settings-picker')).toBeVisible();
    await expect(page.locator('#picker-help')).toHaveText('Sample values only.');
    await page.keyboard.press('Escape'); await expect(page.locator('#prompt')).toHaveValue('Keep this draft.');
  }
  await page.locator('#attach').click(); await page.getByRole('button', { name: 'Add sample image' }).click();
  await expect(page.locator('#attachments img')).toBeVisible(); await page.getByRole('button', { name: 'Remove sample image' }).click();
  await page.locator('#commands').click(); await page.getByRole('option', { name: /\/model/ }).press('Enter');
  await expect(page.locator('#prompt')).toHaveValue('/model'); await page.locator('#send').click();
  await expect(page.locator('#settings-picker')).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('#prompt').fill(''); await tools(page, () => page.locator('#sample-working').check());
  await expect(page.locator('#abort')).toBeVisible(); await page.locator('#abort').click();
  await expect(page.locator('#send')).toBeVisible();
  await expect(page.locator('[data-task="navigation"] .coordinator-task-state').first()).toHaveText('Running');
  await page.locator('#back').click(); await page.getByRole('button', { name: /Review mobile flow/ }).click();
  await expect(page.locator('#prompt')).toBeVisible();
  await page.goto(route + '?variant=invalid'); await expect(page).toHaveURL(/variant=A/);
  await tools(page, () => page.locator('input[name="variant"][value="B"]').check()); await page.reload();
  await expect(page.locator('#header-activity')).toBeVisible(); checkIsolation();
});

test('batched native screenshots: actual baseline and both activity additions, phone and desktop', async ({ page, context }, testInfo) => {
  test.setTimeout(60000);
  const dir = process.env.PI_COORDINATOR_EVIDENCE || testInfo.outputPath('evidence'); mkdirSync(dir, { recursive: true });
  const checks = [];
  const real = await context.newPage(); await production(real);
  for (const view of [
    { name: 'phone-light', width: 390, height: 844, theme: 'light' },
    { name: 'phone-dark', width: 390, height: 844, theme: 'dark' },
    { name: 'desktop-light', width: 1440, height: 900, theme: 'light' },
    { name: 'desktop-dark', width: 1440, height: 900, theme: 'dark' }
  ]) {
    for (const target of [real, page]) { await target.setViewportSize({ width: view.width, height: view.height }); await target.emulateMedia({ colorScheme: view.theme }); }
    await real.screenshot({ path: join(dir, `${view.name}-baseline.png`) });
    for (const variant of ['A', 'B']) {
      await page.goto(`${route}?variant=${variant}`); await familiarControls(page); await noOverflow(page);
      checks.push({ view: view.name, variant, state: 'collapsed', ...await coordinationAppearance(page) });
      await page.screenshot({ path: join(dir, `${view.name}-${variant}.png`) });
      if (variant === 'A') await page.locator('#inline-activity > summary').click(); else await page.locator('#header-activity').click();
      const list = page.locator(variant === 'A' ? '#inline-activity' : '#sheet-tasks');
      await list.locator('[data-task="login"] > summary').click();
      checks.push({ view: view.name, variant, state: 'question', ...await coordinationAppearance(page) });
      await page.screenshot({ path: join(dir, `${view.name}-${variant}-expanded.png`) });
      writeFileSync(join(dir, `${view.name}-${variant}-expanded.aria.txt`), await page.locator('body').ariaSnapshot());
      if (view.name.startsWith('phone')) {
        const login = list.locator('.coordinator-task[data-task="login"]');
        await login.locator('[data-action="inspect"]').click();
        checks.push({ view: view.name, variant, state: 'inspection', ...await coordinationAppearance(page) });
        await page.screenshot({ path: join(dir, `${view.name}-${variant}-inspection.png`) });
        await login.locator('[data-action="back"]').click();
        await list.locator('[data-task="touch"] > summary').click();
        checks.push({ view: view.name, variant, state: 'report', ...await coordinationAppearance(page) });
        await page.screenshot({ path: join(dir, `${view.name}-${variant}-report.png`) });
        const navigation = list.locator('.coordinator-task[data-task="navigation"]'); await navigation.locator('summary').click();
        await navigation.locator('[data-action="stop-review"]').click();
        checks.push({ view: view.name, variant, state: 'stop confirmation', ...await coordinationAppearance(page) });
        await page.screenshot({ path: join(dir, `${view.name}-${variant}-stop-confirmation.png`) });
      }
      await noOverflow(page);
    }
  }
  writeFileSync(join(dir, 'capture.json'), JSON.stringify({ baseline: 'Unmodified production app, deterministic /ws fixture', variants: ['A: handoff activity', 'B: header task sheet'], viewport: ['390x844', '1440x900'], themes: ['light', 'dark'], phoneStates: ['collapsed', 'question', 'inspection', 'report', 'stop confirmation'] }, null, 2));
  writeFileSync(join(dir, 'coordination-rendered-checks.json'), JSON.stringify(checks, null, 2));
  await real.close();
});

test('existing static routes and CSP remain unchanged', async ({ request }) => {
  for (const [suffix, type] of [['html', 'text/html'], ['css', 'text/css'], ['js', 'text/javascript']]) {
    const response = await request.get('/coordinator-prototype.' + suffix);
    expect(response.status()).toBe(200); expect(response.headers()['content-type']).toContain(type);
    expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
  }
});
