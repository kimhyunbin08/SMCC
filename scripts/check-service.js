import { fileURLToPath } from 'node:url';

export async function checkService(origin, fetcher = fetch) {
  const url = new URL(origin);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS service origin (HTTP is allowed only for local checks).');
  }
  const checks = [
    ['/healthz', (body) => body?.status === 'ok' && body.service === 'smcc' && typeof body.revision === 'string' && body.revision.length > 0],
    ['/readyz', (body) => body?.ready === true],
    ['/api/status', (body) => body?.storage === true && ['azure-table', 'sqlite'].includes(body.mode) && typeof body.registration === 'boolean'],
  ];
  for (const [path, validate] of checks) {
    let response, body;
    try {
      response = await fetcher(new URL(path, url), { signal: AbortSignal.timeout(60000), redirect: 'error' });
      if (!response.ok) throw new Error('HTTP failure');
      body = await response.json();
    } catch {
      throw new Error(`Service check failed: ${path} (network, timeout, HTTP or JSON error).`);
    }
    if (!validate(body)) throw new Error(`Service check failed: ${path} (unexpected service state).`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await checkService(process.env.TEST_BASE_URL || 'https://smcc-web.wonderfulcliff-f9ca16c6.koreacentral.azurecontainerapps.io');
    console.log('SMCC health, storage readiness and service checks passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
