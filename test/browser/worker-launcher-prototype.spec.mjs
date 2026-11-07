import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const route = '/coordinator-prototype.html?study=launchers';
const evidence = process.env.VERIFY_EVIDENCE;
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });

async function isolated(page) {
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.addInitScript(() => {
    const forbidden = () => { throw new Error('Launcher study accessed a live capability'); };
    for (const key of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[key] = forbidden;
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) Object.defineProperty(window, key, { get: forbidden });
    Object.defineProperty(document, 'cookie', { get: forbidden, set: forbidden });
    for (const key of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'FileReader', 'showOpenFilePicker']) window[key] = forbidden;
    navigator.sendBeacon = forbidden;
  });
  return () => {
    expect(errors).toEqual([]);
    const allowed = ['/coordinator-prototype.html', '/coordinator-prototype.js', '/coordinator-prototype.css', '/style.css', '/icon.svg'];
    const origin = new URL(page.url()).origin;
    expect(requests.filter(request => request.method !== 'GET' || new URL(request.url).origin !== origin || !allowed.includes(new URL(request.url).pathname))).toEqual([]);
  };
}
async function capture(page, name) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: join(evidence, name + '.png') });
}
async function openNotes(page) { await page.getByRole('button', { name: 'About the launcher study', exact: true }).click(); }
async function closeNotes(page) { await page.getByRole('button', { name: 'Close study notes', exact: true }).click(); }
async function openWorkers(page) {
  if (await page.locator('#coordinator-context').isVisible()) await page.locator('#coordinator-open').click();
  else {
    await page.locator('#launcher-details').click();
    await expect(page.locator('#coordinator-sheet')).not.toBeVisible();
    await page.locator('#coordinator-tasks').click();
  }
  await expect(page.locator('#coordinator-sheet')).toBeFocused();
}
async function bounds(page) {
  return page.evaluate(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
    const byId = id => rect(document.getElementById(id));
    const visible = selector => [...document.querySelectorAll(selector)].filter(element => element.checkVisibility());
    const context = document.getElementById('coordinator-context');
    return { overflow: document.documentElement.scrollWidth > innerWidth, scroll: scrollY,
      launcherHeight: parseFloat(getComputedStyle(document.querySelector('#app > main')).getPropertyValue('--coordinator-height')),
      footer: !context.hidden, action: byId('coordinator-open'), context: byId('coordinator-context'), dots: byId('session-swipe'),
      composer: byId('composer'), controls: byId('launcher-controls'), transcript: byId('transcript'), header: rect(document.querySelector('.conversation-header')),
      headerSlots: document.querySelector('.conversation-header').children.length,
      statusFits: document.getElementById('launcher-header-status').scrollWidth <= document.getElementById('launcher-header-status').clientWidth,
      targets: visible('#launcher-controls .launcher-cycle > button, .launcher-samples > button, .launcher-samples select, #launcher-details, #coordinator-open').map(rect),
      formStyle: ['font-family', 'font-size', 'padding', 'border-radius', 'background-color'].map(key => getComputedStyle(document.getElementById('composer')).getPropertyValue(key)) };
  });
}

test('launcher height comparison: phone idle/working in both themes, narrow and desktop bounds', async ({ page }) => {
  test.setTimeout(90000);
  const safe = await isolated(page), measurements = {};
  const form = source => source.match(/<form id="composer"[\s\S]*?<\/form>/)[0];
  expect(form(readFileSync('web/coordinator-prototype.html', 'utf8'))).toBe(form(readFileSync('web/index.html', 'utf8')));
  const styles = readFileSync('web/coordinator-prototype.css', 'utf8').split('/* Isolated launcher study:')[1];
  expect(styles).not.toMatch(/#composer|\.composer|#prompt|#attach\b|#model\b|#send\b|#usage-meter/);
  for (const [size, width, height, colorScheme] of [
    ['phone-light', 390, 844, 'light'], ['phone-dark', 390, 844, 'dark'],
    ['narrow-dark', 320, 640, 'dark'], ['desktop-light', 1440, 900, 'light']
  ]) {
    await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme });
    for (const state of ['idle', 'working']) for (const variant of ['A', 'B', 'C']) {
      await page.goto(route + '&variant=' + variant + '&state=' + state);
      await expect(page.locator('#launcher-label')).toContainText(variant + ' ·');
      const box = await bounds(page); measurements[`${size}-${state}-${variant}`] = box;
      expect(box.overflow).toBe(false); expect(box.scroll).toBe(0);
      expect(box.transcript.height).toBeGreaterThanOrEqual(44);
      expect(box.composer.bottom).toBeLessThanOrEqual(box.controls.y);
      expect(box.dots.height).toBe(28); expect(box.headerSlots).toBe(3);
      // Absolute production positioning uses the composer's inner border edge.
      expect(Math.abs(box.dots.bottom - (box.composer.y - box.launcherHeight))).toBeLessThanOrEqual(1);
      expect(box.footer).toBe(variant === 'C' || variant === 'A' && state === 'working');
      expect(box.launcherHeight).toBe(variant === 'C' ? 44 : variant === 'A' && state === 'working' ? 53 : 0);
      if (variant === 'B') expect(box.statusFits).toBe(true);
      if (variant === 'C') expect(box.action.width).toBeLessThan(box.context.width);
      for (const target of box.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
      await capture(page, `${size}-${state}-${variant}`);
    }
    const at = (state, variant) => measurements[`${size}-${state}-${variant}`];
    // The composer stays fixed; reclaimed launcher space belongs to the transcript.
    for (const state of ['idle', 'working']) for (const variant of ['B', 'C']) expect(at(state, 'A').composer.y).toBe(at(state, variant).composer.y);
    expect(at('idle', 'A').transcript.height - at('idle', 'C').transcript.height).toBe(44);
    expect(at('working', 'B').transcript.height - at('working', 'A').transcript.height).toBe(53);
    expect(at('working', 'C').transcript.height - at('working', 'A').transcript.height).toBe(9);
    expect(at('working', 'A').formStyle).toEqual(at('idle', 'C').formStyle);
    expect(at('working', 'A').controls.height).toBe(at('idle', 'B').controls.height);
  }
  if (evidence) writeFileSync(join(evidence, 'geometry.json'), JSON.stringify(measurements, null, 2) + '\n');
  safe();
});

test('safe menu/sheet navigation, settlement, shared URLs and mounted composer state', async ({ page }) => {
  test.setTimeout(90000);
  const safe = await isolated(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(route + '&variant=A&state=working');
  await page.locator('#prompt').fill('Keep this unsent draft and attachment.');
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
  await page.getByRole('button', { name: 'Add sample image', exact: true }).click();
  const mainPosition = await page.locator('#transcript').evaluate(element => element.scrollTop);
  await openWorkers(page);
  await expect(page.locator('.coordinator-sheet input, .coordinator-sheet textarea, .coordinator-sheet form')).toHaveCount(0);
  await expect(page.locator('.coordinator-worker small')).toHaveCSS('color', 'rgb(128, 212, 160)');
  await capture(page, 'phone-dark-A-working-roster');
  await page.locator('.coordinator-worker').click();
  await expect(page.locator('#coordinator-sheet')).toBeFocused();
  await expect(page.locator('#coordinator-subtitle')).toHaveText('Working');
  await page.getByText('Task details', { exact: true }).click();
  await page.getByText('Illustrative activity · read · web/style.css', { exact: true }).click();
  await capture(page, 'phone-dark-A-working-log');
  await page.getByRole('button', { name: 'Next launcher', exact: true }).click();
  await expect(page.locator('#coordinator-log details')).toHaveCount(2);
  expect(await page.locator('#coordinator-log details').evaluateAll(elements => elements.every(element => element.open))).toBe(true);
  await expect(page.locator('#coordinator-context')).not.toBeVisible();
  await page.getByRole('button', { name: 'Previous launcher', exact: true }).click();
  await page.locator('#launcher-state').selectOption('idle');
  await expect(page.locator('#coordinator-context')).not.toBeVisible();
  await capture(page, 'phone-dark-A-idle-open-sheet');
  await page.getByRole('button', { name: 'Close workers', exact: true }).click();
  await expect(page.locator('#launcher-details')).toBeFocused();
  await expect(page.locator('#prompt')).toHaveValue('Keep this unsent draft and attachment.');
  await expect(page.getByRole('img', { name: 'Sample image, not uploaded', exact: true })).toBeVisible();
  expect(await page.locator('#transcript').evaluate(element => element.scrollTop)).toBe(mainPosition);

  await openNotes(page);
  const shareLink = await page.getByRole('link', { name: 'B · Header-owned access', exact: true }).getAttribute('href');
  expect(shareLink).toContain('study=launchers'); expect(shareLink).toContain('variant=B'); expect(shareLink).toContain('state=idle');
  await page.getByRole('link', { name: 'B · Header-owned access', exact: true }).click();
  await expect(page).toHaveURL(/variant=B/);
  await expect(page.locator('#prompt')).toHaveValue('Keep this unsent draft and attachment.');
  await openWorkers(page);
  await page.locator('.coordinator-worker').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#coordinator-log-back')).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('.coordinator-worker')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#launcher-details')).toBeFocused();
  await page.locator('#launcher-state').selectOption('answer');
  await expect(page.locator('#launcher-header-status')).toHaveText('1 needs answer');
  expect((await bounds(page)).statusFits).toBe(true);
  await capture(page, 'phone-dark-B-needs-answer');
  await page.locator('#prompt').focus(); await page.keyboard.press('ArrowRight'); await expect(page).toHaveURL(/variant=B/);
  await page.locator('#launcher-state').focus(); await page.keyboard.press('ArrowLeft'); await expect(page).toHaveURL(/variant=B/);
  await page.getByRole('button', { name: 'Next launcher', exact: true }).click();
  await expect(page).toHaveURL(/variant=C/);
  await page.locator('#launcher-state').selectOption('idle'); await openWorkers(page);
  await page.getByRole('button', { name: 'Close workers', exact: true }).click(); await expect(page.locator('#coordinator-open')).toBeFocused();
  await openWorkers(page); await page.locator('#coordinator-sheet').click({ position: { x: 4, y: 72 } });
  await expect(page.locator('#coordinator-sheet')).not.toBeVisible(); await expect(page.locator('#coordinator-open')).toBeFocused();
  await page.keyboard.press('ArrowRight'); await expect(page).toHaveURL(/variant=A/);

  for (const [sampleState, conditions] of [['working', ['starting', 'working', 'stopping']], ['answer', ['waiting']], ['result', ['reported']], ['uncertain', ['unknown', 'queued', 'recovering', 'blocked', 'delivery']]]) {
    await page.locator('#launcher-state').selectOption(sampleState);
    for (const condition of conditions) {
      await openNotes(page); await page.locator('#launcher-condition').selectOption(condition); await closeNotes(page);
      await expect(page.locator('#coordinator-context')).toBeVisible();
      expect((await bounds(page)).launcherHeight).toBe(53);
    }
  }
  await capture(page, 'phone-dark-A-unresolved-delivery');
  await openWorkers(page); await page.locator('.coordinator-worker').click();
  await expect(page.locator('#coordinator-subtitle')).toHaveText('Delivery uncertain');
  await expect(page).toHaveURL(/pane=review/);
  const share = page.url(); await page.reload(); expect(page.url()).toBe(share);
  await expect(page.locator('#coordinator-subtitle')).toHaveText('Delivery uncertain');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
  await expect(page).toHaveURL(/theme=light/); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#model').click(); await expect(page.locator('#settings-dialog')).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('#reasoning-control').click(); await page.getByRole('button', { name: 'Close model picker', exact: true }).click();
  await page.locator('#usage-meter').click(); await page.keyboard.press('Escape');
  await page.locator('#commands').click(); await expect(page.locator('#command-menu')).toBeVisible(); await page.locator('#commands').click();
  await openNotes(page); await page.locator('#launcher-parent-working').check(); await closeNotes(page);
  await expect(page.locator('#abort')).toBeVisible(); await page.locator('#abort').click(); await expect(page.locator('#abort')).not.toBeVisible();
  safe();
});

test('sheet bounds and pull dismissal, plus existing panes/stacks remain separate', async ({ page }) => {
  test.setTimeout(60000);
  const safe = await isolated(page);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  for (const [name, width, height] of [['short', 390, 510], ['narrow', 320, 640], ['desktop', 1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto(route + '&variant=A&state=working&pane=review');
    await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
    const geometry = await page.evaluate(() => {
      const surface = document.querySelector('.coordinator-sheet'), rect = surface.getBoundingClientRect(), header = surface.querySelector('header').getBoundingClientRect();
      const style = getComputedStyle(surface);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom,
        controlsY: document.getElementById('launcher-controls').getBoundingClientRect().y, headerHeight: header.height,
        border: style.borderTopWidth, opacity: style.opacity, background: style.backgroundColor, blur: style.backdropFilter,
        scrollHeight: document.getElementById('coordinator-scroll').getBoundingClientRect().height };
    });
    expect(geometry.width).toBe(Math.min(640, width)); expect(geometry.x).toBe((width - geometry.width) / 2);
    expect(geometry.y).toBeGreaterThanOrEqual(24); expect(geometry.bottom).toBeLessThanOrEqual(geometry.controlsY);
    expect(geometry.height).toBeLessThanOrEqual(Math.min(height * .72, 640) + 1);
    expect(geometry.headerHeight).toBeLessThanOrEqual(74); expect(geometry.scrollHeight).toBeGreaterThanOrEqual(44);
    expect(geometry.border).toBe('0px'); expect(geometry.opacity).toBe('1'); expect(geometry.blur).toBe('blur(10px)');
    expect(geometry.background).toContain('0.74');
    await capture(page, `${name}-working-sheet`);
    await page.keyboard.press('Escape'); await expect(page.locator('#coordinator-sheet')).not.toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 510 });
  await page.goto(route + '&variant=C&state=working&pane=review');
  await expect(page.locator('.coordinator-sheet')).toHaveCSS('transform', 'none');
  const client = await page.context().newCDPSession(page);
  const touch = (type, x, y) => client.send('Input.dispatchTouchEvent', { type, touchPoints: ['touchEnd', 'touchCancel'].includes(type) ? [] : [{ x, y }] });
  const header = await page.locator('.coordinator-sheet > header').boundingBox(), x = header.x + header.width / 2, y = header.y + 32;
  const resting = Math.round((await page.locator('.coordinator-sheet').boundingBox()).y);
  await touch('touchStart', x, y); await touch('touchMove', x, y + 24); await touch('touchMove', x, y + 60); await touch('touchCancel');
  await expect.poll(async () => Math.round((await page.locator('.coordinator-sheet').boundingBox()).y)).toBe(resting);
  await touch('touchStart', x, y); await touch('touchMove', x, y + 24); await touch('touchEnd');
  await expect.poll(async () => Math.round((await page.locator('.coordinator-sheet').boundingBox()).y)).toBe(resting);
  await page.getByText('Task details', { exact: true }).click();
  const overflow = await page.locator('#coordinator-scroll').evaluate(element => element.scrollHeight - element.clientHeight);
  expect(overflow).toBeGreaterThan(100);
  const scroll = await page.locator('#coordinator-scroll').boundingBox(), sy = scroll.y + scroll.height - 20;
  await touch('touchStart', 220, sy); await touch('touchMove', 220, sy - 24); await touch('touchMove', 220, sy - 60); await touch('touchMove', 220, sy - 110); await touch('touchEnd');
  await expect.poll(() => page.locator('#coordinator-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(Math.round((await page.locator('.coordinator-sheet').boundingBox()).y)).toBe(resting);
  await touch('touchStart', x, y); await touch('touchMove', x, y + 30); await touch('touchMove', x, y + 100); await touch('touchMove', x, y + 150); await touch('touchEnd');
  await expect(page.locator('#coordinator-sheet')).not.toBeVisible(); await expect(page.locator('#coordinator-open')).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await openNotes(page);
  const stackLink = await page.getByRole('link', { name: 'rejected stack D working answer', exact: true }).getAttribute('href');
  await page.getByRole('link', { name: 'selected pane D bottom sheet', exact: true }).click();
  await expect(page.locator('#variant-label')).toHaveText('D · Bottom sheet');
  await page.locator('#workers-open').click(); await expect(page.locator('#pane-title')).toHaveText('Workers');
  await page.getByRole('button', { name: 'Messaging, Result ready', exact: true }).click(); await expect(page.locator('#pane-title')).toHaveText('Messaging');
  await page.getByRole('button', { name: 'Close worker pane', exact: true }).click();
  await page.goto('/coordinator-prototype.html' + stackLink); await expect(page.locator('.answer-document')).toBeVisible();
  await expect(page.locator('#variant-label')).toHaveText('Prototype D · Working answer');
  for (const study of ['stacks', 'panes']) for (const variant of ['A', 'B', 'C']) {
    await page.goto('/coordinator-prototype.html?study=' + study + '&variant=' + variant);
    await expect(page.locator('#composer')).toBeVisible(); await expect(page.locator('#variant-label')).toContainText(variant + ' ·');
    await page.getByRole('button', { name: 'Next prototype', exact: true }).click();
    await expect(page).toHaveURL(new RegExp('variant=' + ({ A: 'B', B: 'C', C: 'D' })[variant]));
  }
  safe();
});
