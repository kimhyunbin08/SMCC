import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const assets = new Map([
  ['/', ['../public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['../public/styles.css', 'text/css; charset=utf-8']],
]);

export function createApp() {
  return createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }

    let pathname;
    try {
      pathname = new URL(request.url, 'http://localhost').pathname;
    } catch {
      response.writeHead(400);
      response.end('Bad request');
      return;
    }

    const headers = {
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Cache-Control': 'no-cache',
    };

    if (pathname === '/healthz') {
      response.writeHead(200, { ...headers, 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({
        status: 'ok',
        service: 'smcc',
        revision: process.env.APP_REVISION || 'local',
      }));
      return;
    }

    const asset = assets.get(pathname);
    if (!asset) {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Not found');
      return;
    }

    try {
      const content = await readFile(new URL(asset[0], import.meta.url));
      response.writeHead(200, { ...headers, 'Content-Type': asset[1] });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      console.error('Failed to serve asset', { pathname, error });
      response.writeHead(500, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'Internal server error');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const server = createApp();
  server.listen(port, '0.0.0.0', () => console.log(`SMCC listening on port ${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close((error) => {
        if (error) {
          console.error('Failed to close server', error);
          process.exitCode = 1;
        }
      });
      server.closeIdleConnections();
    });
  }
}
