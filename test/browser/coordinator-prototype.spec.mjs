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
    const forbidden = () => { throw new Error('Stack prototype touched a real capability'); };
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
    const base = root.getBoundingClientRect();
    const props = ['display', 'position', 'width', 'height', 'font-family', 'font-size', 'line-height', 'color', 'background-color',
      'border-color', 'border-radius', 'padding', 'margin', 'gap', 'flex-wrap', 'box-shadow', 'overflow-x', 'overflow-y'];
    return [root, ...root.querySelectorAll('*')].map(n => {
      const style = getComputedStyle(n), r = n.getBoundingClientRect();
      return { id: n.id || n.tagName + '.' + n.className, css: Object.fromEntries(props.map(p => [p, style.getPropertyValue(p)])),
        rect: (r.width && r.height ? [r.x - base.x, r.y - base.y, r.width, r.height] : [0, 0, 0, 0]).map(v => Math.round(v * 100) / 100) };
    });
  });
}



async function fits(page) {
  for (const id of ['attach', 'model', 'reasoning-control', 'usage-meter', 'commands']) await expect(page.locator('#' + id)).toBeVisible();
  await expect(page.locator('#abort:not([hidden]), #send:not([hidden])')).toHaveCount(1);
  const bounds = await page.evaluate(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
    return { overflow: document.documentElement.scrollWidth > innerWidth, scroll: scrollY, height: innerHeight,
      transcript: rect('transcript'), dock: rect('stack-dock'), composer: rect('composer'),
      controls: [...document.querySelectorAll('.stack-row, .prototype-switcher button')].map(node => {
        const r = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { width: r.width, height: r.height, background: style.backgroundColor, radius: style.borderRadius, row: node.classList.contains('stack-row') };
      }) };
  });
  expect(bounds.overflow).toBe(false); expect(bounds.scroll).toBe(0);
  expect(bounds.transcript.height).toBeGreaterThanOrEqual(44);
  expect(bounds.transcript.bottom).toBeLessThanOrEqual(bounds.dock.top + 1);
  expect(bounds.dock.bottom).toBeLessThanOrEqual(bounds.composer.top + 1);
  expect(bounds.composer.bottom).toBeLessThan(bounds.height - 44);
  for (const control of bounds.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44);
    if (control.row) { expect(control.background).toBe('rgba(0, 0, 0, 0)'); expect(control.radius).toBe('0px'); }
  }
}

test('three stack prototypes differ structurally and keep the variant URL shareable', async ({ page, request }) => {
  const isolated = await observe(page); await page.goto(route + '?variant=A');
  await expect(page.locator('#variant-label')).toHaveText('Prototype A · Plain list');
  await expect(page.locator('#stack-dock .stack-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page).toHaveURL(/variant=B/);
  await expect(page.getByRole('region', { name: 'Recovery details' })).toContainText('browser reload or host restart');
  await page.getByRole('button', { name: 'Inspect Layout review, Result ready', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Layout review details' })).toContainText('Sample notes');
  await page.getByRole('button', { name: 'Open Layout review', exact: true }).click();
  await expect(page.locator('#title')).toHaveText('Layout review');
  await expect(page.locator('#transcript')).toContainText('not an executed review');
  await page.getByRole('button', { name: 'Return to Mobile review coordinator' }).click();
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page).toHaveURL(/variant=C/);
  await expect(page.locator('.stack-tree-children .stack-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Open Mobile review, coordinator', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload(); await expect(page.locator('#variant-label')).toHaveText('Prototype C · Session tree');
  await page.getByRole('button', { name: 'Next prototype' }).click(); await expect(page).toHaveURL(/variant=A/);
  await page.locator('#prompt').fill('Keep this draft.'); await page.keyboard.press('ArrowLeft'); await expect(page).toHaveURL(/variant=A/);
  await page.locator('#variant-next').focus(); await page.keyboard.press('ArrowRight'); await expect(page).toHaveURL(/variant=B/);
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft.');
  await page.setViewportSize({ width: 390, height: 510 }); await page.goto(route + '?variant=B');
  await expect(page.getByRole('region', { name: 'Recovery details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect Recovery, Needs answer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reply in Recovery', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'About this design study' }).click();
  await expect(page.locator('#study-info')).toContainText('No agents run'); await page.keyboard.press('Escape');
  for (const suffix of ['html', 'css', 'js']) {
    const response = await request.get('/coordinator-prototype.' + suffix);
    expect(response.status()).toBe(200); expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
  }
  isolated();
});

test('sample worker navigation keeps drafts, attachments and Stop scoped without touching real capabilities', async ({ page }) => {
  const isolated = await observe(page); await page.goto(route + '?variant=A');
  await page.locator('#prompt').fill('Keep my coordinator draft.');
  await page.locator('#attach').click(); await page.getByRole('button', { name: 'Add sample image' }).click();
  await page.getByRole('button', { name: 'Open Messaging, Working', exact: true }).click();
  await expect(page.locator('#study-subtitle')).toHaveText('Mobile review · Worker');
  await expect(page.locator('#prompt')).toHaveValue(''); await expect(page.locator('#attachments')).toBeHidden();
  await page.locator('#abort').click();
  await expect(page.getByRole('button', { name: 'Open Messaging, Stopped', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Recovery, Needs answer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Layout review, Result ready', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open Recovery, Needs answer', exact: true }).click();
  const text = '<img src=x onerror=alert(1)>';
  await page.locator('#prompt').fill(text); await page.locator('#send').click();
  await expect(page.locator('#transcript .message.user').last()).toHaveText(text);
  await expect(page.locator('#transcript img, #transcript script')).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('received by Recovery only');
  await page.getByRole('button', { name: 'Return to Mobile review coordinator' }).click();
  await expect(page.locator('#prompt')).toHaveValue('Keep my coordinator draft.');
  await expect(page.locator('#attachments img')).toBeVisible();
  await page.getByRole('button', { name: 'Remove sample image' }).click();
  for (const id of ['model', 'reasoning-control', 'usage-meter']) {
    await page.locator('#' + id).click(); await expect(page.locator('#settings-picker')).toBeVisible(); await page.keyboard.press('Escape');
  }
  await page.locator('#commands').click(); await page.getByRole('option', { name: /\/model/ }).click();
  await page.locator('#send').click(); await expect(page.locator('#settings-picker')).toBeVisible(); await page.keyboard.press('Escape');
  await page.goto(route + '?variant=C&session=recovery'); await expect(page.locator('#title')).toHaveText('Recovery');
  await page.reload(); await expect(page.locator('#title')).toHaveText('Recovery');
  isolated();
});

test('stack variants preserve exact production composer source and appearance without prototype CSS overrides', async ({ page, context }) => {
  test.setTimeout(60000);
  const composer = source => source.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
  expect(composer(readFileSync('web/coordinator-prototype.html', 'utf8'))).toBe(composer(readFileSync('web/index.html', 'utf8')));
  const real = await context.newPage(); await production(real);
  const isolated = await observe(page);
  for (const view of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 390, height: 510 }]) {
    for (const target of [real, page]) await target.setViewportSize(view);
    await page.goto(route + '?variant=C');
    for (const draft of ['', 'Keep the format.\nOnly review the behavior.']) {
      for (const target of [real, page]) {
        await target.locator('#prompt').fill(draft);
        const bottom = target.locator('#scroll-bottom'); if (await bottom.isVisible()) await bottom.click();
        await expect(bottom).toBeHidden();
      }
      expect(await composerAppearance(page), view.width + 'x' + view.height).toEqual(await composerAppearance(real));
    }
  }
  const selectors = await page.locator('#composer').evaluate(root => {
    const rules = list => [...list].flatMap(rule => rule.cssRules ? rules(rule.cssRules) : rule.selectorText ? [rule.selectorText] : []);
    const sheet = [...document.styleSheets].find(sheet => sheet.href?.endsWith('/coordinator-prototype.css'));
    return rules(sheet.cssRules).filter(selector => [root, ...root.querySelectorAll('*')].some(node => node.matches(selector)));
  });
  expect(selectors).toEqual([]); isolated(); await real.close();
});

test('stack prototypes fit phone, narrow, short and desktop views in one capture batch', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const isolated = await observe(page), evidence = process.env.PI_COORDINATOR_EVIDENCE || testInfo.outputPath('stacks');
  mkdirSync(evidence, { recursive: true });
  for (const variant of ['A', 'B', 'C']) {
    for (const view of [
      { name: 'phone', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 740 },
      { name: 'short', width: 390, height: 510 }, { name: 'desktop', width: 1440, height: 900 }
    ]) {
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize(view); await page.emulateMedia({ colorScheme: theme });
        await page.goto(route + '?variant=' + variant); await fits(page);
        if (view.name === 'phone' || theme === 'light') await page.screenshot({ path: join(evidence, variant + '-' + view.name + '-' + theme + '.png'), fullPage: true });
      }
    }
  }
  isolated();
});
