import { mountPreview } from './demo.js';
import { servicePath, initialTab, localDateTime, chatId } from './ui.js';
import { mountService, guestForm, manageApplication } from './service.js';

const $ = (id) => document.getElementById(id);
let csrf = '', currentUser = null, selectedTeam = null, linkCount = 0, storage = false, registration = false, service;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function notice(value, error = false) { $('message').textContent = value; $('message').className = error ? 'error' : 'success'; }
async function request(path, method = 'GET', body) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { method, signal: controller.signal, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && currentUser) clearAccount();
      const error = new Error(result.error || '요청을 처리할 수 없습니다.'); error.status = response.status; throw error;
    }
    return result;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError || error instanceof SyntaxError) throw new Error('서버 응답을 확인하지 못했습니다. 저장이 완료됐을 수도 있으니 새로고침으로 상태를 확인하세요.');
    throw error;
  } finally { clearTimeout(timer); }
}
function clearAccount() {
  currentUser = null; csrf = ''; selectedTeam = null;
  $('dashboard').hidden = true; $('account-tabs').hidden = true; $('auth').hidden = false;
  updateHeader();
  for (const id of ['team-detail', 'team-list', 'inbox-list', 'link-fields', 'profile-link']) $(id).replaceChildren();
  for (const form of $('dashboard').querySelectorAll('form')) form.reset();
  $('recovery-code').textContent = ''; $('recovery-result').hidden = true;
  notice('로그인이 만료되거나 계정 인증이 변경되었습니다. 다시 로그인하세요.', true);
}
function values(form) {
  const data = Object.fromEntries(new FormData(form));
  for (const input of form.querySelectorAll('input[type=checkbox]')) if (input.name) data[input.name] = input.checked;
  return data;
}
function bindForm(id, action) {
  $(id).addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    if (button.disabled) return;
    const controls = [...event.target.querySelectorAll('input,textarea,select,button')];
    const previous = controls.map((control) => control.disabled);
    const data = values(event.target);
    for (const control of controls) control.disabled = true;
    event.target.setAttribute('aria-busy', 'true');
    try { await action(data); } catch (error) { notice(error.message, true); }
    finally {
      controls.forEach((control, index) => { control.disabled = previous[index] || !storage || (id === 'register-form' && !registration); });
      event.target.removeAttribute('aria-busy');
    }
  });
}
function task(action) { return async (event) => {
  const button = event?.currentTarget;
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { if (button) button.disabled = false; }
}; }
function selectAccountTab(tab) {
  for (const section of document.querySelectorAll('[id^=tab-]')) section.hidden = !currentUser || section.id !== `tab-${tab}`;
}
function updateHeader() {
  const preview = ['/', '/host', '/guest'].includes(location.pathname);
  $('preview-tabs').hidden = !preview;
  $('preview-perspectives').hidden = !preview;
  $('service-tabs').hidden = preview;
  $('brand').href = preview ? '/' : '/service';
  $('header-login').hidden = preview || Boolean(currentUser) || location.pathname === '/login';
  $('header-login').href = `/login${location.pathname === '/service' ? location.search : ''}`;
  for (const link of document.querySelectorAll('[data-auth]')) link.hidden = !currentUser;
  const tab = new URLSearchParams(location.search).get('tab') || 'home';
  for (const link of document.querySelectorAll('[data-service-tab]')) {
    if (location.pathname === '/service' && link.dataset.serviceTab === (tab === 'teams' ? 'coffees' : tab)) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
function showRecovery(code) { if (code) { $('recovery-code').textContent = code; $('recovery-result').hidden = false; } }
async function signedIn(result) {
  currentUser = result.user; csrf = result.csrf || '';
  $('auth').hidden = Boolean(currentUser) || (location.pathname !== '/login' && !location.pathname.startsWith('/invite/')); $('dashboard').hidden = !currentUser;
  $('account-tabs').hidden = !currentUser;
  updateHeader();
  if (!currentUser) return;
  if (location.pathname === '/login') history.replaceState(null, '', servicePath(location.search));
  updateHeader();
  $('welcome').textContent = `${currentUser.name}님 · ${currentUser.role === 'host' ? '호스트' : '참가자'}`;
  $('host-create').hidden = currentUser.role !== 'host';
  renderProfile();
  showRecovery(result.recoveryCode);
  await loadTeams();
  await loadInbox();
  const tab = initialTab(location.search, currentUser.role);
  selectAccountTab(tab);
  await renderInvite();
}
function renderProfile() {
  const form = $('profile-form');
  form.elements.name.value = currentUser.name; form.elements.bio.value = currentUser.bio;
  form.elements.public.checked = currentUser.public;
  $('link-fields').replaceChildren(); linkCount = 0;
  for (const link of currentUser.links) addLink(link);
  profileLink();
}
function profileLink() {
  $('profile-link').replaceChildren();
  if (!currentUser.public) { $('profile-link').textContent = '인터넷 공개는 꺼져 있습니다. 팀별 공유는 따로 설정합니다.'; return; }
  const link = document.createElement('a'); link.href = `/p/${currentUser.username}`; link.textContent = `${location.origin}/p/${currentUser.username}`;
  $('profile-link').append(link);
}
function addLink(link = {}) {
  if (linkCount >= 6) { notice('SNS 링크는 최대 6개입니다.', true); return; }
  const row = document.createElement('div'); row.className = 'link-row';
  row.innerHTML = `<label>이름<input data-label required maxlength="30" value="${escape(link.label)}" placeholder="Instagram / LinkedIn"></label><label>HTTPS 주소<input data-url type="url" required maxlength="500" value="${escape(link.url)}" placeholder="https://"></label><button type="button">삭제</button>`;
  row.querySelector('button').onclick = () => { row.remove(); linkCount--; };
  $('link-fields').append(row); linkCount++;
}
const date = (value) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
function profileCard(profile) {
  return `<article class="profile-card"><div class="avatar">${escape([...profile.name][0])}</div><h3>${escape(profile.name)}</h3><p>${escape(profile.bio)}</p>${profile.links.map((link) => `<a class="bio-link" href="${escape(link.url)}" rel="noopener noreferrer" target="_blank">${escape(link.label)} ↗</a>`).join('')}</article>`;
}
async function loadTeams() {
  const userId = currentUser?.id;
  const { teams } = await request('/api/teams');
  if (!currentUser || currentUser.id !== userId) return;
  $('team-list').innerHTML = teams.length ? teams.map((team) => `<button class="team-card" data-team="${team.id}">${escape(team.title)}<span>${date(team.starts_at)} (한국 시간) · ${team.closed || team.ends_at <= Date.now() ? '종료' : '팀'} · ${team.listed ? '공개 목록' : '초대 전용'}</span></button>`).join('') : '<p>아직 가입한 팀이 없습니다. 초대 링크 또는 공개 커피챗에서 참여하세요.</p>';
  if (selectedTeam && !teams.some((team) => team.id === selectedTeam)) { selectedTeam = null; $('team-detail').replaceChildren(); }
  for (const button of $('team-list').querySelectorAll('button')) button.onclick = task(() => openTeam(button.dataset.team));
}
async function openTeam(id) {
  const userId = currentUser?.id;
  selectedTeam = id;
  let result;
  try { result = await request(`/api/teams/${id}`); } catch (error) { $('team-detail').replaceChildren(); selectedTeam = null; throw error; }
  if (!currentUser || currentUser.id !== userId || selectedTeam !== id) return;
  const team = result.team;
  const host = team.host_id === currentUser.id;
  const ended = team.closed || team.ends_at <= Date.now();
  $('team-detail').innerHTML = `<h3>${escape(team.title)}</h3><p>${escape(team.place)} · ${date(team.starts_at)} ~ ${date(team.ends_at)} (한국 시간)</p><p>정원 ${team.count}/${team.capacity} · 비회원 대기 신청도 정원에 포함됩니다.</p><p>공개에 동의한 멤버만 표시합니다. 내 카드는 본인에게 표시됩니다. 종료·팀 닫기 후 상대방 프로필은 닫힙니다.</p><div class="features">${result.members.map(profileCard).join('')}</div><label class="check"><input id="team-share" type="checkbox" ${result.share ? 'checked' : ''}>호칭·소개·SNS 전체를 이 팀 멤버에게 공유 (선택)</label><button id="save-share">공유 설정 저장</button>${host ? `<form id="publication-form"><label class="check"><input name="listed" type="checkbox" ${team.listed ? 'checked' : ''}>이 팀을 공개 커피챗 목록에 게시 (선택)</label><label>공개 장소 안내<input name="publicPlace" maxlength="80" value="${escape(team.publicPlace)}"></label><button type="submit">공개 목록 설정 저장</button></form><button id="rotate-invite" ${ended ? 'disabled' : ''}>새 초대 링크 발급</button><button id="close-team" ${ended ? 'disabled' : ''}>모집·프로필 닫기</button><button id="delete-team">팀 영구 삭제</button>${ended ? '<p>종료된 팀에는 새 공지를 게시할 수 없습니다.</p>' : '<form id="announcement-form"><label>공지 제목<input name="title" maxlength="80" required></label><label>내용<textarea name="body" maxlength="2000" required></textarea></label><button type="submit">팀 인박스에 공지</button></form>'}<section id="guest-applications"><h4>비회원 신청 · 호스트만 열람</h4>${  (result.guestApplications || []).map((entry) => `<article><h5>${escape(entry.name || '종료된 신청')}</h5><p>${escape(entry.bio || '')}</p><p>${escape({ received: '접수 대기', confirmed: '참여 확정', rejected: '거절', withdrawn: '철회' }[entry.state])}</p>${entry.state === 'received' && !ended && team.starts_at > Date.now() ? `<button data-guest="${entry.id}" data-state="confirmed">확정</button><button data-guest="${entry.id}" data-state="rejected">거절</button>` : ''}</article>`).join('') || '<p>비회원 신청이 없습니다.</p>'}</section>` : '<button id="leave-team">팀 탈퇴</button>'}<p id="team-invite"></p>`;
  $('save-share').onclick = task(async () => { await request(`/api/teams/${id}/sharing`, 'PUT', { share: $('team-share').checked }); notice('팀 공개 설정을 저장했습니다.'); await openTeam(id); });
  if (host) {
    bindForm('publication-form', async (data) => { await request(`/api/teams/${id}/publication`, 'PUT', data); notice('공개 목록 설정을 저장했습니다.'); await openTeam(id); await loadTeams(); });
    for (const button of $('guest-applications').querySelectorAll('[data-guest]')) button.onclick = task(async () => {
      await request(`/api/teams/${id}/guest-applications/${button.dataset.guest}`, 'POST', { state: button.dataset.state });
      await openTeam(id); notice('비회원 신청 상태를 변경했습니다.');
    });
    $('rotate-invite').onclick = task(async () => { const result = await request(`/api/teams/${id}/rotate`, 'POST', {}); showInvite(result.invite); });
    $('close-team').onclick = task(async () => { if (!confirm('모집과 멤버 프로필 열람을 닫을까요?')) return; await request(`/api/teams/${id}/close`, 'POST', {}); await openTeam(id); await loadTeams(); });
    $('delete-team').onclick = task(async () => { if (!confirm('팀과 모든 공지를 영구 삭제할까요?')) return; await request(`/api/teams/${id}`, 'DELETE', {}); $('team-detail').replaceChildren(); await loadTeams(); await loadInbox(); });
    if ($('announcement-form')) bindForm('announcement-form', async (data) => { await request(`/api/teams/${id}/announcements`, 'POST', data); notice('팀 멤버 인박스에 공지를 등록했습니다.'); $('announcement-form').reset(); await loadInbox(); });
  } else $('leave-team').onclick = task(async () => { if (!confirm('팀에서 탈퇴할까요? 프로필과 공지 접근이 해제됩니다.')) return; await request(`/api/teams/${id}/leave`, 'POST', {}); $('team-detail').replaceChildren(); await loadTeams(); await loadInbox(); });
}
function showInvite(token) {
  const el = $('team-invite'); el.replaceChildren();
  const link = document.createElement('a'); link.href = `/invite/${token}`; link.textContent = `${location.origin}/invite/${token}`;
  el.append('현재 초대 링크입니다. 새로 발급한 경우 이전 링크는 무효입니다. DM에 공유하세요: ', link);
  const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = '초대 링크 복사';
  copy.onclick = task(async () => { await navigator.clipboard.writeText(link.href); notice('초대 링크를 복사했습니다.'); });
  el.append(copy);
}
async function loadInbox() {
  const userId = currentUser?.id;
  const { messages } = await request('/api/inbox');
  if (!currentUser || currentUser.id !== userId) return;
  $('inbox-list').innerHTML = messages.length ? messages.map((item) => `<article><span class="badge">${item.read_at ? '읽음' : '새 공지'}</span><h3>${escape(item.title)}</h3><p>${escape(item.team_title)} · ${date(item.created_at)}</p><p class="pre">${escape(item.body)}</p>${item.read_at ? '' : `<button data-read="${item.id}">읽음으로 표시</button>`}</article>`).join('') : '<p>현재 팀 공지가 없습니다.</p>';
  for (const button of $('inbox-list').querySelectorAll('button')) button.onclick = task(async () => { await request(`/api/inbox/${button.dataset.read}/read`, 'POST', {}); await loadInbox(); });
}
async function refreshService() {
  if (location.pathname !== '/service') return;
  service ||= mountService($('service-content'), { request, getUser: () => currentUser, openTeam: async (id) => { await loadTeams(); selectAccountTab('teams'); await openTeam(id); }, selectAccountTab, notice, updateHeader });
  const params = new URLSearchParams(location.search), tab = params.get('tab');
  await service.render(['home', 'coffees', 'cafes', 'profile', 'inbox', 'account'].includes(tab) ? tab : tab === 'teams' ? 'coffees' : 'home',
    chatId(params.get('chat')));
}
bindForm('login-form', async (data) => { await signedIn(await request('/api/login', 'POST', data)); await refreshService(); $('login-form').reset(); notice('로그인했습니다.'); });
bindForm('register-form', async (data) => { await signedIn(await request('/api/register', 'POST', data)); await refreshService(); notice('계정을 만들었습니다. 복구 코드를 보관하세요.'); $('register-form').reset(); });
bindForm('recover-form', async (data) => { await signedIn(await request('/api/recover', 'POST', data)); await refreshService(); notice('비밀번호를 변경했습니다. 이전 복구 코드는 무효입니다.'); $('recover-form').reset(); });
bindForm('password-form', async (data) => { await signedIn(await request('/api/password', 'POST', data)); notice('모든 기존 로그인 세션을 해제했습니다. 새 복구 코드를 보관하세요.'); $('password-form').reset(); });
bindForm('delete-form', async (data) => { await request('/api/account', 'DELETE', data); location.assign('/service'); });
bindForm('profile-form', async (data) => {
  data.profileVersion = currentUser.profileVersion || 0;
  data.links = [...$('link-fields').children].map((row) => ({ label: row.querySelector('[data-label]').value, url: row.querySelector('[data-url]').value }));
  const { profile } = await request('/api/profile', 'PUT', data);
  if (!currentUser || currentUser.id !== profile.id) { notice('인증이 변경되었습니다. 다시 로그인해서 프로필을 확인하세요.', true); return; }
  currentUser = { ...currentUser, ...profile }; profileLink(); notice('프로필을 저장했습니다.');
  if (selectedTeam) await openTeam(selectedTeam);
});
bindForm('team-form', async (data) => {
  data.startsAt = localDateTime(data.startsAt); data.endsAt = localDateTime(data.endsAt); data.capacity = Number(data.capacity);
  const result = await request('/api/teams', 'POST', data); await loadTeams(); await openTeam(result.team.id); showInvite(result.invite); $('team-form').reset(); notice('팀과 초대 링크를 만들었습니다.');
});
$('add-link').onclick = () => addLink();
$('logout').onclick = task(async () => { await request('/api/logout', 'POST', {}); location.assign('/service'); });
$('refresh-inbox').onclick = task(loadInbox);
$('refresh-teams').onclick = task(async () => { await loadTeams(); if (selectedTeam) await openTeam(selectedTeam); });
$('reload-profile').onclick = task(async () => {
  if (!confirm('저장하지 않은 입력을 버리고 저장된 프로필을 다시 불러올까요?')) return;
  const result = await request('/api/me');
  if (!result.user) { clearAccount(); return; }
  currentUser = result.user; csrf = result.csrf; renderProfile(); notice('저장된 프로필을 불러왔습니다.');
});
$('hide-recovery').onclick = () => { $('recovery-code').textContent = ''; $('recovery-result').hidden = true; };

async function start() {
  updateHeader();
  if (['/', '/host', '/guest'].includes(location.pathname)) {
    const role = location.pathname === '/host' ? 'host' : 'guest';
    $('status').hidden = true;
    $('service-cta').href = `/service?perspective=${role}&tab=${role === 'host' ? 'coffees' : 'home'}`;
    document.querySelector(`.perspectives a[href="/${role}"]`).setAttribute('aria-current', 'page');
    mountPreview($('preview'), role);
    return;
  }
  const perspective = new URLSearchParams(location.search).get('perspective');
  if (perspective === 'host') $('register-form').elements.role.value = 'host';
  $('auth').hidden = location.pathname !== '/login' && !location.pathname.startsWith('/invite/');
  const status = await request('/api/status'); storage = status.storage; registration = status.registration;
  if (!storage) {
    for (const input of document.querySelectorAll('form input,form textarea,form select,form button')) input.disabled = true;
    $('status').hidden = false;
    $('status').textContent = '지금은 신청과 계정 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.';
    if (location.pathname === '/service') await refreshService();
    return;
  }
  if (!status.registration) for (const control of $('register-form').querySelectorAll('input,select,button')) control.disabled = true;
  if (!registration) { $('status').hidden = false; $('status').textContent = '새 계정 가입과 비회원 신청이 일시 중단되었습니다.'; }
  await signedIn(await request('/api/me'));
  if (location.pathname === '/service') await refreshService();
  if (location.pathname === '/application') await manageApplication($('service-content'), request, notice);
  if (location.pathname.startsWith('/p/')) {
    const result = await request(`/api/profiles/${location.pathname.split('/')[2]}`);
    $('public-profile').hidden = false; $('public-profile').innerHTML = profileCard(result.profile);
  }
  await renderInvite();
}
async function renderInvite() {
  if (location.pathname.startsWith('/invite/')) {
    const token = location.pathname.split('/')[2], { invite } = await request(`/api/invites/${token}`);
    $('invite').hidden = false;
    $('invite').innerHTML = `<h2>${escape(invite.title)}</h2><p>${date(invite.startsAt)} (한국 시간) · 정원 ${invite.count}/${invite.capacity}</p><p>장소와 멤버 정보는 회원 참여 후 확인합니다. 링크는 전달될 수 있습니다. 참여 시 팀 소속이 저장됩니다.</p>${invite.joined ? '<button id="open-joined-team" type="button">이미 참여 중 · 내 팀 열기</button>' : invite.available ? `${currentUser ? '<form id="join-form"><label class="check"><input name="disclosure" type="checkbox" required>팀 소속 저장·팀 공지 수신·보관/탈퇴 안내 확인 (필수)</label><label class="check"><input name="share" type="checkbox">호칭·소개·SNS 전체를 이 팀 멤버에게 공유 (선택)</label><button type="submit">내 계정으로 팀 참여</button></form>' : '<p>로그인하고 신청하려면 아래 로그인 양식을 사용하세요.</p>'}<button id="invite-guest" type="button">비회원으로 신청</button><div id="invite-guest-form"></div>` : `<p>${invite.closed ? '모집이 종료되었습니다.' : '정원이 찼습니다.'}</p>`}`;
    if ($('invite-guest')) $('invite-guest').onclick = () => guestForm($('invite-guest-form'), { teamId: invite.id, invite: token, request, notice });
    if ($('open-joined-team')) $('open-joined-team').onclick = task(async () => { selectAccountTab('teams'); await openTeam(invite.id); });
    if ($('join-form')) bindForm('join-form', async (data) => {
      const result = await request('/api/join', 'POST', { ...data, invite: token });
      await loadTeams(); await openTeam(result.teamId);
      selectAccountTab('teams');
      $('invite').innerHTML = '<p>팀에 참여했습니다. 내 팀에서 확인하세요.</p>';
      notice('팀에 참여했습니다.');
    });
  }
}
start().catch((error) => { notice(error.message, true); for (const control of document.querySelectorAll('form input,form button')) control.disabled = true; });
