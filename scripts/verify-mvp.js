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
    assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${method} ${path}: ${response.status} ${result.error || 'Unexpected status'}`);
    if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
    if (result.csrf) this.csrf = result.csrf;
    return result;
  } };
}
const phase = process.env.TEST_PHASE || 'begin';
if (phase === 'begin') {
  const suffix = randomBytes(5).toString('hex');
  const roles = process.env.TEST_SCOPE === 'service' ? ['host', 'member'] : ['host', 'member', 'outsider'];
  const users = roles.map((role) => ({ username: `test_${role}_${suffix}`, password: randomBytes(24).toString('base64url'), role }));
  const state = { users, base };
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600, flag: 'wx' });
  const accounts = users.map(actor), [host, member] = accounts, outsider = accounts[2] || actor({});
  for (const who of accounts) await who.call('/api/register', 'POST', {
    username: who.username, password: who.password, name: '가상 시험 계정', role: who.role === 'host' ? 'host' : 'member', terms: true, privacy: true, age: true,
  });
  await host.call('/api/profile', 'PUT', { name: '가상 호스트', bio: 'E2E fixture', links: [{ label: 'SNS', url: 'https://example.com/' }], public: false });
  await member.call('/api/profile', 'PUT', { name: '가상 참가자', bio: 'E2E fixture', links: [], public: false });
  const result = await host.call('/api/teams', 'POST', { title: '가상 검증 팀 · 실제 신청 금지', place: '가상 비공개 시험 장소', startsAt: new Date(Date.now() + 3 * 3600000).toISOString(),
    endsAt: new Date(Date.now() + 4 * 3600000).toISOString(), capacity: 3, share: true, listed: true, publicPlace: '가상 시험 공개 안내' });
  state.team = result.team.id;
  await member.call('/api/join', 'POST', { invite: result.invite, disclosure: true, share: true });
  assert.equal((await member.call(`/api/teams/${state.team}`)).members.length, 2);
  await outsider.call(`/api/teams/${state.team}`, 'GET', undefined, outsider.cookie ? 403 : 401);
  const visitor = actor({});
  const publicDetails = await visitor.call(`/api/public/teams/${state.team}`);
  assert.equal(publicDetails.team.publicPlace, '가상 시험 공개 안내');
  assert.equal(JSON.stringify(publicDetails).includes('가상 비공개 시험 장소'), false);
  state.guest = randomBytes(32).toString('base64url');
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  const application = { teamId: state.team, receiptToken: state.guest, name: '가상 비회원', bio: 'E2E fixture', consent: true, age: true };
  await visitor.call('/api/guest/applications', 'POST', application);
  await visitor.call('/api/guest/applications', 'POST', application);
  assert.equal((await visitor.call(`/api/public/teams/${state.team}`)).team.count, 3);
  assert.equal((await member.call(`/api/teams/${state.team}`)).guestApplications, undefined);
  await visitor.call('/api/inbox', 'GET', undefined, 401);
  const message = await host.call(`/api/teams/${state.team}/announcements`, 'POST', { title: '가상 공지', body: '영속성 검증용' });
  state.message = message.announcementId;
  if (outsider.cookie) assert.equal((await outsider.call('/api/inbox')).messages.length, 0);
  await member.call(`/api/inbox/${state.message}/read`, 'POST', {});
  assert.ok((await member.call('/api/inbox')).messages[0].read_at);
  await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  console.log('E2E begin passed: auth/profile/public and private filtering/member join/guest receipt retry/inbox/read/isolation. Restart the app, then TEST_PHASE=verify.');
} else {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.base, base);
  const accounts = state.users.map(actor), [host, member] = accounts, outsider = accounts[2] || actor({});
  const authenticated = [];
  for (const who of accounts) {
    const result = await who.call('/api/login', 'POST', { username: who.username, password: who.password }, phase === 'cleanup' ? [200, 401] : 200);
    if (result.user) authenticated.push(who);
  }
  if (phase === 'verify') {
    assert.equal((await host.call('/api/me')).user.links.length, 1);
    assert.equal((await member.call(`/api/teams/${state.team}`)).members.length, 2);
    assert.ok((await member.call('/api/inbox')).messages.find((row) => row.id === state.message)?.read_at);
    await outsider.call(`/api/teams/${state.team}`, 'GET', undefined, outsider.cookie ? 403 : 401);
    if (state.guest) {
      const visitor = actor({});
      assert.equal((await visitor.call('/api/guest/status', 'POST', { teamId: state.team, receiptToken: state.guest })).application.state, 'received');
      const application = (await host.call(`/api/teams/${state.team}`)).guestApplications.find((entry) => entry.name === '가상 비회원');
      await host.call(`/api/teams/${state.team}/guest-applications/${application.id}`, 'POST', { state: 'confirmed' });
      assert.equal((await visitor.call('/api/guest/status', 'POST', { teamId: state.team, receiptToken: state.guest })).application.state, 'confirmed');
      await visitor.call('/api/guest/withdraw', 'POST', { teamId: state.team, receiptToken: state.guest });
      await visitor.call('/api/guest/withdraw', 'POST', { teamId: state.team, receiptToken: state.guest });
      assert.equal((await visitor.call('/api/guest/status', 'POST', { teamId: state.team, receiptToken: state.guest })).application.state, 'withdrawn');
      assert.equal((await host.call(`/api/teams/${state.team}`)).guestApplications[0].name, undefined);
    }
    console.log('Live persistence E2E passed after restart: accounts/profiles/public listing/member and guest applications/confirmation/withdrawal/announcements/read-state/isolation.');
  }
  for (const who of [member, host, accounts[2]].filter(Boolean)) if (authenticated.includes(who)) await who.call('/api/account', 'DELETE', { password: who.password });
  await unlink(statePath);
  console.log('Synthetic verification accounts, team and notices removed; local credential fixture deleted.');
}
