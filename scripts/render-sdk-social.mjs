import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { chromium } from '@playwright/test';

const source = readFileSync(new URL('./sdk-guide-social.html', import.meta.url), 'utf8');
const font = readFileSync(new URL('../web/sdk-guide-font.woff2', import.meta.url)).toString('base64');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(source.replace('__GUIDE_FONT__', font));
  await page.waitForFunction(() => window.__sdkSocialReady || window.__sdkSocialError, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__sdkSocialError), undefined);
  assert.deepEqual(errors, []);
  assert(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Bricolage' && font.status === 'loaded')), 'Render the article font, not a fallback.');
  const bounds = await page.locator('h1 span, p').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect(); return { text: element.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  }));
  for (const box of bounds) assert(box.left >= 32 && box.right <= 1168 && box.top >= 24 && box.bottom <= 584, `Clipped preview text: ${box.text}`);
  const png = await page.locator('.cover').screenshot({ type: 'png' });
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 600);
  const origin = Buffer.from('impeccable:prompt\0Rendered from scripts/sdk-guide-social.html and self-hosted web/sdk-guide-font.woff2. Assembly artwork, selected from prototype/sdk-cover-options at c2f0a4f628cc33bf23d850424572fc24fc69b345. An orange asterisk floats above a green Pi sculpture. Rebuild with node scripts/render-sdk-social.mjs.');
  const chunk = Buffer.alloc(origin.length + 12);
  chunk.writeUInt32BE(origin.length, 0); chunk.write('tEXt', 4); origin.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + origin.length)), 8 + origin.length);
  const output = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  assert(output.length < 5_000_000, 'X image cards require a small public image.');
  writeFileSync(new URL('../web/sdk-guide-social.png', import.meta.url), output);
  console.log(`Rendered web/sdk-guide-social.png: 1200 x 600, ${output.length} bytes.`);
} finally { await browser.close(); }
