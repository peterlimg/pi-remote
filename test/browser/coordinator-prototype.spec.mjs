import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const route = '/coordinator-prototype.html';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

async function observe(page) {
  const errors = [], sockets = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  await page.addInitScript(() => {
    const forbidden = () => { throw new Error('Workspace study touched a real capability'); };
    for (const name of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[name] = forbidden;
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) Object.defineProperty(window, name, { get: forbidden });
    Object.defineProperty(document, 'cookie', { get: forbidden, set: forbidden });
    for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'FileReader', 'showOpenFilePicker']) window[name] = forbidden;
    navigator.sendBeacon = forbidden;
  });
  return () => {
    expect(errors).toEqual([]); expect(sockets).toEqual([]);
    const origin = new URL(page.url()).origin;
    const allowed = [route, '/coordinator-prototype.js', '/coordinator-prototype.css', '/style.css', '/icon.svg'];
    expect(requests.filter(r => new URL(r.url).origin !== origin || !allowed.includes(new URL(r.url).pathname) || r.method !== 'GET' || ['fetch', 'xhr', 'websocket'].includes(r.type))).toEqual([]);
  };
}

async function production(page) {
  const state = { id: 'story-baseline', title: 'Mobile release', cwd: '/sample/pi-remote', status: 'idle',
    model: 'openai/gpt-6.1-sol', modelName: 'GPT-6.1 Sol', thinkingLevel: 'max',
    contextUsage: { tokens: 24000, contextWindow: 200000, percent: 12 }, messages: [] };
  await page.routeWebSocket('**/ws', ws => ws.onMessage(raw => {
    const packet = JSON.parse(raw);
    if (packet.type === 'auth') {
      ws.send(JSON.stringify({ type: 'ready', supportsImages: true }));
      ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
    } else {
      if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: 1, state }));
      ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
    }
  }));
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Mobile release/ }).click();
  await expect(page.locator('#app')).not.toHaveClass(/opening/);
  await expect(page.locator('#reasoning-value')).toHaveText('Max');
  await expect(page.locator('#status-line')).toBeVisible();
}
async function composerAppearance(page) {
  return page.locator('#composer').evaluate(root => {
    const props = ['display', 'position', 'width', 'height', 'font-family', 'font-size', 'line-height', 'color', 'background-color',
      'border-color', 'border-radius', 'padding', 'margin', 'gap', 'flex-wrap', 'box-shadow', 'overflow-x', 'overflow-y'];
    return [root, ...root.querySelectorAll('*')].map(n => {
      const style = getComputedStyle(n), r = n.getBoundingClientRect();
      return { id: n.id || n.tagName + '.' + n.className, css: Object.fromEntries(props.map(p => [p, style.getPropertyValue(p)])),
        rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v * 100) / 100) };
    });
  });
}


async function fits(page) {
  for (const id of ['attach', 'model', 'reasoning-control', 'usage-meter', 'commands']) await expect(page.locator('#' + id)).toBeVisible();
  await expect(page.locator('#abort:not([hidden]), #send:not([hidden])')).toHaveCount(1);
  for (const worker of await page.locator('.worker-window').all()) await expect(worker).toBeInViewport();
  const bounds = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth, scroll: scrollY,
    transcriptHeight: document.querySelector('#transcript').getBoundingClientRect().height,
    controls: [...document.querySelectorAll('.worker-window, .workspace-round, #composer button:not([hidden])')]
      .filter(node => node.checkVisibility()).map(node => {
        const r = node.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      }), width: innerWidth, height: innerHeight
  }));
  expect(bounds.overflow).toBe(false); expect(bounds.scroll).toBe(0); expect(bounds.transcriptHeight).toBeGreaterThanOrEqual(44);
  for (const r of bounds.controls) {
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(bounds.width);
    expect(r.bottom).toBeLessThanOrEqual(bounds.height); expect(r.width).toBeGreaterThanOrEqual(44); expect(r.height).toBeGreaterThanOrEqual(44);
  }
}

test('worker workspace shows ownership, a routed question and a returned artifact outside chat', async ({ page, request }) => {
  const isolated = await observe(page); await page.goto(route);
  await expect(page.locator('#title')).toHaveText('Mobile release');
  await expect(page.locator('#workspace-subtitle')).toContainText('Coordinator');
  const workers = page.getByRole('region', { name: 'Workers owned by Mobile release' });
  await expect(workers.locator('.worker-window')).toHaveCount(3);
  await expect(workers.locator('.worker-window[data-session=navigation]')).toContainText('Working');
  await expect(workers.locator('.worker-window[data-session=login]')).toContainText('Needs answer');
  await expect(workers.locator('.worker-window[data-session=checks]')).toContainText('Returned');
  await expect(page.locator('#question-panel')).toContainText('Login copy');
  await expect(page.locator('#question-panel')).toContainText('Mobile release');
  await expect(page.getByRole('button', { name: 'Reply in Login copy' })).toBeInViewport();
  await page.getByRole('tab', { name: /Returned/ }).click();
  await expect(page.locator('#question-panel')).toBeHidden();
  await expect(page.locator('#returned-panel')).toContainText('Checks');
  await expect(page.locator('#returned-panel')).toContainText('Mobile release');
  await page.getByRole('button', { name: 'Open returned viewport review' }).click();
  await expect(page.locator('#title')).toHaveText('Checks');
  await expect(page.getByRole('article', { name: 'Returned viewport review' })).toContainText('not an executed test result');
  await page.getByRole('button', { name: 'Return to Mobile release coordinator' }).click();
  await page.getByRole('tab', { name: /Question/ }).focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /Returned/ })).toBeFocused();
  await page.getByRole('button', { name: 'About this design study' }).click();
  await expect(page.locator('#study-info')).toContainText('No agents run');
  await page.keyboard.press('Escape');
  for (const suffix of ['html', 'css', 'js']) {
    const response = await request.get('/coordinator-prototype.' + suffix);
    expect(response.status()).toBe(200); expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
  }
  isolated();
});

test('worker focus preserves per-session drafts and attachments and scopes sample Stop', async ({ page }) => {
  const isolated = await observe(page); await page.goto(route);
  await page.locator('#prompt').fill('Keep my coordinator draft.');
  await page.locator('#attach').click(); await page.getByRole('button', { name: 'Add sample image' }).click();
  await page.getByRole('button', { name: 'Reply in Login copy' }).click();
  await expect(page.locator('#title')).toHaveText('Login copy');
  await expect(page.locator('#workspace-subtitle')).toContainText('Worker of Mobile release');
  await expect(page.locator('#thread-recipient')).toHaveText('To Login copy');
  await expect(page.locator('#prompt')).toBeFocused(); await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#attachments')).toBeHidden(); await fits(page);
  const text = '<img src=x onerror=alert(1)>';
  await page.locator('#prompt').fill(text); await page.locator('#send').click();
  await expect(page.locator('#transcript .message.user').last()).toHaveText(text);
  await expect(page.locator('#transcript img, #transcript script')).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('received by Login copy only');
  await page.locator('.worker-window[data-session=navigation]').click();
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#transcript')).not.toContainText(text);
  await expect(page.locator('#abort')).toBeVisible();
  await page.locator('#abort').click();
  await expect(page.locator('.worker-window[data-session=navigation]')).toContainText('Stopped');
  await expect(page.locator('.worker-window[data-session=login]')).toContainText('Needs answer');
  await expect(page.locator('.worker-window[data-session=checks]')).toContainText('Returned');
  await page.getByRole('button', { name: 'Return to Mobile release coordinator' }).click();
  await expect(page.locator('#prompt')).toHaveValue('Keep my coordinator draft.');
  await expect(page.locator('#attachments img')).toBeVisible();
  await page.getByRole('button', { name: 'Remove sample image' }).click();
  for (const id of ['model', 'reasoning-control', 'usage-meter']) {
    await page.locator('#' + id).click(); await expect(page.locator('#settings-picker')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  await page.locator('#commands').click(); await page.getByRole('option', { name: /\/model/ }).click();
  await page.locator('#send').click(); await expect(page.locator('#settings-picker')).toBeVisible(); await page.keyboard.press('Escape');
  await page.goto(route + '?session=login'); await expect(page.locator('#title')).toHaveText('Login copy');
  await page.reload(); await expect(page.locator('#title')).toHaveText('Login copy');
  await page.goto(route + '?session=unknown'); await expect(page.locator('#title')).toHaveText('Mobile release');
  isolated();
});

test('composer keeps exact production markup and appearance, including narrow and keyboard-sized views', async ({ page, context }) => {
  test.setTimeout(60000);
  const composer = source => source.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
  expect(composer(readFileSync('web/coordinator-prototype.html', 'utf8'))).toBe(composer(readFileSync('web/index.html', 'utf8')));
  const real = await context.newPage(); await production(real);
  const isolated = await observe(page);
  for (const view of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 390, height: 510 }]) {
    for (const theme of ['light', 'dark']) {
      for (const target of [real, page]) { await target.setViewportSize(view); await target.emulateMedia({ colorScheme: theme }); }
      await page.goto(route);
      for (const draft of ['', 'Keep the original label.\nShorten only the placeholder.\nKeep the saved format.']) {
        for (const target of [real, page]) {
          await target.locator('#prompt').fill(draft);
          const bottom = target.locator('#scroll-bottom');
          if (await bottom.isVisible()) await bottom.click();
          await expect(bottom).toBeHidden();
        }
        await expect(real.locator('#model')).toHaveCSS('opacity', '1');
        expect(await composerAppearance(page), `${view.width}x${view.height} ${theme}`).toEqual(await composerAppearance(real));
      }
    }
  }
  const selectors = await page.locator('#composer').evaluate(root => {
    const rules = list => [...list].flatMap(rule => rule.cssRules ? rules(rule.cssRules) : rule.selectorText ? [rule.selectorText] : []);
    const sheet = [...document.styleSheets].find(sheet => sheet.href?.endsWith('/coordinator-prototype.css'));
    return rules(sheet.cssRules).filter(selector => [root, ...root.querySelectorAll('*')].some(node => node.matches(selector)));
  });
  expect(selectors).toEqual([]); isolated(); await real.close();
});

test('workspace fits phone, worker focus, short viewport and desktop in one capture batch', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const isolated = await observe(page);
  const evidence = process.env.PI_COORDINATOR_EVIDENCE || testInfo.outputPath('workspace');
  mkdirSync(evidence, { recursive: true });
  for (const view of [
    { name: 'phone', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 740 },
    { name: 'keyboard-sized', width: 390, height: 510 }, { name: 'desktop', width: 1440, height: 900 }
  ]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(view); await page.emulateMedia({ colorScheme: theme });
      await page.goto(route);
      if (view.name === 'keyboard-sized') await page.locator('#prompt').fill('Keep the saved format.');
      await fits(page);
      if (['phone', 'desktop'].includes(view.name) || view.name === 'keyboard-sized' && theme === 'light') {
        await page.screenshot({ path: join(evidence, `${view.name}-${theme}.png`), fullPage: true });
      }
      if (view.name === 'phone' && theme === 'light') {
        await page.getByRole('button', { name: 'Reply in Login copy' }).click(); await fits(page);
        await page.screenshot({ path: join(evidence, 'phone-worker-question.png'), fullPage: true });
        await page.locator('.worker-window[data-session=checks]').click(); await fits(page);
        await page.screenshot({ path: join(evidence, 'phone-returned-report.png'), fullPage: true });
      }
    }
  }
  isolated();
});
