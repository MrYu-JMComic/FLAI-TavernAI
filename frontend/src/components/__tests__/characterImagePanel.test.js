import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CharacterImagePanel from '../CharacterImagePanel.vue';

const imageApi = vi.hoisted(() => ({
  createCharacterImage: vi.fn(),
  deleteCharacterImage: vi.fn(),
  fetchCharacterImages: vi.fn(),
  reorderCharacterImages: vi.fn(),
  updateCharacterImage: vi.fn()
}));
vi.mock('../../api/characters.js', () => imageApi);

let wrapper;
const currentImages = [
  { id: 'default-image', characterId: 'character-1', imageUrl: '/default.png', isDefault: true },
  { id: 'next-image', characterId: 'character-1', imageUrl: '/next.png', isDefault: false }
];

beforeEach(() => {
  vi.clearAllMocks();
  imageApi.fetchCharacterImages.mockResolvedValue(currentImages);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('character image default selection', () => {
  it('keeps the current default after a failed update and allows retry', async () => {
    const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    imageApi.updateCharacterImage
      .mockRejectedValueOnce(new Error('网络暂不可用'))
      .mockResolvedValueOnce({ id: 'next-image', isDefault: true });
    imageApi.fetchCharacterImages
      .mockResolvedValueOnce(currentImages)
      .mockResolvedValueOnce([
        { ...currentImages[0], isDefault: false },
        { ...currentImages[1], isDefault: true }
      ]);
    wrapper = mount(CharacterImagePanel, {
      props: { characterId: 'character-1' },
      global: { provide: { notify } }
    });
    await flushPromises();

    const targetButton = wrapper.findAll('button[aria-label="设为默认立绘"]')[1];
    await targetButton.trigger('click');
    await flushPromises();

    expect(imageApi.updateCharacterImage).toHaveBeenNthCalledWith(1, 'character-1', 'next-image', { isDefault: true });
    expect(wrapper.findAll('.cg-default-badge')).toHaveLength(1);
    expect(wrapper.findAll('.cg-card')[0].classes()).toContain('is-default');
    expect(wrapper.findAll('.cg-card')[1].classes()).not.toContain('is-default');
    expect(notify.error).toHaveBeenCalledWith('网络暂不可用');

    await wrapper.findAll('button[aria-label="设为默认立绘"]')[1].trigger('click');
    await flushPromises();

    expect(imageApi.updateCharacterImage).toHaveBeenCalledTimes(2);
    expect(imageApi.updateCharacterImage).toHaveBeenNthCalledWith(2, 'character-1', 'next-image', { isDefault: true });
    expect(wrapper.findAll('.cg-card')[0].classes()).not.toContain('is-default');
    expect(wrapper.findAll('.cg-card')[1].classes()).toContain('is-default');
    expect(notify.success).toHaveBeenCalledWith('已设为默认立绘');
  });
});
