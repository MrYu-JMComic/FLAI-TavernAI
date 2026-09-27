import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import AdminView from '../../views/AdminView.vue';

const adminApi = vi.hoisted(() => ({
  deleteAdminUser: vi.fn(),
  fetchAdminUsers: vi.fn(),
  resetAdminDailyRequestUsage: vi.fn(),
  updateAdminUserQuota: vi.fn()
}));

vi.mock('../../api/admin.js', () => adminApi);

let wrapper;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  adminApi.fetchAdminUsers.mockReset();
  adminApi.resetAdminDailyRequestUsage.mockReset();
  adminApi.updateAdminUserQuota.mockReset();
  adminApi.deleteAdminUser.mockReset();
});

describe('AdminView request quota management', () => {
  it('requires confirmation and updates the row after resetting usage', async () => {
    const notify = { success: vi.fn(), error: vi.fn() };
    adminApi.fetchAdminUsers.mockResolvedValue({
      users: [
        {
          id: 'managed-user',
          accountName: 'managed',
          displayName: '测试用户',
          permissionLabel: '用户组',
          quota: { maxDailyRequests: 100 },
          usageToday: { requestCount: 100, date: '2026-09-08' }
        }
      ],
      nextCursor: ''
    });
    adminApi.resetAdminDailyRequestUsage.mockResolvedValue({
      userId: 'managed-user',
      date: '2026-09-08',
      requestCount: 0,
      inputTokens: 12,
      outputTokens: 4,
      costMicros: 17
    });

    wrapper = mount(AdminView, {
      props: { user: { id: 'root-user', isRootAdmin: true } },
      global: { provide: { notify } }
    });
    await flushPromises();

    expect(adminApi.fetchAdminUsers).toHaveBeenCalledWith({ cursor: '', limit: 50 });
    expect(wrapper.text()).toContain('测试用户');
    expect(wrapper.text()).toContain('剩余 0');

    const resetButton = wrapper.findAll('button').find((button) => button.text() === '重置');
    await resetButton.trigger('click');
    expect(adminApi.resetAdminDailyRequestUsage).not.toHaveBeenCalled();

    const confirmButton = wrapper.findAll('button').find((button) => button.text() === '确认重置');
    await confirmButton.trigger('click');
    await flushPromises();

    expect(adminApi.resetAdminDailyRequestUsage).toHaveBeenCalledWith('managed-user');
    expect(wrapper.text()).toContain('剩余 100');
    expect(notify.success).toHaveBeenCalledWith('已重置 测试用户 的今日请求数');
  });

  it('does not load admin data for a non-root account', async () => {
    wrapper = mount(AdminView, {
      props: { user: { id: 'regular-user', isRootAdmin: false } }
    });
    await flushPromises();

    expect(adminApi.fetchAdminUsers).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('需要根管理员权限');
  });

  it('searches users and supports unlimited quota updates and deletion', async () => {
    const notify = { success: vi.fn(), error: vi.fn() };
    adminApi.fetchAdminUsers.mockResolvedValue({
      users: [{
        id: 'managed-user',
        accountName: 'managed',
        displayName: '测试用户',
        permissionLabel: '用户组',
        quota: { maxDailyRequests: 100 },
        usageToday: { requestCount: 0 }
      }],
      nextCursor: ''
    });
    adminApi.updateAdminUserQuota.mockResolvedValue({ userId: 'managed-user', maxDailyRequests: null });
    adminApi.deleteAdminUser.mockResolvedValue({ ok: true, userId: 'managed-user' });

    wrapper = mount(AdminView, {
      props: { user: { id: 'root-user', isRootAdmin: true } },
      global: { provide: { notify } }
    });
    await flushPromises();

    const searchInput = wrapper.find('input[type="search"]');
    await searchInput.setValue('managed');
    await searchInput.trigger('keyup');
    await wrapper.find('form[role="search"]').trigger('submit');
    await flushPromises();
    expect(adminApi.fetchAdminUsers).toHaveBeenLastCalledWith({ cursor: '', limit: 50, search: 'managed' });

    await wrapper.findAll('button').find((button) => button.text() === '上限').trigger('click');
    await wrapper.find('input[type="checkbox"]').setValue(true);
    await wrapper.find('form.quota-editor').trigger('submit');
    await flushPromises();
    expect(adminApi.updateAdminUserQuota).toHaveBeenCalledWith('managed-user', { maxDailyRequests: null });
    expect(wrapper.text()).toContain('无限');

    await wrapper.find('button[aria-label="删除用户 测试用户"]').trigger('click');
    await wrapper.findAll('button').find((button) => button.text() === '确认删除').trigger('click');
    await flushPromises();
    expect(adminApi.deleteAdminUser).toHaveBeenCalledWith('managed-user');
    expect(wrapper.text()).toContain('暂无用户。');
  });
});
