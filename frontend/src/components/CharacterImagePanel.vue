<script setup>
import { onMounted, ref } from 'vue';
import { GripVertical, ImagePlus, Star, Tag, Trash2, X } from '@lucide/vue';
import {
  createCharacterImage,
  deleteCharacterImage,
  fetchCharacterImages,
  reorderCharacterImages,
  updateCharacterImage
} from '../api';
import { useNotify } from '../composables/useNotify';

const props = defineProps({
  characterId: {
    type: String,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  }
});

const notify = useNotify();
const images = ref([]);
const loading = ref(false);
const uploading = ref(false);
const editingImageId = ref('');
const editForm = ref({ sceneTag: '', emotionTag: '' });
const dragIndex = ref(-1);
const dragOverIndex = ref(-1);

const sceneOptions = ['日常', '学校', '街道', '家里', '餐厅', '战斗', '夜晚', '雨天', '雪天', '海边', '森林', '节日'];
const emotionOptions = ['开心', '悲伤', '愤怒', '惊讶', '害羞', '害怕', '温柔', '严肃', '困倦', '得意'];

onMounted(async () => {
  await loadImages();
});

async function loadImages() {
  loading.value = true;
  try {
    images.value = await fetchCharacterImages(props.characterId);
  } catch {
    images.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleUpload(event) {
  const files = event.target.files;
  if (!files || !files.length) return;

  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      notify.warning(`${file.name} 不是支持的图片格式`);
      continue;
    }
    if (file.size > 4 * 1024 * 1024) {
      notify.warning(`${file.name} 超过 4MB 限制`);
      continue;
    }

    uploading.value = true;
    try {
      const dataUrl = await readAsDataUrl(file);
      await createCharacterImage(props.characterId, {
        imageUrl: dataUrl,
        sceneTag: '',
        emotionTag: '',
        isDefault: images.value.length === 0
      });
      await loadImages();
    } catch (err) {
      notify.error(err.message || '上传失败');
    } finally {
      uploading.value = false;
    }
  }
  event.target.value = '';
}

function startEdit(image) {
  editingImageId.value = image.id;
  editForm.value = {
    sceneTag: image.sceneTag || '',
    emotionTag: image.emotionTag || ''
  };
}

function cancelEdit() {
  editingImageId.value = '';
  editForm.value = { sceneTag: '', emotionTag: '' };
}

async function saveEdit(imageId) {
  try {
    await updateCharacterImage(props.characterId, imageId, {
      sceneTag: editForm.value.sceneTag,
      emotionTag: editForm.value.emotionTag
    });
    await loadImages();
    cancelEdit();
    notify.success('标签已更新');
  } catch (err) {
    notify.error(err.message);
  }
}

async function setDefault(imageId) {
  try {
    // Clear old default
    const currentDefault = images.value.find((img) => img.isDefault);
    if (currentDefault && currentDefault.id !== imageId) {
      await updateCharacterImage(props.characterId, currentDefault.id, { isDefault: false });
    }
    await updateCharacterImage(props.characterId, imageId, { isDefault: true });
    await loadImages();
    notify.success('已设为默认立绘');
  } catch (err) {
    notify.error(err.message);
  }
}

async function removeImage(imageId) {
  if (!window.confirm('确定删除这张立绘？')) return;
  try {
    await deleteCharacterImage(props.characterId, imageId);
    await loadImages();
    notify.success('立绘已删除');
  } catch (err) {
    notify.error(err.message);
  }
}

function onDragStart(index) {
  if (props.disabled) return;
  dragIndex.value = index;
}

function onDragOver(index) {
  if (props.disabled) return;
  dragOverIndex.value = index;
}

function onDragEnd() {
  if (dragIndex.value < 0 || dragOverIndex.value < 0 || dragIndex.value === dragOverIndex.value) {
    dragIndex.value = -1;
    dragOverIndex.value = -1;
    return;
  }

  const reordered = [...images.value];
  const [moved] = reordered.splice(dragIndex.value, 1);
  reordered.splice(dragOverIndex.value, 0, moved);
  images.value = reordered;
  dragIndex.value = -1;
  dragOverIndex.value = -1;

  saveOrder();
}

async function saveOrder() {
  try {
    const orderedIds = images.value.map((img) => img.id);
    await reorderCharacterImages(props.characterId, orderedIds);
  } catch (err) {
    notify.error('排序保存失败');
    await loadImages();
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function sceneLabel(tag) {
  return tag || '未设置';
}

function emotionLabel(tag) {
  return tag || '未设置';
}
</script>

<template>
  <section class="cg-panel">
    <div class="cg-header">
      <div>
        <h2>CG 立绘</h2>
        <p>管理角色的场景立绘，AI 回复时会根据场景/情绪自动切换。</p>
      </div>
      <label v-if="!disabled" class="file-button cg-upload-btn" :class="{ disabled: uploading }">
        <ImagePlus :size="18" />
        <span>{{ uploading ? '上传中...' : '添加立绘' }}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          :disabled="uploading"
          @change="handleUpload"
        />
      </label>
    </div>

    <p v-if="loading" class="muted-text">正在加载立绘...</p>
    <p v-else-if="!images.length" class="muted-text cg-empty">还没有立绘，点击「添加立绘」上传第一张。</p>

    <div v-else class="cg-grid">
      <div
        v-for="(image, index) in images"
        :key="image.id"
        class="cg-card"
        :class="{ 'is-default': image.isDefault, dragging: dragIndex === index, 'drag-over': dragOverIndex === index }"
        draggable="true"
        @dragstart="onDragStart(index)"
        @dragover.prevent="onDragOver(index)"
        @dragend="onDragEnd"
      >
        <div class="cg-image-wrap">
          <img :src="image.imageUrl" :alt="`${image.sceneTag || '立绘'} ${index + 1}`" />
          <span v-if="image.isDefault" class="cg-default-badge">
            <Star :size="14" />
            默认
          </span>
        </div>

        <div class="cg-info">
          <div v-if="editingImageId === image.id" class="cg-edit-form">
            <label>
              <span>场景</span>
              <select v-model="editForm.sceneTag">
                <option value="">未设置</option>
                <option v-for="s in sceneOptions" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <label>
              <span>情绪</span>
              <select v-model="editForm.emotionTag">
                <option value="">未设置</option>
                <option v-for="e in emotionOptions" :key="e" :value="e">{{ e }}</option>
              </select>
            </label>
            <div class="cg-edit-actions">
              <button class="ghost-button small" type="button" @click="saveEdit(image.id)">保存</button>
              <button class="ghost-button small" type="button" @click="cancelEdit">取消</button>
            </div>
          </div>

          <div v-else class="cg-tags">
            <span class="cg-tag scene">
              <Tag :size="12" />
              场景: {{ sceneLabel(image.sceneTag) }}
            </span>
            <span class="cg-tag emotion">
              <Tag :size="12" />
              情绪: {{ emotionLabel(image.emotionTag) }}
            </span>
          </div>
        </div>

        <div v-if="!disabled" class="cg-actions">
          <button class="icon-button" title="拖拽排序" draggable="false" @mousedown.stop>
            <GripVertical :size="16" />
          </button>
          <button class="icon-button" title="编辑标签" @click="startEdit(image)">
            <Tag :size="16" />
          </button>
          <button
            class="icon-button"
            :class="{ active: image.isDefault }"
            title="设为默认"
            @click="setDefault(image.id)"
          >
            <Star :size="16" />
          </button>
          <button class="icon-button danger" title="删除" @click="removeImage(image.id)">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cg-panel {
  margin-top: 1.5rem;
}

.cg-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.cg-header h2 {
  margin: 0;
  font-size: 1.15rem;
}

.cg-header p {
  margin: 0.25rem 0 0;
  color: var(--muted, #888);
  font-size: 0.85rem;
}

.cg-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 1rem;
  background: var(--primary, #5b7fff);
  color: #fff;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
}

.cg-upload-btn.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.cg-upload-btn input {
  display: none;
}

.cg-empty {
  text-align: center;
  padding: 2rem 1rem;
  border: 2px dashed var(--border, #ddd);
  border-radius: 12px;
  color: var(--muted, #888);
}

.cg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 1rem;
}

.cg-card {
  border: 2px solid var(--border, #e0e0e0);
  border-radius: 12px;
  overflow: hidden;
  background: var(--surface, #fff);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.cg-card.is-default {
  border-color: var(--primary, #5b7fff);
}

.cg-card.dragging {
  opacity: 0.5;
}

.cg-card.drag-over {
  border-color: var(--primary, #5b7fff);
  box-shadow: 0 0 0 2px var(--primary-alpha, rgba(91, 127, 255, 0.2));
}

.cg-image-wrap {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--surface-alt, #f5f5f5);
}

.cg-image-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.cg-default-badge {
  position: absolute;
  top: 0.5rem;
  left: 0.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.5rem;
  background: var(--primary, #5b7fff);
  color: #fff;
  border-radius: 6px;
  font-size: 0.72rem;
  font-weight: 600;
}

.cg-info {
  padding: 0.6rem 0.75rem;
}

.cg-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.cg-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.15rem 0.5rem;
  border-radius: 6px;
  font-size: 0.75rem;
  background: var(--surface-alt, #f0f0f0);
  color: var(--text, #333);
}

.cg-tag.scene {
  background: rgba(52, 152, 219, 0.1);
  color: #2980b9;
}

.cg-tag.emotion {
  background: rgba(231, 76, 60, 0.1);
  color: #c0392b;
}

.cg-edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.cg-edit-form label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
}

.cg-edit-form label span {
  min-width: 2.5rem;
  color: var(--muted, #888);
}

.cg-edit-form select {
  flex: 1;
  padding: 0.3rem 0.5rem;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  font-size: 0.8rem;
  background: var(--surface, #fff);
}

.cg-edit-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.25rem;
}

.ghost-button.small {
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.cg-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.5rem;
  border-top: 1px solid var(--border, #e8e8e8);
}

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: var(--text, #555);
  transition: background 0.15s;
}

.icon-button:hover {
  background: var(--surface-alt, #f0f0f0);
}

.icon-button.active {
  color: var(--primary, #5b7fff);
}

.icon-button.danger:hover {
  background: rgba(231, 76, 60, 0.1);
  color: #e74c3c;
}
</style>
