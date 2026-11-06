import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const route = '/coordinator-prototype.html?study=panes';
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

async function isolated(page) {
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.addInitScript(() => {
    const forbidden = () => { throw new Error('Pane prototype accessed a live capability'); };
    for (const key of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[key] = forbidden;
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) Object.defineProperty(window, key, { get: forbidden });
    Object.defineProperty(document, 'cookie', { get: forbidden, set: forbidden });
    for (const key of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'FileReader', 'showOpenFilePicker']) window[key] = forbidden;
    navigator.sendBeacon = forbidden;
  });
  return () => {
    expect(errors).toEqual([]);
    const origin = new URL(page.url()).origin;
    const allowed = ['/coordinator-prototype.html', '/coordinator-prototype.js', '/coordinator-prototype.css', '/style.css', '/icon.svg'];
    expect(requests.filter(request => request.method !== 'GET' || new URL(request.url).origin !== origin || !allowed.includes(new URL(request.url).pathname))).toEqual([]);
  };
}
async function inspect(page, variant, worker = 'Messaging') {
  if (variant === 'A') await page.getByRole('region', { name: 'Workers', exact: true }).getByRole('button', { name: worker + ', ' + (worker === 'Messaging' ? 'Result ready' : 'Stopped'), exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Open workers', exact: true }).click();
    if (variant === 'B') await page.locator('#worker-pane').getByRole('button', { name: worker + ', ' + (worker === 'Messaging' ? 'Result ready' : 'Stopped'), exact: true }).click();
    else await page.getByRole('tab', { name: worker, exact: true }).click();
  }
  await expect(page.locator('#pane-title')).toHaveText(worker);
}
async function capture(page, name) {
  if (!process.env.VERIFY_EVIDENCE) return;
  mkdirSync(process.env.VERIFY_EVIDENCE, { recursive: true });
  await page.screenshot({ path: join(process.env.VERIFY_EVIDENCE, name + '.png') });
}

test('pane variants preserve the production composer, draft, sample attachment and main reading position', async ({ page }) => {
  const safe = await isolated(page), form = source => source.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
  expect(form(readFileSync('web/coordinator-prototype.html', 'utf8'))).toBe(form(readFileSync('web/index.html', 'utf8')));
  const paneStyles = readFileSync('web/coordinator-prototype.css', 'utf8').split('/* Isolated worker navigation study.')[1];
  expect(paneStyles).not.toMatch(/#composer|\.composer|#prompt|#attach\b|#model\b|#send\b|#usage-meter/);
  for (const variant of ['A', 'B', 'C']) {
    await page.goto(route + '&variant=' + variant);
    await page.locator('#prompt').fill('Keep this unsent draft while I inspect.');
    await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
    await page.getByRole('button', { name: 'Add sample image', exact: true }).click();
    await page.locator('#transcript').evaluate(node => node.scrollTo(0, 35));
    const position = await page.locator('#transcript').evaluate(node => node.scrollTop);
    await inspect(page, variant);
    await expect(page.locator('#worker-pane')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#pane-content')).toContainText('Illustrative content');
    await expect(page.locator('#worker-pane textarea, #worker-pane input, #worker-pane form')).toHaveCount(0);
    if (variant === 'B') {
      await page.getByRole('button', { name: 'Workers', exact: true }).click();
      await page.getByRole('button', { name: 'Recovery, Stopped', exact: true }).click();
      await expect(page.locator('#pane-content')).toContainText('No completed report');
    } else if (variant === 'C') {
      await page.getByRole('tab', { name: 'Recovery', exact: true }).click();
      await expect(page.locator('#pane-content')).toContainText('No completed report');
    }
    await page.getByRole('button', { name: 'Close worker pane', exact: true }).click();
    await expect(page.locator('#prompt')).toHaveValue('Keep this unsent draft while I inspect.');
    await expect(page.getByRole('img', { name: 'Sample image, not uploaded' })).toBeVisible();
    expect(await page.getByRole('img', { name: 'Sample image, not uploaded' }).evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    expect(await page.locator('#transcript').evaluate(node => node.scrollTop)).toBe(position);
    await expect(variant === 'A' ? page.locator('#coordinator-worker-links [data-worker="messaging"]') : page.locator('#workers-open')).toBeFocused();
    if (variant === 'C') {
      await page.getByRole('button', { name: 'Open workers', exact: true }).click();
      await expect(page.locator('#pane-title')).toHaveText('Recovery');
      await page.getByRole('button', { name: 'Close worker pane', exact: true }).click();
    }
    await page.locator('#prompt').focus(); await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(new RegExp('variant=' + variant));
    await inspect(page, variant);
    await page.getByRole('button', { name: 'Next prototype' }).click();
    await expect(page.locator('#worker-pane')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#worker-pane')).not.toBeVisible();
    await expect(page.locator('#prompt')).toHaveValue('Keep this unsent draft while I inspect.');
  }
  safe();
});

test('all pane layouts fit phone, narrow, short and desktop views in both themes', async ({ page }) => {
  test.setTimeout(90000);
  const safe = await isolated(page);
  for (const variant of ['A', 'B', 'C']) for (const [name, width, height, colorScheme] of [
    ['phone-light', 390, 844, 'light'], ['phone-dark', 390, 844, 'dark'], ['narrow', 320, 740, 'dark'],
    ['short', 390, 510, 'dark'], ['desktop', 1440, 900, 'light']
  ]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
    await page.goto(route + '&variant=' + variant);
    const before = await page.locator('#transcript').boundingBox();
    if (variant !== 'A') expect((await page.locator('#workers-open').boundingBox()).height).toBeLessThanOrEqual(49);
    await capture(page, variant + '-' + name + '-main');
    await inspect(page, variant);
    const geometry = await page.evaluate(() => {
      const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const panel = document.querySelector('.pane-surface'), style = getComputedStyle(panel);
      const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
      context.fillStyle = style.backgroundColor; context.fillRect(0, 0, 1, 1);
      return { backgroundAlpha: context.getImageData(0, 0, 1, 1).data[3], opacity: Number(style.opacity),
        backdrop: getComputedStyle(document.getElementById('pane-dismiss')).backgroundColor,
        standardBackdrop: getComputedStyle(document.getElementById('sample-attachment'), '::backdrop').backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth, pageScroll: scrollY, panel: rect(panel),
        body: rect(document.getElementById('pane-scroll')), footer: rect(document.querySelector('.pane-footer')),
        switcher: rect(document.getElementById('prototype-controls')), modal: document.getElementById('worker-pane').matches(':modal'),
        form: rect(document.getElementById('composer')), main: rect(document.querySelector('#app > main')),
        controls: [...document.querySelectorAll('.pane-header button, .pane-footer button, .worker-tabs button, #prototype-controls > button')].filter(node => node.checkVisibility()).map(rect) };
    });
    expect(geometry.overflow).toBe(false); expect(geometry.pageScroll).toBe(0);
    expect(before.height).toBeGreaterThan(44);
    expect(geometry.panel.x).toBeGreaterThanOrEqual(48); expect(geometry.panel.right).toBeCloseTo(width, 0);
    expect(geometry.backgroundAlpha).toBe(255); expect(geometry.opacity).toBe(1);
    expect(geometry.backdrop).toBe(geometry.standardBackdrop);
    expect(geometry.panel.y).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.switcher.y);
    expect(geometry.body.height).toBeGreaterThanOrEqual(44);
    expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.panel.bottom + 1);
    for (const target of geometry.controls) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
    expect(geometry.modal).toBe(!(variant === 'C' && width >= 1100));
    if (!geometry.modal) expect(geometry.main.right).toBeLessThanOrEqual(geometry.panel.x + 1);
    await capture(page, variant + '-' + name + '-pane');
    await page.getByRole('button', { name: 'Close worker pane', exact: true }).click();
  }
  safe();
});

test('animated workers drawer enters from the right without scrolling its overlay', async ({ page }, testInfo) => {
  const safe = await isolated(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(route + '&variant=B');
  await page.evaluate(() => {
    window.drawerMotion = { frames: [], done: false };
    document.getElementById('workers-open').addEventListener('click', () => {
      const start = performance.now();
      const sample = () => {
        const pane = document.getElementById('worker-pane'), surface = pane.querySelector('.pane-surface');
        const rect = surface.getBoundingClientRect();
        window.drawerMotion.frames.push({ time: performance.now() - start, x: rect.x, width: rect.width,
          overlayScroll: pane.scrollLeft, pageScroll: document.scrollingElement.scrollLeft });
        if (performance.now() - start < 350) requestAnimationFrame(sample); else window.drawerMotion.done = true;
      };
      requestAnimationFrame(sample);
    }, { capture: true, once: true });
  });
  await page.getByRole('button', { name: 'Open workers', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.drawerMotion.done)).toBe(true);
  const frames = await page.evaluate(() => window.drawerMotion.frames);
  await testInfo.attach('drawer-motion.json', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' });
  expect(frames.length).toBeGreaterThan(3);
  expect(Math.max(...frames.map(frame => frame.overlayScroll))).toBe(0);
  expect(Math.max(...frames.map(frame => frame.pageScroll))).toBe(0);
  const resting = frames.at(-1).x;
  expect(Math.min(...frames.map(frame => frame.x))).toBeGreaterThanOrEqual(resting - 1);
  expect(frames[0].x).toBeGreaterThan(resting + 10);
  for (let index = 1; index < frames.length; index++) expect(frames[index].x).toBeLessThanOrEqual(frames[index - 1].x + 1);
  await expect(page.getByRole('button', { name: 'Close worker pane', exact: true })).toBeFocused();
  safe();
});

test('pinned inspector keeps desktop main input usable and becomes a native modal drawer on phones', async ({ page }) => {
  const safe = await isolated(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(route + '&variant=C&pane=messaging');
  await expect(page.locator('#worker-pane')).toBeVisible();
  expect(await page.locator('#worker-pane').evaluate(node => node.matches(':modal'))).toBe(false);
  await page.locator('#prompt').fill('Reply in the main conversation, not in the worker.');
  await expect(page.locator('#pane-title')).toHaveText('Messaging');
  await page.getByRole('tab', { name: 'Recovery', exact: true }).focus(); await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Messaging', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Messaging log', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/variant=C/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('#worker-pane').evaluate(node => node.matches(':modal'))).toBe(true);
  await page.getByRole('button', { name: 'Prototype options', exact: true }).click();
  await page.getByRole('button', { name: 'Switch light / dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', /light|dark/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Close worker pane', exact: true }).click();
  await expect(page.locator('#prompt')).toHaveValue('Reply in the main conversation, not in the worker.');
  await page.getByRole('button', { name: 'Open workers', exact: true }).click();
  await page.getByRole('button', { name: 'Dismiss worker pane', exact: true }).click({ position: { x: 4, y: 120 } });
  await expect(page.locator('#worker-pane')).not.toBeVisible();
  await page.goto(route + '&variant=B&pane=recovery');
  await expect(page.locator('#pane-title')).toHaveText('Recovery');
  await page.reload(); await expect(page.locator('#pane-title')).toHaveText('Recovery');
  safe();
});
