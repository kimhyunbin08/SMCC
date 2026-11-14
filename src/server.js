import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';
import { openTableStore } from './table-store.js';
import { createApi, HttpError } from './api.js';

const assets = new Map([
  ['/', ['../public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['../public/styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['../public/app.js', 'text/javascript; charset=utf-8']],
  ['/privacy', ['../PRIVACY.md', 'text/plain; charset=utf-8']],
  ['/terms', ['../TERMS.md', 'text/plain; charset=utf-8']],
]);

export function createApp(options = {}) {
  const db = options.db || null;
  const registration = options.registration ?? false;
  const secure = options.secure ?? process.env.NODE_ENV === 'production';
  const api = db ? createApi(db, {
    origin: options.origin || process.env.PUBLIC_ORIGIN || 'http://localhost:3000',
    registration, secure,
    clientAddress: options.clientAddress || ((req) => options.trustProxy
      ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').at(-1).trim()
      : req.socket.remoteAddress || ''),
  }) : null;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; img-src 'self'");
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { res.writeHead(400); res.end('Bad request'); return; }
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(value));
    };
    try {
      if (pathname === '/healthz' && ['GET', 'HEAD'].includes(req.method)) {
        json(200, { status: 'ok', service: 'smcc', revision: process.env.APP_REVISION || 'local' });
        return;
      }
      if (pathname === '/api/status' && req.method === 'GET') {
        if (db) await db.check();
        json(200, { mode: db?.kind || 'read-only-preview', storage: Boolean(api),
          registration: Boolean(api && registration), linkedin: false,
          message: api ? `${db.kind === 'azure-table' ? 'Azure 영속 저장소' : '로컬 영속 저장소'}에서 동작하는 개인 프로젝트 MVP입니다.${registration ? '' : ' 운영 정보 확인 전에는 신규 가입이 제한됩니다.'}` : '영속 저장소가 미설정되어 로그인·저장 기능을 제공하지 않는 미리보기입니다.' });
        return;
      }
      if (pathname === '/readyz' && req.method === 'GET') {
        if (db) await db.check();
        json(api ? 200 : 503, { ready: Boolean(api) }); return;
      }
      if (pathname.startsWith('/api/')) {
        if (!api) throw new HttpError(503, '영속 저장소가 미설정입니다. 로컬 Compose에서 시험할 수 있습니다.');
        let body = {};
        if (!['GET', 'HEAD'].includes(req.method)) {
          if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') throw new HttpError(415, 'JSON 요청만 지원합니다.');
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16384) throw new HttpError(413, '입력이 너무 큽니다.');
            chunks.push(chunk);
          }
          try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
          catch { throw new HttpError(400, '요청 형식이 올바르지 않습니다.'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, '요청 객체가 필요합니다.');
        }
        json(200, await api(req, res, pathname, body));
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
      }
      const entry = assets.get(pathname) || (/^\/(?:invite\/[A-Za-z0-9_-]{43}|p\/[a-z0-9_]{3,30})$/.test(pathname) ? assets.get('/') : null);
      if (!entry) { res.writeHead(404); res.end(req.method === 'HEAD' ? undefined : 'Not found'); return; }
      let content = await readFile(new URL(entry[0], import.meta.url));
      if (['/privacy', '/terms'].includes(pathname)) {
        content = content.toString().replaceAll('{{OPERATOR_NAME}}', options.operatorName || '운영 주체 미설정')
          .replaceAll('{{SUPPORT_EMAIL}}', options.supportEmail || '문의 창구 미설정')
          .replaceAll('{{DEPLOYMENT_MODE}}', db?.kind === 'azure-table' ? 'Microsoft Azure Table Storage / 한국 중부' : '로컬 SQLite / 사용자의 Docker 볼륨');
      }
      res.writeHead(200, { 'Content-Type': entry[1] });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error instanceof HttpError) { json(error.status, { error: error.message }); return; }
      console.error('Operational request failure', { type: error.code || error.name });
      json(503, { error: '서비스 처리에 문제가 발생했습니다. 저장 완료로 간주하지 말고 잠시 후 다시 시도하세요.' });
    }
  });
  let cleaning = false;
  server.cleanup = async () => {
    if (!api || cleaning) return;
    cleaning = true;
    try { await api.cleanup(); } finally { cleaning = false; }
  };
  if (api && options.maintenance !== false) {
    const timer = setInterval(() => {
      server.cleanup().catch((error) => console.error('Retention cleanup failed', { type: error.code || error.name }));
    }, 30 * 60_000);
    timer.unref();
    server.on('close', () => clearInterval(timer));
  }
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const local = process.env.APP_MODE === 'local';
  const tableEndpoint = process.env.TABLE_ENDPOINT;
  if (tableEndpoint && !/^https:\/\/[a-z0-9]{3,24}\.table\.core\.windows\.net\/?$/.test(tableEndpoint)) throw new Error('Invalid TABLE_ENDPOINT');
  const db = local && process.env.DB_PATH ? openDatabase(process.env.DB_PATH)
    : tableEndpoint ? openTableStore(tableEndpoint, process.env.TABLE_NAME || 'smccdata', process.env.STORAGE_CLIENT_ID) : null;
  if (db) await db.check();
  const operatorName = process.env.OPERATOR_NAME;
  const supportEmail = process.env.SUPPORT_EMAIL;
  const legal = Boolean(operatorName?.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail || ''));
  const server = createApp({ db, registration: local || (legal && process.env.REGISTRATION_ENABLED === 'true'),
    secure: !local, operatorName, supportEmail, trustProxy: Boolean(tableEndpoint) });
  await server.cleanup();
  server.requestTimeout = 15_000;
  server.listen(port, '0.0.0.0', () => console.log(`SMCC listening on ${port}; mode=${db?.kind || 'read-only-preview'}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(() => { db?.close(); });
    server.closeIdleConnections();
  });
}
