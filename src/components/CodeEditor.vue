<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup, EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

const props = defineProps<{
  modelValue: string;
  filename: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
}>();

const host = ref<HTMLDivElement | null>(null);
const languageCompartment = new Compartment();
let view: EditorView | null = null;
let observer: ResizeObserver | null = null;
let syncing = false;

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.55",
  },
  ".cm-content": {
    padding: "10px 0",
  },
  ".cm-gutters": {
    backgroundColor: "#0b1220",
    borderRight: "1px solid #1e293b",
    color: "#64748b",
  },
  ".cm-foldGutter": {
    width: "12px",
  },
  "&.cm-focused": {
    outline: "none",
  },
});

async function applyLanguage(filename: string) {
  if (!view) {
    return;
  }
  const description = LanguageDescription.matchFilename(
    languages,
    filename,
  );
  let support = null;
  if (description) {
    try {
      support = await description.load();
    } catch {
      support = null;
    }
  }
  if (!view) {
    return;
  }
  view.dispatch({
    effects: languageCompartment.reconfigure(support ?? []),
  });
}

onMounted(() => {
  if (!host.value) {
    return;
  }

  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        oneDark,
        editorTheme,
        languageCompartment.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !syncing) {
            emit("update:modelValue", update.state.doc.toString());
          }
        }),
      ],
    }),
  });

  void applyLanguage(props.filename);

  observer = new ResizeObserver(() => view?.requestMeasure());
  observer.observe(host.value);
});

watch(
  () => props.filename,
  (filename) => {
    void applyLanguage(filename);
  },
);

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) {
      return;
    }
    syncing = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: value,
      },
    });
    syncing = false;
  },
);

onBeforeUnmount(() => {
  observer?.disconnect();
  view?.destroy();
  view = null;
});
</script>

<template>
  <div ref="host" class="code-editor"></div>
</template>

<style scoped>
.code-editor {
  height: min(54vh, 520px);
  overflow: hidden;
  border: 1px solid #334155;
  background: #0f172a;
  text-align: left;
}

.code-editor :deep(.cm-editor) {
  height: 100%;
  background: #0f172a;
  color: #e2e8f0;
}
</style>
