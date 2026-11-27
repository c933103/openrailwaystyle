// Optional server is isolated from the reference-data generator's npm lock.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startServer} from './admin-backend/server.ts';
export * from './admin-backend/server.ts';
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void startServer();
