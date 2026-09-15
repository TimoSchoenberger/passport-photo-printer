import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));

assert.equal(manifest.name, 'Passport Photo Printer');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.theme_color, '#101114');
assert.ok(manifest.icons.some(({ sizes, purpose }) => sizes === '512x512' && purpose === 'maskable'));

for (const file of ['index.html', 'sw.js', 'registerSW.js', 'pwa-192x192.png', 'pwa-512x512.png', 'apple-touch-icon.png', 'third-party-licenses.txt']) {
  await access(new URL(file, root));
}

const html = await readFile(new URL('index.html', root), 'utf8');
assert.match(html, /rel="manifest"/);
assert.match(html, /rel="apple-touch-icon"/);
console.log('PWA manifest, worker, and icons verified.');
