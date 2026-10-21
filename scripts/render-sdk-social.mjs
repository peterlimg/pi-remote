import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { chromium } from '@playwright/test';

const source = readFileSync(new URL('./sdk-guide-social.html', import.meta.url), 'utf8');
const font = readFileSync(new URL('../web/sdk-guide-font.woff2', import.meta.url)).toString('base64');
function savePng(file, png, width, height) {
  assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
  const origin = Buffer.from('impeccable:prompt\0Rendered from scripts/sdk-guide-social.html and self-hosted web/sdk-guide-font.woff2. Signal print, selected as C from prototype/sdk-cover-options at c2f0a4f628cc33bf23d850424572fc24fc69b345. A seeded stippled ink field reveals Pi lettering. Rebuild both article and social artwork with node scripts/render-sdk-social.mjs.');
  const chunk = Buffer.alloc(origin.length + 12);
  chunk.writeUInt32BE(origin.length, 0); chunk.write('tEXt', 4); origin.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + origin.length)), 8 + origin.length);
  const output = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  assert(output.length < 5_000_000, 'Keep the static artwork small enough for sharing.');
  writeFileSync(new URL('../web/' + file, import.meta.url), output);
  console.log(`Rendered ${file}: ${width} x ${height}, ${output.length} bytes.`);
}
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
  savePng('sdk-guide-social.png', await page.locator('.cover').screenshot({ type: 'png' }), 1200, 600);
  const print = await page.evaluate(() => {
    const crop = document.createElement('canvas'); crop.width = 558; crop.height = 500;
    crop.getContext('2d').drawImage(document.querySelector('canvas'), 612, 32, 558, 500, 0, 0, 558, 500);
    return crop.toDataURL('image/png');
  });
  savePng('sdk-guide-print.png', Buffer.from(print.split(',')[1], 'base64'), 558, 500);
} finally { await browser.close(); }
