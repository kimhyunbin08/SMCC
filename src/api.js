import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { StoreConflict } from './database.js';

const derive = promisify(scrypt);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const DAY = 86_400_000;
export const CONSENT_VERSION = '2026-11-14-mvp';
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
export function text(value, min, max, label) {
  if (typeof value !== 'string' || [...value.trim()].length < min || [...value.trim()].length > max) fail(400, `${label}은 ${min}~${max}자로 입력하세요.`);
  return value.trim();
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, '비밀번호는 12~128자로 입력하세요.');
  return value;
}
export function username(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_]{3,30}$/.test(value)) fail(400, '아이디는 소문자·숫자·밑줄 3~30자입니다.');
  return value;
}
async function passwordHash(value, salt) {
  return Buffer.from(await derive(value, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 })).toString('hex');
}
async function verify(value, user) {
  const actual = await passwordHash(value, user?.salt || 'smcc-nonexistent-user-salt');
  return Boolean(user) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(user.password_hash, 'hex'));
}
function profile(user) { return { id: user.id, username: user.username, name: user.name, bio: user.bio, links: user.links }; }
const currentTeam = (row) => {
  if (!row || row.deleted) fail(404, '팀을 찾을 수 없습니다.');
  return row;
};
function sanitizeTeam(row) {
  return { id: row.id, host_id: row.host_id, title: row.title, place: row.place, starts_at: row.starts_at,
    ends_at: row.ends_at, capacity: row.capacity, closed: row.closed, created_at: row.created_at };
}

export function createApi(store, config) {
  let activePasswordJobs = 0;
  async function limitedPasswordJob(job) {
    if (activePasswordJobs >= 4) fail(429, '로그인 요청이 많습니다. 잠시 후 다시 시도하세요.');
    activePasswordJobs++;
    try { return await job(); } finally { activePasswordJobs--; }
  }
  async function rate(key, limit = 10) {
    await store.mutate('rates', hash(key), (entry) => {
      const now = Date.now();
      if (!entry || entry.expires_at <= now) entry = { id: hash(key), count: 0, expires_at: now + 3_600_000 };
      if (entry.count >= limit) fail(429, '요청 한도를 넘었습니다. 1시간 후 다시 시도하세요.');
      return { ...entry, count: entry.count + 1 };
    });
  }
  const tokenFrom = (req) => /(?:^|;\s*)smcc_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  async function authenticate(req) {
    const token = tokenFrom(req);
    if (!token) return null;
    const entry = await store.get('sessions', hash(token));
    if (!entry || entry.expires_at <= Date.now()) return null;
    const user = await store.get('users', entry.user_id);
    if (!user || user.deleted || user.auth_version !== entry.auth_version) return null;
    return { ...user, csrf: entry.csrf };
  }
  async function session(user, res) {
    const token = random(), csrf = random(), id = hash(token);
    await store.create('sessions', id, { id, user_id: user.id, auth_version: user.auth_version, csrf, expires_at: Date.now() + 7 * DAY });
    res.setHeader('Set-Cookie', `smcc_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${config.secure ? '; Secure' : ''}`);
    return { user: { ...profile(user), role: user.role, public: user.public }, csrf };
  }
  function requireUser(user) { if (!user) fail(401, '로그인이 필요합니다.'); }
  function requireHost(user) { requireUser(user); if (user.role !== 'host') fail(403, '호스트 계정만 팀을 만들 수 있습니다.'); }
  function authorizeUser(current, expected) {
    if (!current || current.deleted || current.auth_version !== expected.auth_version) fail(401, '계정 인증이 변경되었습니다. 다시 로그인하세요.');
    return current;
  }
  async function team(id) {
    const row = currentTeam(await store.get('teams', id));
    const host = await store.get('users', row.host_id);
    if (!host || host.deleted) fail(404, '팀을 찾을 수 없습니다.');
    return row;
  }
  function requireMember(row, user) { requireUser(user); if (!row.members[user.id]) fail(403, '이 팀의 멤버가 아닙니다.'); }
  function requireOwner(row, user) { requireHost(user); if (row.host_id !== user.id) fail(403, '자신의 팀만 관리할 수 있습니다.'); }
  async function editTeam(id, user, owner, change) {
    await team(id);
    return store.mutate('teams', id, (value) => {
      const row = currentTeam(value);
      if (owner) requireOwner(row, user); else requireMember(row, user);
      return change(row);
    });
  }
  async function findInvite(token) {
    const rows = await store.list('teams'), digest = hash(token);
    const row = rows.find((entry) => !entry.deleted && entry.invite_hash === digest);
    if (!row) fail(404, '초대 링크가 만료되었거나 존재하지 않습니다.');
    return team(row.id);
  }
  async function deleteTeam(id) {
    await store.mutate('teams', id, (row) => ({ id, host_id: row?.host_id, deleted: true, members: {} }));
    const announcements = (await store.list('announcements')).filter((entry) => entry.team_id === id);
    const ids = new Set(announcements.map((entry) => entry.id));
    for (const receipt of await store.list('receipts')) if (ids.has(receipt.announcement_id)) await store.remove('receipts', receipt.id);
    for (const entry of announcements) await store.remove('announcements', entry.id);
    await store.remove('teams', id);
  }
  async function deleteUserData(id) {
    for (const row of await store.list('teams')) {
      if (row.host_id === id) await deleteTeam(row.id);
      else if (row.members?.[id]) await store.mutate('teams', row.id, (current) => {
        if (!current) return { id: row.id, deleted: true, members: {} };
        delete current.members[id]; return current;
      });
    }
    for (const entry of await store.list('sessions')) if (entry.user_id === id) await store.remove('sessions', entry.id);
    for (const entry of await store.list('receipts')) if (entry.user_id === id) await store.remove('receipts', entry.id);
    const reservation = await store.get('users', id);
    if (reservation?.deleted && reservation.expires_at <= Date.now()) await store.remove('users', id);
  }
  async function cleanup() {
    const now = Date.now();
    for (const user of await store.list('users')) if (user.deleted) await deleteUserData(user.id);
    for (const row of await store.list('teams')) {
      if (row.deleted || row.ends_at < now - 30 * DAY || !await store.get('users', row.host_id)) await deleteTeam(row.id);
    }
    for (const namespace of ['sessions', 'rates']) {
      for (const row of await store.list(namespace)) if (row.expires_at < now) await store.remove(namespace, row.id);
    }
    for (const row of await store.list('announcements')) {
      const parent = await store.get('teams', row.team_id);
      if (!parent || parent.deleted) await store.remove('announcements', row.id);
    }
    for (const row of await store.list('receipts')) {
      const user = await store.get('users', row.user_id), message = await store.get('announcements', row.announcement_id);
      const parent = message && await store.get('teams', message.team_id);
      if (!user || user.deleted || !parent?.members?.[row.user_id]) await store.remove('receipts', row.id);
    }
  }

  const api = async function (req, res, pathname, body) {
    const user = await authenticate(req);
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.origin !== config.origin) fail(403, '같은 서비스에서만 요청할 수 있습니다.');
      if (user && req.headers['x-csrf-token'] !== user.csrf) fail(403, '요청 인증이 만료되었습니다. 새로고침하세요.');
    }
    const key = `${req.method} ${pathname}`;
    if (key === 'GET /api/me') return user ? { user: { ...profile(user), role: user.role, public: user.public }, csrf: user.csrf } : { user: null };
    if (key === 'POST /api/register') {
      if (!config.registration) fail(503, '운영 정보와 영속 저장소 확인 전에는 가입할 수 없습니다.');
      const login = username(body.username), pass = password(body.password), name = text(body.name, 1, 40, '호칭');
      if (!['host', 'member'].includes(body.role)) fail(400, '계정 종류를 선택하세요.');
      if (body.terms !== true || body.privacy !== true || body.age !== true) fail(400, '필수 고지 확인과 만 14세 이상 확인이 필요합니다.');
      await rate(`register:${config.clientAddress(req)}`, 5);
      const id = hash(login), salt = random(), recoveryCode = random();
      const encoded = await limitedPasswordJob(() => passwordHash(pass, salt));
      const newUser = { id, username: login, password_hash: encoded, salt, recovery_hash: hash(recoveryCode), auth_version: random(),
        role: body.role, name, bio: '', links: [], public: false, created_at: Date.now(), consent_version: CONSENT_VERSION, consent_at: Date.now() };
      try { await store.create('users', id, newUser); }
      catch (error) { if (error instanceof StoreConflict) fail(409, '사용할 수 없는 아이디입니다.'); throw error; }
      return { ...await session(newUser, res), recoveryCode };
    }
    if (key === 'POST /api/login') {
      const login = username(body.username), pass = password(body.password);
      await rate(`login:${config.clientAddress(req)}`); await rate(`login-user:${login}`);
      const found = await store.get('users', hash(login));
      if (!await limitedPasswordJob(() => verify(pass, found?.deleted ? null : found))) fail(401, '아이디 또는 비밀번호가 맞지 않습니다.');
      const fresh = authorizeUser(await store.get('users', found.id), found);
      return session(fresh, res);
    }
    if (key === 'POST /api/recover' || key === 'POST /api/password') {
      let found;
      if (pathname === '/api/password') {
        requireUser(user); await rate(`password:${user.id}`, 5);
        if (!await limitedPasswordJob(() => verify(password(body.password), user))) fail(401, '현재 비밀번호가 맞지 않습니다.');
        found = user;
      } else {
        await rate(`recover:${config.clientAddress(req)}`, 5);
        found = await store.get('users', hash(username(body.username)));
        const code = hash(text(body.recoveryCode, 40, 64, '복구 코드'));
        if (!found || found.deleted || !timingSafeEqual(Buffer.from(code, 'hex'), Buffer.from(found.recovery_hash, 'hex'))) fail(401, '복구 정보를 확인하세요.');
      }
      const salt = random(), recoveryCode = random(), encoded = await limitedPasswordJob(() => passwordHash(password(body.newPassword), salt));
      const updated = await store.mutate('users', found.id, (current) => ({
        ...authorizeUser(current, found), password_hash: encoded, salt, recovery_hash: hash(recoveryCode), auth_version: random(),
      }));
      return { ...await session(updated, res), recoveryCode };
    }
    if (key === 'POST /api/logout') {
      requireUser(user); await store.remove('sessions', hash(tokenFrom(req)));
      res.setHeader('Set-Cookie', `smcc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secure ? '; Secure' : ''}`);
      return { ok: true };
    }
    if (key === 'DELETE /api/account') {
      requireUser(user); await rate(`delete:${user.id}`, 5);
      if (!await limitedPasswordJob(() => verify(password(body.password), user))) fail(401, '현재 비밀번호가 맞지 않습니다.');
      await store.mutate('users', user.id, (current) => {
        authorizeUser(current, user);
        return { id: user.id, deleted: true, expires_at: Date.now() + 30 * DAY };
      });
      await deleteUserData(user.id);
      res.setHeader('Set-Cookie', `smcc_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secure ? '; Secure' : ''}`);
      return { ok: true };
    }
    if (key === 'PUT /api/profile') {
      requireUser(user);
      const name = text(body.name, 1, 40, '호칭'), bio = text(body.bio, 0, 200, '소개');
      if (!Array.isArray(body.links) || body.links.length > 6) fail(400, 'SNS 링크는 최대 6개입니다.');
      const links = body.links.map((link) => {
        if (!link || typeof link !== 'object') fail(400, '링크 형식을 확인하세요.');
        const label = text(link.label, 1, 30, '링크 이름'), raw = text(link.url, 1, 500, '링크 주소');
        let url;
        try { url = new URL(raw); } catch { fail(400, '올바른 HTTPS 주소를 입력하세요.'); }
        if (url.protocol !== 'https:' || url.username || url.password) fail(400, '로그인 정보 없는 HTTPS 링크만 등록할 수 있습니다.');
        return { label, url: url.href };
      });
      if (typeof body.public !== 'boolean') fail(400, '공개 여부를 확인하세요.');
      const updated = await store.mutate('users', user.id, (current) => ({ ...authorizeUser(current, user), name, bio, links, public: body.public }));
      return { profile: { ...profile(updated), public: updated.public } };
    }
    if (req.method === 'GET' && pathname.startsWith('/api/profiles/')) {
      const found = await store.get('users', hash(username(pathname.split('/')[3])));
      if (!found || found.deleted || !found.public) fail(404, '공개 프로필을 찾을 수 없습니다.');
      return { profile: profile(found) };
    }
    if (key === 'GET /api/teams') {
      requireUser(user);
      const teams = [];
      for (const row of await store.list('teams')) {
        if (!row.deleted && row.members[user.id] && row.ends_at >= Date.now() - 30 * DAY) {
          const host = await store.get('users', row.host_id);
          if (host && !host.deleted) teams.push({ ...sanitizeTeam(row), share: row.members[user.id].share });
        }
      }
      return { teams: teams.sort((a, b) => b.created_at - a.created_at) };
    }
    if (key === 'POST /api/teams') {
      requireHost(user);
      const title = text(body.title, 1, 80, '팀 이름'), place = text(body.place, 1, 160, '장소');
      const starts = typeof body.startsAt === 'string' ? Date.parse(body.startsAt) : NaN;
      const ends = typeof body.endsAt === 'string' ? Date.parse(body.endsAt) : NaN;
      if (!Number.isFinite(starts) || !Number.isFinite(ends) || starts <= Date.now() || ends <= starts || ends - starts > DAY) fail(400, '시작은 미래 시각, 종료는 시작 이후 24시간 이내여야 합니다.');
      if (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 30) fail(400, '정원은 호스트 포함 1~30명입니다.');
      const id = randomUUID(), invite = random(), now = Date.now();
      const row = { id, host_id: user.id, title, place, starts_at: starts, ends_at: ends, capacity: body.capacity,
        invite_hash: hash(invite), closed: false, created_at: now, members: { [user.id]: { share: body.share === true, consent_at: now } } };
      authorizeUser(await store.get('users', user.id), user);
      await store.create('teams', id, row);
      return { team: sanitizeTeam(await team(id)), invite };
    }
    if (req.method === 'GET' && pathname.startsWith('/api/invites/')) {
      const row = await findInvite(pathname.split('/')[3] || '');
      return { invite: { id: row.id, title: row.title, startsAt: row.starts_at, endsAt: row.ends_at, capacity: row.capacity,
        available: !row.closed && row.starts_at > Date.now(), count: Object.keys(row.members).length } };
    }
    if (key === 'POST /api/join') {
      requireUser(user);
      if (body.disclosure !== true) fail(400, '팀 정보 공유 고지를 확인하세요.');
      const token = text(body.invite, 40, 64, '초대 코드'), row = await findInvite(token);
      await store.mutate('teams', row.id, (value) => {
        const current = currentTeam(value);
        if (current.invite_hash !== hash(token) || current.closed || current.starts_at <= Date.now()) fail(409, '모집 또는 초대가 종료되었습니다.');
        if (current.members[user.id]) return current;
        if (Object.keys(current.members).length >= current.capacity) fail(409, '정원이 찼습니다.');
        current.members[user.id] = { share: body.share === true, consent_at: Date.now() };
        return current;
      });
      return { teamId: row.id };
    }
    const match = /^\/api\/teams\/([0-9a-f-]+)(?:\/([a-z-]+))?$/.exec(pathname);
    if (match) {
      const [, id, action] = match;
      if (req.method === 'GET' && !action) {
        const row = await team(id); requireMember(row, user);
        const members = [];
        if (!row.closed && row.ends_at > Date.now()) {
          for (const [userId, entry] of Object.entries(row.members)) {
            if (entry.share || userId === user.id) {
              const person = await store.get('users', userId);
              if (person && !person.deleted) members.push(profile(person));
            }
          }
        }
        const fresh = await team(id); requireMember(fresh, user);
        if (fresh.closed || fresh.ends_at <= Date.now()) return { team: sanitizeTeam(fresh), members: [], share: fresh.members[user.id].share };
        const visible = members.filter((person) => fresh.members[person.id] && (fresh.members[person.id].share || person.id === user.id));
        return { team: sanitizeTeam(fresh), members: visible, share: fresh.members[user.id].share };
      }
      if (req.method === 'PUT' && action === 'sharing') {
        if (typeof body.share !== 'boolean') fail(400, '공유 여부를 확인하세요.');
        await editTeam(id, user, false, (row) => { row.members[user.id] = { share: body.share, consent_at: Date.now() }; return row; });
        return { ok: true };
      }
      if (req.method === 'POST' && action === 'leave') {
        await editTeam(id, user, false, (row) => {
          if (row.host_id === user.id) fail(409, '호스트는 팀을 삭제해야 합니다.');
          delete row.members[user.id]; return row;
        });
        const ids = new Set((await store.list('announcements')).filter((entry) => entry.team_id === id).map((entry) => entry.id));
        for (const row of await store.list('receipts')) if (row.user_id === user.id && ids.has(row.announcement_id)) await store.remove('receipts', row.id);
        return { ok: true };
      }
      if (req.method === 'POST' && action === 'rotate') {
        const invite = random();
        await editTeam(id, user, true, (row) => ({ ...row, invite_hash: hash(invite) }));
        return { invite };
      }
      if (req.method === 'POST' && action === 'close') {
        await editTeam(id, user, true, (row) => ({ ...row, closed: true }));
        return { ok: true };
      }
      if (req.method === 'DELETE' && !action) {
        requireOwner(await team(id), user); await deleteTeam(id); return { ok: true };
      }
      if (req.method === 'POST' && action === 'announcements') {
        const row = await team(id); requireOwner(row, user);
        if (row.closed || row.ends_at <= Date.now()) fail(409, '종료된 팀에는 공지를 올릴 수 없습니다.');
        await rate(`announce:${user.id}`, 20);
        const message = { id: randomUUID(), team_id: id, title: text(body.title, 1, 80, '제목'), body: text(body.body, 1, 2000, '공지'), created_at: Date.now() };
        await store.create('announcements', message.id, message);
        return { announcementId: message.id };
      }
    }
    if (key === 'GET /api/inbox') {
      requireUser(user);
      const messages = [];
      for (const entry of await store.list('announcements')) {
        const row = await store.get('teams', entry.team_id);
        if (!row || row.deleted || !row.members[user.id] || row.ends_at < Date.now() - 30 * DAY) continue;
        const host = await store.get('users', row.host_id);
        if (!host || host.deleted) continue;
        const read = await store.get('receipts', `${user.id}_${entry.id}`);
        messages.push({ id: entry.id, title: entry.title, body: entry.body, created_at: entry.created_at, team_title: row.title, read_at: read?.read_at || null });
      }
      return { messages: messages.sort((a, b) => b.created_at - a.created_at).slice(0, 100) };
    }
    if (req.method === 'POST' && /^\/api\/inbox\/[0-9a-f-]+\/read$/.test(pathname)) {
      requireUser(user);
      const messageId = pathname.split('/')[3], entry = await store.get('announcements', messageId);
      if (!entry) fail(404, '공지를 찾을 수 없습니다.');
      requireMember(await team(entry.team_id), user);
      const id = `${user.id}_${messageId}`;
      await store.mutate('receipts', id, (current) => current || { id, announcement_id: messageId, user_id: user.id, read_at: Date.now() });
      return { ok: true };
    }
    fail(404, '요청한 기능을 찾을 수 없습니다.');
  };
  api.cleanup = cleanup;
  return api;
}
