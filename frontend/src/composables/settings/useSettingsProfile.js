import { reactive, ref, watch } from 'vue';
import {
  getUserProfile,
  saveUserAvatar,
  saveUserProfile
} from '../../api/auth.js';
import {
  setListIfChanged,
  setPlainValueIfChanged
} from './settingsListState.js';
import { readFileAsDataUrl, validateImageDataUrl } from '../../utils/fileReaders';

export function useSettingsProfile({ user, isPersonalPage, notify, emitProfileSaved } = {}) {
  const initialUser = readUser(user);
  const profile = reactive({
    avatarUrl: initialUser?.avatarUrl || '',
    accountName: initialUser?.accountName || initialUser?.username || '',
    displayName: initialUser?.displayName || '',
    permissionLabel: initialUser?.permissionLabel || '用户组',
    permissionGroup: initialUser?.permissionGroup || 'user',
    isRootAdmin: Boolean(initialUser?.isRootAdmin)
  });
  const profileStats = ref({
    ownedAiCount: 0,
    publicAiCount: 0,
    privateAiCount: 0,
    likeCount: 0,
    totalUseCount: 0,
    userCount: 0
  });
  const ownedCharacters = ref([]);
  const profileSaving = ref(false);
  const avatarSaving = ref(false);
  let avatarSaveToken = 0;
  let profileSaveToken = 0;

  watch(
    () => readUser(user),
    (value) => {
      if (!value) {
        return;
      }
      applyProfileUser(value);
    }
  );

  async function loadUserProfile() {
    return getUserProfile();
  }

  async function handleUserAvatar(event) {
    const input = event?.target;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file || !isPersonalPageReady() || avatarSaving.value) {
      return;
    }

    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify?.warning?.('头像仅支持 PNG、JPG 或 WebP');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      notify?.warning?.('头像不能超过 2MB');
      return;
    }

    avatarSaving.value = true;
    const mutationToken = ++avatarSaveToken;
    try {
      const avatarDataUrl = await readFileAsDataUrl(file, '头像读取失败');
      if (!isCurrentAvatarSave(mutationToken)) return;
      const validatedAvatarDataUrl = await validateImageDataUrl(
        avatarDataUrl,
        '头像图片数据无效，请重新选择 PNG、JPG 或 WebP 图片'
      );
      if (!isCurrentAvatarSave(mutationToken)) return;
      const result = await saveUserAvatar({ avatarDataUrl: validatedAvatarDataUrl });
      if (!isCurrentAvatarSave(mutationToken)) return;
      profile.avatarUrl = result.user?.avatarUrl || '';
      notify?.success?.('头像已保存');
      emitProfileSaved?.(result.user);
    } catch (err) {
      if (!isCurrentAvatarSave(mutationToken)) return;
      notify?.error?.(err.message);
    } finally {
      if (isCurrentAvatarSave(mutationToken)) {
        avatarSaving.value = false;
      }
    }
  }

  async function submitProfile() {
    if (!isPersonalPageReady() || profileSaving.value) {
      return;
    }
    const mutationToken = ++profileSaveToken;
    const displayName = profile.displayName;
    profileSaving.value = true;
    try {
      const result = await saveUserProfile({
        displayName
      });
      if (!isCurrentProfileSaveResult(mutationToken, displayName)) return;
      applyProfile(result);
      notify?.success?.('个人资料已保存');
      emitProfileSaved?.(result.user);
    } catch (err) {
      if (!isCurrentProfileSaveResult(mutationToken, displayName)) return;
      notify?.error?.(err.message);
    } finally {
      if (isCurrentProfileSaveToken(mutationToken)) {
        profileSaving.value = false;
      }
    }
  }

  function updateProfileDisplayName(value) {
    profile.displayName = String(value || '').slice(0, 8);
  }

  function isCurrentAvatarSave(mutationToken) {
    return mutationToken === avatarSaveToken && isPersonalPageReady();
  }

  function isCurrentProfileSaveToken(mutationToken) {
    return mutationToken === profileSaveToken && isPersonalPageReady();
  }

  function isCurrentProfileSaveResult(mutationToken, displayName) {
    return isCurrentProfileSaveToken(mutationToken) && profile.displayName === displayName;
  }

  function resetProfileAsyncScope() {
    avatarSaveToken += 1;
    profileSaveToken += 1;
    avatarSaving.value = false;
    profileSaving.value = false;
  }

  function applyProfile(result = {}) {
    applyProfileUser(result.user || {});
    setProfileStatsIfChanged(result.stats);
    setOwnedCharactersIfChanged(result.ownedCharacters);
  }

  function applyProfileUser(nextUser = {}) {
    profile.avatarUrl = nextUser.avatarUrl || profile.avatarUrl || '';
    profile.accountName = nextUser.accountName || nextUser.username || profile.accountName || '';
    profile.displayName = nextUser.displayName || '';
    profile.permissionLabel = nextUser.permissionLabel || '用户组';
    profile.permissionGroup = nextUser.permissionGroup || 'user';
    profile.isRootAdmin = Boolean(nextUser.isRootAdmin);
  }

  function setProfileStatsIfChanged(nextStats) {
    return setPlainValueIfChanged(profileStats, nextStats || profileStats.value);
  }

  function setOwnedCharactersIfChanged(nextCharacters) {
    return setListIfChanged(ownedCharacters, nextCharacters);
  }

  function isPersonalPageReady() {
    return isPersonalPage?.value === true;
  }

  return {
    applyProfile,
    avatarSaving,
    handleUserAvatar,
    loadUserProfile,
    ownedCharacters,
    profile,
    profileSaving,
    profileStats,
    resetProfileAsyncScope,
    submitProfile,
    updateProfileDisplayName
  };
}

function readUser(user) {
  return user?.value ?? user ?? null;
}
