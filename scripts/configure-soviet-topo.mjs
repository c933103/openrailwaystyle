import {readFile, writeFile} from 'node:fs/promises';
import {publicSovietArchiveRoot} from '../styles/soviet-topo.mjs';

const value = (process.env.SOVIET_TOPO_ARCHIVE_ROOT ?? '').trim();
const root = publicSovietArchiveRoot(value);
if (value && !root) throw new Error('Use an HTTPS archive directory URL without credentials, a query or fragment.');
const path = process.argv[2] ?? 'styles/index.html';
const html = await readFile(path, 'utf8');
const meta = /<meta name="atlas-soviet-archive-root" content="[^"]*">/g;
if ([...html.matchAll(meta)].length !== 1) throw new Error('Expected exactly one Soviet topo archive setting in the page.');
const attribute = root?.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;') ?? '';
await writeFile(path, html.replace(meta, () => `<meta name="atlas-soviet-archive-root" content="${attribute}">`));
