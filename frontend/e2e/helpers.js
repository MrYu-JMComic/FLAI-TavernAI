import { expect } from '@playwright/test';

export function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function registerUser(page, suffix = uniqueSuffix()) {
  const account = {
    username: `e2e_${suffix}`,
    password: `e2e-pass-${suffix}`,
    suffix
  };

  await page.goto('/#/register');
  await expect(page.getByRole('heading', { name: /注册 FLAI Tavern AI/ })).toBeVisible();
  await page.locator('#auth-username').fill(account.username);
  await page.locator('#auth-password').fill(account.password);
  await page.locator('#auth-confirm-password').fill(account.password);
  await page.getByRole('button', { name: /注册并进入/ }).click();
  await expect(page.getByRole('heading', { name: '角色库' })).toBeVisible();

  return account;
}

export async function loginUser(page, account) {
  await page.goto('/#/login');
  await expect(page.getByRole('heading', { name: /登录 FLAI Tavern AI/ })).toBeVisible();
  await page.locator('#auth-username').fill(account.username);
  await page.locator('#auth-password').fill(account.password);
  await page.getByRole('button', { name: /^登录$/ }).click();
  await expect(page.getByRole('heading', { name: '角色库' })).toBeVisible();
}

export async function logoutUser(page) {
  await page.getByRole('button', { name: '用户菜单' }).click();
  await page.getByRole('menuitem', { name: /退出登录/ }).click();
  await expect(page.getByRole('heading', { name: /登录 FLAI Tavern AI/ })).toBeVisible();
}

export async function apiRequest(page, path, options = {}) {
  return page.evaluate(async ({ path: requestPath, options: requestOptions }) => {
    const method = String(requestOptions.method || 'GET').toUpperCase();
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const headers = {};
    if (requestOptions.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (isMutation) {
      const tokenResponse = await fetch('/api/csrf-token', { credentials: 'include' });
      const tokenData = await tokenResponse.json();
      headers['X-CSRF-Token'] = tokenData.csrfToken || '';
    }

    const response = await fetch(requestPath, {
      method,
      credentials: 'include',
      headers,
      body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body)
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(data?.error || data?.message || `Request failed: ${response.status}`);
    }
    return data;
  }, { path, options });
}
