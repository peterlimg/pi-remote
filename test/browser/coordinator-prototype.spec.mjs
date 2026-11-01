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
    const forbidden = () => { throw new Error('Storyboard touched a real capability'); };
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
async function fits(page) {
  for (const id of ['attach', 'model', 'reasoning-control', 'usage-meter', 'commands', 'send']) await expect(page.locator('#' + id)).toBeVisible();
  const bounds = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, y: scrollY,
    guide: document.querySelector('.story-guide').getBoundingClientRect().bottom,
    shell: document.querySelector('#app').getBoundingClientRect().top,
    transcript: document.querySelector('#transcript').getBoundingClientRect().height,
    headerBottom: document.querySelector('.conversation-header').getBoundingClientRect().bottom,
    currentTop: document.querySelector('[data-current-scene]').getBoundingClientRect().top,
    controls: [...document.querySelectorAll('#composer button:not([hidden]), .story-guide button')].filter(n => n.checkVisibility()).map(n => {
      const r = n.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }), width: innerWidth, height: innerHeight }));
  expect(bounds.overflow).toBe(false); expect(bounds.y).toBe(0);
  expect(bounds.guide).toBeLessThanOrEqual(bounds.shell); expect(bounds.transcript).toBeGreaterThan(40);
  expect(bounds.currentTop).toBeGreaterThanOrEqual(bounds.headerBottom);
  if (page.viewportSize().width > 700) expect(await page.locator('#sessions strong').evaluate(n => n.scrollWidth <= n.clientWidth)).toBe(true);
  for (const r of bounds.controls) {
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.right).toBeLessThanOrEqual(bounds.width);
    expect(r.bottom).toBeLessThanOrEqual(bounds.height); expect(r.width).toBeGreaterThanOrEqual(44); expect(r.height).toBeGreaterThanOrEqual(44);
  }
}
async function production(page) {
  const state = { id: 'story-baseline', title: 'Mobile release', cwd: '/sample/pi-remote', status: 'idle',
    model: 'openai/gpt-6.1-sol', modelName: 'GPT-6.1 Sol', thinkingLevel: 'xhigh',
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
  await expect(page.locator('#reasoning-value')).toHaveText('XHigh');
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

test('six-scene briefing storyboard preserves drafts and separates permission, scoped stop and review', async ({ page }) => {
  const isolated = await observe(page);
  await page.goto(route);
  await expect(page).toHaveURL(/scene=1/);
  await expect(page.locator('#story-title')).toHaveText('Hand off two jobs');
  await expect(page.getByRole('button', { name: 'Previous scene' })).toBeDisabled();
  await expect(page.locator('#transcript .message')).toHaveCount(2);
  await page.getByRole('button', { name: 'Next scene' }).click();
  await expect(page.locator('#story-title')).toHaveText('Keep the conversation moving');
  await expect(page.locator('#transcript')).toContainText('QR pairing');
  await page.locator('#prompt').fill('Keep my release-plan draft.');
  await page.locator('#prompt').press('ArrowLeft'); await expect(page).toHaveURL(/scene=2/);
  await page.getByRole('button', { name: 'Next scene' }).click();
  await expect(page.locator('#story-title')).toHaveText('A choice that cannot be guessed');
  await expect(page.locator('#prompt')).toHaveValue('Keep my release-plan draft.');
  await expect(page.locator('[data-question-state=open]')).toContainText('sign existing users out');
  await expect(page.locator('[data-story-action=keep]')).toBeInViewport();
  await page.locator('#prompt').fill('Yes, go ahead.'); await page.locator('#send').click();
  await expect(page.locator('[data-question-state=open]')).toBeVisible();
  await expect(page.locator('#transcript .message.assistant').last()).toContainText('has not approved');
  await page.locator('#prompt').fill('Keep my release-plan draft.');
  await page.getByRole('button', { name: 'Keep saved format', exact: true }).click();
  await expect(page).toHaveURL(/scene=3/);
  await expect(page.locator('[data-question-state=answered]')).toContainText('Navigation continues');
  await expect(page.locator('#transcript')).not.toContainText('Navigation is stopped');
  await expect(page.locator('[data-story-action=keep]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next scene' }).click();
  await expect(page).toHaveURL(/scene=4/);
  await expect(page.locator('[data-question-state=answered]')).toHaveCount(1);
  await expect(page.locator('#transcript .message.assistant').last()).toContainText('Login copy continues');
  await expect(page.locator('#transcript .message.assistant').last()).toContainText('partial findings are unverified');
  await expect(page.locator('#prompt')).toHaveValue('Keep my release-plan draft.');
  await expect(page.locator('#abort')).toBeHidden();
  await page.getByRole('button', { name: 'Next scene' }).click();
  await expect(page.locator('#story-title')).toHaveText('Return to one useful briefing');
  await expect(page.locator('.story-briefing h2')).toBeInViewport();
  await expect(page.locator('.story-briefing')).toContainText('Navigation is stopped');
  await expect(page.locator('.story-result')).toContainText('web/index.html');
  await expect(page.locator('.story-result-note')).toHaveText('Not applied or verified.');
  await page.getByRole('button', { name: 'Next scene' }).click();
  await expect(page).toHaveURL(/scene=6/);
  await expect(page.locator('#transcript .message.assistant').last()).toContainText('change only the placeholder');
  await expect(page.locator('#transcript .message.assistant').last().locator('.story-result')).not.toContainText('label:');
  await expect(page.locator('#prompt')).toHaveValue('Keep my release-plan draft.');
  await page.reload(); await expect(page.locator('#story-title')).toHaveText('Correct the result in context');
  await page.getByRole('button', { name: 'Restart storyboard' }).click();
  await expect(page).toHaveURL(/scene=1/);
  await page.locator('#story-position').click();
  await expect(page.locator('#story-index')).toContainText('No agents run');
  await page.locator('[data-scene="4"]').click(); await expect(page).toHaveURL(/scene=5/);
  await page.goto(route + '?scene=invalid'); await expect(page).toHaveURL(/scene=1/);
  isolated();
});

test('composer remains production-identical across representative scenes, including a multiline draft', async ({ page, context }) => {
  test.setTimeout(60000);
  const composer = source => source.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
  expect(composer(readFileSync('web/coordinator-prototype.html', 'utf8'))).toBe(composer(readFileSync('web/index.html', 'utf8')));
  const real = await context.newPage(); await production(real);
  const isolated = await observe(page);
  for (const view of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 390, height: 420 }]) {
    for (const theme of ['light', 'dark']) {
      for (const target of [real, page]) { await target.setViewportSize(view); await target.emulateMedia({ colorScheme: theme }); }
      for (const scene of [1, 3, 5, 6]) {
        await page.goto(route + '?scene=' + scene);
        for (const draft of ['', 'Keep the original label.\nShorten the placeholder only.\nDo not change the saved format.']) {
          for (const target of [real, page]) {
            await target.locator('#prompt').fill(draft);
            // Match the reader's position too: the storyboard opens at the current scene, not necessarily the thread bottom.
            const bottom = target.locator('#scroll-bottom');
            if (await bottom.isVisible()) await bottom.click();
            await expect(bottom).toBeHidden();
          }
          await expect(real.locator('#model')).toHaveCSS('opacity', '1');
          expect(await composerAppearance(page), `${view.width}x${view.height} ${theme} scene ${scene}`).toEqual(await composerAppearance(real));
        }
      }
    }
  }
  const selectors = await page.locator('#composer').evaluate(root => {
    const rules = list => [...list].flatMap(r => r.cssRules ? rules(r.cssRules) : r.selectorText ? [r.selectorText] : []);
    const sheet = [...document.styleSheets].find(s => s.href?.endsWith('/coordinator-prototype.css'));
    return rules(sheet.cssRules).filter(selector => [root, ...root.querySelectorAll('*')].some(n => n.matches(selector)));
  });
  expect(selectors).toEqual([]); isolated(); await real.close();
});

test('storyboard scenes fit phones and desktop in both themes, with one batched capture', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const isolated = await observe(page);
  const evidence = process.env.PI_COORDINATOR_EVIDENCE || testInfo.outputPath('storyboard');
  mkdirSync(evidence, { recursive: true });
  for (const view of [
    { name: 'phone', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 740 },
    { name: 'short', width: 390, height: 420 }, { name: 'desktop', width: 1440, height: 900 }
  ]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(view); await page.emulateMedia({ colorScheme: theme });
      for (let scene = 1; scene <= 6; scene++) {
        await page.goto(route + '?scene=' + scene); await fits(page);
        if (view.name !== 'narrow' && view.name !== 'short') await page.screenshot({ path: join(evidence, `${view.name}-${theme}-${scene}.png`) });
      }
    }
  }
  isolated();
});

test('normal composer controls remain bounded samples and the static routes retain CSP', async ({ page, request }) => {
  const isolated = await observe(page); await page.goto(route + '?scene=3');
  await page.locator('#prompt').fill('Keep this draft.');
  for (const id of ['model', 'reasoning-control', 'usage-meter']) {
    await page.locator('#' + id).click(); await expect(page.locator('#settings-picker')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.locator('#prompt')).toHaveValue('Keep this draft.');
  }
  await page.locator('#attach').click(); await page.getByRole('button', { name: 'Add sample image' }).click();
  await expect(page.locator('#attachments img')).toBeVisible(); await page.getByRole('button', { name: 'Remove sample image' }).click();
  await page.locator('#commands').click(); await page.getByRole('option', { name: /\/model/ }).click();
  await page.locator('#send').click(); await expect(page.locator('#settings-picker')).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('#prompt').fill('<img src=x onerror=alert(1)>'); await page.locator('#send').click();
  await expect(page.locator('#transcript .message.user').last()).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#transcript img, #transcript script')).toHaveCount(0);
  for (const suffix of ['html', 'css', 'js']) {
    const response = await request.get('/coordinator-prototype.' + suffix);
    expect(response.status()).toBe(200); expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
  }
  isolated();
});
