import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';

const base = process.env.TEST_BASE_URL;
if (!base || !/^https?:\/\//.test(base)) throw new Error('Set TEST_BASE_URL to the actual local or live app');
const statePath = new URL('../.mvp-verification.json', import.meta.url);
function actor(saved) {
  return { ...saved, cookie: '', csrf: '', async call(path, method = 'GET', body, status = 200) {
    const response = await fetch(base + path, { method, headers: { Cookie: this.cookie, Origin: new URL(base).origin,
      'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
    if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
    if (result.csrf) this.csrf = result.csrf;
    return result;
  } };
}
const phase = process.env.TEST_PHASE || 'begin';
if (phase === 'begin') {
  const suffix = randomBytes(5).toString('hex');
  const users = ['host', 'member', 'outsider'].map((role) => ({ username: `test_${role}_${suffix}`, password: randomBytes(24).toString('base64url'), role }));
  const state = { users, base };
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  const [host, member, outsider] = users.map(actor);
  for (const who of [host, member, outsider]) await who.call('/api/register', 'POST', {
    username: who.username, password: who.password, name: '가상 시험 계정', role: who.role === 'host' ? 'host' : 'member', terms: true, privacy: true, age: true,
  });
  await host.call('/api/profile', 'PUT', { name: '가상 호스트', bio: 'E2E fixture', links: [{ label: 'SNS', url: 'https://example.com/' }], public: false });
  await member.call('/api/profile', 'PUT', { name: '가상 참가자', bio: 'E2E fixture', links: [], public: false });
  const result = await host.call('/api/teams', 'POST', { title: '가상 검증 팀', place: '가상 시험 장소', startsAt: new Date(Date.now() + 3 * 3600000).toISOString(),
    endsAt: new Date(Date.now() + 4 * 3600000).toISOString(), capacity: 2, share: true });
  state.team = result.team.id;
  await member.call('/api/join', 'POST', { invite: result.invite, disclosure: true, share: true });
  assert.equal((await member.call(`/api/teams/${state.team}`)).members.length, 2);
  await outsider.call(`/api/teams/${state.team}`, 'GET', undefined, 403);
  const message = await host.call(`/api/teams/${state.team}/announcements`, 'POST', { title: '가상 공지', body: '영속성 검증용' });
  state.message = message.announcementId;
  assert.equal((await outsider.call('/api/inbox')).messages.length, 0);
  await member.call(`/api/inbox/${state.message}/read`, 'POST', {});
  assert.ok((await member.call('/api/inbox')).messages[0].read_at);
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log('E2E begin passed: auth/profile/invite/visibility/inbox/read/isolation. Restart the app, then TEST_PHASE=verify.');
} else {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.base, base);
  const [host, member, outsider] = state.users.map(actor);
  const authenticated = [];
  for (const who of [host, member, outsider]) {
    const result = await who.call('/api/login', 'POST', { username: who.username, password: who.password }, phase === 'cleanup' ? [200, 401] : 200);
    if (result.user) authenticated.push(who);
  }
  if (phase === 'verify') {
    assert.equal((await host.call('/api/me')).user.links.length, 1);
    assert.equal((await member.call(`/api/teams/${state.team}`)).members.length, 2);
    assert.ok((await member.call('/api/inbox')).messages.find((row) => row.id === state.message)?.read_at);
    await outsider.call(`/api/teams/${state.team}`, 'GET', undefined, 403);
    console.log('Live persistence E2E passed after restart: accounts/profiles/membership/announcements/read-state/isolation.');
  }
  for (const who of [member, host, outsider]) if (authenticated.includes(who)) await who.call('/api/account', 'DELETE', { password: who.password });
  await unlink(statePath);
  console.log('Synthetic verification accounts, team and notices removed; local credential fixture deleted.');
}
