import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const route = '/session-icons-prototype.html';
// Build reference artwork from the production drawing code, not another manually maintained snapshot.
const source = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const botStar ='), end = source.indexOf('const personalityKinds =');
if (start < 0 || end <= start) throw new Error('Production drawing block moved; update the prototype reference.');
const productionSvg = runInNewContext(source.slice(start, end) + '\nbotSvg');
async function expectOriginalArtwork(page) {
  const bots = page.locator('.layout-bot');
  const attributes = await bots.evaluateAll(nodes => nodes.map(node => ({ kind: node.dataset.kind, mood: node.dataset.mood, size: Number(node.dataset.size), unread: node.dataset.unread === 'true' })));
  const references = attributes.map(({ kind, mood, size, unread }) => productionSvg(kind, mood, size, unread));
  const matches = await bots.evaluateAll((nodes, references) => nodes.map((node, index) => {
    const reference = new DOMParser().parseFromString(references[index], 'text/html').querySelector('svg');
    return node.querySelector('svg').innerHTML === reference.innerHTML;
  }), references);
  expect(matches).not.toContain(false);
}

test('mixed character family preserves original artwork, colours and stable assignments', async ({ page }, testInfo) => {
  const errors = [], sockets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  const colours = {
    pip: [[136, 136, 136], [245, 245, 245]],
    sprout: [[0, 155, 87], [0, 200, 117]],
    bun: [[255, 35, 69], [255, 35, 69]],
    mochi: [[201, 116, 0], [255, 159, 0]],
    pebble: [[146, 84, 255], [146, 84, 255]],
    wisp: [[0, 153, 138], [0, 185, 164]],
    idea: [[201, 116, 0], [255, 159, 0]],
    fix: [[255, 35, 69], [255, 35, 69]],
    build: [[0, 155, 87], [0, 200, 117]],
    notes: [[136, 136, 136], [245, 245, 245]],
    ship: [[146, 84, 255], [146, 84, 255]],
    miso: [[201, 116, 0], [255, 159, 0]],
    puff: [[136, 136, 136], [245, 245, 245]],
    moss: [[0, 155, 87], [0, 200, 117]],
    jelly: [[0, 153, 138], [0, 185, 164]],
    nim: [[255, 35, 69], [255, 35, 69]],
    zig: [[146, 84, 255], [146, 84, 255]],
  };
  const expected = { prototype: 'idea', compress: 'build', recovery: 'pebble', 'review-logic': 'sprout', visibility: 'mochi', 'review-post': 'notes', 'fix-model': 'fix', 'fix-sdk': 'ship' };
  const assignments = () => page.locator('#list .session').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.id, node.querySelector('.layout-bot').dataset.kind])));
  const proposals = page.locator('.layout-bot[data-proposed]'), roster = page.locator('#characters .layout-bot');
  for (const [width, theme] of [[320, 'light'], [390, 'dark'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto(`${route}?variant=leading&icons=more`);
    await expect(page.locator('#characters')).toBeVisible();
    await expect(page.locator('#characters figcaption')).toHaveText(['Miso', 'Puff', 'Moss', 'Jelly', 'Nim', 'Zig', 'Pip', 'Sprout', 'Bun', 'Mochi', 'Pebble', 'Wisp', 'Idea', 'Fix', 'Build', 'Notes', 'Ship']);
    await expect(page.locator('#list .session')).toHaveCount(8);
    await expect(proposals).toHaveCount(25);
    await expectOriginalArtwork(page);
    expect(await assignments()).toEqual(expected);
    for (const [kind, palette] of Object.entries(colours)) {
      const bot = roster.and(page.locator(`[data-kind=${kind}]`));
      await expect(bot).toHaveCSS('width', '32px');
      await expect(bot.locator('g.bot-body')).toHaveCSS('fill', `rgb(${palette[theme === 'light' ? 0 : 1].join(', ')})`);
      await expect(bot.locator('.bot-eye')).toHaveCount(2);
      await expect(bot.locator('.bot-frame, .bot-glint')).toHaveCount(0);
      expect(await bot.locator('.bot-eye').evaluateAll((nodes, theme) => nodes.every(node => {
        const style = getComputedStyle(node);
        return style.stroke === 'none' && style.fill === (theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(20, 20, 20)');
      }), theme)).toBe(true);
      expect(await bot.locator('.bot-shine').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).fill === 'rgba(0, 0, 0, 0)'))).toBe(true);
    }
    expect(await roster.and(page.locator('.personality-bot')).evaluateAll(nodes => new Set(nodes.map(node => node.querySelector('g.bot-body').innerHTML)).size)).toBe(12);
    const contrasts = await roster.evaluateAll(nodes => {
      const luminance = colour => {
        const [r, g, b] = colour.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
        return .2126 * r + .7152 * g + .0722 * b;
      };
      const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const background = luminance(getComputedStyle(document.body).backgroundColor);
      return nodes.map(node => {
        const body = luminance(getComputedStyle(node.querySelector('g.bot-body')).fill);
        return { kind: node.dataset.kind, body: ratio(body, background), eyes: ratio(body, luminance(getComputedStyle(node.querySelector('.bot-eye')).fill)) };
      });
    });
    for (const { kind, body, eyes } of contrasts) {
      expect(body, `${theme} ${kind} body/background`).toBeGreaterThanOrEqual(3);
      expect(eyes, `${theme} ${kind} eyes/body`).toBeGreaterThanOrEqual(3);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('#list .layout-bot').evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().width === 32) && new Set(nodes.map(node => node.getBoundingClientRect().x)).size === 1)).toBe(true);
    await expect(page.locator('[data-id=prototype] .bot-badge circle')).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath(`random-icons-${width}-${theme}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: /^Select sample: Fix model selection issue/ }).click();
  await expect(page.locator('[data-id=fix-model]')).toHaveAttribute('aria-current', 'true');
  expect(await assignments()).toEqual(expected);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByText('Preview controls', { exact: true }).click();
  await page.getByRole('button', { name: 'Preview light theme', exact: true }).click();
  expect(await roster.locator('.bot-eye').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).fill === 'rgb(255, 255, 255)'))).toBe(true);
  await page.getByRole('button', { name: 'Preview dark theme', exact: true }).click();
  expect(await roster.locator('.bot-eye').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).fill === 'rgb(20, 20, 20)'))).toBe(true);
  await page.getByRole('button', { name: 'Show active sessions', exact: true }).click();
  await expect(page.locator('#list .session')).toHaveCount(10);
  expect(await assignments()).toMatchObject(expected);
  await expect(page.locator('[data-id=active-fix] .layout-bot')).toHaveAttribute('data-kind', 'pip');
  await expect(page.locator('[data-id=active-fix] .bot-badge circle')).toHaveCount(1);
  await expect(page.locator('[data-id=active-research] .layout-bot')).toHaveAttribute('data-kind', 'wisp');
  await expect(page.locator('[data-id=active-research] .bot-badge path')).toHaveCount(1);
  const figure = page.locator('[data-id=active-fix] .bot-figure');
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveCSS('animation-name', 'character-pip');
  await expect(figure).toHaveCSS('animation-duration', '3s');
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveCSS('animation-play-state', 'running');
  await page.getByRole('button', { name: 'Next layout', exact: true }).click();
  expect(await assignments()).toMatchObject(expected);
  await page.getByRole('button', { name: 'Previous layout', exact: true }).click();
  expect(await assignments()).toMatchObject(expected);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await proposals.locator('*').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true);
  expect(errors).toEqual([]); expect(sockets).toEqual([]);
});

test('personalities have distinct multi-part loops and preserve original motion', async ({ page, browserName }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto(`${route}?variant=leading&icons=more`);
  const lineup = page.locator('#characters'), personalities = lineup.locator('.personality-bot');
  await expect(personalities).toHaveCount(12);
  const parts = { pip: '.character-antenna', sprout: '.character-leaf-left', bun: '.character-ear', mochi: '.bot-look', pebble: '.character-orbit', wisp: '.character-tail', miso: '.character-cat-tail', puff: '.character-cloud-puff', moss: '.character-frog-foot', jelly: '.character-tentacle', nim: '.character-wing', zig: '.character-zig-foot' };
  const partAnimations = { pip: 'character-aerial', sprout: 'character-leaf', bun: 'character-ear', mochi: 'character-look', pebble: 'bot-turn', wisp: 'character-tail', miso: 'character-swish', puff: 'character-billow', moss: 'character-kick', jelly: 'character-tentacle', nim: 'character-wing', zig: 'character-step' };
  for (const [kind, part] of Object.entries(parts)) {
    const bot = lineup.locator(`[data-kind=${kind}]`);
    await expect(bot).toHaveAttribute('data-mood', 'working');
    await expect(bot.locator('.bot-figure')).toHaveCSS('animation-name', `character-${kind}`);
    await expect(bot.locator(part).first()).toHaveCSS('animation-name', partAnimations[kind]);
    await expect(bot.locator(part).first()).toHaveCSS('animation-play-state', 'running');
  }
  for (const [kind, part, animation] of [['idea', '.bot-bulb', 'bot-flicker'], ['fix', '.bot-antenna', 'bot-twitch'], ['build', '.bot-hammer', 'bot-hammer'], ['notes', '.bot-pencil', 'bot-write'], ['ship', '.bot-flame', 'bot-flame']]) {
    await expect(lineup.locator(`[data-kind=${kind}] ${part}`).first()).toHaveCSS('animation-name', animation);
  }
  await expectOriginalArtwork(page);
  const seen = new Map();
  await expect.poll(async () => {
    const poses = await personalities.evaluateAll((nodes, parts) => nodes.flatMap(node => ['.bot-figure', parts[node.dataset.kind]].map((selector, index) => [node.dataset.kind + index, getComputedStyle(node.querySelector(selector)).transform])), parts);
    for (const [key, transform] of poses) {
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key).add(transform);
    }
    return seen.size === 24 && [...seen.values()].every(values => values.size >= 3);
  }, { timeout: 6000, intervals: [50, 100, 150], message: 'Every new body and its follow-through part should actually move' }).toBe(true);
  await testInfo.attach('observed-motion', { body: JSON.stringify({ browserName, poses: Object.fromEntries([...seen].map(([key, values]) => [key, [...values]])) }), contentType: 'application/json' });

  const pip = lineup.locator('[data-kind=pip] .bot-figure');
  const timing = node => ({ progress: node.getAnimations()[0].effect.getComputedTiming().progress, now: performance.now() });
  const before = await pip.evaluate(timing);
  await page.getByRole('button', { name: /^Select sample: Prototype animation icons/ }).click();
  await expect(pip).toHaveCSS('animation-play-state', 'running');
  const after = await pip.evaluate(timing);
  const expectedPhase = (before.progress + (after.now - before.now) / 3000) % 1;
  const distance = Math.abs(after.progress - expectedPhase);
  expect(Math.min(distance, 1 - distance), 'Rebuilding rows should not restart the loop').toBeLessThan(.12);

  // Sample a complete clock cycle for visual review of anticipation and follow-through.
  const start = await page.evaluate(() => performance.now());
  for (let frame = 0; frame < 9; frame++) {
    await page.waitForFunction(target => performance.now() >= target, start + frame * 750);
    await lineup.screenshot({ path: testInfo.outputPath(`motion-${browserName}-${frame}.png`) });
  }
  await page.getByText('Preview controls', { exact: true }).click();
  await expect(pip).toHaveCSS('animation-play-state', 'paused');
  await lineup.scrollIntoViewIfNeeded();
  await expect(pip).toHaveCSS('animation-play-state', 'running');
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await lineup.scrollIntoViewIfNeeded();
  expect(await personalities.locator('*').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationPlayState === 'paused'))).toBe(true);
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await lineup.scrollIntoViewIfNeeded();
  await expect(pip).toHaveCSS('animation-play-state', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await lineup.locator('*').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true);
});

test('three layouts keep the current bots, colours, unread and selection while changing size and position', async ({ page }, testInfo) => {
  const errors = [], sockets = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => sockets.push(socket.url()));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  let palette;
  const density = {};
  for (const [variant, size] of [['inline', 28], ['leading', 32], ['roomy', 40]]) {
    await page.goto(`${route}?variant=${variant}`);
    await expect(page.locator('#page')).toHaveAttribute('data-variant', variant);
    await expect(page.locator('#list .session')).toHaveCount(8);
    await expect(page.locator('.session-pinned')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible();
    await expectOriginalArtwork(page);
    expect(await page.locator('.layout-bot').evaluateAll((nodes, size) => nodes.every(node => node.getBoundingClientRect().width === size), size)).toBe(true);
    const colours = await page.locator('.layout-bot').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.dataset.kind, getComputedStyle(node.querySelector('.bot-body')).fill])));
    expect(Object.keys(colours)).toHaveLength(5);
    if (palette) expect(colours).toEqual(palette); else palette = colours;
    if (variant === 'inline') {
      await expect(page.locator('.session-kind > .layout-bot')).toHaveCount(8);
      await expect(page.locator('[data-id=prototype] .session-icon[data-unread]')).toHaveCount(1);
      expect(await page.locator('.layout-bot').evaluateAll(nodes => nodes.every(node => {
        const icon = node.getBoundingClientRect(), time = node.closest('.session-meta').querySelector('.session-time').getBoundingClientRect();
        return icon.x - time.right >= 0 && icon.x - time.right <= 8;
      }))).toBe(true);
    } else {
      await expect(page.locator('.session-indicators > .layout-bot')).toHaveCount(8);
      await expect(page.locator('[data-id=prototype] .bot-badge circle')).toHaveCount(1);
      expect(await page.locator('.layout-bot').evaluateAll(nodes => {
        const xs = nodes.map(node => node.getBoundingClientRect().x);
        return new Set(xs).size === 1 && nodes.every(node => {
          const icon = node.getBoundingClientRect(), row = node.closest('.session').getBoundingClientRect();
          return Math.abs(icon.y + icon.height / 2 - row.y - row.height / 2) < 1;
        });
      })).toBe(true);
    }
    const titleHeight = (await page.locator('[data-id=prototype] strong').boundingBox()).height;
    if (variant === 'roomy') expect(titleHeight).toBeGreaterThan(30); else expect(titleHeight).toBeLessThan(30);
    density[variant] = await page.locator('#list .session').evaluateAll(nodes => {
      const limit = document.querySelector('.switcher').getBoundingClientRect().top;
      return nodes.filter(node => node.getBoundingClientRect().bottom <= limit).length;
    });
    await page.screenshot({ path: testInfo.outputPath(`${variant}-390-light.png`) });
  }
  expect(density.roomy).toBeLessThan(density.leading);
  await page.getByRole('button', { name: /^Select sample: Fix model selection issue/ }).click();
  await expect(page.locator('[data-id=fix-model]')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('status')).toContainText('Fix model selection issue');
  await page.getByRole('button', { name: 'Next layout' }).click();
  await expect(page.locator('#page')).toHaveAttribute('data-variant', 'inline');
  await expect(page.locator('[data-id=fix-model]')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page).toHaveURL(/variant=roomy$/);
  await page.reload();
  await expect(page.locator('#page')).toHaveAttribute('data-variant', 'roomy');
  expect(errors).toEqual([]); expect(sockets).toEqual([]);
  expect([...new Set(requests)].every(path => [route, '/session-icons-prototype.js', '/session-icons-prototype.css', '/style.css', '/icon.svg'].includes(path))).toBe(true);
});

test('layouts fit phone widths and preserve working, waiting and reduced-motion behaviour', async ({ page }, testInfo) => {
  for (const [width, colorScheme] of [[320, 'light'], [390, 'dark'], [1280, 'dark']]) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    for (const variant of ['inline', 'leading', 'roomy']) {
      await page.goto(`${route}?variant=${variant}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.locator('.session').evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth))).toBe(true);
      await expectOriginalArtwork(page);
      await page.screenshot({ path: testInfo.outputPath(`${variant}-${width}-${colorScheme}.png`) });
      await page.getByText('Preview controls', { exact: true }).click();
      const last = await page.locator('#list .session').last().boundingBox();
      const bar = await page.locator('.switcher').boundingBox();
      expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
    }
  }
  await page.getByRole('button', { name: 'Preview light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Show active sessions', exact: true }).click();
  await expect(page.locator('.session-busy')).toHaveCount(2);
  await expect(page.locator('[data-id=active-fix] .session-state')).toHaveText('Working');
  await expect(page.locator('[data-id=active-research] .session-state')).toHaveText('Needs input');
  const figure = page.locator('[data-id=active-fix] .bot-figure');
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveCSS('animation-name', 'bot-bob');
  await expectOriginalArtwork(page);
  await page.screenshot({ path: testInfo.outputPath('active-and-waiting.png') });
  await page.getByRole('button', { name: 'Pause motion', exact: true }).click();
  await expect(figure).toHaveCSS('animation-play-state', 'paused');
  await page.getByRole('button', { name: 'Resume motion', exact: true }).click();
  await figure.scrollIntoViewIfNeeded();
  await expect(figure).toHaveCSS('animation-play-state', 'running');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Pause motion', exact: true })).toBeDisabled();
  expect(await page.locator('.layout-bot *').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).animationName === 'none'))).toBe(true);
  await page.goto(`${route}?variant=__proto__&scenario=run&step=2`);
  await expect(page).toHaveURL(/variant=leading$/);
});
