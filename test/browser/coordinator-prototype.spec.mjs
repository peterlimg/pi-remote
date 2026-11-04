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
  const main = await page.locator('#composer').isVisible();
  if (main) {
    for (const id of ['attach', 'model', 'reasoning-control', 'usage-meter', 'commands']) await expect(page.locator('#' + id)).toBeVisible();
    await expect(page.locator('#abort:not([hidden]), #send:not([hidden])')).toHaveCount(1);
  } else {
    await expect(page.locator('#worker-inspection')).toBeVisible();
    await expect(page.locator('textarea:visible, input:visible')).toHaveCount(0);
  }
  const bounds = await page.evaluate(() => {
    const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
    return { overflow: document.documentElement.scrollWidth > innerWidth, scroll: scrollY, height: innerHeight,
      transcript: rect('transcript'), dock: rect('stack-dock'), composer: rect('composer'), inspection: rect('worker-inspection'),
      controls: [...document.querySelectorAll('#worker-stack > summary, .stack-row, .prototype-switcher button, .coordinator-actions button, #worker-inspection button')].filter(node => node.checkVisibility()).map(node => {
        const r = node.getBoundingClientRect(), style = getComputedStyle(node);
        return { width: r.width, height: r.height, background: style.backgroundColor, radius: style.borderRadius, row: node.classList.contains('stack-row') };
      }) };
  });
  expect(bounds.overflow).toBe(false); expect(bounds.scroll).toBe(0);
  expect(bounds.transcript.height).toBeGreaterThanOrEqual(44);
  expect(bounds.transcript.bottom).toBeLessThanOrEqual(bounds.dock.top + 1);
  const footer = main ? bounds.composer : bounds.inspection;
  expect(bounds.dock.bottom).toBeLessThanOrEqual(footer.top + 1);
  expect(footer.bottom).toBeLessThan(bounds.height - 44);
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
  await page.getByRole('button', { name: 'View Layout review log', exact: true }).click();
  await expect(page.locator('#title')).toHaveText('Layout review');
  await expect(page.locator('#transcript')).toContainText('not an executed review');
  await page.getByRole('button', { name: 'Return to Mobile review coordinator' }).click();
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await expect(page).toHaveURL(/variant=C/);
  await expect(page.locator('.stack-tree-children .stack-row')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Return to Mobile review main conversation', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.reload(); await expect(page.locator('#variant-label')).toHaveText('Prototype C · Session tree');
  await page.getByRole('button', { name: 'Next prototype' }).click(); await expect(page).toHaveURL(/variant=D/);
  await expect(page.getByRole('article', { name: 'Working answer', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next prototype' }).click(); await expect(page).toHaveURL(/variant=A/);
  await page.locator('#prompt').fill('Keep this draft.'); await page.keyboard.press('ArrowLeft'); await expect(page).toHaveURL(/variant=A/);
  await page.locator('#variant-next').focus(); await page.keyboard.press('ArrowRight'); await expect(page).toHaveURL(/variant=B/);
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft.');
  await page.setViewportSize({ width: 390, height: 510 }); await page.goto(route + '?variant=B');
  await expect(page.getByRole('region', { name: 'Recovery details' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Inspect Recovery, Needs answer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Answer in main chat', exact: true })).toBeInViewport();
  await page.getByRole('button', { name: 'Answer in main chat', exact: true }).click();
  await expect(page.locator('#title')).toHaveText('Mobile review'); await expect(page.locator('#prompt')).toBeFocused();
  await page.getByRole('button', { name: 'About this design study' }).click();
  await expect(page.locator('#study-info')).toContainText('No agents run'); await page.keyboard.press('Escape');
  for (const suffix of ['html', 'css', 'js']) {
    const response = await request.get('/coordinator-prototype.' + suffix);
    expect(response.status()).toBe(200); expect(response.headers()['content-security-policy']).not.toContain('unsafe-inline');
  }
  isolated();
});

test('the coordinator presents questions and relays all input while worker logs stay read-only', async ({ page }) => {
  const isolated = await observe(page);
  for (const variant of ['A', 'B', 'C']) {
    await page.goto(route + '?variant=' + variant);
    await expect(page.getByText('Recovery needs a choice before it can continue. Should it check browser reload or host restart first?', { exact: true })).toBeInViewport();
    await page.locator('#prompt').fill('Host restart first.'); await page.locator('#send').click();
    await expect(page.locator('#title')).toHaveText('Mobile review');
    await expect(page.locator('#transcript')).toContainText('I relayed your choice to Recovery: host restart first. Other workers are unchanged.');
    await expect(page.locator('#worker-stack-summary')).toHaveText('2 working · 1 ready');
    await expect(page.getByRole('button', { name: 'Host restart first', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop Messaging', exact: true }).click();
    await expect(page.locator('#transcript')).toContainText('I stopped Messaging at your request. Recovery and Layout review are unchanged.');
    await expect(page.locator('#worker-stack-summary')).toHaveText('1 working · 1 ready');
    await page.locator('[data-session="recovery"]').last().click();
    await expect(page.locator('#title')).toHaveText('Recovery');
    await expect(page.locator('#transcript')).toContainText('Instruction from Mobile review');
    await expect(page.locator('#transcript')).toContainText('Host restart first.');
    await expect(page.locator('#transcript .message.user')).toHaveCount(0);
    await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('#status-line')).toBeHidden();
    await expect(page.locator('textarea:visible, input:visible')).toHaveCount(0);
    await expect(page.locator('#worker-inspection')).toContainText('Read-only worker log');
    await page.getByRole('button', { name: 'Back to main conversation', exact: true }).click();
    await expect(page.locator('#composer')).toBeVisible();
    await expect(page.locator('#transcript .message.user')).toHaveCount(3);
    await expect(page.locator('#prototype-state')).toContainText('"recipient": "coordinator"');
  }
  isolated();
});

test('inspection preserves the coordinator draft and attachments without exposing direct worker controls', async ({ page }) => {
  const isolated = await observe(page); await page.goto(route + '?variant=A');
  await page.locator('#prompt').fill('Keep my coordinator draft.');
  await page.locator('#attach').click(); await page.getByRole('button', { name: 'Add sample image' }).click();
  await page.getByRole('button', { name: 'Stop Messaging', exact: true }).click();
  await expect(page.locator('#sample-feedback')).toContainText('Send or clear your current draft');
  await expect(page.locator('#worker-stack-summary')).toHaveText('1 working · 1 needs answer · 1 ready');
  for (const name of ['Messaging', 'Recovery', 'Layout review']) {
    await page.getByRole('button', { name: new RegExp('^View ' + name + ' log,') }).click();
    await expect(page.locator('#study-subtitle')).toHaveText('Worker log · Read-only');
    await expect(page.locator('#composer')).toBeHidden(); await expect(page.locator('#abort')).toBeHidden();
    await page.getByRole('button', { name: 'Back to main conversation', exact: true }).click();
    await expect(page.locator('#prompt')).toHaveValue('Keep my coordinator draft.');
    await expect(page.locator('#attachments img')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Remove sample image' }).click();
  for (const text of ['<img src=x onerror=alert(1)>', '__proto__']) {
    await page.locator('#prompt').fill(text); await page.locator('#send').click();
    await expect(page.locator('#transcript .message.user').last()).toHaveText(text);
    await expect(page.locator('#transcript img, #transcript script')).toHaveCount(0);
    await expect(page.locator('#transcript .message.assistant').last()).toContainText('No worker action was inferred');
  }
  for (const id of ['model', 'reasoning-control', 'usage-meter']) {
    await page.locator('#' + id).click(); await expect(page.locator('#settings-picker')).toBeVisible(); await page.keyboard.press('Escape');
  }
  await page.locator('#commands').click(); await page.getByRole('option', { name: /\/model/ }).click();
  await page.locator('#send').click(); await expect(page.locator('#settings-picker')).toBeVisible(); await page.keyboard.press('Escape');
  await page.goto(route + '?variant=C&session=recovery');
  await page.reload(); await expect(page.locator('#title')).toHaveText('Recovery'); await expect(page.locator('#composer')).toBeHidden();
  isolated();
});

test('collapsing each stack preserves inspection state and the coordinator draft', async ({ page }) => {
  const isolated = await observe(page), disclosure = page.locator('#worker-stack'), toggle = disclosure.locator('summary');
  for (const variant of ['A', 'B', 'C']) {
    await page.goto(route + '?variant=' + variant);
    await page.locator('#prompt').fill('Keep my coordinator draft.');
    const expandedHeight = await page.locator('#transcript').evaluate(node => node.clientHeight);
    await toggle.click();
    await expect(disclosure).toHaveJSProperty('open', false);
    await expect(page.locator('#stack-dock .stack-row:visible')).toHaveCount(0);
    await expect(toggle).toContainText('1 working · 1 needs answer · 1 ready');
    await expect.poll(() => page.locator('#transcript').evaluate(node => node.clientHeight)).toBeGreaterThan(expandedHeight + 88);
    await page.getByRole('button', { name: 'Next prototype' }).click();
    await expect(disclosure).toHaveJSProperty('open', false);
    await expect(page.locator('#title')).toHaveText('Mobile review');
    await expect(page.locator('#prompt')).toHaveValue('Keep my coordinator draft.');
    await toggle.focus(); await page.keyboard.press('Space');
    await expect(disclosure).toHaveJSProperty('open', true); await expect(toggle).toBeFocused();
  }
  await page.getByRole('button', { name: 'Next prototype' }).click();
  await page.locator('#attach').click(); await page.getByRole('button', { name: 'Add sample image' }).click();
  await page.getByRole('button', { name: 'View Messaging log, Working', exact: true }).click();
  await toggle.click(); await expect(page.locator('#composer')).toBeHidden();
  await expect(disclosure).toHaveJSProperty('open', false);
  await page.getByRole('button', { name: 'Back to main conversation', exact: true }).click();
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(page.locator('#prompt')).toHaveValue('Keep my coordinator draft.');
  await expect(page.locator('#attachments img')).toBeVisible();
  await page.getByRole('button', { name: 'Remove sample image' }).click();
  await page.locator('#prompt').fill('Stop Messaging'); await page.locator('#send').click();
  await expect(disclosure).toHaveJSProperty('open', false);
  await expect(toggle).toContainText('1 needs answer · 1 ready'); await expect(toggle).not.toContainText('working');
  await expect(page.locator('#prototype-state')).toContainText('"expanded": false');
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
    await page.goto(route + '?variant=D');
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

test('working answer queues findings without replacing the text being read and retains previous revisions', async ({ page }) => {
  const isolated = await observe(page); await page.setViewportSize({ width: 390, height: 510 });
  await page.goto(route + '?variant=D');
  const document = page.getByRole('article', { name: 'Working answer', exact: true });
  await expect(page.locator('#worker-stack')).toHaveJSProperty('open', false);
  await expect(page.locator('.stack-summary-title')).toHaveText('Sources · 3');
  await page.locator('#prompt').fill('Keep my unfinished instruction.');
  await page.locator('#transcript').hover(); await page.mouse.wheel(0, 120);
  await expect.poll(() => page.locator('#transcript').evaluate(node => node.scrollTop)).toBeGreaterThan(20);
  const before = { text: await document.innerText(), scroll: await page.locator('#transcript').evaluate(node => node.scrollTop),
    top: await page.locator('#answer-messaging').evaluate(node => node.getBoundingClientRect().top) };
  await page.getByRole('button', { name: 'About this design study' }).click();
  await page.getByRole('button', { name: 'Receive sample finding', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review new findings', exact: true })).toBeVisible();
  expect(await document.innerText()).toBe(before.text);
  expect(await page.locator('#transcript').evaluate(node => node.scrollTop)).toBe(before.scroll);
  expect(await page.locator('#answer-messaging').evaluate(node => node.getBoundingClientRect().top)).toBeCloseTo(before.top, 0);
  await expect(page.locator('#prompt')).toHaveValue('Keep my unfinished instruction.');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.locator('#answer-history-list details')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close changes', exact: true }).click();
  await page.getByRole('button', { name: 'Review new findings', exact: true }).click();
  await expect(page.locator('#answer-messaging')).toContainText('Delivery passed the simulated check');
  await expect(page.getByRole('button', { name: 'Review new findings', exact: true })).toBeHidden();
  await expect(page.locator('#prompt')).toHaveValue('Keep my unfinished instruction.');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.locator('#answer-history-list details')).toHaveCount(2);
  const original = page.locator('#answer-history-list details').last();
  await original.locator('summary').click();
  await expect(original.getByText('The sample send trace reaches the host. Reconnect delivery is still being checked.', { exact: true })).toBeVisible();
  await page.keyboard.press('ArrowLeft'); await expect(page).toHaveURL(/variant=D/);
  await page.keyboard.press('Escape');
  await page.locator('#transcript').hover(); await page.mouse.wheel(0, 200);
  await expect.poll(() => page.locator('#transcript').evaluate(node => node.scrollTop)).toBeGreaterThan(50);
  const readingPosition = await page.locator('#transcript').evaluate(node => node.scrollTop);
  await page.getByRole('button', { name: 'Inspect Recovery source', exact: true }).click();
  await page.getByRole('button', { name: 'Back to main conversation', exact: true }).click();
  await expect.poll(() => page.locator('#transcript').evaluate(node => node.scrollTop)).toBe(readingPosition);
  isolated();
});

test('working answer decisions and scope changes stay in the main session with inspectable source evidence', async ({ page }) => {
  const isolated = await observe(page); await page.goto(route + '?variant=D');
  await page.getByRole('button', { name: 'Keep on phone', exact: true }).click();
  await expect(page.locator('#answer-recovery')).toContainText('Drafts should stay on this phone');
  await expect(page.getByRole('region', { name: 'Decision for you', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'About this design study' }).click();
  await page.getByRole('button', { name: 'Receive sample finding', exact: true }).click();
  await page.locator('#prompt').fill('Ignore desktop. Focus on Safari.'); await page.locator('#send').click();
  await expect(page.locator('.answer-meta').first()).toContainText('Safari only');
  await expect(page.locator('#answer-messaging')).toContainText('needs rechecking');
  await expect(page.locator('#answer-receipt')).toContainText('Older queued findings were set aside');
  await expect(page.getByRole('button', { name: 'Review new findings', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'About this design study' }).click();
  await page.getByRole('button', { name: 'Receive sample finding', exact: true }).click();
  await page.locator('#prompt').fill('Focus on Safari.'); await page.locator('#send').click();
  await expect(page.locator('#answer-receipt')).toContainText('queued evidence are unchanged');
  await expect(page.getByRole('button', { name: 'Review new findings', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review new findings', exact: true }).click();
  await expect(page.locator('#answer-messaging')).toContainText('Safari sample trace');
  await page.locator('#prompt').fill('Keep this draft while I inspect.');
  await page.locator('#attach').click(); await page.getByRole('button', { name: 'Add sample image' }).click();
  await page.getByRole('button', { name: 'Inspect Messaging source', exact: true }).click();
  await expect(page.locator('#composer')).toBeHidden();
  await expect(page.locator('textarea:visible, input:visible')).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('Recheck the delivery evidence for Safari only');
  await expect(page.locator('#transcript .message.user')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to main conversation', exact: true }).click();
  await expect(page.locator('#prompt')).toHaveValue('Keep this draft while I inspect.');
  await expect(page.locator('#attachments img')).toBeVisible();
  await page.goto(route + '?variant=D');
  await page.locator('#prompt').fill('Stop Messaging'); await page.locator('#send').click();
  await page.getByRole('button', { name: 'About this design study' }).click();
  await page.getByRole('button', { name: 'Receive sample finding', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review new findings', exact: true })).toBeHidden();
  await expect(page.locator('#sample-feedback')).toContainText('No new sample report was accepted');
  isolated();
});

test('working answer fits phone, narrow, short and desktop views with source logs and revision history', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const isolated = await observe(page), evidence = process.env.PI_COORDINATOR_EVIDENCE || testInfo.outputPath('answer');
  mkdirSync(evidence, { recursive: true });
  for (const view of [{ name: 'phone', width: 390, height: 844 }, { name: 'narrow', width: 320, height: 740 },
    { name: 'short', width: 390, height: 510 }, { name: 'desktop', width: 1440, height: 900 }]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize(view); await page.emulateMedia({ colorScheme: theme });
      await page.goto(route + '?variant=D'); await fits(page);
      await expect(page.getByRole('heading', { name: 'Mobile login review', exact: true })).toBeVisible();
      if (view.name === 'phone') expect(await page.getByRole('button', { name: 'Keep on phone', exact: true }).evaluate(node => node.getBoundingClientRect().bottom <= document.getElementById('transcript').getBoundingClientRect().bottom - 32)).toBe(true);
      const capture = async state => { if (view.name === 'phone' || theme === 'light') await page.screenshot({ path: join(evidence, 'D-' + view.name + '-' + theme + '-' + state + '.png'), fullPage: true }); };
      await capture('answer');
      await page.locator('#worker-stack > summary').click(); await fits(page);
      expect(await page.locator('#worker-stack .stack-name').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
      await capture('sources'); await page.locator('#worker-stack > summary').click();
      await page.getByRole('button', { name: 'About this design study' }).click();
      await page.getByRole('button', { name: 'Receive sample finding', exact: true }).click();
      await fits(page); await capture('pending');
      await page.getByRole('button', { name: 'Changes', exact: true }).click();
      const box = await page.locator('#answer-history').boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(view.height);
      await capture('history'); await page.getByRole('button', { name: 'Close changes', exact: true }).click();
      await page.getByRole('button', { name: 'Inspect Recovery source', exact: true }).click();
      await expect(page.locator('#composer')).toBeHidden(); await fits(page); await capture('source-log');
    }
  }
  isolated();
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
        await page.locator('#worker-stack > summary').click();
        await expect(page.locator('#worker-stack')).toHaveJSProperty('open', false);
        await fits(page);
        if (view.name === 'phone' || theme === 'light') await page.screenshot({ path: join(evidence, variant + '-' + view.name + '-' + theme + '-collapsed.png'), fullPage: true });
        await page.locator('#worker-stack > summary').click();
        if (variant === 'B') await page.getByRole('button', { name: 'Inspect Messaging, Working', exact: true }).click();
        await page.getByRole('button', { name: /^View Messaging log/ }).click();
        await expect(page.locator('#composer')).toBeHidden(); await fits(page);
        expect(await page.locator('.stack-row[aria-current="page"] .stack-name').evaluate(node => node.getBoundingClientRect().top >= document.querySelector('#worker-stack > summary').getBoundingClientRect().bottom)).toBe(true);
        if (view.name === 'phone' || theme === 'light') await page.screenshot({ path: join(evidence, variant + '-' + view.name + '-' + theme + '-worker-log.png'), fullPage: true });
      }
    }
  }
  isolated();
});
