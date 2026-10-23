#!/usr/bin/env node
// Builds a static blog post from docs/blog/<name>.md and its <name>/ asset folder.
// Usage: node scripts/build-blog-post.mjs docs/blog/building-pi-remote.md <out-dir> <https-base-url>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import markdownIt from 'markdown-it';

const [source, out, baseArg] = process.argv.slice(2);
if (!source || !out || !/^https:\/\//.test(baseArg || '')) {
  console.error('Usage: build-blog-post.mjs <post.md> <out-dir> <https-base-url>');
  process.exit(1);
}
const base = baseArg.replace(/\/$/, '');
const assets = join(dirname(source), basename(source, '.md'));
const escape = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

let text = readFileSync(source, 'utf8');
const title = text.match(/^# (.+)$/m)?.[1];
const description = text.match(/<!-- description: (.+?) -->/)?.[1];
const hero = text.match(/!\[([^\]]+)\]\([^)]*\/hero\.jpg\)/)?.[1];
if (!title || !description || !hero) throw new Error('Post needs a # title, a description comment and a hero.jpg image');
text = text.replace(/^# .+\n/m, '').replaceAll(`${basename(assets)}/`, '');

const md = markdownIt({ html: true });
const body = md.render(text).replace(/<img src="(hero|reference-vs-ours)\.jpg"/g, '<img class="wide" src="$1.jpg"');
const images = [...new Set([...body.matchAll(/<img[^>]+src="([^"/]+)"/g)].map((m) => m[1]))];

mkdirSync(out, { recursive: true });
for (const file of [...images, 'style.css']) copyFileSync(join(assets, file), join(out, file));

// The version query gives X a new cache key whenever the hero changes.
const image = `${base}/hero.jpg?v=${Date.now().toString(36)}`;
const [t, d, a] = [title, description, hero].map(escape);
writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title><meta name="description" content="${d}">
<link rel="canonical" href="${base}/"><link rel="stylesheet" href="style.css">
<meta property="og:type" content="article"><meta property="og:url" content="${base}/">
<meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta property="og:image" content="${image}"><meta property="og:image:width" content="2400"><meta property="og:image:height" content="1260">
<meta property="og:image:alt" content="${a}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}"><meta name="twitter:image" content="${image}"><meta name="twitter:image:alt" content="${a}">
</head><body><main><h1>${t}</h1><div class="meta">BySepStudio</div>
${body}</main></body></html>
`);
console.log([...images, 'style.css', 'index.html'].join('\n'));
