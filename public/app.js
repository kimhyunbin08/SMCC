const $ = (id) => document.getElementById(id);
let csrf = '', currentUser = null, selectedTeam = null, linkCount = 0, storage = false;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function notice(value, error = false) { $('message').textContent = value; $('message').className = error ? 'error' : 'success'; }
async function request(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 처리할 수 없습니다.');
  return result;
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
    button.disabled = true;
    try { await action(values(event.target)); } catch (error) { notice(error.message, true); }
    finally { button.disabled = !storage; }
  });
}
function task(action) { return async () => { try { await action(); } catch (error) { notice(error.message, true); } }; }
function showRecovery(code) { if (code) { $('recovery-code').textContent = code; $('recovery-result').hidden = false; } }
async function signedIn(result) {
  currentUser = result.user; csrf = result.csrf || '';
  $('auth').hidden = Boolean(currentUser); $('dashboard').hidden = !currentUser;
  if (!currentUser) return;
  $('welcome').textContent = `${currentUser.name}님 · ${currentUser.role === 'host' ? '호스트' : '참가자'}`;
  $('host-create').hidden = currentUser.role !== 'host';
  const form = $('profile-form');
  form.elements.name.value = currentUser.name; form.elements.bio.value = currentUser.bio;
  form.elements.public.checked = currentUser.public;
  $('link-fields').replaceChildren(); linkCount = 0;
  for (const link of currentUser.links) addLink(link);
  showRecovery(result.recoveryCode);
  await loadTeams();
  await loadInbox();
  profileLink();
  await renderInvite();
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
const date = (value) => new Date(value).toLocaleString('ko-KR');
function profileCard(profile) {
  return `<article class="profile-card"><div class="avatar">${escape([...profile.name][0])}</div><h3>${escape(profile.name)}</h3><p>${escape(profile.bio)}</p>${profile.links.map((link) => `<a class="bio-link" href="${escape(link.url)}" rel="noopener noreferrer" target="_blank">${escape(link.label)} ↗</a>`).join('')}</article>`;
}
async function loadTeams() {
  const { teams } = await request('/api/teams');
  $('team-list').innerHTML = teams.length ? teams.map((team) => `<button class="team-card" data-team="${team.id}">${escape(team.title)}<span>${date(team.starts_at)} · ${team.closed ? '닫힘' : '팀'}</span></button>`).join('') : '<p>아직 가입한 팀이 없습니다. 초대 링크로 참여하세요.</p>';
  for (const button of $('team-list').querySelectorAll('button')) button.onclick = task(() => openTeam(button.dataset.team));
}
async function openTeam(id) {
  selectedTeam = id;
  const result = await request(`/api/teams/${id}`), team = result.team;
  const host = team.host_id === currentUser.id;
  $('team-detail').innerHTML = `<h3>${escape(team.title)}</h3><p>${escape(team.place)} · ${date(team.starts_at)} ~ ${date(team.ends_at)}</p><p>공개에 동의한 멤버만 표시합니다. 내 카드는 본인에게 표시됩니다. 종료·팀 닫기 후 상대방 프로필은 닫힙니다.</p><div class="features">${result.members.map(profileCard).join('')}</div><label class="check"><input id="team-share" type="checkbox" ${result.share ? 'checked' : ''}>호칭·소개·SNS 전체를 이 팀 멤버에게 공유 (선택)</label><button id="save-share">공유 설정 저장</button>${host ? '<button id="rotate-invite">새 초대 링크 발급</button><button id="close-team">모집·프로필 닫기</button><button id="delete-team">팀 영구 삭제</button><form id="announcement-form"><label>공지 제목<input name="title" maxlength="80" required></label><label>내용<textarea name="body" maxlength="2000" required></textarea></label><button type="submit">팀 인박스에 공지</button></form>' : '<button id="leave-team">팀 탈퇴</button>'}<p id="team-invite"></p>`;
  $('save-share').onclick = task(async () => { await request(`/api/teams/${id}/sharing`, 'PUT', { share: $('team-share').checked }); notice('팀 공개 설정을 저장했습니다.'); await openTeam(id); });
  if (host) {
    $('rotate-invite').onclick = task(async () => { const result = await request(`/api/teams/${id}/rotate`, 'POST', {}); showInvite(result.invite); });
    $('close-team').onclick = task(async () => { if (!confirm('모집과 멤버 프로필 열람을 닫을까요?')) return; await request(`/api/teams/${id}/close`, 'POST', {}); await openTeam(id); await loadTeams(); });
    $('delete-team').onclick = task(async () => { if (!confirm('팀과 모든 공지를 영구 삭제할까요?')) return; await request(`/api/teams/${id}`, 'DELETE', {}); $('team-detail').replaceChildren(); await loadTeams(); await loadInbox(); });
    bindForm('announcement-form', async (data) => { await request(`/api/teams/${id}/announcements`, 'POST', data); notice('팀 멤버 인박스에 공지를 등록했습니다.'); $('announcement-form').reset(); await loadInbox(); });
  } else $('leave-team').onclick = task(async () => { if (!confirm('팀에서 탈퇴할까요? 프로필과 공지 접근이 해제됩니다.')) return; await request(`/api/teams/${id}/leave`, 'POST', {}); $('team-detail').replaceChildren(); await loadTeams(); await loadInbox(); });
}
function showInvite(token) {
  const el = $('team-invite'); el.replaceChildren();
  const link = document.createElement('a'); link.href = `/invite/${token}`; link.textContent = `${location.origin}/invite/${token}`;
  el.append('이전 초대 링크는 무효입니다. 새 링크를 DM에 공유하세요: ', link);
}
async function loadInbox() {
  const { messages } = await request('/api/inbox');
  $('inbox-list').innerHTML = messages.length ? messages.map((item) => `<article><span class="badge">${item.read_at ? '읽음' : '새 공지'}</span><h3>${escape(item.title)}</h3><p>${escape(item.team_title)} · ${date(item.created_at)}</p><p class="pre">${escape(item.body)}</p>${item.read_at ? '' : `<button data-read="${item.id}">읽음으로 표시</button>`}</article>`).join('') : '<p>현재 팀 공지가 없습니다.</p>';
  for (const button of $('inbox-list').querySelectorAll('button')) button.onclick = task(async () => { await request(`/api/inbox/${button.dataset.read}/read`, 'POST', {}); await loadInbox(); });
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => {
  for (const section of document.querySelectorAll('[id^=tab-]')) section.hidden = section.id !== `tab-${button.dataset.tab}`;
};
bindForm('login-form', async (data) => { await signedIn(await request('/api/login', 'POST', data)); notice('로그인했습니다.'); });
bindForm('register-form', async (data) => { await signedIn(await request('/api/register', 'POST', data)); notice('계정을 만들었습니다. 복구 코드를 보관하세요.'); $('register-form').reset(); });
bindForm('recover-form', async (data) => { await signedIn(await request('/api/recover', 'POST', data)); notice('비밀번호를 변경했습니다. 이전 복구 코드는 무효입니다.'); $('recover-form').reset(); });
bindForm('password-form', async (data) => { await signedIn(await request('/api/password', 'POST', data)); notice('모든 기존 로그인 세션을 해제했습니다. 새 복구 코드를 보관하세요.'); $('password-form').reset(); });
bindForm('delete-form', async (data) => { await request('/api/account', 'DELETE', data); location.assign('/'); });
bindForm('profile-form', async (data) => {
  data.links = [...$('link-fields').children].map((row) => ({ label: row.querySelector('[data-label]').value, url: row.querySelector('[data-url]').value }));
  const { profile } = await request('/api/profile', 'PUT', data); currentUser = { ...currentUser, ...profile }; profileLink(); notice('프로필을 저장했습니다.');
});
bindForm('team-form', async (data) => {
  data.startsAt = new Date(data.startsAt).toISOString(); data.endsAt = new Date(data.endsAt).toISOString(); data.capacity = Number(data.capacity);
  const result = await request('/api/teams', 'POST', data); await loadTeams(); await openTeam(result.team.id); showInvite(result.invite); notice('팀과 초대 링크를 만들었습니다.');
});
$('add-link').onclick = () => addLink();
$('logout').onclick = task(async () => { await request('/api/logout', 'POST', {}); location.assign('/'); });
$('refresh-inbox').onclick = task(loadInbox);
$('hide-recovery').onclick = () => { $('recovery-code').textContent = ''; $('recovery-result').hidden = true; };

async function start() {
  const status = await request('/api/status'); storage = status.storage; $('status').textContent = status.message;
  if (!storage) {
    for (const input of document.querySelectorAll('form input,form textarea,form select,form button')) input.disabled = true;
    $('status').append(' 개인정보·비밀번호를 이 미리보기에 입력하지 마세요.');
    return;
  }
  if (!status.registration) for (const control of $('register-form').querySelectorAll('input,select,button')) control.disabled = true;
  await signedIn(await request('/api/me'));
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
    $('invite').innerHTML = `<h2>${escape(invite.title)}</h2><p>${date(invite.startsAt)} · 정원 ${invite.count}/${invite.capacity}</p><p>장소와 멤버 정보는 가입 후 확인합니다. 링크는 전달될 수 있습니다. 참여 시 팀 소속이 저장됩니다.</p>${currentUser && invite.available ? '<form id="join-form"><label class="check"><input name="disclosure" type="checkbox" required>팀 소속 저장·팀 공지 수신·보관/탈퇴 안내 확인 (필수)</label><label class="check"><input name="share" type="checkbox">호칭·소개·SNS 전체를 이 팀 멤버에게 공유 (선택)</label><button type="submit">팀 참여</button></form>' : `<p>${invite.available ? '로그인 후 이 페이지에서 참여하세요.' : '모집이 종료되었습니다.'}</p>`}`;
    if ($('join-form')) bindForm('join-form', async (data) => {
      const result = await request('/api/join', 'POST', { ...data, invite: token });
      await loadTeams(); await openTeam(result.teamId);
      for (const section of document.querySelectorAll('[id^=tab-]')) section.hidden = section.id !== 'tab-teams';
      $('invite').innerHTML = '<p>팀에 참여했습니다. 내 팀에서 확인하세요.</p>';
      notice('팀에 참여했습니다.');
    });
  }
}
start().catch((error) => { $('status').textContent = '서비스 상태 확인에 실패했습니다. 개인정보를 입력하지 마세요.'; notice(error.message, true); for (const control of document.querySelectorAll('form input,form button')) control.disabled = true; });
