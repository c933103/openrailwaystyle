import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {ICON_FILES, iconUrl, syncBranding} from '../scripts/sync-branding.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const bytes = file => readFileSync(new URL(`../styles/${file}`, import.meta.url));
const html = read('styles/index.html');
const manifest = JSON.parse(read('styles/manifest.webmanifest'));
const tags = (source, name) => [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(([tag]) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
const meta = (source, name) => tags(source, 'meta').find(tag => tag.name === name || tag.property === name)?.content;
const links = source => tags(source, 'link');

test('Railway Atlas has one displayed name, without changing installed-app identity', () => {
  assert.equal(manifest.name, 'Railway Atlas');
  assert.equal(manifest.short_name, manifest.name);
  assert.deepEqual([manifest.id, manifest.start_url, manifest.scope], ['./', './', './']);
  assert.equal(manifest.display, 'standalone');
  assert.equal(meta(html, 'application-name'), manifest.name);
  assert.equal(meta(html, 'apple-mobile-web-app-title'), manifest.name);
  assert.equal(links(html).find(tag => tag.rel === 'manifest')?.href, 'manifest.webmanifest');
  assert.match(html, /<title>Railway Atlas · Worldwide rail map<\/title>/);
  assert.match(html, /<h1>Railway Atlas<\/h1>/);
});

test('sharing metadata uses the current name and versioned PNG artwork', () => {
  assert.equal(meta(html, 'og:site_name'), manifest.name);
  assert.equal(meta(html, 'og:title'), 'Railway Atlas · Worldwide rail map');
  assert.equal(meta(html, 'twitter:title'), meta(html, 'og:title'));
  assert.equal(meta(html, 'twitter:card'), 'summary');
  const image = new URL(meta(html, 'og:image'));
  assert.equal(image.protocol, 'https:');
  assert.equal(image.pathname.split('/').at(-1) + image.search, iconUrl('atlas-icon-512.png'));
  assert.equal(meta(html, 'twitter:image'), image.href);
  assert.equal(meta(html, 'og:image:width'), '512');
  assert.equal(meta(html, 'og:image:height'), '512');
  assert.match(meta(html, 'og:image:alt'), /Railway Atlas/);
  assert.equal(meta(html, 'twitter:image:alt'), meta(html, 'og:image:alt'));
});

test('main and auxiliary pages have matching favicon and Apple touch icon links', () => {
  for (const file of ['index.html', 'data-check.html', 'terrain-credits.html']) {
    const page = read(`styles/${file}`), all = links(page);
    assert.equal(meta(page, 'application-name'), manifest.name, file);
    assert.ok(all.some(tag => tag.rel === 'icon' && tag.type === 'image/svg+xml' && tag.sizes === 'any' && tag.href === iconUrl('atlas-icon.svg')), file);
    assert.ok(all.some(tag => tag.rel === 'icon' && tag.type === 'image/png' && tag.sizes === '192x192' && tag.href === iconUrl('atlas-icon-192.png')), file);
    assert.ok(all.some(tag => tag.rel === 'apple-touch-icon' && tag.sizes === '180x180' && tag.href === iconUrl('atlas-icon-touch-180.png')), file);
  }
});

test('manifest icon revisions match their bytes and dimensions, including maskable artwork', () => {
  const expected = new Map([
    ['atlas-icon-192.png', ['192x192', 'any']],
    ['atlas-icon-512.png', ['512x512', 'any']],
    ['atlas-icon-maskable-512.png', ['512x512', 'maskable']],
    ['atlas-icon.svg', ['any', 'any']]
  ]);
  assert.equal(manifest.icons.length, expected.size);
  for (const [file, [size, purpose]] of expected) {
    const icon = manifest.icons.find(icon => icon.src === iconUrl(file));
    assert.ok(icon, file);
    assert.equal(icon.sizes, size, file);
    assert.equal(icon.purpose ?? 'any', purpose, file);
    assert.equal(icon.type, file.endsWith('.svg') ? 'image/svg+xml' : 'image/png', file);
  }
  for (const [file, width] of [['atlas-icon-192.png', 192], ['atlas-icon-512.png', 512], ['atlas-icon-maskable-512.png', 512], ['atlas-icon-touch-180.png', 180]]) {
    const png = bytes(file);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file);
    assert.equal(png.subarray(12, 16).toString(), 'IHDR', file);
    assert.equal(png.readUInt32BE(16), width, file);
    assert.equal(png.readUInt32BE(20), width, file);
  }
  assert.deepEqual(syncBranding({check: true}), [], 'Run node scripts/sync-branding.mjs after replacing icons');
});

test('documentation and the inline controls icon reuse the approved SVG', () => {
  for (const [file, icon] of [['README.md', 'styles/atlas-icon.svg'], ['docs/README.md', '../styles/atlas-icon.svg']]) {
    const doc = read(file);
    assert.match(doc, /# Railway Atlas/);
    assert.ok(doc.includes(`src="${icon}"`), file);
  }
  const artwork = read('styles/atlas-icon.svg').trim().replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>$/, '');
  assert.ok(html.includes(artwork), 'The inline menu icon must match the canonical SVG artwork');
  assert.match(read('README.md'), /Open Railway Styles/);
  assert.match(html, /https:\/\/github.com\/OpenRail-Playground\/openrailwaystyle/);
});

test('versioned branding icons still resolve offline from the precached plain aliases', async () => {
  const scope = 'https://example.test/openrailwaystyle/';
  const saved = new Map(ICON_FILES.map(file => [new URL(file, scope).href, new Response(bytes(file))]));
  const listeners = new Map();
  vm.runInNewContext(read('styles/sw.js'), {
    URL, Response, Request,
    location: {origin: new URL(scope).origin},
    self: {registration: {scope}, addEventListener: (name, fn) => listeners.set(name, fn)},
    caches: {open: async () => ({match: async key => saved.get(typeof key === 'string' ? key : key.url)?.clone()})},
    fetch: async () => { throw new TypeError('offline'); }
  });
  for (const file of ICON_FILES) {
    let response;
    listeners.get('fetch')({request: new Request(new URL(iconUrl(file), scope)), respondWith: value => { response = value; }});
    assert.ok(response, `${file} must be handled by the worker`);
    assert.deepEqual(Buffer.from(await (await response).arrayBuffer()), bytes(file), file);
  }
});
