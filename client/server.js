import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const clientRoot = resolve('client');
const sharedRoot = resolve('shared');
const contentTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const base = pathname.startsWith('/shared/') ? sharedRoot : clientRoot;
    const relative = pathname.startsWith('/shared/') ? pathname.slice('/shared/'.length) : pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = resolve(base, relative);
    if (!file.startsWith(base + sep) && file !== base) throw new Error('Invalid path');
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(Number(process.env.CLIENT_PORT || 4173), '0.0.0.0', () => {
  console.log(`Hippo Raft client running at http://localhost:${process.env.CLIENT_PORT || 4173}`);
});
