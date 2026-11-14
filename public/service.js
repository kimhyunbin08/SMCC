const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = (value) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
const states = { received: '신청 접수 · 호스트 확인 대기', confirmed: '호스트가 참여 확정', rejected: '호스트가 신청 거절', withdrawn: '신청 철회' };
const receiptToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

export function guestForm(element, options) {
  const { teamId, invite, request, notice } = options;
  const token = receiptToken();
  element.innerHTML = `<h3>비회원 신청</h3><p>계정을 만들지 않습니다. 호칭·소개는 해당 호스트만 확인하며 신청 접수는 참여 확정이 아닙니다. 회원 프로필·상세 장소·인박스 접근권은 생기지 않습니다.</p><form id="guest-application-form"><label>호칭 (별칭 권장)<input name="name" required maxlength="40"></label><label>소개 (선택)<textarea name="bio" maxlength="200"></textarea></label><label class="check"><input name="consent" type="checkbox" required>호스트에게 호칭·소개·신청 상태 전달, 모임 종료 후 30일 보관, 관리 링크로 철회에 동의 (필수, <a href="/privacy" target="_blank" rel="noopener">개인정보 안내</a>)</label><label class="check"><input name="age" type="checkbox" required>만 14세 이상 확인 (필수)</label><p>관리 링크를 분실하면 자동으로 본인 신청을 찾을 수 없습니다. 이메일·전화번호를 수집하거나 인증 메일을 보내지 않습니다.</p><button type="submit">비회원 신청 접수</button></form><p id="guest-result" role="status"></p>`;
  const form = element.querySelector('form');
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('button'); if (button.disabled) return;
    button.disabled = true;
    try {
      const data = new FormData(form);
      const result = await request('/api/guest/applications', 'POST', { teamId, invite, receiptToken: token,
        name: data.get('name'), bio: data.get('bio'), consent: data.get('consent') === 'on', age: data.get('age') === 'on' });
      const url = `${location.origin}/application?team=${teamId}#${token}`;
      const target = element.querySelector('#guest-result'); target.replaceChildren();
      const link = document.createElement('a'); link.href = url; link.textContent = '내 신청 확인·철회 관리 링크'; link.className = 'action-link';
      target.append(`${states[result.state]}입니다. 이 링크를 본인만 안전하게 보관하세요. 다른 사람과 공유하지 마세요. `, link);
      form.hidden = true;
      notice('비회원 신청을 접수했습니다. 참여 확정과 다릅니다. 관리 링크를 보관하세요.');
    } catch (error) { notice(error.message, true); button.disabled = false; }
  };
}

export async function manageApplication(element, request, notice) {
  const teamId = new URLSearchParams(location.search).get('team'), token = location.hash.slice(1);
  if (!/^[a-f0-9-]{36}$/.test(teamId || '') || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('보관한 신청 관리 링크를 확인하세요.');
  const { application } = await request('/api/guest/status', 'POST', { teamId, receiptToken: token });
  element.hidden = false;
  element.innerHTML = `<section class="panel"><h2>내 비회원 신청</h2><p>${escape(application.title)} · ${date(application.startsAt)}</p><p>공개 장소 안내: ${escape(application.publicPlace || '초대 모임 · 호스트 안내를 확인하세요.')}</p><p id="guest-state" role="status">${states[application.state]}</p><p>이 링크로 본인 신청 상태만 확인할 수 있습니다. 상세 장소·타인 프로필·팀 인박스는 제공하지 않습니다. 문의는 기존 호스트 안내 채널을 이용하세요.</p>${['received', 'confirmed'].includes(application.state) ? '<button id="withdraw-application" type="button">내 비회원 신청 철회</button>' : ''}</section>`;
  const button = element.querySelector('#withdraw-application');
  if (button) button.onclick = async () => {
    if (!confirm('비회원 신청을 철회하고 호칭·소개를 삭제할까요?')) return;
    button.disabled = true;
    try { await request('/api/guest/withdraw', 'POST', { teamId, receiptToken: token }); await manageApplication(element, request, notice); notice('신청을 철회했습니다.'); }
    catch (error) { notice(error.message, true); button.disabled = false; }
  };
}

export function mountService(element, options) {
  const { request, getUser, openTeam, selectAccountTab, notice, updateHeader } = options;
  let renderVersion = 0;
  async function render(tab = 'home', chat) {
    const version = ++renderVersion, user = getUser();
    updateHeader();
    document.getElementById('service-tabs').hidden = false;
    element.hidden = false;
    for (const link of document.querySelectorAll('[data-service-tab]')) {
      if (link.dataset.serviceTab === tab) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
    const login = `/login?tab=${tab}${chat ? `&chat=${chat}` : ''}`;
    if (tab === 'profile') {
      element.innerHTML = user ? '' : `<section class="panel"><h2>프로필</h2><p>로그인해서 내 소개와 SNS 링크를 관리하세요.</p><a class="action-link" href="${login}">로그인하고 내 프로필 만들기</a></section>`;
      selectAccountTab(user ? 'profile' : null); return;
    }
    if (['inbox', 'account'].includes(tab)) {
      element.innerHTML = user ? '' : `<a class="action-link" href="${login}">로그인하고 이용하기</a>`;
      selectAccountTab(user ? tab : null); return;
    }
    selectAccountTab(user && tab === 'coffees' ? 'teams' : null);
    if (tab === 'home') {
      element.innerHTML = `<section class="panel"><h2>홈</h2><div class="service-shortcuts"><a class="action-link" href="/service?tab=coffees">커피챗 둘러보기</a><a class="action-link" href="/service?tab=cafes">카페 보기</a>${user ? `<a class="action-link" href="/service?tab=profile">내 프로필</a><a class="action-link" href="/service?tab=inbox">팀 공지 확인</a>` : `<a class="action-link" href="/login?tab=profile">로그인</a>`}</div></section>`; return;
    }
    element.innerHTML = '<p role="status">공개 정보를 불러오는 중입니다.</p>';
    try {
      const { teams } = await request('/api/public/teams');
      if (version !== renderVersion) return;
      if (tab === 'cafes') {
        const places = [...new Set(teams.map((row) => row.publicPlace).filter(Boolean))];
        element.innerHTML = `<section class="panel"><h2>카페·공개 장소 안내</h2>        <p>커피챗 호스트가 안내한 모임 장소입니다.</p>${places.length ? places.map((place) => `<article><h3>${escape(place)}</h3><span class="badge">호스트 제공 안내</span></article>`).join('') : '<p>아직 호스트가 공개한 카페·장소 안내가 없습니다.</p>'}</section>`; return;
      }
      element.innerHTML = `<section class="panel"><h2>공개 커피챗</h2>${teams.length ? teams.map((row) => `<article><h3>${escape(row.title)}</h3><p>${date(row.startsAt)} (한국 시간) · ${escape(row.publicPlace)}</p><p>정원 ${row.count}/${row.capacity} (비회원 대기 신청 포함)</p><button type="button" data-chat="${row.id}">커피챗 안내·신청 보기</button></article>`).join('') : '<p>현재 공개 모집 중인 커피챗이 없습니다. 초대 전용 모임은 받은 초대 링크로 확인하세요.</p>'}<div id="public-chat-detail"></div></section>`;
      for (const button of element.querySelectorAll('[data-chat]')) button.onclick = () => chooseChat(button.dataset.chat).catch((error) => notice(error.message, true));
      if (chat) await chooseChat(chat);
    } catch (error) { if (version === renderVersion) element.innerHTML = '<p class="error">공개 정보를 불러오지 못했습니다. 새로고침 후 다시 확인하세요.</p>'; notice(error.message, true); }
  }
  async function chooseChat(id) {
    const { team } = await request(`/api/public/teams/${id}`);
    history.replaceState(null, '', `/service?tab=coffees&chat=${id}`);
    updateHeader();
    const target = element.querySelector('#public-chat-detail');
    if (!target) return;
    target.innerHTML = `<h3>${escape(team.title)}</h3><p>${date(team.startsAt)} ~ ${date(team.endsAt)} · ${escape(team.publicPlace)}</p><p>정원 ${team.count}/${team.capacity} · 신청 접수와 참석 확정은 구분됩니다.</p>${team.available ? `<div class="tabs"><button id="choose-guest" type="button">비회원으로 신청</button><button id="choose-login" type="button">${getUser() ? '내 계정으로 참여' : '로그인하고 신청'}</button></div>` : '<p>모집이 종료되었거나 정원이 찼습니다.</p>'}<div id="application-choice"></div>`;
    const choice = target.querySelector('#application-choice');
    if (team.available) {
      target.querySelector('#choose-guest').onclick = () => guestForm(choice, { teamId: id, request, notice });
      target.querySelector('#choose-login').onclick = () => {
        if (!getUser()) { location.assign(`/login?tab=coffees&chat=${id}`); return; }
        choice.innerHTML = '<form id="member-public-join"><label class="check"><input name="disclosure" type="checkbox" required>팀 소속 저장·공지 수신·보관/탈퇴 고지 확인 (필수)</label><label class="check"><input name="share" type="checkbox">내 프로필 전체를 팀에 공유 (선택)</label><p>회원 경로는 정원 내 직접 참여로 확정됩니다. 다른 사람 공개와 참석 보장은 별개입니다.</p><button type="submit">내 계정으로 팀 참여</button></form>';
        const form = choice.querySelector('form');
        form.onsubmit = async (event) => {
          event.preventDefault(); const button = form.querySelector('button'); if (button.disabled) return; button.disabled = true;
          try {
            const data = new FormData(form);
            const result = await request(`/api/public/teams/${id}/join`, 'POST', { disclosure: data.get('disclosure') === 'on', share: data.get('share') === 'on' });
            await openTeam(result.teamId); notice('회원 계정으로 팀에 참여했습니다.');
            choice.innerHTML = '<p>팀 참여 완료. 아래 내 팀에서 확인하세요.</p>';
          } catch (error) { notice(error.message, true); button.disabled = false; }
        };
      };
    }
    target.scrollIntoView({ block: 'nearest' });
  }
  for (const link of document.querySelectorAll('[data-service-tab]')) link.onclick = (event) => {
    event.preventDefault();
    const tab = link.dataset.serviceTab;
    history.pushState(null, '', `/service?tab=${tab}`);
    render(tab).catch((error) => notice(error.message, true));
  };
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(location.search);
    render(params.get('tab') || 'home', params.get('chat') || undefined).catch((error) => notice(error.message, true));
  });
  return { render };
}
