<script setup>
import { inject } from 'vue';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  Globe2,
  LockKeyhole,
  Save,
  Trash2
} from '@lucide/vue';
import CharacterCreationWizardPanel from './CharacterCreationWizardPanel.vue';
import CharacterSectionOutlet from './CharacterSectionOutlet.vue';
import { CHARACTER_EDITOR_KEY } from '../../composables/character/useCharacterEditor';

const editor = inject(CHARACTER_EDITOR_KEY);
</script>

<template>
  <CharacterCreationWizardPanel
    v-if="editor.isCharacterCreationWizardAvailable"
    :active="editor.isCharacterCreationWizardActive"
    :current-step="editor.currentCharacterWizardStep"
    :progress-text="editor.characterWizardProgressText"
    :step-id="editor.characterWizardStepId"
    :steps="editor.CHARACTER_CREATION_WIZARD_STEPS"
    @set-mode="editor.setCharacterCreationMode"
    @set-step="editor.setCharacterWizardStep"
  />

  <div class="character-studio">
    <nav class="character-studio-nav" aria-label="角色编辑目录">
      <div v-for="group in editor.sectionGroups" :key="group.id" class="character-studio-nav-group">
        <p>{{ group.label }}</p>
        <button
          v-for="section in group.sections"
          :key="section.id"
          class="character-studio-nav-item"
          :class="{ active: editor.activeSection === section.id }"
          :data-section-id="section.id"
          :aria-current="editor.activeSection === section.id ? 'true' : undefined"
          type="button"
          @click="editor.setActiveSection(section.id)"
        >
          <span class="character-studio-nav-label">{{ section.label }}</span>
          <small
            v-if="editor.sectionStatus(section.id).text"
            class="character-studio-nav-status"
            :class="editor.sectionStatus(section.id).state"
          >
            {{ editor.sectionStatus(section.id).text }}
          </small>
        </button>
      </div>
    </nav>

    <form class="character-studio-main" novalidate @submit.prevent="editor.submit">
      <aside class="character-studio-aside" aria-label="角色摘要与操作">
        <section class="character-studio-card" aria-label="角色卡预览">
          <div class="character-studio-identity">
            <div class="character-studio-avatar">
              <img v-if="editor.form.avatarUrl" :src="editor.form.avatarUrl" :alt="editor.form.name || '角色头像'" />
              <span v-else>{{ String(editor.form.name || 'F').slice(0, 1) }}</span>
            </div>
            <div class="character-studio-identity-text">
              <h2>{{ editor.form.name || '未命名角色' }}</h2>
              <span class="character-studio-visibility">
                <Globe2 v-if="editor.form.visibility === 'public'" :size="14" />
                <LockKeyhole v-else :size="14" />
                {{ editor.form.visibility === 'public' ? '公开角色' : '私人角色' }}
              </span>
              <div v-if="editor.form.selectedTags.length" class="character-studio-tags" aria-label="角色标签">
                <span v-for="tag in editor.form.selectedTags.slice(0, 4)" :key="tag" class="tag-badge">{{ tag }}</span>
                <span v-if="editor.form.selectedTags.length > 4" class="tag-badge">
                  +{{ editor.form.selectedTags.length - 4 }}
                </span>
              </div>
            </div>
          </div>

          <details class="character-studio-progress">
            <summary aria-label="查看核心内容完成情况">
              <div class="character-studio-progress-head">
                <strong>核心内容</strong>
                <span>{{ editor.completedCount }} / {{ editor.completionItems.length }}</span>
                <ChevronDown :size="14" />
              </div>
              <div
                class="character-studio-progress-bar"
                role="progressbar"
                aria-label="核心内容完成度"
                :aria-valuenow="editor.completedCount"
                aria-valuemin="0"
                :aria-valuemax="editor.completionItems.length"
              >
                <span :style="{ width: `${(editor.completedCount / editor.completionItems.length) * 100}%` }"></span>
              </div>
            </summary>
            <ul class="character-studio-checklist">
              <li v-for="item in editor.completionItems" :key="item.key" :class="{ complete: item.complete }">
                <span class="character-studio-check"><Check v-if="item.complete" :size="12" /></span>
                {{ item.label }}
              </li>
            </ul>
          </details>
        </section>

        <section class="character-studio-actions" aria-label="角色操作">
          <div class="character-save-state" :class="{ dirty: editor.hasUnsavedChanges }" aria-live="polite">
            <span class="character-save-state-dot"></span>
            <div>
              <strong>{{ editor.hasUnsavedChanges ? '有未保存更改' : '所有更改已保存' }}</strong>
            </div>
          </div>

          <div class="character-studio-action-buttons">
            <button
              v-if="editor.isCharacterCreationWizardActive && editor.characterWizardStepIndex < editor.CHARACTER_CREATION_WIZARD_STEPS.length - 1"
              class="primary-button character-primary-action"
              type="button"
              :disabled="editor.saving || editor.deleting || editor.exporting"
              @click="editor.goToNextCharacterWizardStep"
            >
              <span>下一步</span>
              <ChevronRight :size="18" />
            </button>
            <button
              v-else-if="editor.canEdit"
              class="primary-button character-primary-action"
              type="submit"
              :disabled="editor.saving || editor.deleting || editor.exporting"
            >
              <Save :size="18" />
              <span>{{ editor.saving ? '保存中...' : (editor.isEditing || editor.isCharacterCreationFullForm ? '保存角色' : '创建角色') }}</span>
            </button>
            <button
              v-else
              class="primary-button character-primary-action"
              type="button"
              @click="editor.navigateHome"
            >
              <ChevronLeft :size="18" />
              <span>返回角色列表</span>
            </button>

            <button
              v-if="editor.isCharacterCreationWizardActive && editor.characterWizardStepIndex > 0"
              class="ghost-button character-studio-back-step"
              type="button"
              :disabled="editor.saving || editor.deleting || editor.exporting"
              @click="editor.goToPreviousCharacterWizardStep"
            >
              <ChevronLeft :size="18" />
              <span>上一步</span>
            </button>

            <details v-if="editor.isEditing" class="character-studio-manage">
              <summary class="ghost-button" aria-label="更多角色操作" title="更多角色操作">
                <Ellipsis :size="18" />
              </summary>
              <div class="character-studio-manage-menu">
                <button
                  class="ghost-button"
                  type="button"
                  :disabled="editor.saving || editor.deleting || editor.exporting"
                  @click="editor.handleExport"
                >
                  <Download :size="18" />
                  <span>{{ editor.exporting ? '导出中...' : '导出角色' }}</span>
                </button>
                <button
                  v-if="editor.canEdit"
                  class="danger-button"
                  type="button"
                  :disabled="editor.saving || editor.deleting || editor.exporting"
                  @click="editor.removeCharacter"
                >
                  <Trash2 :size="18" />
                  <span>{{ editor.deleting ? '删除中...' : '删除角色' }}</span>
                </button>
              </div>
            </details>
          </div>
        </section>
      </aside>

      <div class="character-studio-stage">
        <div v-if="editor.isCharacterCreationFullForm" class="character-studio-full-form">
          <div
            v-for="section in editor.visibleSections"
            :key="section.id"
            class="character-studio-full-section character-studio-stage"
            :data-section-id="section.id"
          >
            <CharacterSectionOutlet :section-id="section.id" />
          </div>
        </div>
        <CharacterSectionOutlet v-else-if="editor.activeSection" :key="editor.activeSection" :section-id="editor.activeSection" />

        <div class="character-studio-stepper">
          <button
            class="ghost-button"
            type="button"
            :disabled="!editor.hasPreviousSection"
            @click="editor.goToPreviousSection"
          >
            <ChevronLeft :size="18" />
            <span>上一分区</span>
          </button>
          <button
            class="ghost-button"
            type="button"
            :disabled="!editor.hasNextSection"
            @click="editor.goToNextSection"
          >
            <span>下一分区</span>
            <ChevronRight :size="18" />
          </button>
        </div>
      </div>
    </form>
  </div>
</template>
