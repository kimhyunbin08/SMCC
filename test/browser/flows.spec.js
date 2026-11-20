import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('mobile public demos stay synthetic; service navigation works without login', async ({ page }) => {
  const apiCalls = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/')) apiCalls.push(request.url()); });
  await page.goto('/host');
  await expect(page.getByRole('heading', { name: '호스트 미리보기' })).toBeVisible();
  await expect(page.locator('.hero')).toHaveCount(0);
  await expect(page.locator('header a[href="/host"], header a[href="/guest"]')).toHaveCount(0);
  await expect(page.locator('header #service-cta')).toBeVisible();
  await page.locator('#demo-team-form [name=title]').fill('가상 호스트 체험');
  await page.getByRole('button', { name: '가상 팀 만들어보기' }).click();
  await expect(page.locator('#demo-team-result')).toBeVisible();
  await page.locator('#demo-announcement-form [name=body]').fill('<b>가상 공지</b>');
  await page.getByRole('button', { name: '가상 공지 보내보기' }).click();
  await expect(page.locator('#demo-announcement')).toHaveText('<b>가상 공지</b>');
  await page.getByRole('navigation', { name: '호스트·게스트 둘러보기' }).getByRole('link', { name: '게스트', exact: true }).click();
  await page.locator('#demo-profile-form [name=name]').fill('가상 게스트 체험');
  await page.getByRole('button', { name: '가상 프로필 바꿔보기' }).click();
  await expect(page.locator('#demo-profile')).toContainText('가상 게스트 체험');
  await page.getByRole('button', { name: '가상 팀 참여해보기' }).click();
  await expect(page.locator('#demo-members')).toBeVisible();
  await page.getByRole('button', { name: '가상 공지 읽음으로 표시' }).click();
  await expect(page.locator('#demo-read-state')).toHaveText('읽음 · 가상');
  await page.getByRole('button', { name: '체험 초기화' }).click();
  await expect(page.locator('#demo-members')).toBeHidden();
  expect(apiCalls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#service-cta').click();
  await expect(page).toHaveURL(/\/service/);
  await expect(page.locator('#auth')).toBeHidden();
  await expect(page.locator('header #service-tabs')).toBeVisible();
  await expect(page.locator('#preview-tabs')).toBeHidden();
  await expect(page.locator('#preview-perspectives')).toBeHidden();
  await expect(page.locator('#service-cta')).toBeHidden();
  await expect(page.locator('#brand')).toHaveAttribute('href', '/service');
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('body')).not.toContainText('개인 프로젝트');
  await expect(page.locator('body')).not.toContainText('프로토타입');
  await expect(page.locator('body')).not.toContainText('좋은 아침, 새로운 대화.');
  await expect(page.locator('body')).not.toContainText('Azure');
  await page.locator('[data-service-tab=coffees]').click();
  await expect(page.getByRole('heading', { name: '공개 커피챗', exact: true })).toBeVisible();
  await expect(page.locator('[data-service-tab=coffees]')).toHaveAttribute('aria-current', 'page');
  await page.locator('[data-service-tab=cafes]').click();
  await expect(page.getByRole('heading', { name: '카페·공개 장소 안내' })).toBeVisible();
  await page.locator('[data-service-tab=profile]').click();
  await expect(page.getByRole('link', { name: '로그인하고 내 프로필 만들기' })).toBeVisible();
  await expect(page.locator('#header-login')).toHaveAttribute('href', '/login?tab=profile');
  await page.goBack();
  await expect(page.locator('[data-service-tab=cafes]')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: '카페·공개 장소 안내' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#preview-tabs')).toBeHidden();
  await page.locator('#brand').click();
  await expect(page).toHaveURL(/\/service$/);
  await expect(page.getByRole('heading', { name: '홈', exact: true })).toBeVisible();
});

test('history navigation never interpolates untrusted chat query into login markup', async ({ page }) => {
  const injected = '"><img id="injected-chat" src=x onerror="document.body.dataset.injected=1"><a x="';
  const query = new URLSearchParams({ tab: 'profile', chat: injected });
  await page.goto(`/service?${query}`);
  await expect(page.getByRole('link', { name: '로그인하고 내 프로필 만들기' })).toHaveAttribute('href', '/login?tab=profile');
  await page.locator('[data-service-tab=cafes]').click();
  await page.goBack();
  await expect(page.getByRole('link', { name: '로그인하고 내 프로필 만들기' })).toHaveAttribute('href', '/login?tab=profile');
  await expect(page.locator('#injected-chat')).toHaveCount(0);
  await expect(page.locator('[onerror]')).toHaveCount(0);
  await expect(page.locator('#service-content')).not.toContainText(injected);
  await page.evaluate((chat) => {
    history.pushState(null, '', `/service?${new URLSearchParams({ tab: 'account', chat })}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, injected);
  await expect(page.getByRole('link', { name: '로그인하고 이용하기' })).toHaveAttribute('href', '/login?tab=account');
  await expect(page.locator('#injected-chat')).toHaveCount(0);
});

test('warm semantic theme keeps preview and service surfaces readable and keyboard-visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/host', '/guest', '/service?tab=coffees']) {
    await page.goto(route);
    await expect(page.locator(route.startsWith('/service') ? '#service-content .panel' : '#preview .panel').first()).toBeVisible();
    const palette = await page.evaluate((route) => {
      const style = getComputedStyle(document.documentElement);
      const names = ['--color-background', '--color-surface', '--color-text', '--color-text-muted', '--color-primary', '--color-on-primary', '--color-focus'];
      const tokens = Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
      const layer = document.createElement('span');
      layer.style.color = 'var(--color-background)';
      document.body.append(layer);
      const background = getComputedStyle(layer).color;
      layer.style.backgroundColor = 'var(--color-surface)';
      const expectedSurfaceColor = getComputedStyle(layer).backgroundColor;
      layer.style.color = 'var(--color-text)';
      const text = getComputedStyle(layer).color;
      layer.style.color = 'var(--color-text-muted)';
      const muted = getComputedStyle(layer).color;
      layer.style.color = 'var(--color-on-primary)';
      const onPrimary = getComputedStyle(layer).color;
      layer.style.color = 'var(--color-accent-text)';
      const accentText = getComputedStyle(layer).color;
      layer.style.backgroundColor = 'var(--color-accent)';
      const accent = getComputedStyle(layer).backgroundColor;
      layer.style.backgroundColor = 'var(--color-primary)';
      const primarySurface = getComputedStyle(layer).backgroundColor;
      layer.remove();
      const luminance = (color) => {
        const [r, g, b] = color.match(/\d+/g).slice(0, 3).map((part) => Number(part) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (first, second) => {
        const a = luminance(first), b = luminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const surface = document.querySelector(route.startsWith('/service') ? '#service-content .panel' : '#preview .panel');
      return { tokens, textContrast: contrast(text, background), mutedContrast: contrast(muted, background),
        primaryContrast: contrast(onPrimary, primarySurface), accentContrast: contrast(accentText, accent),
        expectedSurfaceColor, surfaceColor: surface && getComputedStyle(surface).backgroundColor };
    }, route);
    expect(Object.values(palette.tokens).every(Boolean)).toBe(true);
    expect(palette.textContrast).toBeGreaterThanOrEqual(4.5);
    expect(palette.mutedContrast).toBeGreaterThanOrEqual(4.5);
    expect(palette.primaryContrast).toBeGreaterThanOrEqual(4.5);
    expect(palette.accentContrast).toBeGreaterThanOrEqual(4.5);
    expect(palette.surfaceColor).toBe(palette.expectedSurfaceColor);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto('/host');
  await page.locator('#service-cta').focus();
  await expect.poll(() => page.locator('#service-cta').evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
});

async function register(page, role, navigate = true) {
  const username = `browser_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const password = `browser-password-${randomUUID()}`;
  if (navigate) await page.goto(`/login?perspective=${role === 'host' ? 'host' : 'guest'}&tab=coffees`);
  await page.getByText('계정 만들기', { exact: true }).first().click();
  const form = page.locator('#register-form');
  await form.locator('[name=username]').fill(username);
  await form.locator('[name=password]').fill(password);
  await form.locator('[name=name]').fill('가상 브라우저 계정');
  await form.locator('[name=role]').selectOption(role);
  for (const name of ['terms', 'privacy', 'age']) await form.locator(`[name=${name}]`).check();
  await form.getByRole('button', { name: '계정 만들기' }).click();
  await expect(page.locator('#dashboard')).toBeVisible();
  await expect(page).toHaveURL(/\/service/);
  return { username, password };
}

async function removeAccount(page, password) {
  await page.evaluate(async (password) => {
    const me = await (await fetch('/api/me')).json();
    if (!me.user) throw Error('Test account missing');
    const result = await fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf }, body: JSON.stringify({ password }) });
    if (!result.ok) throw Error(`Synthetic account cleanup failed: ${result.status}`);
  }, password);
}

test('host public listing, guest receipt, login return, consent, inbox and withdrawal are real', async ({ browser }) => {
  const hostContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3190', viewport: { width: 390, height: 844 } });
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3190', viewport: { width: 390, height: 844 } });
  const memberContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3190', viewport: { width: 390, height: 844 } });
  const host = await hostContext.newPage(), guest = await guestContext.newPage(), member = await memberContext.newPage();
  const errors = [];
  for (const page of [host, guest, member]) page.on('pageerror', (error) => errors.push(error.message));
  let hostAccount, memberAccount;
  try {
    hostAccount = await register(host, 'host');
    await expect(host.locator('header [data-service-tab=inbox]')).toBeVisible();
    await expect(host.locator('header [data-service-tab=account]')).toBeVisible();
    await expect(host.locator('#preview-tabs')).toBeHidden();
    await host.locator('#host-create summary').click();
    const form = host.locator('#team-form');
    const title = `가상 공개 모임 ${randomUUID().slice(0, 8)}`;
    await form.locator('[name=title]').fill(title);
    await form.locator('[name=place]').fill('PRIVATE BROWSER VENUE');
    const localTime = (time) => {
      const value = new Date(time);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}T${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    };
    await form.locator('[name=startsAt]').fill(localTime(Date.now() + 3 * 3600000));
    await form.locator('[name=endsAt]').fill(localTime(Date.now() + 4 * 3600000));
    await form.locator('[name=capacity]').fill('3');
    await form.locator('[name=listed]').check();
    await form.locator('[name=publicPlace]').fill('가상 공개 카페 안내');
    await form.getByRole('button', { name: '팀 만들기' }).click();
    await expect(host.locator('#team-detail')).toContainText(title);
    await guest.goto('/service?tab=coffees');
    await expect(guest.locator('#service-content')).not.toContainText('PRIVATE BROWSER VENUE');
    await guest.locator('#service-content article').filter({ hasText: title }).getByRole('button').click();
    await guest.getByRole('button', { name: '비회원으로 신청', exact: true }).click();
    const application = guest.locator('#guest-application-form');
    await application.locator('[name=name]').fill('가상 비회원');
    await application.locator('[name=bio]').fill('호스트만 확인하는 가상 소개');
    await application.locator('[name=consent]').check();
    await application.locator('[name=age]').check();
    await application.getByRole('button', { name: '비회원 신청 접수' }).click();
    await expect(guest.getByRole('link', { name: '내 신청 확인·철회 관리 링크' })).toBeVisible();
    const receipt = await guest.getByRole('link', { name: '내 신청 확인·철회 관리 링크' }).getAttribute('href');
    await guest.goto(receipt);
    await expect(guest.locator('#guest-state')).toContainText('호스트 확인 대기');
    await expect(guest.locator('#service-content')).not.toContainText('PRIVATE BROWSER VENUE');
    await host.getByRole('button', { name: '팀 목록 새로고침' }).click();
    await expect(host.locator('#guest-applications')).toContainText('가상 비회원');
    await host.locator('#guest-applications').getByRole('button', { name: '확정', exact: true }).click();
    await guest.reload();
    await expect(guest.locator('#guest-state')).toContainText('호스트가 참여 확정');
    const teamId = new URL(receipt).searchParams.get('team');
    await member.goto(`/service?tab=coffees&chat=${teamId}`);
    await member.getByRole('button', { name: '로그인하고 신청' }).click();
    await expect(member).toHaveURL(new RegExp(`/login\\?tab=coffees&chat=${teamId}`));
    memberAccount = await register(member, 'member', false);
    await expect(member).toHaveURL(new RegExp(`/service\\?tab=coffees&chat=${teamId}`));
    await member.getByRole('button', { name: '내 계정으로 참여', exact: true }).click();
    await member.locator('#member-public-join [name=disclosure]').check();
    await member.locator('#member-public-join').getByRole('button', { name: '내 계정으로 팀 참여' }).click();
    await expect(member.locator('#team-detail')).toContainText('PRIVATE BROWSER VENUE');
    await expect(member.locator('#guest-applications')).toHaveCount(0);
    await expect(member.locator('#host-create')).toBeHidden();
    await member.locator('[data-service-tab=profile]').click();
    await member.locator('#profile-form [name=name]').fill('가상 멤버 프로필');
    await member.locator('#profile-form [name=bio]').fill('새 소개');
    await member.locator('#profile-form').getByRole('button', { name: '프로필 저장' }).click();
    await expect(member.locator('#message')).toContainText('프로필을 저장');
    await host.locator('#announcement-form [name=title]').fill('가상 브라우저 공지');
    await host.locator('#announcement-form [name=body]').fill('실제 팀 인박스 검증');
    await host.locator('#announcement-form').getByRole('button', { name: '팀 인박스에 공지' }).click();
    await expect(host.locator('#message')).toContainText('공지를 등록');
    await member.locator('[data-tab=inbox]').click();
    await expect(member).toHaveURL(/tab=inbox/);
    await expect(member.locator('[data-service-tab=inbox]')).toHaveAttribute('aria-current', 'page');
    await member.getByRole('button', { name: '공지 확인', exact: true }).click();
    await expect(member.locator('#inbox-list')).toContainText('가상 브라우저 공지');
    await member.locator('#inbox-list').getByRole('button', { name: '읽음으로 표시' }).click();
    await expect(member.locator('#inbox-list .badge')).toHaveText('읽음');
    guest.on('dialog', (dialog) => dialog.accept());
    await guest.getByRole('button', { name: '내 비회원 신청 철회' }).click();
    await expect(guest.locator('#guest-state')).toHaveText('신청 철회');
    await host.getByRole('button', { name: '팀 목록 새로고침' }).click();
    await expect(host.locator('#guest-applications')).not.toContainText('호스트만 확인하는 가상 소개');
    expect(errors).toEqual([]);
    for (const page of [host, guest, member]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    if (memberAccount) await removeAccount(member, memberAccount.password);
    if (hostAccount) await removeAccount(host, hostAccount.password);
    await hostContext.close(); await guestContext.close(); await memberContext.close();
  }
});

test('service failures stay explicit without normal-operation banners', async ({ page }) => {
  await page.route('**/api/status', (route) => route.fulfill({ json: { storage: false, registration: false, message: 'INTERNAL STORAGE DETAIL' } }));
  await page.goto('/service?tab=profile');
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toContainText('지금은 신청과 계정 서비스를 이용할 수 없습니다.');
  await expect(page.locator('body')).not.toContainText('INTERNAL STORAGE DETAIL');
  await expect(page.locator('header #service-tabs')).toBeVisible();
  await expect(page.locator('#preview-tabs')).toBeHidden();
});
