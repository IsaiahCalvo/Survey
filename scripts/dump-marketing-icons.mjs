// Renders the app's own tool icons (src/Icons.jsx) to static markup for the
// marketing pages, so the site shows the exact glyphs the toolbar draws.
// Run `node scripts/dump-marketing-icons.mjs` after an icon changes, then
// `node scripts/build-marketing.mjs`. Writes scripts/marketing-icons.json.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MARKETING_ICON_NAMES = ['pen', 'highlighter', 'eraser', 'shapes', 'shapeCloud', 'counter', 'measureScale', 'callout', 'library', 'formatHighlight', 'scanText', 'pages'];

const vite = await createServer({ root: repo, configFile: false, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { default: Icon } = await vite.ssrLoadModule('/src/Icons.jsx');
  const out = {};
  for (const name of MARKETING_ICON_NAMES) {
    out[name] = renderToStaticMarkup(React.createElement(Icon, { name, size: 24, color: 'currentColor' }))
      // Mask icons carry their asset as a data: URI; its prose comments are dead weight on the page.
      .replace(/%3c!--[^]*?--%3e/gi, '')
      .replace(/%3c\?xml[^]*?\?%3e/gi, '');
  }
  writeFileSync(join(repo, 'scripts', 'marketing-icons.json'), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote', Object.keys(out).length, 'icons');
} finally {
  await vite.close();
}
