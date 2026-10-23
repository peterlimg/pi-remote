#!/usr/bin/env node
// Builds a static blog post from docs/blog/<name>.md and its <name>/ asset folder.
// Usage: node scripts/build-blog-post.mjs docs/blog/building-pi-remote.md <out-dir> <https-base-url>
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const date = text.match(/<!-- date: (\d{4}-\d{2}-\d{2}) -->/)?.[1];
if (!title || !description || !date) throw new Error('Post needs a # title and description and date comments');
const minutes = Math.max(1, Math.round(text.split(/\s+/).length / 230));
const shown = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
text = text.replace(/^# .+\n/m, '').replaceAll(`${basename(assets)}/`, '');

const md = markdownIt({ html: true });
const body = md.render(text)
  .replace(/<img src="(reference-vs-ours)\.jpg"/g, '<img class="wide" src="$1.jpg"')
  .replace(/<p>(-BySepStudio)<\/p>/, '<p class="sign">$1</p>');
const images = [...new Set([...body.matchAll(/<img[^>]+src="([^"/]+)"/g)].map((m) => m[1]))];

mkdirSync(out, { recursive: true });
for (const file of [...images, 'style.css']) copyFileSync(join(assets, file), join(out, file));
cpSync(join(assets, 'fonts'), join(out, 'fonts'), { recursive: true });

const [t, d] = [title, description].map(escape);
writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${t}</title><meta name="description" content="${d}">
<link rel="canonical" href="${base}/"><link rel="stylesheet" href="style.css">
<meta property="og:type" content="article"><meta property="og:url" content="${base}/"><meta property="article:published_time" content="${date}">
<link rel="preload" href="fonts/BodoniModa.ttf" as="font" type="font/ttf" crossorigin>
<meta property="og:title" content="${t}"><meta property="og:description" content="${d}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
</head><body><div class="page">
<header class="bar"><a class="mark" href="./">BySepStudio</a><span class="tag">Build notes <i>on</i> Pi Remote</span></header>
<main><h1>${t}</h1>
<div class="meta"><span>BySepStudio</span><time datetime="${date}">${shown}</time><span>${minutes} min read</span></div>
<article>${body}</article></main>
<footer><span>Also by BySepStudio: <a href="https://claude-sdk-in-pi.vercel.app">Claude SDK in Pi</a></span><span>Set in <a href="fonts/BodoniModa-OFL.txt">Bodoni Moda</a>, <a href="fonts/Geist-OFL.txt">Geist</a> &amp; <a href="fonts/GeistMono-OFL.txt">Geist Mono</a></span></footer>
</div></body></html>
`);
console.log([...images, 'style.css', 'fonts/', 'index.html'].join('\n'));
