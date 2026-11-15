import { reactive } from "vue";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  value?: string;
  placeholder?: string;
}

type DialogKind = "confirm" | "prompt";
type DialogResult = boolean | string | null;

interface DialogState {
  open: boolean;
  kind: DialogKind;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  value: string;
  placeholder: string;
}

const defaultState = (): DialogState => ({
  open: false,
  kind: "confirm",
  title: "",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  danger: false,
  value: "",
  placeholder: "",
});

export const dialogState = reactive<DialogState>(defaultState());

let resolver: ((value: DialogResult) => void) | null = null;

export function settleDialog(value: DialogResult) {
  const resolve = resolver;
  resolver = null;
  dialogState.open = false;
  resolve?.(value);
}

function openDialog(
  kind: DialogKind,
  options: ConfirmOptions | PromptOptions | string,
  fallbackValue = "",
): Promise<DialogResult> {
  if (resolver) {
    settleDialog(dialogState.kind === "prompt" ? null : false);
  }

  const config: PromptOptions =
    typeof options === "string" ? { message: options } : options;

  dialogState.kind = kind;
  dialogState.title = config.title ?? "请确认";
  dialogState.message = config.message;
  dialogState.confirmText = config.confirmText ?? "确定";
  dialogState.cancelText = config.cancelText ?? "取消";
  dialogState.danger = config.danger ?? false;
  dialogState.value = "value" in config ? (config.value ?? "") : fallbackValue;
  dialogState.placeholder =
    "placeholder" in config ? (config.placeholder ?? "") : "";

  return new Promise((resolve) => {
    resolver = resolve;
    dialogState.open = true;
  });
}

export function confirmDialog(
  options: ConfirmOptions | string,
): Promise<boolean> {
  return openDialog("confirm", options).then((value) => value === true);
}

export function promptDialog(
  options: PromptOptions | string,
  fallbackValue = "",
): Promise<string | null> {
  return openDialog("prompt", options, fallbackValue).then((value) =>
    typeof value === "string" ? value : null,
  );
}
