import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('profile conflicts require reload; password rotation removes stale account screens', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL }), staleContext = await browser.newContext({ baseURL });
  const page = await context.newPage(), conflict = await context.newPage(), stale = await staleContext.newPage();
  const username = `browser_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  let password = `test-password-${randomUUID()}`;
  let registered = false;
  try {
    await page.goto('/login?tab=profile&perspective=host');
    await page.getByText('계정 만들기', { exact: true }).first().click();
    const register = page.locator('#register-form');
    await register.locator('[name=username]').fill(username);
    await register.locator('[name=password]').fill(password);
    await register.locator('[name=name]').fill('가상 충돌 시험');
    await register.locator('[name=role]').selectOption('member');
    for (const name of ['terms', 'privacy', 'age']) await register.locator(`[name=${name}]`).check();
    await register.getByRole('button', { name: '계정 만들기' }).click();
    await expect(page.locator('#profile-form')).toBeVisible();
    registered = true;
    await expect(page.locator('#host-create')).toBeHidden();
    await conflict.goto('/service?tab=profile');
    await expect(conflict.locator('#profile-form [name=name]')).toHaveValue('가상 충돌 시험');
    await page.locator('#profile-form [name=name]').fill('최신 저장 프로필');
    await page.locator('#profile-form').getByRole('button', { name: '프로필 저장' }).click();
    await expect(page.locator('#message')).toContainText('프로필을 저장');
    await conflict.locator('#profile-form [name=name]').fill('오래된 덮어쓰기');
    await conflict.locator('#profile-form').getByRole('button', { name: '프로필 저장' }).click();
    await expect(conflict.locator('#message')).toContainText('다른 화면에서 프로필을 수정');
    conflict.on('dialog', (dialog) => dialog.accept());
    await conflict.getByRole('button', { name: '저장된 프로필 다시 불러오기' }).click();
    await expect(conflict.locator('#profile-form [name=name]')).toHaveValue('최신 저장 프로필');
    await stale.goto('/login?tab=profile');
    await stale.locator('#login-form [name=username]').fill(username);
    await stale.locator('#login-form [name=password]').fill(password);
    await stale.locator('#login-form').getByRole('button', { name: '로그인', exact: true }).click();
    await expect(stale.locator('#profile-form')).toBeVisible();
    await page.goto('/service?tab=account');
    await expect(page.locator('#password-form')).toBeVisible();
    const next = `next-password-${randomUUID()}`;
    await page.locator('#password-form [name=password]').fill(password);
    await page.locator('#password-form [name=newPassword]').fill(next);
    await page.locator('#password-form').getByRole('button', { name: '비밀번호·복구 코드 교체' }).click();
    await expect(page.locator('#message')).toContainText('모든 기존 로그인 세션');
    password = next;
    await stale.locator('#profile-form [name=bio]').fill('만료 세션 입력');
    await stale.locator('#profile-form').getByRole('button', { name: '프로필 저장' }).click();
    await expect(stale.locator('#dashboard')).toBeHidden();
    await expect(stale.locator('#auth')).toBeVisible();
    await expect(stale.locator('#profile-form [name=name]')).toHaveValue('');
    await expect(stale.locator('#recovery-code')).toHaveText('');
    await page.getByRole('button', { name: '보관했어요 · 숨기기' }).click();
    await expect(page.locator('#recovery-code')).toHaveText('');
  } finally {
    if (registered) await page.evaluate(async (password) => {
      const me = await (await fetch('/api/me')).json();
      const response = await fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf }, body: JSON.stringify({ password }) });
      if (!response.ok) throw Error(`Synthetic cleanup failed: ${response.status}`);
    }, password);
    await context.close(); await staleContext.close();
  }
});
