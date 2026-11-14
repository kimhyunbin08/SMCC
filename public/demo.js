const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function createDemo(role) {
  if (!['host', 'guest'].includes(role)) throw new Error('Unknown preview perspective');
  return {
    role, name: '아침 산책가 (가상)', bio: '커피와 새로운 이야기를 좋아해요.',
    team: '토요일 아침 커피 (가상)', place: '샘플 카페 · 가상 장소', created: false,
    joined: false, share: false, announcement: '내일 아침 8시에 만나요. 가상 공지입니다.', read: false,
  };
}

export function previewHtml(state) {
  const host = state.role === 'host';
  const cta = (tab, label) => `<a class="action-link" href="/service?perspective=${state.role}&tab=${tab}">서비스로 이동하기 · ${label}</a>`;
  const profile = `<article class="profile-card"><div class="avatar">아</div><h3>${escape(state.name)}</h3><p>${escape(state.bio)}</p><span class="bio-link">Instagram · 가상 SNS 링크</span><span class="bio-link">LinkedIn · URL 직접 등록 예시</span></article>`;
  return `<p class="notice"><strong>로그인 없이 보는 ${host ? '호스트' : '게스트'} 체험</strong><br>모든 인물·팀·공지는 가상 예시입니다. 이 화면의 입력과 변경은 서버에 전송·저장되지 않고 새로고침하면 사라집니다. 실제 개인정보를 입력하지 마세요.</p>
    <h2>${host ? '내 모임을 만들고, 초대하고, 공지해요.' : '나를 소개하고, 함께할 사람들을 만나요.'}</h2>
    <p>${host ? '호스트 화면이라고 가정해 기존 기능을 체험합니다. 링크만으로 실제 호스트 권한을 얻지는 않습니다.' : '소개부터 팀 참여, 멤버 확인, 공지 읽기까지 먼저 둘러보세요.'}</p>
    ${host ? `<section class="panel"><h3>1. 팀 만들기</h3><form id="demo-team-form"><label>팀 이름<input name="title" maxlength="80" required value="${escape(state.team)}"></label><label>장소<input name="place" maxlength="160" required value="${escape(state.place)}"></label><p>예시 일정: 토요일 08:00~09:00 · 정원 8명 (호스트 포함)</p><button type="submit">가상 팀 만들어보기</button></form><div id="demo-team-result" ${state.created ? '' : 'hidden'}><p>${escape(state.team)} · ${escape(state.place)}<br>가상 팀과 초대 예시를 만들었습니다. 실제 모집은 시작되지 않습니다.</p><h3>2. 초대 링크</h3><a href="/guest">게스트가 보는 초대·참여 화면 보기</a><p>실제 팀은 로그인 후 고유 초대 링크를 만들어 DM으로 공유합니다.</p></div>${cta('teams', '내 계정으로 실제 팀 만들기')}</section>
    <section class="panel"><h3>3. 팀 공지 → 멤버 인박스</h3><form id="demo-announcement-form"><label>가상 공지 내용<textarea name="body" required maxlength="2000">${escape(state.announcement)}</textarea></label><button type="submit">가상 공지 보내보기</button></form><article><span class="badge">가상 멤버 인박스</span><p id="demo-announcement">${escape(state.announcement)}</p></article>${cta('teams', '로그인하고 실제 팀에 공지하기')}</section>`
      : `<section class="panel"><h3>1. 내 링크 프로필</h3><form id="demo-profile-form"><label>가상 호칭<input name="name" required maxlength="40" value="${escape(state.name)}"></label><label>가상 소개<textarea name="bio" maxlength="200">${escape(state.bio)}</textarea></label><button type="submit">가상 프로필 바꿔보기</button></form><div id="demo-profile">${profile}</div><p>실제 프로필에는 SNS 주소 최대 6개를 등록합니다. 인터넷 공개와 팀 공유는 각각 선택이며 기본 비공개입니다. LinkedIn 자동 가져오기·AI는 미설정입니다.</p>${cta('profile', '내 프로필을 저장하려면 로그인')}</section>
      <section class="panel"><h3>2. 초대받은 팀에 참여</h3><p>${escape(state.team)} · 토요일 08:00~09:00 · 가상 정원 3/8</p><p>실제 초대에서는 가입 전 상세 장소·타인 프로필이 보이지 않습니다.</p><form id="demo-join-form"><label class="check"><input name="share" type="checkbox" ${state.share ? 'checked' : ''}>가상 프로필을 이 샘플 팀에 공유해보기 (선택)</label><button type="submit">${state.joined ? '가상 공유 선택 바꾸기' : '가상 팀 참여해보기'}</button></form><div id="demo-members" ${state.joined ? '' : 'hidden'}><p>가상 참여 상태 · ${escape(state.place)}</p><h3>3. 공유에 동의한 가상 멤버</h3><div class="demo-grid"><article><h4>커피 호스트 (가상)</h4><p>다양한 아침 이야기를 나눠요.</p></article><article><h4>독서 친구 (가상)</h4><p>책과 일상에 대해 대화하고 싶어요.</p></article>${state.share ? profile : '<p>내 가상 프로필은 공유 OFF입니다. 공유하지 않아도 참여와 공지 확인은 가능합니다.</p>'}</div><p>공유 미동의자의 카드·실제 회원 데이터는 이 체험에 표시하지 않습니다.</p></div>${cta('teams', '로그인 후 실제 초대 링크로 참여')}</section>
      <section class="panel"><h3>4. 팀 공지 인박스</h3><article><span class="badge" id="demo-read-state">${state.read ? '읽음 · 가상' : '새 공지 · 가상'}</span><h4>내일 아침 안내 (가상)</h4><p>${escape(state.announcement)}</p><button id="demo-read" type="button">${state.read ? '가상 읽음 표시 취소' : '가상 공지 읽음으로 표시'}</button></article><p>실제 인박스는 현재 소속 팀 공지만 보여주고 내 읽음 상태를 저장합니다.</p>${cta('inbox', '내 인박스를 이용하려면 로그인')}</section>`}
    <p id="demo-message" role="status" aria-live="polite" tabindex="-1"></p><button id="demo-reset" type="button">체험 초기화</button>`;
}

export function mountPreview(element, role) {
  let state = createDemo(role);
  function render(message = '') {
    element.innerHTML = previewHtml(state);
    element.hidden = false;
    const find = (id) => element.querySelector(`#${id}`);
    find('demo-message').textContent = message;
    if (message) find('demo-message').focus();
    function bind(id, action) {
      const form = find(id);
      if (form) form.onsubmit = (event) => {
        event.preventDefault();
        action(new FormData(form));
        render('가상 체험 화면만 변경했습니다. 실제 데이터는 저장되지 않았습니다.');
      };
    }
    bind('demo-team-form', (data) => { state.team = data.get('title').trim(); state.place = data.get('place').trim(); state.created = true; });
    bind('demo-announcement-form', (data) => { state.announcement = data.get('body').trim(); });
    bind('demo-profile-form', (data) => { state.name = data.get('name').trim(); state.bio = data.get('bio').trim(); });
    bind('demo-join-form', (data) => { state.joined = true; state.share = data.get('share') === 'on'; });
    if (find('demo-read')) find('demo-read').onclick = () => { state.read = !state.read; render('가상 공지 읽음 상태를 변경했습니다.'); };
    find('demo-reset').onclick = () => { state = createDemo(role); render('체험을 초기화했습니다.'); };
  }
  render();
}
