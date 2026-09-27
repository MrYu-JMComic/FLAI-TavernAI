<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Download, Globe2, LockKeyhole, Save, Trash2 } from '@lucide/vue';
import CharacterSectionOutlet from './CharacterSectionOutlet.vue';
import { CHARACTER_EDITOR_KEY } from '../../composables/character/useCharacterEditor';

const editor = inject(CHARACTER_EDITOR_KEY);

// The hub lists sections; opening one pushes a full-screen sheet. Browser back
// is deliberately left alone so this never fights the hash router.
const openSectionId = ref('');

const openSection = computed(() => {
  for (const section of editor.visibleSections) {
    if (section.id === openSectionId.value) {
      return section;
    }
  }
  return null;
});
const actionBusy = computed(() => editor.saving || editor.deleting || editor.exporting);

watch(
  () => editor.visibleSections,
  (sections) => {
    if (!openSectionId.value) {
      return;
    }
    for (const section of sections) {
      if (section.id === openSectionId.value) {
        return;
      }
    }
    openSectionId.value = '';
  }
);

// The name field lives inside the basic sheet; open it when validation fails.
watch(
  () => editor.nameError,
  (message) => {
    if (message && !openSectionId.value) {
      enterSection('basic');
    }
  }
);

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown);
});

function handleKeydown(event) {
  if (event?.key === 'Escape' && openSectionId.value) {
    leaveSection();
  }
}

function enterSection(sectionId) {
  editor.setActiveSection(sectionId);
  openSectionId.value = sectionId;
}

function leaveSection() {
  openSectionId.value = '';
}
</script>

<template>
  <div class="character-mobile">
    <form class="character-mobile-form" novalidate @submit.prevent="editor.submit">
      <section
        v-show="!openSectionId"
        class="character-mobile-hub"
        :class="{ 'full-form-active': editor.isCharacterCreationFullForm }"
      >
        <header class="character-mobile-identity">
          <div class="character-mobile-avatar">
            <img v-if="editor.form.avatarUrl" :src="editor.form.avatarUrl" :alt="editor.form.name || '角色头像'" />
            <span v-else>{{ String(editor.form.name || 'F').slice(0, 1) }}</span>
          </div>
          <div class="character-mobile-identity-text">
            <h2>{{ editor.form.name || '未命名角色' }}</h2>
            <span class="character-mobile-visibility">
              <Globe2 v-if="editor.form.visibility === 'public'" :size="13" />
              <LockKeyhole v-else :size="13" />
              {{ editor.form.visibility === 'public' ? '公开角色' : '私人角色' }}
            </span>
          </div>
        </header>

        <div class="character-mobile-progress">
          <div class="character-mobile-progress-head">
            <span>核心内容</span>
            <strong>{{ editor.completedCount }} / {{ editor.completionItems.length }}</strong>
          </div>
          <div
            class="character-mobile-progress-bar"
            role="progressbar"
            :aria-valuenow="editor.completedCount"
            aria-valuemin="0"
            :aria-valuemax="editor.completionItems.length"
          >
            <span :style="{ width: `${(editor.completedCount / editor.completionItems.length) * 100}%` }"></span>
          </div>
        </div>

        <div v-if="editor.isCharacterCreationWizardAvailable" class="character-mobile-wizard">
          <div class="character-mobile-wizard-head">
            <strong>{{ editor.isCharacterCreationWizardActive ? editor.characterWizardProgressText : '全部设置' }}</strong>
            <button
              class="ghost-button compact-button"
              type="button"
              @click="editor.setCharacterCreationMode(editor.isCharacterCreationWizardActive ? 'full' : 'wizard')"
            >
              {{ editor.isCharacterCreationWizardActive ? '完整表单' : '回到向导' }}
            </button>
          </div>
          <div v-if="editor.isCharacterCreationWizardActive" class="character-mobile-wizard-steps">
            <button
              v-for="(step, index) in editor.CHARACTER_CREATION_WIZARD_STEPS"
              :key="step.id"
              class="character-mobile-wizard-step"
              :class="{ active: editor.characterWizardStepId === step.id }"
              type="button"
              @click="editor.setCharacterWizardStep(step.id)"
            >
              <span class="character-mobile-wizard-index">{{ index + 1 }}</span>
              <span>{{ step.label }}</span>
            </button>
          </div>
          <p v-if="editor.isCharacterCreationWizardActive" class="character-mobile-wizard-desc">
            {{ editor.currentCharacterWizardStep.description }}
          </p>
        </div>

        <template v-if="!editor.isCharacterCreationWizardAvailable">
          <div v-for="group in editor.sectionGroups" :key="group.id" class="character-mobile-group">
            <p class="character-mobile-group-label">{{ group.label }}</p>
            <button
              v-for="section in group.sections"
              :key="section.id"
              class="character-mobile-section-item"
              :data-section-id="section.id"
              type="button"
              @click="enterSection(section.id)"
            >
              <span class="character-mobile-section-text">
                <strong>{{ section.label }}</strong>
                <small>{{ section.hint }}</small>
              </span>
              <small
                v-if="editor.sectionStatus(section.id).text"
                class="character-mobile-section-status"
                :class="editor.sectionStatus(section.id).state"
              >
                {{ editor.sectionStatus(section.id).text }}
              </small>
              <ChevronRight :size="18" />
            </button>
          </div>
        </template>

        <nav v-else class="character-mobile-full-nav" aria-label="角色创建分区">
          <button
            v-for="section in editor.visibleSections"
            :key="`full-${section.id}`"
            class="character-mobile-section-item"
            :data-section-id="section.id"
            type="button"
            @click="enterSection(section.id)"
          >
            <span class="character-mobile-section-text">
              <strong>{{ section.label }}</strong>
              <small>{{ section.hint }}</small>
            </span>
            <small
              v-if="editor.sectionStatus(section.id).text"
              class="character-mobile-section-status"
              :class="editor.sectionStatus(section.id).state"
            >
              {{ editor.sectionStatus(section.id).text }}
            </small>
            <ChevronRight :size="18" />
          </button>
        </nav>

        <div v-if="editor.isCharacterCreationFullForm && !openSectionId" class="character-mobile-full-form">
          <div
            v-for="section in editor.visibleSections"
            :key="section.id"
            class="character-mobile-full-section"
            :data-section-id="section.id"
          >
            <CharacterSectionOutlet :section-id="section.id" />
          </div>
        </div>

        <div v-if="editor.isEditing" class="character-mobile-manage">
          <button class="ghost-button" type="button" :disabled="actionBusy" @click="editor.handleExport">
            <Download :size="18" />
            <span>{{ editor.exporting ? '导出中...' : '导出角色' }}</span>
          </button>
          <button
            v-if="editor.canEdit"
            class="danger-button"
            type="button"
            :disabled="actionBusy"
            @click="editor.removeCharacter"
          >
            <Trash2 :size="18" />
            <span>{{ editor.deleting ? '删除中...' : '删除角色' }}</span>
          </button>
        </div>
      </section>

      <section v-if="openSectionId" class="character-mobile-sheet" aria-live="polite">
        <header class="character-mobile-sheet-head">
          <button
            class="ghost-button character-mobile-back"
            type="button"
            aria-label="返回分区列表"
            @click="leaveSection"
          >
            <ChevronLeft :size="20" />
          </button>
          <h2>{{ openSection?.label || '角色设置' }}</h2>
        </header>
        <div class="character-mobile-sheet-body">
          <CharacterSectionOutlet :key="openSectionId" :section-id="openSectionId" />
        </div>
      </section>

      <div class="character-mobile-actionbar" :class="{ dirty: editor.hasUnsavedChanges }">
        <button v-if="openSectionId" class="ghost-button" type="button" @click="leaveSection">
          <span>完成</span>
        </button>
        <div v-else class="character-mobile-save-state" aria-live="polite">
          <span class="character-save-state-dot"></span>
          <strong>{{ editor.hasUnsavedChanges ? '未保存' : '已保存' }}</strong>
        </div>

        <button
          v-if="editor.canEdit"
          class="primary-button character-mobile-primary"
          type="submit"
          :disabled="actionBusy"
        >
          <Save :size="18" />
          <span>{{ editor.saving ? '保存中...' : (editor.isEditing || editor.isCharacterCreationFullForm ? '保存角色' : '创建角色') }}</span>
        </button>
        <button v-else class="primary-button character-mobile-primary" type="button" @click="editor.navigateHome">
          <span>返回角色列表</span>
        </button>
      </div>
    </form>
  </div>
</template>
