import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/host.mjs';
import { loadConfig } from '../../src/config.mjs';
import { filterRecentSessions } from './session-filter.mjs';

const fence = source => '```mermaid\n' + source + '```';
const simple = 'stateDiagram-v2\n  [*] --> Paid\n';

// The remaining cases simulate the browser WebSocket, not the diagram library or assets.
async function openDiagrams(page, text) {
  const state = { id: 'diagrams', title: 'Diagrams', cwd: '/project', status: 'idle', messages: [
    { id: 'reply', role: 'assistant', text }
  ] };
  let client, version = 1;
  await page.routeWebSocket('**/ws', ws => {
    client = ws;
    ws.onMessage(raw => {
      const packet = JSON.parse(raw);
      if (packet.type === 'auth') {
        ws.send(JSON.stringify({ type: 'ready' }));
        ws.send(JSON.stringify({ type: 'sessions', sessions: [state] }));
      } else {
        if (packet.op === 'watch') ws.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version, state }));
        ws.send(JSON.stringify({ type: 'response', id: packet.id, ok: true, value: [] }));
      }
    });
  });
  await page.goto('/#token=browser-test-token-only-123456789012345');
  await page.getByRole('button', { name: /Diagrams/ }).click();
  return text => {
    state.messages[0].text = text;
    client.send(JSON.stringify({ type: 'snapshot', sessionId: state.id, version: ++version, state }));
  };
}

test('Mermaid state diagrams render instead of displaying only their source', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-remote-diagrams-'));
  writeFileSync(join(dir, 'session.jsonl'), [
    { type: 'session', id: 'diagrams', cwd: dir },
    { type: 'session_info', id: 'title', parentId: null, name: 'Saved diagram' },
    { type: 'message', id: 'reply', parentId: 'title', message: { role: 'assistant', content: [{ type: 'text', text: fence(simple) }], timestamp: Date.now() } }
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const config = loadConfig(dir);
  const host = await startHost({ dir, config, port: 0, roots: [dir], relayUrl: '' });
  try {
    await page.goto(`http://127.0.0.1:${host.http.address().port}/#token=${config.clientToken}`);
    await filterRecentSessions(page, 'offline');
    await page.getByRole('button', { name: /Saved diagram/ }).click();
    const image = page.locator('.code-block img[alt="Mermaid diagram"]');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBeGreaterThan(0);
  } finally {
    await page.close(); await host.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('nested concurrent state diagrams support copying, source, zoom and both themes', async ({ page, context, browserName }, testInfo) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = `stateDiagram-v2
  direction LR
  state "Legend" as legend {
    lg0: Breaks NoDoublePayment
    lg1: Path to the NoDoublePayment bug
  }
  class lg0 breaks
  class lg1 bugPath
  state "At the same time" as all {
    state "Claim A" as r0 {
      s0: Reading wallet 1
      s1: Same accrual paid twice
      [*] --> s0
      s0 --> s1: stage rakeback payment
    }
    --
    state "Claim B" as r1 {
      t0: Payout locked for wallet 2
      t1: Committed
      [*] --> t0
      t0 --> t1: commit claim
    }
  }
  classDef breaks fill:#922,color:#fff,stroke:#f88
  classDef bugPath fill:#634,color:#fff,stroke:#f88
  class s1 breaks
`;
  const requests = [];
  page.on('request', request => requests.push(request.url()));
  const update = await openDiagrams(page, fence(source) + '\n\n```sh\nnpm test\n```');
  const block = page.locator('.code-block').first(), image = block.locator('img');
  await expect(image).toBeVisible();
  expect(await image.evaluate(node => node.naturalWidth)).toBeGreaterThan(0);
  await expect(block.locator('pre')).toBeHidden();
  await block.getByText('Diagram source', { exact: true }).click();
  await expect(block.locator('pre')).toHaveText(source);
  if (browserName === 'chromium') {
    await block.getByRole('button', { name: 'Copy code' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
  }
  await block.getByText('Diagram source', { exact: true }).click();
  await expect(page.locator('.code-block').last().locator('pre')).toHaveText('npm test\n');
  await block.getByRole('link', { name: 'Open diagram' }).click();
  await expect(page.locator('#image-viewer')).toBeVisible();
  await page.keyboard.press('+');
  await expect(page.locator('#image-zoom-reset')).not.toHaveText('100%');
  await page.screenshot({ path: testInfo.outputPath('state-diagram-zoom-phone.png') });
  await page.getByRole('button', { name: 'Close image', exact: true }).click();
  for (const [width, colorScheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 900 });
    const previous = await image.getAttribute('src');
    await page.emulateMedia({ colorScheme });
    if (colorScheme === 'light' || width === 1280) await expect(image).not.toHaveAttribute('src', previous);
    await expect(image).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`state-diagram-${width}-${colorScheme}.png`) });
  }
  const url = await image.getAttribute('src');
  update(fence(source) + '\n\nAnother update.');
  await expect(page.locator('.message-text')).toContainText('Another update.');
  await expect(image).toBeVisible();
  expect(await page.evaluate(async url => { try { await fetch(url); return true; } catch { return false; } }, url)).toBe(false);
  expect(requests.filter(url => url.endsWith('/mermaid-tiny.js'))).toHaveLength(1);
  expect(requests.filter(url => url.startsWith('http') && new URL(url).hostname !== '127.0.0.1')).toEqual([]);
  await testInfo.attach('diagram-conversation', { body: await page.locator('#transcript').ariaSnapshot(), contentType: 'text/plain' });
});

test('invalid and oversized diagrams retain source and later valid updates render safely', async ({ page }) => {
  const external = [], dialogs = [];
  page.on('request', request => { if (request.url().startsWith('http') && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  const invalid = 'stateDiagram-v2\n state "Incomplete\n';
  const update = await openDiagrams(page, fence(invalid));
  const block = page.locator('.code-block');
  await expect(block.locator('.diagram-status')).toHaveText('Diagram unavailable. Source shown below.');
  await expect(block.locator('pre')).toHaveText(invalid);
  await expect(block.locator('pre')).toBeVisible();
  update(fence('a'.repeat(50001) + '\n'));
  await expect(block.locator('.diagram-status')).toHaveText('Diagram unavailable. Source shown below.');
  update(fence('%%{init: {"securityLevel":"loose","htmlLabels":true}}%%\nflowchart LR\n A["<img src=\'https://example.com/tracker.png\' onerror=\'alert(1)\'>"] --> B[Safe]\n click B "javascript:alert(1)"\n'));
  await expect(block.locator('img')).toBeVisible();
  await expect(block.locator('.mermaid-diagram script, .mermaid-diagram svg, .mermaid-diagram iframe')).toHaveCount(0);
  await expect(page.locator('iframe.diagram-renderer')).toHaveAttribute('sandbox', 'allow-scripts');
  const renderer = await page.request.get('/diagram-renderer.html');
  expect(renderer.headers()['content-security-policy']).toContain('sandbox allow-scripts');
  expect(renderer.headers()['content-security-policy']).toMatch(/script-src 'nonce-[^']+'/);
  const app = await page.request.get('/');
  expect(app.headers()['content-security-policy']).not.toContain('unsafe-inline');
  update(fence(simple));
  await expect(block.locator('img')).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(external).toEqual([]);
});

test('plain code does not load Mermaid and a failed library keeps the diagram source', async ({ page }) => {
  const loaded = [];
  page.on('request', request => { if (request.url().includes('/mermaid-tiny.js')) loaded.push(request.url()); });
  await page.route('**/mermaid-tiny.js', route => route.abort());
  const update = await openDiagrams(page, '```sh\nnpm test\n```');
  await expect(page.locator('.code-block pre')).toHaveText('npm test\n');
  expect(loaded).toEqual([]);
  update(fence(simple));
  await expect(page.locator('.diagram-status')).toHaveText('Diagram unavailable. Source shown below.');
  await expect(page.locator('.code-block pre')).toHaveText(simple);
  await expect(page.locator('.code-block pre')).toBeVisible();
});

test('Markdown details and summary tags become collapsible sections', async ({ page }, testInfo) => {
  const text = '<details>\n<summary>Payment **model**</summary>\n\n' + fence(simple) + '\n</details>\n\n'
    + '<details> <summary>Missing-lock mutation counterexample</summary>\n\nNoDoublePayment breaks at step 12.\n'
    + '<details open>\n<summary>Step **12**</summary>\n\nBoth claims commit the same accrual.\n</details>\n</details>';
  const update = await openDiagrams(page, text);
  const details = page.locator('.message-text > .markdown-details'), first = details.first(), second = details.last();
  await expect(details).toHaveCount(2);
  await expect(first.locator(':scope > summary strong')).toHaveText('model');
  await expect(first).toHaveAttribute('open', '');
  await expect(first.locator('img[alt="Mermaid diagram"]')).toBeVisible();
  await expect(first.locator('.diagram-source pre')).toBeHidden();
  await first.locator(':scope > summary').click();
  const summary = second.locator(':scope > summary'), paragraph = second.locator(':scope > p');
  await expect(summary).toHaveText('Missing-lock mutation counterexample');
  await expect(paragraph).toBeHidden();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(paragraph).toBeVisible();
  await expect(second.locator('details')).toHaveAttribute('open', '');
  await expect(second.locator('details p')).toBeVisible();
  update(text + '\n\nStreamed update.');
  await expect(page.locator('.message-text')).toContainText('Streamed update.');
  await expect(summary).toBeFocused();
  await expect(paragraph).toBeVisible();
  await expect(first).not.toHaveAttribute('open', '');
  await first.locator(':scope > summary').click();
  await expect(first.locator('img[alt="Mermaid diagram"]')).toBeVisible();
  await expect(page.locator('.message-text')).not.toContainText('</details>');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(first.locator('img')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('markdown-details-phone.png') });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('markdown-details-desktop.png') });
  await testInfo.attach('markdown-disclosures', { body: await page.locator('#transcript').ariaSnapshot(), contentType: 'text/plain' });
});

test('diagram sections expand when Mermaid arrives and preserve deliberate folds', async ({ page }, testInfo) => {
  const prefix = '<details>\n<summary>Charts</summary>\n\n<details>\n<summary>Passing chart</summary>\n\n';
  const suffix = '\n</details>\n</details>\n\n<details>\n<summary>Notes</summary>\n\nNot a diagram.\n</details>';
  const update = await openDiagrams(page, prefix + 'Preparing chart.' + suffix);
  const charts = page.locator('.message-text > .markdown-details').first();
  const chart = charts.locator(':scope > .markdown-details');
  const notes = page.locator('.message-text > .markdown-details').last();
  await expect(charts).not.toHaveAttribute('open', '');
  await expect(chart).not.toHaveAttribute('open', '');
  update(prefix + 'Still preparing chart.' + suffix);
  await expect(charts).toContainText('Still preparing chart.');
  update(prefix + fence(simple) + suffix);
  const image = chart.locator('img[alt="Mermaid diagram"]');
  await expect(image).toBeVisible();
  await expect(charts).toHaveAttribute('open', '');
  await expect(chart).toHaveAttribute('open', '');
  await expect(notes).not.toHaveAttribute('open', '');
  await expect(chart.locator('.diagram-source')).not.toHaveAttribute('open', '');
  await page.screenshot({ path: testInfo.outputPath('diagram-expanded-by-default-phone.png') });
  await chart.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await expect(image).toBeHidden();
  update(prefix + fence(simple) + suffix + '\n\nReply updated.');
  await expect(page.locator('.message-text')).toContainText('Reply updated.');
  await expect(chart).not.toHaveAttribute('open', '');
  await expect(charts).toHaveAttribute('open', '');
  await expect(chart.locator(':scope > summary')).toBeFocused();
  await expect(image).toBeHidden();
  await chart.locator(':scope > summary').click();
  await expect(image).toBeVisible();
});

test('disclosure support leaves arbitrary HTML escaped and code examples literal', async ({ page }) => {
  const external = [];
  page.on('request', request => { if (request.url().startsWith('http') && new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
  const literal = '<details><summary>Literal example</summary></details>\n';
  await openDiagrams(page, '<details>\n<summary>Safe **title** <img src="https://example.com/tracker.png" onerror="window.injected=true"></summary>\n\n'
    + '<script>window.injected=true</script>\n\n[unsafe](javascript:window.injected=true)\n\n</details>\n\n'
    + '<details open onclick="window.injected=true">\n\nUnsafe attributes stay text.\n\n</details>\n\n'
    + '```html\n' + literal + '```\n\n`<summary>Inline example</summary>`\n\n'
    + '    <details>\n    <summary>Indented example</summary>\n    </details>');
  const details = page.locator('.markdown-details');
  await expect(details).toHaveCount(1);
  await expect(details.locator('summary strong')).toHaveText('title');
  await details.locator('summary').click();
  await expect(page.locator('#transcript script, #transcript img, #transcript iframe, #transcript [onclick], #transcript a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('.code-block pre').first()).toHaveText(literal);
  await expect(page.locator('.code-block pre').last()).toHaveText('<details>\n<summary>Indented example</summary>\n</details>');
  await expect(page.locator('.message-text > p > code')).toHaveText('<summary>Inline example</summary>');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(external).toEqual([]);
});
