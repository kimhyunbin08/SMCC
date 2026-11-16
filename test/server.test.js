import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { createApp } from '../src/server.js';
import { openDatabase, StoreConflict, StoreUnavailable } from '../src/database.js';
import { tableStore } from '../src/table-store.js';
import { username, password, text, timestamp } from '../src/api.js';
import { createDemo, previewHtml } from '../public/demo.js';
import { servicePath, initialTab, localDateTime } from '../public/ui.js';

test('unit: public perspectives render only synthetic escaped examples and contextual login', () => {
  const host = createDemo('host'), guest = createDemo('guest');
  assert.notEqual(host, createDemo('host'));
  assert.throws(() => createDemo('admin'));
  assert.match(previewHtml(host), /demo-team-form/);
  assert.match(previewHtml(host), /demo-announcement-form/);
  assert.match(previewHtml(host), /\/service\?perspective=host&tab=teams/);
  assert.match(previewHtml(guest), /demo-profile-form/);
  assert.match(previewHtml(guest), /demo-join-form/);
  assert.match(previewHtml(guest), /demo-read/);
  assert.match(previewHtml(guest), /서버에 전송·저장되지/);
  guest.name = '<script>attack</script>'; guest.joined = true; guest.share = true; guest.read = true;
  assert.doesNotMatch(previewHtml(guest), /<script>attack/);
  assert.match(previewHtml(guest), /&lt;script&gt;attack/);
  assert.match(previewHtml(guest), /읽음 · 가상/);
});

test('unit: internal service destinations and actual calendar dates are allowlisted', () => {
  assert.equal(servicePath('?tab=coffees&chat=12345678-1234-1234-1234-123456789abc&return=https://evil.invalid'), '/service?tab=coffees&chat=12345678-1234-1234-1234-123456789abc');
  assert.equal(servicePath('?perspective=admin&tab=evil&chat=//evil'), '/service');
  assert.equal(initialTab('', 'host'), 'teams');
  assert.equal(initialTab('?tab=profile', 'host'), 'profile');
  assert.throws(() => localDateTime('invalid'));
  assert.equal(timestamp('2030-01-01T08:00:00Z'), Date.parse('2030-01-01T08:00:00Z'));
  for (const date of ['2030-02-30T08:00:00Z', '01/01/2030', '2030-01-01T25:00:00Z', null]) assert.throws(() => timestamp(date), { status: 400 });
});

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
    async deleteEntity(ns, id, options) {
      const key = `${ns}/${id}`, old = records.get(key);
      if (options?.etag && old?.etag !== options.etag) throw { statusCode: 412 };
      records.delete(key);
    },
    async *listEntities() { for (const entry of records.values()) yield entry; },
  };
  for (const store of [openDatabase(':memory:'), tableStore(client)]) {
    await store.create('teams', 'team', { id: 'team', count: 0 });
    await assert.rejects(store.create('teams', 'team', {}), StoreConflict);
    await Promise.all([1, 2, 3].map(() => store.mutate('teams', 'team', (row) => ({ ...row, count: row.count + 1 }))));
    assert.equal((await store.get('teams', 'team')).count, 3);
    await store.mutate('teams', 'team', () => null);
    assert.equal(await store.get('teams', 'team'), null);
    await store.mutate('teams', 'absent', () => null);
    assert.equal(await store.get('teams', 'absent'), null);
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

async function app(t, storage = false, options = {}) {
  const db = storage ? openDatabase(':memory:') : null;
  const server = createApp({ db, origin: 'https://test.smcc', registration: storage, secure: false,
    operatorName: '시험 운영자', supportEmail: 'test@example.invalid', maintenance: false, ...options });
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
        assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
        this.lastStatus = response.status;
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
  for (const path of ['/styles.css', '/app.js', '/demo.js', '/ui.js', '/service.js', '/privacy', '/terms', '/host', '/guest', '/login', '/service', '/application']) assert.equal((await fetch(base + path)).status, 200);
  for (const path of ['/host', '/guest']) {
    const page = await fetch(base + path);
    const html = await page.text();
    assert.match(html, /href="\/host"/);
    assert.match(html, /href="\/guest"/);
    assert.match(html, /id="auth" class="panel" hidden/);
    assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
  }
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
  await anonymous.call('/api/teams', 'POST', { title: 'URL is not authorization' }, 401);
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

test('integration: public listing is opt-in, guest receipts are scoped and never grant member access', async (t) => {
  const { actor, db, server } = await app(t, true);
  const host = actor(), other = actor(), member = actor(), visitor = actor(), intruder = actor();
  const pass = 'synthetic-test-password-123';
  for (const [who, login, role] of [[host, 'public_host', 'host'], [other, 'other_public_host', 'host'], [member, 'public_member', 'member']]) {
    await who.call('/api/register', 'POST', { username: login, password: pass, name: login, role, terms: true, privacy: true, age: true });
  }
  const dates = { startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() };
  const privateTeam = await host.call('/api/teams', 'POST', { ...dates, title: 'PRIVATE TITLE', place: 'PRIVATE DETAIL', capacity: 2 });
  assert.equal((await visitor.call('/api/public/teams')).teams.length, 0);
  await visitor.call(`/api/public/teams/${privateTeam.team.id}`, 'GET', undefined, 404);
  await visitor.call(`/api/profiles/public_host/extra`, 'GET', undefined, 404);
  await visitor.call(`/api/invites/${privateTeam.invite}/extra`, 'GET', undefined, 404);
  await other.call(`/api/teams/${privateTeam.team.id}/publication`, 'PUT', { listed: true, publicPlace: 'none' }, 403);
  await host.call(`/api/teams/${privateTeam.team.id}/publication`, 'PUT', { listed: true, publicPlace: '호스트가 입력한 공개 장소' });
  const list = await visitor.call('/api/public/teams');
  assert.equal(list.teams.length, 1);
  assert.equal(JSON.stringify(list).includes('PRIVATE DETAIL'), false);
  assert.equal(JSON.stringify(list).includes(privateTeam.invite), false);
  assert.equal(JSON.stringify(list).includes('members'), false);
  const receipt = 'a'.repeat(43), guest = { teamId: privateTeam.team.id, receiptToken: receipt, name: '가상 비회원', bio: '호스트에게만 공개', consent: true, age: true };
  await visitor.call('/api/guest/applications', 'POST', { ...guest, consent: false }, 400);
  await visitor.call('/api/guest/applications', 'POST', guest);
  await visitor.call('/api/guest/applications', 'POST', guest);
  assert.equal((await visitor.call('/api/public/teams')).teams[0].count, 2);
  await member.call(`/api/public/teams/${privateTeam.team.id}/join`, 'POST', { disclosure: true, share: false }, 409);
  await visitor.call(`/api/teams/${privateTeam.team.id}`, 'GET', undefined, 401);
  await visitor.call('/api/inbox', 'GET', undefined, 401);
  await intruder.call('/api/guest/status', 'POST', { teamId: privateTeam.team.id, receiptToken: 'b'.repeat(43) }, 404);
  const details = await host.call(`/api/teams/${privateTeam.team.id}`);
  assert.equal(details.guestApplications.length, 1);
  assert.equal(details.guestApplications[0].name, guest.name);
  const id = details.guestApplications[0].id;
  await other.call(`/api/teams/${privateTeam.team.id}/guest-applications/${id}`, 'POST', { state: 'confirmed' }, 403);
  await host.call(`/api/teams/${privateTeam.team.id}/guest-applications/${id}`, 'POST', { state: 'confirmed' });
  const status = await visitor.call('/api/guest/status', 'POST', { teamId: guest.teamId, receiptToken: receipt });
  assert.equal(status.application.state, 'confirmed');
  assert.equal(JSON.stringify(status).includes('PRIVATE DETAIL'), false);
  assert.equal(JSON.stringify(status).includes(guest.bio), false);
  await visitor.call('/api/guest/withdraw', 'POST', { teamId: guest.teamId, receiptToken: receipt });
  await visitor.call('/api/guest/withdraw', 'POST', { teamId: guest.teamId, receiptToken: receipt });
  assert.equal((await visitor.call('/api/guest/status', 'POST', { teamId: guest.teamId, receiptToken: receipt })).application.state, 'withdrawn');
  const withdrawn = (await db.get('teams', guest.teamId)).guest_applications[id];
  assert.equal(withdrawn.name, undefined); assert.equal(withdrawn.bio, undefined);
  await visitor.call('/api/guest/applications', 'POST', { ...guest, receiptToken: 'c'.repeat(43) });
  const pending = (await host.call(`/api/teams/${guest.teamId}`)).guestApplications.find((entry) => entry.state === 'received');
  await host.call(`/api/teams/${guest.teamId}/guest-applications/${pending.id}`, 'POST', { state: 'rejected' });
  const rejected = (await db.get('teams', guest.teamId)).guest_applications[pending.id];
  assert.equal(rejected.name, undefined); assert.equal(rejected.bio, undefined);
  assert.equal((await visitor.call('/api/guest/applications', 'POST', { ...guest, receiptToken: 'c'.repeat(43) })).state, 'rejected');
  await member.call(`/api/public/teams/${guest.teamId}/join`, 'POST', { disclosure: true, share: false });
  const memberDetails = await member.call(`/api/teams/${guest.teamId}`);
  assert.equal(memberDetails.guestApplications, undefined);
  await host.call(`/api/teams/${guest.teamId}/publication`, 'PUT', { listed: false });
  assert.equal((await visitor.call('/api/public/teams')).teams.length, 0);
  await visitor.call('/api/guest/applications', 'POST', { ...guest, receiptToken: 'c'.repeat(43) }, 404);
  await host.call(`/api/teams/${guest.teamId}/close`, 'POST', {});
  await visitor.call('/api/guest/applications', 'POST', { ...guest, receiptToken: 'e'.repeat(43), invite: privateTeam.invite }, 409);
  await db.mutate('teams', guest.teamId, (row) => ({ ...row, ends_at: Date.now() - 31 * 86400000 }));
  await member.call(`/api/teams/${guest.teamId}`, 'GET', undefined, 404);
  await visitor.call('/api/guest/status', 'POST', { teamId: guest.teamId, receiptToken: receipt }, 404);
  await server.cleanup();
  assert.equal(await db.get('teams', guest.teamId), null);
});

test('integration: guest/member racing for one seat, cancel/rejoin receipt generation, profile conflicts', async (t) => {
  const { actor, db } = await app(t, true);
  const host = actor(), member = actor(), visitor = actor();
  const pass = 'synthetic-race-password-123';
  const h = await host.call('/api/register', 'POST', { username: 'race_host', password: pass, name: 'H', role: 'host', terms: true, privacy: true, age: true });
  await member.call('/api/register', 'POST', { username: 'race_member', password: pass, name: 'M', role: 'member', terms: true, privacy: true, age: true });
  const row = await host.call('/api/teams', 'POST', { title: 'race', place: 'private', capacity: 2, listed: true, publicPlace: 'public',
    startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() });
  const receipt = 'd'.repeat(43);
  await Promise.all([
    visitor.call('/api/guest/applications', 'POST', { teamId: row.team.id, receiptToken: receipt, name: 'Guest', bio: '', consent: true, age: true }, [200, 409]),
    member.call(`/api/public/teams/${row.team.id}/join`, 'POST', { disclosure: true }, [200, 409]),
  ]);
  const guestWon = visitor.lastStatus === 200;
  assert.equal([visitor.lastStatus, member.lastStatus].filter((status) => status === 200).length, 1);
  assert.equal((await visitor.call('/api/public/teams')).teams[0].count, 2);
  if (guestWon) await visitor.call('/api/guest/withdraw', 'POST', { teamId: row.team.id, receiptToken: receipt });
  else await member.call(`/api/teams/${row.team.id}/leave`, 'POST', {});
  await member.call(`/api/public/teams/${row.team.id}/join`, 'POST', { disclosure: true });
  const message = await host.call(`/api/teams/${row.team.id}/announcements`, 'POST', { title: 'Notice', body: 'data' });
  await member.call(`/api/inbox/${message.announcementId}/read`, 'POST', {});
  assert.ok((await member.call('/api/inbox')).messages[0].read_at);
  const old = (await db.list('receipts'))[0];
  await member.call(`/api/teams/${row.team.id}/leave`, 'POST', {});
  await member.call(`/api/public/teams/${row.team.id}/join`, 'POST', { disclosure: true });
  await db.create('receipts', old.id, old);
  assert.equal((await member.call('/api/inbox')).messages[0].read_at, null);
  await member.call(`/api/inbox/${message.announcementId}/read`, 'POST', {});
  assert.notEqual((await db.get('receipts', old.id)).membership_version, old.membership_version);
  const saved = await host.call('/api/profile', 'PUT', { name: 'new', bio: '', links: [], public: false, profileVersion: h.user.profileVersion });
  await host.call('/api/profile', 'PUT', { name: 'stale', bio: '', links: [], public: true, profileVersion: h.user.profileVersion }, 409);
  assert.equal((await host.call('/api/me')).user.profileVersion, saved.profile.profileVersion);
  await host.call(`/api/teams/${row.team.id}/sharing`, 'PUT', { share: 'true' }, 400);
});

test('integration: concurrent recovery revokes old sessions and uses each recovery code once', async (t) => {
  const { actor } = await app(t, true);
  const user = actor(), left = actor(), right = actor();
  const pass = 'concurrent-recovery-test-123';
  const first = await user.call('/api/register', 'POST', { username: 'recovery_test', password: pass, name: 'R', role: 'member', terms: true, privacy: true, age: true });
  const results = await Promise.all([
    left.call('/api/recover', 'POST', { username: 'recovery_test', recoveryCode: first.recoveryCode, newPassword: 'next-password-test-123' }, [200, 401]),
    right.call('/api/recover', 'POST', { username: 'recovery_test', recoveryCode: first.recoveryCode, newPassword: 'another-password-123' }, [200, 401]),
  ]);
  assert.equal([left.lastStatus, right.lastStatus].filter((status) => status === 200).length, 1);
  assert.equal((await user.call('/api/me')).user, null);
  const winner = left.lastStatus === 200 ? left : right;
  const currentPass = winner === left ? 'next-password-test-123' : 'another-password-123';
  const previousCookie = winner.cookie;
  await winner.call('/api/password', 'POST', { password: currentPass, newPassword: 'final-password-test-123' });
  const stale = actor(); stale.cookie = previousCookie;
  assert.equal((await stale.call('/api/me')).user, null);
  await winner.call('/api/logout', 'POST', {});
  assert.equal((await winner.call('/api/me')).user, null);
});

test('integration: cleanup cannot remove a rate limit renewed after its snapshot', async (t) => {
  const { db, server } = await app(t, true);
  await db.create('rates', 'renewed', { id: 'renewed', count: 5, expires_at: Date.now() - 1 });
  const list = db.list.bind(db);
  let renewed = false;
  db.list = async (namespace) => {
    const rows = await list(namespace);
    if (namespace === 'rates' && !renewed) {
      renewed = true;
      await db.mutate('rates', 'renewed', (row) => ({ ...row, expires_at: Date.now() + 3600000 }));
    }
    return rows;
  };
  await server.cleanup();
  assert.ok(await db.get('rates', 'renewed'));
});

test('unit: Azure conditional updates retry conflicts but do not mask outages', async () => {
  let updates = 0;
  const conflict = tableStore({
    async getEntity() { return { document: '{"count":1}', etag: '"1"' }; },
    async updateEntity() { updates++; throw { statusCode: 412 }; },
  });
  await assert.rejects(conflict.mutate('teams', 'one', (row) => row), StoreUnavailable);
  assert.equal(updates, 8);
  const outage = tableStore({ async getEntity() { throw Object.assign(new Error('offline'), { statusCode: 503 }); } });
  await assert.rejects(outage.get('teams', 'one'), /offline/);
});

test('integration: public join compensates concurrent account deletion without retaining a seat', async (t) => {
  const { actor, db } = await app(t, true);
  const host = actor(), member = actor();
  const data = { password: 'synthetic-delete-race-123', name: 'T', terms: true, privacy: true, age: true };
  await host.call('/api/register', 'POST', { ...data, username: 'delete_race_host', role: 'host' });
  const account = await member.call('/api/register', 'POST', { ...data, username: 'delete_race_member', role: 'member' });
  const { team } = await host.call('/api/teams', 'POST', { title: 'delete race', place: 'private', capacity: 2, listed: true, publicPlace: 'public',
    startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() });
  const mutate = db.mutate.bind(db);
  let armed = true;
  db.mutate = async (namespace, id, change) => {
    const result = await mutate(namespace, id, change);
    if (armed && namespace === 'teams' && id === team.id) {
      armed = false;
      await mutate('users', account.user.id, () => ({ id: account.user.id, deleted: true, expires_at: Date.now() + 86400000 }));
    }
    return result;
  };
  await member.call(`/api/public/teams/${team.id}/join`, 'POST', { disclosure: true }, 401);
  assert.equal((await db.get('teams', team.id)).members[account.user.id], undefined);
  assert.equal((await actor().call('/api/public/teams')).teams[0].count, 1);
});

test('integration: leave cleanup preserves a receipt created by concurrent rejoin', async (t) => {
  const { actor, db } = await app(t, true);
  const host = actor(), member = actor();
  const data = { password: 'synthetic-leave-race-123', name: 'T', terms: true, privacy: true, age: true };
  await host.call('/api/register', 'POST', { ...data, username: 'leave_race_host', role: 'host' });
  await member.call('/api/register', 'POST', { ...data, username: 'leave_race_member', role: 'member' });
  const { team } = await host.call('/api/teams', 'POST', { title: 'leave race', place: 'private', capacity: 2, listed: true, publicPlace: 'public',
    startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() });
  await member.call(`/api/public/teams/${team.id}/join`, 'POST', { disclosure: true });
  const { announcementId } = await host.call(`/api/teams/${team.id}/announcements`, 'POST', { title: 'race', body: 'data' });
  await member.call(`/api/inbox/${announcementId}/read`, 'POST', {});
  const list = db.list.bind(db);
  let armed = true;
  db.list = async (namespace) => {
    const rows = await list(namespace);
    if (namespace === 'receipts' && armed) {
      armed = false;
      await member.call(`/api/public/teams/${team.id}/join`, 'POST', { disclosure: true });
      await member.call(`/api/inbox/${announcementId}/read`, 'POST', {});
    }
    return rows;
  };
  await member.call(`/api/teams/${team.id}/leave`, 'POST', {});
  assert.ok((await member.call('/api/inbox')).messages[0].read_at);
});

test('integration: cumulative guest applications are bounded within Azure string-property size', async (t) => {
  const { actor, db } = await app(t, true);
  const host = actor(), visitor = actor();
  await visitor.call('/api/guest/applications', 'POST', { teamId: '/'.repeat(36) }, 400);
  await visitor.call('/api/guest/status', 'POST', { teamId: '/'.repeat(36), receiptToken: 'z'.repeat(43) }, 400);
  await host.call('/api/register', 'POST', { username: 'bounded_host', password: 'synthetic-bounded-test-123', name: 'T', role: 'host', terms: true, privacy: true, age: true });
  const { team } = await host.call('/api/teams', 'POST', { title: '😀'.repeat(80), place: '😀'.repeat(160), capacity: 30, listed: true, publicPlace: '😀'.repeat(80),
    startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() });
  const entries = Object.fromEntries(Array.from({ length: 64 }, (_, index) => {
    const id = index.toString(16).padStart(64, '0');
    return [id, { id, state: 'withdrawn', created_at: Date.now() }];
  }));
  await db.mutate('teams', team.id, (row) => ({ ...row, guest_applications: entries }));
  await visitor.call('/api/guest/applications', 'POST', { teamId: team.id, receiptToken: 'z'.repeat(43), name: 'Guest', bio: '', consent: true, age: true }, 409);
  const maximum = await db.get('teams', team.id);
  for (const entry of Object.values(maximum.guest_applications).slice(0, 29)) Object.assign(entry, {
    state: 'received', name: '😀'.repeat(40), bio: '😀'.repeat(200), consent_version: '2026-11-14-service',
  });
  const bytes = Buffer.byteLength(JSON.stringify(maximum), 'utf16le');
  assert.ok(bytes < 64 * 1024, `Maximum team property is ${bytes} bytes`);
});

test('integration: missing operator approval disables new guest collection as well as registration', async (t) => {
  const { actor } = await app(t, true, { registration: false });
  const visitor = actor();
  assert.equal((await visitor.call('/api/status')).registration, false);
  await visitor.call('/api/guest/applications', 'POST', {}, 503);
  await visitor.call('/api/register', 'POST', {}, 503);
});

test('integration: existing read receipts survive upgrade and sharing changes but not rejoin', async (t) => {
  const { actor, db, server } = await app(t, true);
  const host = actor(), member = actor();
  const fields = { name: 'T', password: 'compatibility-password-123', terms: true, privacy: true, age: true };
  await host.call('/api/register', 'POST', { ...fields, username: 'legacy_host', role: 'host' });
  const { user } = await member.call('/api/register', 'POST', { ...fields, username: 'legacy_member', role: 'member' });
  const { team, invite } = await host.call('/api/teams', 'POST', { title: 'legacy', place: 'private', capacity: 2,
    startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() });
  await member.call('/api/join', 'POST', { invite, disclosure: true });
  const { announcementId } = await host.call(`/api/teams/${team.id}/announcements`, 'POST', { title: 'existing', body: 'notice' });
  await member.call(`/api/inbox/${announcementId}/read`, 'POST', {});
  const receiptId = `${user.id}_${announcementId}`;
  await db.mutate('teams', team.id, (row) => { for (const entry of Object.values(row.members)) delete entry.version; return row; });
  const legacyReceipt = await db.mutate('receipts', receiptId, (row) => { delete row.membership_version; return row; });
  await server.cleanup();
  assert.equal((await member.call('/api/inbox')).messages[0].read_at, legacyReceipt.read_at);
  await member.call(`/api/teams/${team.id}/sharing`, 'PUT', { share: true });
  assert.equal((await member.call('/api/inbox')).messages[0].read_at, legacyReceipt.read_at);
  await member.call(`/api/inbox/${announcementId}/read`, 'POST', {});
  assert.equal((await db.get('receipts', receiptId)).read_at, legacyReceipt.read_at);
  await member.call(`/api/teams/${team.id}/leave`, 'POST', {});
  assert.equal(await db.get('receipts', receiptId), null);
  await member.call('/api/join', 'POST', { invite, disclosure: true });
  await db.create('receipts', receiptId, legacyReceipt);
  assert.equal((await member.call('/api/inbox')).messages[0].read_at, null);
  await server.cleanup();
  assert.equal(await db.get('receipts', receiptId), null);
});

test('integration: account deletion racing host team creation leaves no team or public listing', async (t) => {
  const { actor, db } = await app(t, true);
  const host = actor();
  const account = await host.call('/api/register', 'POST', { username: 'delete_create_host', password: 'delete-create-race-pass-123',
    name: '가상 호스트', role: 'host', terms: true, privacy: true, age: true });
  const create = db.create.bind(db);
  let raced = false;
  db.create = async (namespace, id, value) => {
    const result = await create(namespace, id, value);
    if (namespace === 'teams' && !raced) {
      raced = true;
      await db.mutate('users', account.user.id, (user) => ({ id: user.id, deleted: true, expires_at: Date.now() + 86400000 }));
    }
    return result;
  };
  await host.call('/api/teams', 'POST', { title: '삭제 경쟁 팀', place: '비공개 장소', capacity: 2, listed: true, publicPlace: '공개 안내',
    startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString() }, 401);
  assert.equal((await db.list('teams')).length, 0);
  assert.equal((await actor().call('/api/public/teams')).teams.length, 0);
});
