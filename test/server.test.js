import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { createApp } from '../src/server.js';
import { openDatabase, StoreConflict } from '../src/database.js';
import { tableStore } from '../src/table-store.js';
import { username, password, text } from '../src/api.js';

test('unit: username/password/Unicode boundaries reject malformed input', () => {
  assert.equal(username('test_user'), 'test_user');
  for (const input of ['A_USER', '../foo', 'ab', null, {}]) assert.throws(() => username(input), { status: 400 });
  assert.equal(password('long-password-123'), 'long-password-123');
  for (const input of ['', 'x'.repeat(129), null]) assert.throws(() => password(input), { status: 400 });
  assert.equal(text(' 😀😀 ', 2, 2, '호칭'), '😀😀');
  assert.throws(() => text('😀😀😀', 1, 2, '호칭'), { status: 400 });
});

test('unit/integration: both storage adapters prevent duplicate creation and lost updates', async () => {
  const records = new Map();
  const client = {
    async getEntity(ns, id) {
      const entry = records.get(`${ns}/${id}`);
      if (!entry) throw { statusCode: 404 };
      return { ...entry };
    },
    async createEntity(entry) {
      const key = `${entry.partitionKey}/${entry.rowKey}`;
      if (records.has(key)) throw { statusCode: 409 };
      records.set(key, { ...entry, etag: '1' });
    },
    async updateEntity(entry, mode, options) {
      assert.equal(mode, 'Replace');
      const key = `${entry.partitionKey}/${entry.rowKey}`, old = records.get(key);
      if (old.etag !== options.etag) throw { statusCode: 412 };
      records.set(key, { ...entry, etag: String(Number(old.etag) + 1) });
    },
    async deleteEntity(ns, id) { records.delete(`${ns}/${id}`); },
    async *listEntities() { for (const entry of records.values()) yield entry; },
  };
  for (const store of [openDatabase(':memory:'), tableStore(client)]) {
    await store.create('teams', 'team', { id: 'team', count: 0 });
    await assert.rejects(store.create('teams', 'team', {}), StoreConflict);
    await Promise.all([1, 2, 3].map(() => store.mutate('teams', 'team', (row) => ({ ...row, count: row.count + 1 }))));
    assert.equal((await store.get('teams', 'team')).count, 3);
    store.close();
  }
});

test('integration: SQLite survives close and reopen on actual disk', async (t) => {
  const path = `${process.cwd()}/.test-${randomUUID()}.sqlite`;
  t.after(async () => { for (const suffix of ['', '-wal', '-shm']) await unlink(path + suffix).catch((error) => { if (error.code !== 'ENOENT') throw error; }); });
  let store = openDatabase(path);
  await store.create('users', 'fixture', { id: 'fixture', name: '가상 참가자' });
  store.close();
  store = openDatabase(path);
  assert.equal((await store.get('users', 'fixture')).name, '가상 참가자');
  store.close();
});

async function app(t, storage = false) {
  const db = storage ? openDatabase(':memory:') : null;
  const server = createApp({ db, origin: 'https://test.smcc', registration: storage, secure: false,
    operatorName: '시험 운영자', supportEmail: 'test@example.invalid', maintenance: false });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }); db?.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  function actor() {
    return {
      cookie: '', csrf: '',
      async call(path, method = 'GET', body, expected = 200, headers = {}) {
        const response = await fetch(base + path, { method, headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(method !== 'GET' ? { Origin: 'https://test.smcc', 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}), ...headers,
        }, body: body === undefined ? undefined : JSON.stringify(body) });
        const result = await response.json();
        assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
        if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
        if (result.csrf) this.csrf = result.csrf;
        return result;
      },
    };
  }
  return { base, actor, db, server };
}

test('integration: allowlist, health, policies and no-store failures are truthful', async (t) => {
  const { base, actor } = await app(t);
  const page = await fetch(base);
  assert.equal(page.status, 200); assert.match(await page.text(), /서울모닝커피클럽/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const path of ['/src/api.js', '/.env', '/PRD.md', '/package-lock.json', '/missing', '/%2e%2e/ideation.md']) assert.equal((await fetch(base + path)).status, 404);
  for (const path of ['/styles.css', '/app.js', '/privacy', '/terms']) assert.equal((await fetch(base + path)).status, 200);
  assert.match(await (await fetch(base + '/privacy')).text(), /시험 운영자/);
  assert.deepEqual(await actor().call('/healthz'), { status: 'ok', service: 'smcc', revision: process.env.APP_REVISION || 'local' });
  assert.equal((await actor().call('/readyz', 'GET', undefined, 503)).ready, false);
  assert.equal((await actor().call('/api/status')).storage, false);
  await actor().call('/api/register', 'POST', {}, 503);
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
});

test('HTTP E2E: auth → profiles → invite/capacity/isolation → inbox/read → credentials/deletion', async (t) => {
  const { actor, db, server } = await app(t, true);
  const host = actor(), a = actor(), b = actor(), otherHost = actor(), anonymous = actor();
  const pass = 'only-synthetic-test-123';
  const register = (who, login, role = 'member') => who.call('/api/register', 'POST', { username: login, password: pass, name: login, role, privacy: true, terms: true, age: true });
  await register(host, 'host_test', 'host');
  const registeredA = await register(a, 'member_test');
  await register(b, 'second_test');
  await register(otherHost, 'other_host', 'host');
  await anonymous.call('/api/teams', 'GET', undefined, 401);
  await host.call('/api/profile', 'PUT', { name: '호스트', bio: '소개', links: [{ label: 'SNS', url: 'javascript:alert(1)' }], public: false }, 400);
  await host.call('/api/profile', 'PUT', { name: '호스트', bio: '소개', links: [], public: true }, 403, { Origin: 'https://evil.invalid' });
  await host.call('/api/profile', 'PUT', { name: '호스트', bio: '소개', links: [], public: true }, 403, { 'X-CSRF-Token': 'wrong' });
  await host.call('/api/profile', 'PUT', { name: '호스트', bio: '<script>plain text</script>', links: [{ label: 'SNS', url: 'https://example.com/' }], public: true });
  assert.equal((await anonymous.call('/api/profiles/host_test')).profile.links.length, 1);
  await anonymous.call('/api/profiles/member_test', 'GET', undefined, 404);
  const dates = { startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() };
  await a.call('/api/teams', 'POST', { ...dates, title: 'x', place: 'x', capacity: 2 }, 403);
  const created = await host.call('/api/teams', 'POST', { ...dates, title: 'Test team', place: 'PRIVATE LOCATION', capacity: 2, share: true });
  const { team, invite } = created;
  const preview = await anonymous.call(`/api/invites/${invite}`);
  assert.equal(JSON.stringify(preview).includes('PRIVATE LOCATION'), false);
  await otherHost.call(`/api/teams/${team.id}/rotate`, 'POST', {}, 403);
  const join = (who) => who.call('/api/join', 'POST', { invite, disclosure: true, share: false }, 200);
  const attempts = await Promise.allSettled([join(a), join(b)]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  const winner = attempts[0].status === 'fulfilled' ? a : b, loser = winner === a ? b : a;
  await loser.call(`/api/teams/${team.id}`, 'GET', undefined, 403);
  assert.equal((await winner.call(`/api/teams/${team.id}`)).members.length, 2);
  assert.equal((await host.call(`/api/teams/${team.id}`)).members.length, 1);
  await join(winner);
  const rotated = await host.call(`/api/teams/${team.id}/rotate`, 'POST', {});
  await anonymous.call(`/api/invites/${invite}`, 'GET', undefined, 404);
  assert.equal((await winner.call(`/api/teams/${team.id}`)).team.id, team.id);
  assert.equal((await anonymous.call(`/api/invites/${rotated.invite}`)).invite.count, 2);
  await winner.call(`/api/teams/${team.id}/sharing`, 'PUT', { share: true });
  assert.equal((await host.call(`/api/teams/${team.id}`)).members.length, 2);
  const msg = await host.call(`/api/teams/${team.id}/announcements`, 'POST', { title: 'Morning', body: 'Only team members' });
  assert.equal((await otherHost.call('/api/inbox')).messages.length, 0);
  await otherHost.call(`/api/inbox/${msg.announcementId}/read`, 'POST', {}, 403);
  assert.equal((await winner.call('/api/inbox')).messages[0].read_at, null);
  await winner.call(`/api/inbox/${msg.announcementId}/read`, 'POST', {});
  assert.ok((await winner.call('/api/inbox')).messages[0].read_at);
  assert.equal((await host.call('/api/inbox')).messages[0].read_at, null);
  await host.call(`/api/teams/${team.id}/close`, 'POST', {});
  assert.equal((await winner.call(`/api/teams/${team.id}`)).members.length, 0);
  await winner.call(`/api/teams/${team.id}/leave`, 'POST', {});
  assert.equal((await winner.call('/api/inbox')).messages.length, 0);
  await winner.call(`/api/teams/${team.id}`, 'GET', undefined, 403);
  const stale = { ...a };
  const newPass = 'new-synthetic-password-123';
  const recovered = await anonymous.call('/api/recover', 'POST', { username: 'member_test', recoveryCode: registeredA.recoveryCode, newPassword: newPass });
  assert.notEqual(recovered.recoveryCode, registeredA.recoveryCode);
  assert.equal((await stale.call('/api/me')).user, null);
  await actor().call('/api/recover', 'POST', { username: 'member_test', recoveryCode: registeredA.recoveryCode, newPassword: pass }, 401);
  await anonymous.call('/api/account', 'DELETE', { password: newPass });
  await host.call('/api/account', 'DELETE', { password: pass });
  await anonymous.call('/api/profiles/host_test', 'GET', undefined, 404);
  assert.equal((await otherHost.call('/api/teams')).teams.length, 0);
  await server.cleanup();
  assert.equal((await db.list('announcements')).length, 0);
});
