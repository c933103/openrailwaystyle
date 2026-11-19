import {readFile, writeFile} from 'node:fs/promises';
import {restrictedTileOrigin} from '../styles/restricted-tiles.mjs';

const input = (process.env.AUTH_BACKEND_ORIGIN ?? '').trim();
const origin = restrictedTileOrigin(input);
if (input && !origin) throw new Error('AUTH_BACKEND_ORIGIN must be an HTTPS origin.');
const path = process.argv[2] ?? 'styles/index.html';
const html = await readFile(path, 'utf8');
const tag = /<meta name="atlas-restricted-tile-origin" content="[^"]*">/g;
if ([...html.matchAll(tag)].length !== 1) throw new Error('Expected exactly one restricted tile service setting.');
await writeFile(path, html.replace(tag, () => `<meta name="atlas-restricted-tile-origin" content="${origin ?? ''}">`));
