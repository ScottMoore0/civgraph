#!/usr/bin/env node

import { readText, exists, printSection } from './_shared.mjs';

const indexPath = 'index.html';
if (!exists(indexPath)) {
    console.error(`Missing ${indexPath}`);
    process.exit(1);
}

const html = readText(indexPath);
const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
const head = headMatch ? headMatch[1] : '';

const linkMatches = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
const scriptMatches = [...head.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);

function attr(tag, name) {
    const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
    return match ? match[1] : '';
}

const links = linkMatches.map((tag) => ({
    tag,
    rel: attr(tag, 'rel'),
    href: attr(tag, 'href'),
    as: attr(tag, 'as'),
    crossorigin: attr(tag, 'crossorigin')
}));

const scripts = scriptMatches.map((tag) => ({
    tag,
    src: attr(tag, 'src'),
    type: attr(tag, 'type'),
    defer: /\bdefer\b/i.test(tag),
    async: /\basync\b/i.test(tag)
}));

const likelyBlocking = links.filter((link) => /stylesheet/i.test(link.rel));

console.log('# First Load Asset Report');
console.log(`Head link tags: ${links.length}`);
console.log(`Head script tags: ${scripts.length}`);
console.log(`Likely render-blocking stylesheets: ${likelyBlocking.length}`);

printSection('Head Links');
for (const link of links) {
    console.log(`${link.rel || '(no rel)'}  ${link.href || '(no href)'}`);
}

printSection('Head Scripts');
if (scripts.length === 0) {
    console.log('(none found)');
} else {
    for (const script of scripts) {
        const flags = [
            script.type ? `type=${script.type}` : null,
            script.defer ? 'defer' : null,
            script.async ? 'async' : null
        ].filter(Boolean).join(', ');
        console.log(`${script.src || '(inline)'}${flags ? `  [${flags}]` : ''}`);
    }
}

printSection('Likely Render-Blocking Stylesheets');
for (const link of likelyBlocking) {
    console.log(link.href || '(no href)');
}

