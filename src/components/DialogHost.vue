<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { dialogState, settleDialog } from "../services/dialogs";

const inputRef = ref<HTMLInputElement | null>(null);
const dialogRef = ref<HTMLDivElement | null>(null);

function cancel() {
  settleDialog(dialogState.kind === "prompt" ? null : false);
}

function confirm() {
  if (dialogState.kind === "prompt") {
    const value = dialogState.value.trim();
    if (value === "") {
      return;
    }
    settleDialog(value);
    return;
  }
  settleDialog(true);
}

watch(
  () => dialogState.open,
  async (open) => {
    if (!open) {
      return;
    }
    await nextTick();
    if (dialogState.kind === "prompt") {
      inputRef.value?.focus();
      inputRef.value?.select();
    } else {
      dialogRef.value?.focus();
    }
  },
);
</script>

<template>
  <div
    v-if="dialogState.open"
    class="dialog-mask"
    @click.self="cancel"
    @keydown.esc="cancel"
  >
    <div
      ref="dialogRef"
      class="dialog"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      @keydown.esc="cancel"
    >
      <h2>{{ dialogState.title }}</h2>
      <p class="dialog-message">{{ dialogState.message }}</p>
      <input
        v-if="dialogState.kind === 'prompt'"
        ref="inputRef"
        v-model="dialogState.value"
        class="dialog-input"
        :placeholder="dialogState.placeholder"
        @keyup.enter="confirm"
        @keyup.esc="cancel"
      />
      <div class="dialog-actions">
        <button class="dialog-cancel" @click="cancel">
          {{ dialogState.cancelText }}
        </button>
        <button
          class="dialog-confirm"
          :class="{ danger: dialogState.danger }"
          :disabled="
            dialogState.kind === 'prompt' && dialogState.value.trim() === ''
          "
          @click="confirm"
        >
          {{ dialogState.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.45);
}

.dialog {
  width: min(420px, 100%);
  padding: 22px 24px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.3);
  text-align: center;
}

.dialog h2 {
  margin: 0 0 10px;
  color: var(--accent);
  font-size: 16px;
  word-break: break-word;
}

.dialog-message {
  margin: 0;
  color: #374151;
  font-size: 14px;
  line-height: 1.6;
  text-align: left;
  white-space: pre-line;
  word-break: break-word;
}

.dialog-input {
  box-sizing: border-box;
  width: 100%;
  height: var(--control-height);
  margin-top: 14px;
  padding: 0 10px;
  border: 1px solid var(--control-border);
  border-radius: 0;
  background: #fff;
  color: var(--control-text);
  font-family: inherit;
  font-size: var(--control-font);
  outline: none;
}

.dialog-input:focus {
  border-color: var(--accent);
}

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
}

.dialog-actions button {
  height: 36px;
  min-width: 96px;
  padding: 0 16px;
  border: 1px solid var(--accent);
  background: #fff;
  color: var(--accent);
  font-family: inherit;
  font-size: 14px;
}

.dialog-actions button:hover:not(:disabled) {
  background: var(--control-hover);
}

.dialog-confirm.danger {
  border-color: #dc2626;
  color: #dc2626;
}

.dialog-confirm.danger:hover:not(:disabled) {
  background: #fef2f2;
}
</style>
