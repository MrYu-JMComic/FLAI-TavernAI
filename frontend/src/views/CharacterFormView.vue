<script setup>
import { provide, reactive } from 'vue';
import { ArrowLeft, Plus, RotateCcw, X } from '@lucide/vue';
import CharacterEditorDesktop from '../components/character/CharacterEditorDesktop.vue';
import CharacterEditorMobile from '../components/character/CharacterEditorMobile.vue';
import CharacterStatusPreviewDialog from '../components/character/CharacterStatusPreviewDialog.vue';
import CharacterWorldBookDialog from '../components/character/CharacterWorldBookDialog.vue';
import { CHARACTER_EDITOR_KEY, useCharacterEditor } from '../composables/character/useCharacterEditor';
import { useViewport } from '../composables/useViewport';

const props = defineProps({
  route: {
    type: Object,
    required: true
  },
  user: {
    type: Object,
    default: null
  },
  provider: {
    type: Object,
    default: null
  }
});
const emit = defineEmits(['navigate']);

// Desktop and mobile are separate shells, picked in JS rather than by squeezing
// one layout through media queries. `reactive` unwraps the refs so both shells
// read the same state with plain `editor.x` bindings.
const { isPhone } = useViewport({ breakpoint: '(max-width: 760px)' });
const editor = reactive(useCharacterEditor({ props, emit }));
provide(CHARACTER_EDITOR_KEY, editor);
</script>

<template>
  <section class="page-stack character-editor-page" :class="isPhone ? 'is-mobile' : 'is-desktop'">
    <div class="section-heading character-editor-header">
      <div>
        <p>{{ editor.isEditing && !editor.canEdit ? '查看角色' : editor.isEditing ? '编辑角色' : '创建角色' }}</p>
        <h1>{{ editor.isEditing ? editor.form.name || '角色编辑' : '创建新的 AI 角色' }}</h1>
      </div>
      <button class="ghost-button" type="button" aria-label="返回" @click="editor.navigateHome">
        <ArrowLeft :size="18" />
        <span>返回</span>
      </button>
    </div>

    <p v-if="editor.loading" class="muted-text" aria-live="polite">正在加载角色...</p>
    <section v-else-if="editor.loadError" class="form-panel empty-state error-state" role="alert">
      <h2>角色加载失败</h2>
      <p>{{ editor.loadError }}</p>
      <div class="empty-state-actions">
        <button class="ghost-button" type="button" :disabled="editor.loading" @click="editor.loadEditingCharacter">
          <RotateCcw :size="18" />
          <span>{{ editor.loading ? '重试中...' : '重试' }}</span>
        </button>
        <button class="primary-button" type="button" @click="emit('navigate', 'characterNew')">
          <Plus :size="18" />
          <span>创建新角色</span>
        </button>
        <button class="ghost-button" type="button" @click="editor.navigateHome">
          <ArrowLeft :size="18" />
          <span>返回首页</span>
        </button>
      </div>
    </section>

    <template v-if="!editor.loading && !editor.loadError">
      <p class="permission-note character-permission-note" :class="{ readonly: !editor.canEdit }">
        {{ editor.permissionText }}
      </p>

      <section
        v-if="editor.canEdit && editor.characterDraftStatusText"
        class="character-draft-note"
        :class="{
          pending: editor.pendingCharacterDraft,
          warning: editor.characterDraftStatus === 'too-large' || editor.characterDraftStatus === 'error'
        }"
        aria-live="polite"
      >
        <div class="character-draft-copy">
          <strong>{{ editor.pendingCharacterDraft ? '本地草稿' : '自动保存' }}</strong>
          <span>{{ editor.characterDraftStatusText }}</span>
        </div>
        <div v-if="editor.pendingCharacterDraft" class="character-draft-actions">
          <button class="ghost-button" type="button" @click="editor.restoreCharacterDraft">
            <RotateCcw :size="17" />
            <span>恢复</span>
          </button>
          <button class="ghost-button" type="button" @click="editor.discardCharacterDraft">
            <X :size="17" />
            <span>丢弃</span>
          </button>
        </div>
      </section>

      <CharacterEditorMobile v-if="isPhone" />
      <CharacterEditorDesktop v-else />
    </template>

    <CharacterWorldBookDialog
      v-if="editor.showWorldBookDialog"
      v-model:search="editor.worldBookSearch"
      v-model:sort="editor.worldBookSort"
      :can-edit="editor.canEdit"
      :options-loading="editor.optionsLoading"
      :options-load-error="editor.optionsLoadError"
      :paged-world-books="editor.pagedWorldBooks"
      :filtered-world-books="editor.filteredWorldBooks"
      :selected-world-book-ids="editor.selectedWorldBookIds"
      :world-book-page="editor.worldBookPage"
      :world-book-page-start="editor.worldBookPageStart"
      :world-book-page-end="editor.worldBookPageEnd"
      :world-book-page-count="editor.worldBookPageCount"
      @clear-search="editor.clearWorldBookSearch"
      @close="editor.closeWorldBookDialog"
      @page="editor.setWorldBookPage"
      @toggle="editor.toggleWorldBook"
    />

    <CharacterStatusPreviewDialog
      v-if="editor.showStatusPreviewDialog"
      :status-bar="editor.statusBarBlueprintPreview"
      :template-config="editor.statusBarBlueprintPreviewConfig"
      @close="editor.showStatusPreviewDialog = false"
    />
  </section>
</template>
