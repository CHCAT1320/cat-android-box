<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { openUrl } from "@tauri-apps/plugin-opener";
import { version } from "../../package.json";

const GITHUB_URL = "https://github.com/CHCAT1320/cat-android-box";

async function openGithub() {
  try {
    await openUrl(GITHUB_URL);
  } catch {
    window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
  }
}

const tips = [
  "连接设备前，请确保手机已开启 USB 调试并授权本电脑。",
  "右侧设备列表支持多设备切换，所有操作都会自动带上当前设备的序列号。",
  "执行 adb / fastboot 命令后，输出可以在弹窗里一键复制。",
  "快捷重启里的 FastBoot 会重启到 bootloader，9008 适用于高通机型。",
  "安装 APK 失败时，可以先卸载旧版本再重新安装。",
  "截图会以 PNG 格式保存到你选择的电脑目录。",
  "网络调试默认使用 5555 端口，手机和电脑需要处于同一局域网。",
  "清空账号、清除设备管理员等操作风险较高，执行前请先备份。",
  "页面隐藏时会暂停设备轮询，回到页面后会自动刷新。",
  "修改 DPI 前建议记住原数值，方便随时恢复。",
  "设备显示为 unauthorized 时，请在手机上点允许 USB 调试。",
  "FastBoot 模式下 adb 不可用，右侧设备列表会自动识别 FastBoot 设备。",
  "刷入镜像前请确认文件与机型匹配，刷错分区可能导致无法开机。",
  "重新锁定 Bootloader 通常会清除数据，操作前请务必备份。",
  "恢复模式下可以直接删除设备管理员策略文件。",
  "推送文件会保持原文件名，并且支持一次选择多个文件。",
  "绿色守护、黑阈、Shizuku 等脚本激活前，需要先在手机上安装并打开一次对应应用。",
  "DPM 类激活要求设备上没有其他账号、多用户和应用双开。",
  "激活冰箱、小黑屋等应用失败时，失败原因会显示在弹窗输出里。",
  "修改 DPI 后如果界面异常，可以用原数值恢复或直接重启设备。",
  "9008 模式无法通过 adb 检测，需要在设备管理器里确认端口。",
  "截图前请确认保存目录在电脑上真实存在。",
  "执行耗时操作时请保持数据线连接稳定。",
  "使用 adb connect 前，先在设备上开启网络调试并确认 IP 地址。",
  "adb disconnect 会断开所有网络调试连接，请谨慎执行。",
  "同时连接多台设备时，先确认右侧高亮的设备再执行操作。",
  "命令输出里的 [exit code: 0] 表示命令执行成功。",
  "刷机或系统更新过程中不要拔出数据线。",
  "授权电脑后仍无法识别设备时，可以尝试重新插拔 USB 或重启 adb 服务。",
  "刷入 Boot.img 和刷入 REC 只写入对应分区，请先确认镜像与分区匹配。",
  "FastBoot 模式下的「加上BL锁」就是重新锁定 Bootloader，请谨慎操作。",
  "解锁系统分区需要先执行 adb root 和 adb remount，否则无法写入系统目录。",
  "脚本类激活成功后，建议把对应应用加入电池优化白名单，避免被系统回收。",
  "空调狗、黑洞、太极、岛等激活都依赖 DPM，激活后不要手动移除设备管理员。",
  "adb 和 fastboot 命令有执行超时保护，长时间无输出时请检查数据线和设备状态。",
  "截图文件名会自动带上时间戳，多次截图不会互相覆盖。",
  "修改 DPI 后会立即生效，部分应用需要重启才能适配新的显示密度。",
  "清空所有用户会删除全部用户数据，包括工作资料和双开应用。",
  "设备一直显示未授权时，可以在开发者选项里撤销 USB 调试授权后重新插拔。",
  "网络调试连接成功后，设备会像 USB 设备一样出现在右侧列表里。",
  "点击右侧设备卡片即可切换当前设备，高亮项就是后续操作的目标。",
  "命令输出支持全选复制，排查问题时可以连同退出码一起发给他人。",
  "设备列表和命令输出会在页面隐藏时暂停刷新，切回页面后自动恢复。",
  "设备信息区会显示厂商、型号、代号、Android 版本、分辨率、DPI、内存和存储分区。",
  "快捷重启提供系统、恢复模式、FastBoot 和 9008 四个入口，执行前会二次确认。",
  "功能按钮会根据设备当前模式自动切换，只有对应模式下可用的操作才会显示。",
  "选择文件类操作时，可以直接在输入框粘贴路径，也可以点「选择文件」浏览电脑目录。",
  "安装 APK 需要选择电脑上的 apk 文件，执行结果会显示在弹窗输出里。",
  "推送文件支持一次选择多个文件，路径会按每行一个自动填入输入框。",
  "点击「复制输出」按钮可以把完整命令输出复制到剪贴板。",
  "执行按钮在必填路径为空时会自动禁用，填写完整后才能执行。",
  "命令执行期间弹窗不会自动关闭，请等待输出完成后手动关闭。",
  "点击设备卡片切换设备后，设备信息会立即刷新。",
  "网络连接新设备只需要输入 IP:端口，连接成功后会立即刷新设备列表。",
  "开启网络调试前请先用 USB 连接设备，执行 adb tcpip 5555 后即可拔掉数据线。",
  "断开网络连接会同时断开所有无线调试设备，USB 连接不受影响。",
  "没有设备连接时，页面会提示先连接并授权设备。",
  "设备处于 FastBoot 时不会显示 Android 信息，改由 FastBoot 专用功能接管。",
  "恢复模式下的功能与系统模式不同，请确认设备当前状态后再执行。",
  "清空账号和清空用户都需要 root 权限，普通设备上可能直接失败。",
  "刷入镜像、加锁等操作会先弹出说明，确认文件无误后再点击执行。",
  "如果操作输出只有报错没有结果，可以先把输出复制下来再排查。",
  "设备列表底部的网络调试按钮会根据连接状态自动启用或禁用。",
  "USB 连接不稳定时，优先更换数据线或电脑上的 USB 接口。",
  "执行任何写分区操作前，请先确认设备电量充足并保持屏幕解锁。",
  "When the streets are cold and lonely,And the cars they burn below me.", // Made of stone
  "I know,I know I've let you down,I've been a fool to myself.", // Come Sweet Death
  "so with sadness in my heart, feel the best thing i could do,is end it all.", // Come Sweet Death
  "Burning brighter,Runnin outta time,we're chasing the light.", // Buring Bright
  "Don't fade away it's time to shine.", // Buring Bright
  "The thought of us stuck in my mind.", // Buring Bright
  "我们似乎走在了并列的时空,交错而过却永远不能重逢。", // Sister's noise 中文翻唱
  "明明比任何人都更加接近,为何却始终无法互相感应。", // Sister's noise 中文翻唱
  "真实地活在自己的世界里,是我最想要告诉你的话语。", // Sister's noise 中文翻唱
  "夕阳下，曾经的约定，此刻的你，是否已忘记?", // Sister's noise 中文翻唱
  "I Love You, bliss, I love you on (and) on.", // A moment apart
  "I can see for miles and miles and miles and miles and miles.", // FH4
  "In other words, please be true!In other words, I love you!", // Fly me to the moon
  "what's done is done it feels so bad,what once was happy now is sad.", // Come Sweet Death
  "我所做的一切都已无法挽回,重温那些美好的回忆却只是感到难过。", // Come Sweet Death
  "I wish that I could turn back time,cos now the guilt is all mine.", // Come Sweet Death
  "与你交织紧握的手,传来了无与伦比的温暖,但愿永远不忘这份感觉,这是你所留下的温存。", // Late in autumn
  "Since I was young, I knew I’d find you,But our love was a song sung by a dying swan.", // Oblivion
  "And in your dreams you’ll see me falling, falling,Breathe in the light,I’ll stay here in the shadow.", // Oblivion
  "我知道已被忘却,流浪的航程太长太长,但那一刻要叫我一声啊,\n当人类又看到了蓝天,当鲜花又挂上了枝头,地球,我的流浪地球。", // 流浪地球结尾诗歌
  "一壶浊酒尽余欢,今宵别梦寒。", // 送别
  "长亭外 古道边,芳草碧连天。", // 送别
  "\"生死如常啊。\"", // 流浪地球
  "\"Life and death are normal.\"", // 流浪地球
  "我相信你说的那句话,总有一天,冰会化成水的,\n到那个时候,我们再带着孩子去钓鲑鱼。", // 流浪地球
  "I do belive in your words,there'll be a day,when ice turns into water,\nlet's take our children,to go salmon finishing at that time.", // 流浪地球
  "记得，我们一起坐在海边看天,好像已过了千年万年。", // 带着地球去流浪
  "东临碣石，以观沧海 水何澹澹，山岛竦峙\n树木丛生，百草丰茂 秋风萧瑟，洪波涌起。", // 带着地球去流浪
  "今天，还不知道啊，你和思念哪个更远,明天，更不知道啊，我们要带着家园飞向谁边。", // 带着地球去流浪
  "世界之外有一个等待,倒数的爱黑夜慢慢散开。", // 去流浪
  "像钻石珍贵的希望,在心底在蔓延在绽放。", // 霞光
  "月光把天空照亮,洒下一片光芒点缀海洋。", // 霞光
  "每当流星从天而降,心中的梦想都随风飘扬。", // 霞光
  "展开透明翅膀越出天窗,找寻一个最美丽的希望。", // 霞光
  "不经历风雨 怎能有传奇,我会在这里等着你。", // 我就要和你在一起
  "Now I'm here, blinking in the starlight,Now I'm here, suddenly I see.", // I See the light
  "Fly me to the moon, and let me play among the stars.", // Fly me to the moon
  "Let me see what spring is like on Jupiter and Mars.", // Fly me to the moon
  "Fill my heart with song and let me sing forevermore.", // Fly me to the moon
  "You are all I long for, all I worship and adore.", // Fly me to the moon
  "All at once everything looks different, now that I see you.", // I See the light
  "A moment apart, a moment in time.", // A moment apart
  "All that I need is a little more time.", // A moment apart
  "I'm walking on sunshine, whoa.", // Walking on Sunshine
  "Take me home, to the place I belong.", // Take Me Home, Country Roads
  "Almost heaven, West Virginia.", // Take Me Home, Country Roads
  "But I would walk five hundred miles.", // I'm Gonna Be
  "And I would walk five hundred more.", // I'm Gonna Be
  "Sweet dreams are made of this.", // Sweet Dreams
  "Who am I to disagree.", // Sweet Dreams
  "Forever young, I want to be forever young.", // Forever Young
  "Let's dance in style, let's dance for a while.", // Forever Young
  "轻轻的我走了,正如我轻轻的来。", // 再别康桥
  "悄悄是别离的笙箫,夏虫也为我沉默。", // 再别康桥
  "我挥一挥衣袖,不带走一片云彩。", // 再别康桥
  "面朝大海,春暖花开。", // 海子
  "从明天起,做一个幸福的人。", // 海子
  "愿你出走半生,归来仍是少年。", // 网络诗句
  "所念皆星河,星河不可及。", // 星河
  "此去经年,应是良辰好景虚设。", // 雨霖铃
  "执手相看泪眼,竟无语凝噎。", // 雨霖铃
  "多情自古伤离别,更那堪冷落清秋节。", // 雨霖铃
  "人生若只如初见,何事秋风悲画扇。", // 木兰词
  "山有木兮木有枝,心悦君兮君不知。", // 越人歌
  "青青子衿,悠悠我心。", // 诗经
  "所谓伊人,在水一方。", // 诗经
  "落霞与孤鹜齐飞,秋水共长天一色。", // 滕王阁序
  "海上生明月,天涯共此时。", // 望月怀远
  "但愿人长久,千里共婵娟。", // 水调歌头
  "人有悲欢离合,月有阴晴圆缺。", // 水调歌头
  "举头望明月,低头思故乡。", // 静夜思
  "长风破浪会有时,直挂云帆济沧海。", // 行路难
  "天生我材必有用,千金散尽还复来。", // 将进酒
  "会当凌绝顶,一览众山小。", // 望岳
  "星垂平野阔,月涌大江流。", // 旅夜书怀
  "无边落木萧萧下,不尽长江滚滚来。", // 登高
  "大漠孤烟直,长河落日圆。", // 使至塞上
  "等闲识得东风面,万紫千红总是春。", // 春日
  "沉舟侧畔千帆过,病树前头万木春。", // 酬乐天
  "问渠那得清如许,为有源头活水来。", // 观书有感
  "纸上得来终觉浅,绝知此事要躬行。", // 冬夜读书示子聿
  "山重水复疑无路,柳暗花明又一村。", // 游山西村
  "原神，启动！", // 原神
  "原来你也玩原神。", // 原神
  "异世相遇，尽享美味。", // 原神
  "听凭风引。", // 原神
  "愿风神护佑你。", // 原神
  "璃月欢迎你。", // 原神
  "天动万象。", // 原神
  "安如磐石。", // 原神
  "俱收并蓄。", // 原神
  "可叹，落叶飘零。", // 原神
  "不过是些许风霜罢了。", // 原神
  "剑光如我，斩尽芜杂。", // 原神
  "裁雨留虹。", // 原神
  "知识与你分享。", // 原神
  "向着星辰与深渊。", // 原神
  "派蒙不是应急食品。", // 原神
  "今天的委托，你清了吗？", // 原神
  "树脂满了，快去清体力。", // 原神
  "再刷一次圣遗物就下线。", // 原神
  "小保底歪了，别灰心。", // 原神
  "单抽奇迹，十连双黄。", // 原神
  "暴击率又没堆够。", // 原神
  "防御力：我谢谢你。", // 原神
  "抓个晶蝶先。", // 原神
  "这个任务做完就睡。", // 原神
  "风神像，给我回血。", // 原神
  "丘丘人：呀哈哈！", // 原神
  "史莱姆，别跑！", // 原神
  "只要不去抽卡，原石就一直在。", // 原神
  "这里的风景真不错，拍张照吧。", // 原神
  "愿风神忽悠你。", // 原神
  "愿岩神忽悠你。", // 原神
  "只要胆子大，丘丘人放产假。", // 原神
  "这个仇，我记下了。", // 原神
  "别刮了，再刮就秃了。", // 原神
  "钟离：我虽然没钱，但我有故事。", // 原神
  "公子：我是来消费的。", // 原神
  "派蒙：旅行者，你又在偷懒。", // 原神
  "应急食品，启动！", // 原神
  "枫丹第一深情。", // 原神
  "那维莱特：我要审判你。", // 原神
  "芙宁娜：我有权保持沉默。", // 原神
  "胡桃：买一送一，往生堂了解一下。", // 原神
  "七七：我是僵尸，不是萝莉。", // 原神
  "可莉：炸弹是艺术品。", // 原神
  "早柚：我要睡觉。", // 原神
  "神子：小家伙，过来。", // 原神
  "心海：我算过了，这波能赢。", // 原神
  "一斗：本大爷天下第一。", // 原神
  "久岐忍：荒泷派，解散。", // 原神
  "夜兰：赌一把？", // 原神
  "凝光：群玉阁，再建就是了。", // 原神
  "刻晴：加班使我快乐。", // 原神
  "甘雨：我还能再工作五百年。", // 原神
  "魈：别靠近我。", // 原神
  "温迪：再来一杯。", // 原神
  "钟离：这顿你请。", // 原神
  "雷电将军：甜点，好吃。", // 原神
  "宵宫：看烟花吗？", // 原神
  "万叶：风会指引你。", // 原神
  "派蒙：我是应急食品，不是派蒙。", // 原神
  "旅行者，帮我找找我的神之眼。", // 原神
  "小保底不歪，十连出金。", // 原神
  "深渊满星，就在今天。", // 原神
  "再氪一单就收手。", // 原神
];

const tip = ref(tips[Math.floor(Math.random() * tips.length)]);
const tipsCard = ref<HTMLElement | null>(null);
let timer: number | undefined;

// 随机切换提示：旧文字淡出，尺寸平滑改变后再淡入新文字
async function nextTip() {
  const card = tipsCard.value;
  if (!card) {
    return;
  }

  const text = card.querySelector<HTMLElement>(".tips-text");
  const before = card.getBoundingClientRect();

  // 1. 旧提示逐渐消失
  let fadeOut: Animation | undefined;
  if (text) {
    fadeOut = text.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 300, easing: "ease", fill: "forwards" },
    );
    try {
      await fadeOut.finished;
    } catch {
      // 动画被取消时继续执行
    }
    if (!card.isConnected) {
      return;
    }
  }

  // 2. 更新提示内容
  const current = tips.indexOf(tip.value);
  const offset = 1 + Math.floor(Math.random() * (tips.length - 1));
  tip.value = tips[(current + offset) % tips.length];
  await nextTick();
  if (!card.isConnected) {
    return;
  }

  // 3. 卡片尺寸变化，带动下方内容一起平滑移动
  const after = card.getBoundingClientRect();
  const sizeChanged =
    Math.abs(before.width - after.width) >= 1 ||
    Math.abs(before.height - after.height) >= 1;

  let sizeAnimation: Animation | undefined;
  if (sizeChanged) {
    card.classList.add("is-resizing");
    sizeAnimation = card.animate(
      [
        { width: `${before.width}px`, height: `${before.height}px` },
        { width: `${after.width}px`, height: `${after.height}px` },
      ],
      { duration: 600, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }

  // 尺寸过渡完成后再显示新文字，避免多行文本在过渡中被裁切
  if (sizeAnimation) {
    try {
      await sizeAnimation.finished;
    } catch {
      // 动画被取消时继续执行
    }
    if (!card.isConnected) {
      return;
    }
  }

  // 4. 新提示逐渐显示
  fadeOut?.cancel();

  const fadeIn = text?.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 700, easing: "ease" },
  );

  const cleanup = () => {
    card.classList.remove("is-resizing");
    fadeIn?.cancel();
  };

  if (fadeIn) {
    fadeIn.finished.then(cleanup, cleanup);
  } else {
    cleanup();
  }
}

onMounted(() => {
  timer = window.setInterval(nextTip, 5000);
});

onBeforeUnmount(() => {
  window.clearInterval(timer);
});
</script>

<template>
  <section class="page">
    <h1 class="muted">👋 欢迎使用 Cat Android Box</h1>
    <div ref="tipsCard" class="tipsDiv">
      <span class="tips-label">↓TIPS↓</span>
      <p class="tips-text">Tips: {{ tip }}</p>
    </div>
    <div class="selfInfo">
      <h2>关于 Cat Android Box (p≧w≦q)</h2>
      <p>
        Cat Android Box 是一个面向 Android 设备的桌面工具箱，基于 Tauri + Vue 3 +
        TypeScript 构建，内置 adb 与 fastboot，无需额外配置环境。
      </p>
      <p>
        连接设备后，可以在一个窗口里查看设备信息、切换多台设备、快捷重启、安装
        APK、截图保存、推送文件、修改 DPI、开启网络调试，并按系统 / 恢复模式 /
        FastBoot 显示对应操作。所有命令都在本机执行，输出可一键复制。
      </p>
      <p class="selfInfo-tech">Tauri 2 · Rust · Vue 3 · TypeScript · Vite</p>
    </div>

    <div class="selfInfo-links">
      <div
        class="contact-card contact-card-link"
        role="link"
        tabindex="0"
        @click="openGithub"
        @keydown.enter="openGithub"
        @keydown.space.prevent="openGithub"
      >
        <div class="contact-icon-wrap">
          <svg class="contact-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            />
          </svg>
        </div>
        <div class="contact-body">
          <span class="contact-label">GitHub</span>
          <span class="contact-value">cat-android-box</span>
        </div>
      </div>
      <div class="contact-card">
        <div class="contact-icon-wrap">
          <svg class="contact-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z"
            />
          </svg>
        </div>
        <div class="contact-body">
          <span class="contact-label">QQ</span>
          <span class="contact-value">1095216448</span>
        </div>
      </div>
    </div>

    <p class="copyright">
      Cat Android Box v{{ version }} · Copyright © 2026 CHCAT1320. All rights
      reserved.
    </p>
  </section>
</template>

<style scoped>
  .page {
    text-align: center;
  }
  .tipsDiv {
    width: fit-content;
    max-width: 560px;
    box-sizing: border-box;
    margin: 32px auto 0;
    padding: 16px 20px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    text-align: left;
  }
  .tipsDiv.is-resizing {
    overflow: hidden;
  }
  .tips-label {
    display: block;
    color: var(--accent);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: center;
  }
  .selfInfo {
    width: 100%;
    max-width: 720px;
    margin: 20px auto 0;
    padding: 20px 24px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    text-align: left;
  }
  .selfInfo h2 {
    margin: 0 0 10px;
    color: var(--accent);
    font-size: 16px;
  }
  .selfInfo p {
    margin: 0 0 10px;
    color: #4b5563;
    font-size: 14px;
    line-height: 1.7;
  }
  .selfInfo p:last-child {
    margin-bottom: 0;
  }
  .selfInfo p.selfInfo-tech {
    color: #9ca3af;
    font-size: 12px;
  }
  .selfInfo-links {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    width: 100%;
    max-width: 720px;
    margin: 12px auto 0;
  }
  .contact-card {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 12px 16px;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fafafa;
    text-align: left;
  }
  .contact-card-link {
    cursor: pointer;
    user-select: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }
  .contact-card-link:hover {
    border-color: var(--accent);
    background: #fff;
  }
  .contact-card-link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .contact-icon-wrap {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    flex: none;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    background: #fff;
    color: var(--accent);
  }
  .contact-icon {
    display: block;
    width: 20px;
    height: 20px;
  }
  .contact-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .contact-label {
    color: #6b7280;
    font-size: 12px;
  }
  .contact-value {
    color: var(--accent);
    font-size: 15px;
    font-weight: 500;
    word-break: break-all;
  }
  @media (max-width: 560px) {
    .selfInfo-links {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .copyright {
    margin: 20px 0 24px;
    color: #9ca3af;
    font-size: 12px;
  }
  .tips-text {
    margin: 8px 0 0;
    color: #4b5563;
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-line;
  }
</style>
