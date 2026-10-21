import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { chromium } from '@playwright/test';

const root = new URL('../web/sdk-cover-prototypes/', import.meta.url);
const font = readFileSync(new URL('../web/sdk-guide-font.woff2', import.meta.url)).toString('base64');
const css = readFileSync(new URL('author.css', root), 'utf8').replace("'../sdk-guide-font.woff2'", `data:font/woff2;base64,${font}`);
const html = readFileSync(new URL('author.html', root), 'utf8').replace('<link rel="stylesheet" href="author.css">', `<style>${css}</style>`).replace('<script src="author.js"></script>', '');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html);
  await page.addScriptTag({ content: readFileSync(new URL('author.js', root), 'utf8') });
  await page.waitForFunction(() => window.__coversReady || window.__coversError, null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__coversError), undefined);
  assert.deepEqual(errors, []);
  assert(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Bricolage' && font.status === 'loaded')));
  for (const [key, description] of [
    ['A', 'Assembly. A raymarched orange asterisk floats above a green Pi sculpture, with the headline on a dark green field. Authored with WebGL in author.js and the article Bricolage font.'],
    ['B', 'Overprint. Oversized lime Pi lettering and an asymmetric white headline on a saturated cobalt field. Authored typography in author.html and author.css using the article Bricolage font.'],
    ['C', 'Signal print. A seeded mathematical ink field cut into Pi letterforms, with an orange and ivory headline. Authored with Canvas in author.js using the article Bricolage font.'],
  ]) {
    const cover = page.locator(`#${key}`);
    const clipped = await cover.locator('h1 span,p').evaluateAll(elements => elements.map(element => {
      const cover = element.closest('.cover').getBoundingClientRect(), box = element.getBoundingClientRect();
      return { text: element.textContent, left: box.left - cover.left, top: box.top - cover.top, right: box.right - cover.left, bottom: box.bottom - cover.top };
    }).filter(box => box.left < 0 || box.top < 0 || box.right > 1200 || box.bottom > 600));
    assert.deepEqual(clipped, [], `Text outside ${key}: ${JSON.stringify(clipped)}`);
    const png = await cover.screenshot({ animations: 'disabled', type: 'png' });
    assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 600);
    const origin = Buffer.from(`impeccable:prompt\0Prototype only. ${description} Rebuild with node scripts/render-sdk-cover-prototypes.mjs.`);
    const chunk = Buffer.alloc(origin.length + 12); chunk.writeUInt32BE(origin.length, 0); chunk.write('tEXt', 4); origin.copy(chunk, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + origin.length)), 8 + origin.length);
    const result = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
    writeFileSync(new URL(`${key}.png`, root), result);
    console.log(`${key}.png: 1200 x 600, ${result.length} bytes`);
  }
} finally { await browser.close(); }
