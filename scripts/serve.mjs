import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('dist');
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
};
try {
  await stat(resolve(root, 'index.html'));
} catch {
  console.error('Build the app first: npm run build');
  process.exit(1);
}
createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': types[extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
      'Content-Length': body.byteLength,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`TraceLab is ready at http://localhost:${port}`));
