import http from 'node:http';
import {open, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';

const TYPES = {'.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.pmtiles': 'application/octet-stream'};

export function createPreviewServer({root = resolve('styles'), statFile = stat, openFile = open} = {}) {
  root = resolve(root);
  return http.createServer(async (req, res) => {
    let file;
    try {
      const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\/$/, '/index.html'));
      if (!path.startsWith(root + sep)) {res.writeHead(403).end(); return;}
      // Reject directories and other non-files before opening; check again on
      // the opened descriptor so metadata and streamed bytes refer to one file.
      if (!(await statFile(path)).isFile()) {res.writeHead(404).end(); return;}
      file = await openFile(path, 'r');
      const info = await file.stat();
      if (res.destroyed) return;
      if (!info.isFile()) {res.writeHead(404).end(); return;}
      const mime = TYPES[extname(path)] || 'application/octet-stream';
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range ? Math.min(range[2] ? Number(range[2]) : info.size - 1, info.size - 1) : info.size - 1;
      if (range && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end)) {
        res.writeHead(416, {'Content-Range': `bytes */${info.size}`}).end(); return;
      }
      const length = Math.max(0, end - start + 1);
      res.writeHead(range ? 206 : 200, {'Content-Type': mime, 'Accept-Ranges': 'bytes',
        'Content-Length': length, ...(range && {'Content-Range': `bytes ${start}-${end}/${info.size}`})});
      if (req.method === 'HEAD' || length === 0) {res.end(); return;}
      const stream = file.createReadStream({start, end});
      // The pipeline owns asynchronous read/response errors and closes the
      // reader when a client disconnects. End only after checking for a short
      // read: a file truncated during transfer must not leave a hanging reply.
      await pipeline(stream, res, {end: false});
      if (stream.bytesRead !== length) res.destroy();
      else res.end();
    } catch {
      // Open/stat failures can still produce a normal response. Once headers
      // or body bytes have gone out, terminate this response rather than send
      // a second set of headers or let an asynchronous error kill the server.
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) res.writeHead(404).end();
    } finally {
      await file?.close().catch(() => {});
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createPreviewServer().listen(4173, '127.0.0.1', () => console.log('Preview http://127.0.0.1:4173'));
}
