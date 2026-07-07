<script setup>
import { ref } from 'vue';
import { Dice6 } from '@lucide/vue';
import TalentRollDialog from '../TalentRollDialog.vue';

defineProps({
  canEdit: { type: Boolean, default: false },
  characterId: { type: String, required: true },
  characterName: { type: String, default: '' }
});

const showTalentDialog = ref(false);
</script>

<template>
  <section id="section-talents" class="form-panel talent-panel">
    <div class="inline-heading">
      <div>
        <h2>角色天赋</h2>
        <p>管理 Roll 得到的角色天赋；开启“天赋提示”后会进入聊天提示词。</p>
      </div>
      <button class="ghost-button" type="button" @click="showTalentDialog = true">
        <Dice6 :size="17" />
        <span>管理天赋</span>
      </button>
    </div>
  </section>

  <TalentRollDialog
    v-if="showTalentDialog"
    :character-id="characterId"
    :character-name="characterName"
    :can-edit="canEdit"
    @close="showTalentDialog = false"
  />
</template>
