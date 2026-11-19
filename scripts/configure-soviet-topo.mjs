import {readFile, writeFile} from 'node:fs/promises';

const provider = (process.env.SOVIET_TOPO_TILE_SERVICE ?? '').trim();
if (provider && provider !== 'indian-open-maps') throw new Error('Unknown Soviet topo tile service.');
const path = process.argv[2] ?? 'styles/index.html';
const html = await readFile(path, 'utf8');
const tag = /<meta name="atlas-soviet-tile-service" content="[^"]*">/g;
if ([...html.matchAll(tag)].length !== 1) throw new Error('Expected exactly one Soviet topo service setting.');
await writeFile(path, html.replace(tag, () => `<meta name="atlas-soviet-tile-service" content="${provider}">`));
