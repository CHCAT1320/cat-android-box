<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { APRIL_FOOLS_OPTOUT_KEY } from "../services/settings";

type Phase = "idle" | "playing" | "hold" | "drag" | "ask";

const phase = ref<Phase>("idle");
const iframeRef = ref<HTMLIFrameElement | null>(null);
const iframeReady = ref(false);
const captureRef = ref<HTMLDivElement | null>(null);
const cardRef = ref<HTMLDivElement | null>(null);
const trashRef = ref<HTMLDivElement | null>(null);
const noRef = ref<HTMLButtonElement | null>(null);
const nyanFrame = ref(0);
const cardX = ref(0);
const cardY = ref(0);
const dragging = ref(false);
const overTrash = ref(false);
const deleting = ref(false);
const noDodged = ref(false);
const noFrozen = ref(false);
const noOffset = ref({ x: 0, y: 0 });
let noLastDodge = 0;
let noWatchTimer: number | undefined;
let pointerX = -9999;
let pointerY = -9999;
let noBase = { left: 0, top: 0, width: 0, height: 0 };
let longPressTimer: number | undefined;
let pressStartX = 0;
let pressStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
let tracking = false;
let nyanTimer: number | undefined;

const nyanFrameSrc = computed(
  () => `/aprilfools/nyan-${String(nyanFrame.value).padStart(2, "0")}.png`,
);

const cardStyle = computed(() => ({
  left: `${cardX.value}px`,
  top: `${cardY.value}px`,
  transform: `translate(-50%, -50%) scale(${
    deleting.value ? 0.06 : phase.value === "hold" ? 1 : 0.56
  })`,
  transition: deleting.value
    ? "left 0.38s ease, top 0.38s ease, transform 0.38s ease, opacity 0.38s ease"
    : dragging.value
      ? "none"
      : "transform 0.25s ease",
  opacity: deleting.value ? 0 : 1,
}));

const noStyle = computed(() => ({
  transform: `translate(${noOffset.value.x}px, ${noOffset.value.y}px)`,
}));

function todayKey(): string {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function hasTestOverride(): boolean {
  if (new URLSearchParams(window.location.search).get("aprilfools") === "1") {
    return true;
  }
  const hashQueryIndex = window.location.hash.indexOf("?");
  if (hashQueryIndex === -1) {
    return false;
  }
  return (
    new URLSearchParams(
      window.location.hash.slice(hashQueryIndex + 1),
    ).get("aprilfools") === "1"
  );
}

function isAprilFoolsDay(): boolean {
  if (hasTestOverride()) {
    return true;
  }
  const date = new Date();
  return date.getMonth() === 3 && date.getDate() === 1;
}

function isOptedOut(): boolean {
  try {
    return localStorage.getItem(APRIL_FOOLS_OPTOUT_KEY) === todayKey();
  } catch {
    return false;
  }
}

function startEffect() {
  phase.value = "playing";
  iframeReady.value = false;
  document.documentElement.requestFullscreen?.().catch(() => {});
  void nextTick(() => captureRef.value?.focus());
}

function startNyanAnimation() {
  if (nyanTimer !== undefined) {
    return;
  }
  nyanFrame.value = 0;
  nyanTimer = window.setInterval(() => {
    nyanFrame.value = (nyanFrame.value + 1) % 12;
  }, 90);
}

function stopNyanAnimation() {
  if (nyanTimer !== undefined) {
    window.clearInterval(nyanTimer);
    nyanTimer = undefined;
  }
}

function onIframeLoad() {
  const doc = iframeRef.value?.contentDocument;
  if (!doc) {
    return;
  }
  try {
    const style = doc.createElement("style");
    style.textContent = "#overlay{display:none!important}";
    doc.head.appendChild(style);
    Object.defineProperty(doc.documentElement, "requestFullscreen", {
      value: () => Promise.resolve(),
      configurable: true,
    });
    doc.querySelector<HTMLButtonElement>("#boot")?.click();
  } catch {
    // 让画面继续加载，长按时会使用备用卡片
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (phase.value === "playing") {
        iframeReady.value = true;
      }
    });
  });
}

function centerCard() {
  cardX.value = window.innerWidth / 2;
  cardY.value = window.innerHeight / 2;
}

function beginHold() {
  if (phase.value !== "playing") {
    return;
  }
  phase.value = "hold";
  startNyanAnimation();
  const recenter = () => {
    if (phase.value === "hold") {
      centerCard();
    }
  };
  if (document.fullscreenElement) {
    void document.exitFullscreen().then(recenter).catch(recenter);
  } else {
    recenter();
  }
}

function onFullscreenChange() {
  if (phase.value === "playing" && !document.fullscreenElement) {
    beginHold();
  } else if (phase.value === "hold") {
    window.setTimeout(centerCard, 0);
  }
}

function onWindowResize() {
  if (phase.value === "hold") {
    centerCard();
  }
}

function startTracking() {
  if (tracking) {
    return;
  }
  tracking = true;
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function stopTracking() {
  if (!tracking) {
    return;
  }
  tracking = false;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
}

function cancelLongPress() {
  if (longPressTimer !== undefined) {
    window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }
}

function onCardPointerDown(event: PointerEvent) {
  if (phase.value !== "hold" && phase.value !== "drag") {
    return;
  }
  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }
  event.preventDefault();

  if (phase.value === "drag") {
    dragging.value = true;
    dragOffsetX = cardX.value - event.clientX;
    dragOffsetY = cardY.value - event.clientY;
    startTracking();
    return;
  }

  pressStartX = event.clientX;
  pressStartY = event.clientY;
  cancelLongPress();
  longPressTimer = window.setTimeout(() => {
    longPressTimer = undefined;
    if (phase.value !== "hold") {
      return;
    }
    phase.value = "drag";
    dragging.value = true;
    dragOffsetX = cardX.value - pressStartX;
    dragOffsetY = cardY.value - pressStartY;
  }, 550);
  startTracking();
}

function onPointerMove(event: PointerEvent) {
  if (dragging.value) {
    cardX.value = event.clientX + dragOffsetX;
    cardY.value = event.clientY + dragOffsetY;
    overTrash.value = isOverTrash();
    return;
  }
  if (
    longPressTimer !== undefined &&
    Math.hypot(event.clientX - pressStartX, event.clientY - pressStartY) > 8
  ) {
    cancelLongPress();
  }
}

function onPointerUp() {
  cancelLongPress();
  if (dragging.value) {
    dragging.value = false;
    if (phase.value === "drag" && isOverTrash()) {
      deleteCard();
    }
  }
  stopTracking();
}

function isOverTrash(): boolean {
  const card = cardRef.value;
  const trash = trashRef.value;
  if (!card || !trash) {
    return false;
  }
  const cardRect = card.getBoundingClientRect();
  const trashRect = trash.getBoundingClientRect();
  return (
    cardRect.left < trashRect.right &&
    cardRect.right > trashRect.left &&
    cardRect.top < trashRect.bottom &&
    cardRect.bottom > trashRect.top
  );
}

function deleteCard() {
  if (phase.value !== "drag" || deleting.value) {
    return;
  }
  dragging.value = false;
  overTrash.value = true;
  const trashRect = trashRef.value?.getBoundingClientRect();
  if (trashRect) {
    cardX.value = trashRect.left + trashRect.width / 2;
    cardY.value = trashRect.top + trashRect.height / 2;
  }
  deleting.value = true;
  stopTracking();
  window.setTimeout(() => {
    deleting.value = false;
    phase.value = "ask";
    noOffset.value = { x: 0, y: 0 };
    noDodged.value = false;
    noFrozen.value = false;
  }, 380);
}

async function captureNoBase() {
  await nextTick();
  const rect = noRef.value?.getBoundingClientRect();
  if (rect) {
    noBase = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }
}

function onAskPointerMove(event: PointerEvent) {
  pointerX = event.clientX;
  pointerY = event.clientY;
  checkDodge();
}

function checkDodge() {
  if (
    phase.value !== "ask" ||
    noFrozen.value ||
    !noRef.value ||
    noBase.width === 0
  ) {
    return;
  }
  const now = performance.now();
  if (now - noLastDodge < 90) {
    return;
  }

  const baseCenterX = noBase.left + noBase.width / 2;
  const baseCenterY = noBase.top + noBase.height / 2;
  const currentCenterX = baseCenterX + noOffset.value.x;
  const currentCenterY = baseCenterY + noOffset.value.y;
  if (
    Math.hypot(currentCenterX - pointerX, currentCenterY - pointerY) > 110
  ) {
    return;
  }

  noLastDodge = now;
  noDodged.value = true;

  const margin = 16;
  const minX = margin + noBase.width / 2;
  const maxX = window.innerWidth - margin - noBase.width / 2;
  const minY = margin + noBase.height / 2;
  const maxY = window.innerHeight - margin - noBase.height / 2;

  let best: { x: number; y: number; score: number } | null = null;
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const radius = 120 + Math.random() * 80;
    let angle = Math.atan2(
      currentCenterY - pointerY,
      currentCenterX - pointerX,
    );
    angle += (Math.random() - 0.5) * 1.5;
    const targetX = Math.max(
      minX,
      Math.min(maxX, currentCenterX + Math.cos(angle) * radius),
    );
    const targetY = Math.max(
      minY,
      Math.min(maxY, currentCenterY + Math.sin(angle) * radius),
    );
    const moved = Math.hypot(
      targetX - currentCenterX,
      targetY - currentCenterY,
    );
    const pointerDistance = Math.hypot(
      targetX - pointerX,
      targetY - pointerY,
    );
    if (moved < 70 || pointerDistance < 130) {
      continue;
    }
    const offsetX = targetX - baseCenterX;
    const offsetY = targetY - baseCenterY;
    const score = pointerDistance + Math.random() * 50;
    if (!best || score > best.score) {
      best = { x: offsetX, y: offsetY, score };
    }
  }

  if (!best) {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const directionX = centerX - currentCenterX;
    const directionY = centerY - currentCenterY;
    const length = Math.hypot(directionX, directionY) || 1;
    const distance = Math.min(150, length);
    const targetX = Math.max(
      minX,
      Math.min(
        maxX,
        currentCenterX + (directionX / length) * distance,
      ),
    );
    const targetY = Math.max(
      minY,
      Math.min(
        maxY,
        currentCenterY + (directionY / length) * distance,
      ),
    );
    best = {
      x: targetX - baseCenterX,
      y: targetY - baseCenterY,
      score: 0,
    };
  }

  noOffset.value = { x: best.x, y: best.y };
}

function answerYes() {
  phase.value = "idle";
  noDodged.value = false;
  noFrozen.value = false;
}

// 按下白旗后让“不要”回到原位并停止逃跑
function freezeNo() {
  noFrozen.value = true;
  noDodged.value = false;
  noOffset.value = { x: 0, y: 0 };
}

function answerNo() {
  if (!noFrozen.value) {
    return;
  }
  suppressToday();
}

function suppressToday() {
  try {
    localStorage.setItem(APRIL_FOOLS_OPTOUT_KEY, todayKey());
  } catch {
    // 忽略存储失败
  }
  phase.value = "idle";
  noDodged.value = false;
  noFrozen.value = false;
}

function onGlobalClick(event: MouseEvent) {
  if (phase.value !== "idle") {
    return;
  }
  const target = event.target as Element | null;
  if (target?.closest("[data-april-fools]")) {
    return;
  }
  if (!isAprilFoolsDay() || isOptedOut()) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  startEffect();
}

watch(phase, (value) => {
  if (value === "ask") {
    pointerX = -9999;
    pointerY = -9999;
    noLastDodge = 0;
    void captureNoBase();
    window.addEventListener("pointermove", onAskPointerMove);
    noWatchTimer = window.setInterval(checkDodge, 80);
  } else {
    window.removeEventListener("pointermove", onAskPointerMove);
    if (noWatchTimer !== undefined) {
      window.clearInterval(noWatchTimer);
      noWatchTimer = undefined;
    }
  }
  if (value !== "hold" && value !== "drag") {
    cancelLongPress();
    stopTracking();
  }
  if (value !== "drag") {
    dragging.value = false;
    overTrash.value = false;
  }
  if (value !== "hold" && value !== "drag") {
    stopNyanAnimation();
  }
});

onMounted(() => {
  document.addEventListener("click", onGlobalClick, true);
  document.addEventListener("fullscreenchange", onFullscreenChange);
  window.addEventListener("resize", onWindowResize);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onGlobalClick, true);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("pointermove", onAskPointerMove);
  if (noWatchTimer !== undefined) {
    window.clearInterval(noWatchTimer);
    noWatchTimer = undefined;
  }
  cancelLongPress();
  stopTracking();
  stopNyanAnimation();
});
</script>

<template>
  <div v-if="phase !== 'idle'" class="af-stage" data-april-fools>
    <template v-if="phase === 'playing'">
      <iframe
        ref="iframeRef"
        class="af-frame"
        :class="{ ready: iframeReady }"
        src="/memz-nyan-boot.html"
        title="Nyan Cat"
        allow="autoplay; fullscreen"
        @load="onIframeLoad"
      ></iframe>
      <div
        ref="captureRef"
        class="af-capture"
        tabindex="0"
        @keydown.esc.stop="beginHold"
      ></div>
      <p class="af-playing-hint">按 ESC 退出</p>
    </template>

    <template v-else-if="phase === 'hold' || phase === 'drag'">
      <div
        v-if="phase === 'drag'"
        ref="trashRef"
        class="af-trash"
        :class="{ open: overTrash }"
      >
        <svg class="af-trash-svg" viewBox="0 0 96 96" aria-hidden="true">
          <defs>
            <linearGradient id="af-bin-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#fff" stop-opacity="0.2" />
              <stop offset="1" stop-color="#fff" stop-opacity="0.04" />
            </linearGradient>
          </defs>
          <ellipse class="af-trash-shadow" cx="48" cy="89" rx="24" ry="3" />
          <g class="af-lid">
            <rect x="20" y="18" width="56" height="9" rx="4.5" />
            <path d="M38 18v-5a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v5" />
          </g>
          <path
            class="af-bin"
            d="M26 32h44l-3.5 42.5A8.5 8.5 0 0 1 58 83H38a8.5 8.5 0 0 1-8.5-8.5Z"
          />
          <path class="af-lines" d="M40 44v29M48 44v29M56 44v29" />
        </svg>
        <span>拖到这里删除</span>
      </div>

      <div
        ref="cardRef"
        class="af-card"
        :class="{ dragging, deleting }"
        :style="cardStyle"
        @pointerdown="onCardPointerDown"
      >
        <div class="af-card-inner" :class="{ shake: phase === 'drag' }">
          <img :src="nyanFrameSrc" alt="" draggable="false" />
        </div>
      </div>
    </template>

    <div v-if="phase === 'ask'" class="af-modal">
      <div class="af-dialog">
        <h2>今日内还要再次显示这个效果吗？</h2>
        <div class="af-choices">
          <button class="af-yes" @click="answerYes">要</button>
          <button
            ref="noRef"
            class="af-no"
            :class="{ frozen: noFrozen }"
            :style="noStyle"
            :tabindex="noFrozen ? 0 : -1"
            :aria-hidden="!noFrozen"
            @click="answerNo"
          >
            不要
          </button>
        </div>
        <button
          v-if="noDodged && !noFrozen"
          class="af-flag"
          title="让它停下来"
          aria-label="让不要按钮停下来"
          @click="freezeNo"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 22V3" />
            <path d="M6 4h12l-2 4 2 4H6" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.af-stage {
  position: fixed;
  inset: 0;
  z-index: 3000;
  overflow: hidden;
  background: #000;
  color: #fff;
}

.af-frame {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  border: 0;
  background: #000;
  opacity: 0;
}

.af-frame.ready {
  opacity: 1;
}

.af-capture {
  position: fixed;
  inset: 0;
  z-index: 2;
  outline: none;
  cursor: default;
}

.af-playing-hint {
  position: fixed;
  right: 22px;
  bottom: 18px;
  z-index: 3;
  margin: 0;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  letter-spacing: 0.08em;
}

.af-trash {
  position: fixed;
  top: 7vh;
  left: 50%;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  letter-spacing: 0.08em;
  pointer-events: none;
}

.af-trash-svg {
  width: 80px;
  height: 80px;
  overflow: visible;
  filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.45));
}

.af-trash-shadow {
  fill: rgba(0, 0, 0, 0.45);
  filter: blur(2px);
}

.af-lid {
  transform-origin: 48px 23px;
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.af-trash.open .af-lid {
  transform: rotate(-28deg) translateY(-2px);
}

.af-lid rect {
  fill: #fff;
}

.af-lid path {
  fill: none;
  stroke: #fff;
  stroke-width: 4.5;
  stroke-linecap: round;
}

.af-bin {
  fill: url(#af-bin-fill);
  stroke: rgba(255, 255, 255, 0.92);
  stroke-width: 3;
  stroke-linejoin: round;
}

.af-lines {
  fill: none;
  stroke: rgba(255, 255, 255, 0.42);
  stroke-width: 3;
  stroke-linecap: round;
}

.af-card {
  position: fixed;
  z-index: 35;
  width: min(76vw, 900px, 130vh);
  aspect-ratio: 8 / 5;
  transform-origin: center;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.af-card.dragging {
  cursor: grabbing;
}

.af-card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 2px solid rgba(255, 255, 255, 0.24);
  background: #000;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.65);
}

.af-card-inner.shake {
  animation: af-shake 0.16s linear infinite alternate;
}

.af-card-inner img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.af-modal {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.58);
}

.af-dialog {
  position: relative;
  width: min(460px, 100%);
  padding: 24px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
  text-align: center;
}

.af-dialog h2 {
  margin: 0 0 20px;
  color: var(--accent);
  font-size: 16px;
  line-height: 1.5;
}

.af-choices {
  display: flex;
  justify-content: center;
  gap: 14px;
}

.af-choices button {
  position: relative;
  height: 38px;
  min-width: 96px;
  border: 1px solid var(--accent);
  background: #fff;
  color: var(--accent);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
}

.af-yes {
  z-index: 1;
}

.af-no {
  z-index: 2;
  pointer-events: none;
  user-select: none;
  transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.af-no.frozen {
  pointer-events: auto;
  cursor: pointer;
}

.af-flag {
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-top: 18px;
  padding: 0;
  border: 1px solid #d1d5db;
  background: #fff;
  cursor: pointer;
}

.af-flag svg {
  width: 16px;
  height: 16px;
  fill: #fff;
  stroke: #4b5563;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

@keyframes af-shake {
  from {
    transform: translateX(-3px) rotate(-1.4deg);
  }
  to {
    transform: translateX(3px) rotate(1.4deg);
  }
}
</style>
