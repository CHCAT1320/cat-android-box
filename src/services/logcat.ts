export interface LogLineInfo {
  time: string;
  pid: string;
  level: string;
  tag: string;
  message: string;
}

export interface CrashEvent {
  id: string;
  time: string;
  app: string;
  pid: string;
  reason: string;
}

export interface WarningEvent {
  id: string;
  time: string;
  pid: string;
  tag: string;
  message: string;
}

const LOG_TIME = String.raw`\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+`;
const TIME_FORMAT = new RegExp(
  `^(${LOG_TIME})\\s+([VDIWEF])/([^(]+)\\(\\s*(\\d+)\\)\\s*:\\s?(.*)$`,
);
const THREADTIME_FORMAT = new RegExp(
  `^(${LOG_TIME})\\s+(\\d+)\\s+(\\d+)\\s+([VDIWEF])\\s+([^:]+):\\s?(.*)$`,
);
const CRASH_MARKER = /FATAL EXCEPTION|Fatal signal|ANR in|beginning of crash/;

// 兼容 logcat -v time（D/Tag(PID): 消息）和 threadtime（PID TID L Tag: 消息）
export function parseLogLine(line: string): LogLineInfo {
  let match = line.match(TIME_FORMAT);
  if (match) {
    return {
      time: match[1],
      level: match[2],
      tag: match[3].trim(),
      pid: match[4],
      message: match[5],
    };
  }

  match = line.match(THREADTIME_FORMAT);
  if (match) {
    return {
      time: match[1],
      pid: match[2],
      level: match[4],
      tag: match[5].trim(),
      message: match[6],
    };
  }

  return { time: "", pid: "", level: "", tag: "", message: line };
}

// 从日志中提取崩溃事件，尽量解析出应用包名/进程名和 PID
export function extractCrashes(lines: string[]): CrashEvent[] {
  const infos = lines.map(parseLogLine);
  const events: CrashEvent[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < infos.length; index += 1) {
    const info = infos[index];
    const message = info.message;
    const fatal = message.match(/FATAL EXCEPTION:\s*(.*)/);
    const signal = message.match(/Fatal signal \d+ \(([^)]+)\)/);
    const anr = message.match(/ANR in ([^\s,(]+)/);
    if (!fatal && !signal && !anr) {
      continue;
    }

    let app = anr?.[1] ?? "";
    let pid = info.pid;
    let pidResolved = false;
    let exception = "";
    let reason = fatal
      ? fatal[1].trim()
        ? `FATAL EXCEPTION: ${fatal[1].trim()}`
        : "FATAL EXCEPTION"
      : signal
        ? `Fatal signal ${signal[1]}`
        : "ANR";

    const limit = Math.min(index + 24, infos.length);
    let end = limit;
    for (let cursor = index + 1; cursor < limit; cursor += 1) {
      if (CRASH_MARKER.test(infos[cursor].message)) {
        end = cursor;
        break;
      }
    }

    for (let cursor = index; cursor < end; cursor += 1) {
      const next = infos[cursor].message;
      const offset = cursor - index;

      const process = next.match(/Process:\s*([^,\s]+),\s*PID:\s*(\d+)/);
      if (process && offset <= 8) {
        app ||= process[1];
        if (!pidResolved) {
          pid = process[2];
          pidResolved = true;
        }
      }

      const nativePid = next.match(/\bpid:\s*(\d+),\s*tid:/);
      if (nativePid && offset <= 8 && !pidResolved) {
        pid = nativePid[1];
        pidResolved = true;
      }

      const anrPid = next.match(/\bPID:\s*(\d+)/);
      if (anrPid && !process && offset <= 8 && !pidResolved) {
        pid = anrPid[1];
        pidResolved = true;
      }

      const cmdline = next.match(/\bCmdline:\s*(\S+)/);
      if (cmdline && app === "") {
        app = cmdline[1];
      }

      const nativeApp = next.match(/>>>\s*([^\s<]+)\s*<</);
      if (nativeApp && app === "") {
        app = nativeApp[1];
      }

      const exceptionMatch = next.match(
        /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+(?:Exception|Error))(?::\s*(.*))?/,
      );
      if (exceptionMatch && exception === "") {
        exception =
          exceptionMatch[1] +
          (exceptionMatch[2] ? `: ${exceptionMatch[2]}` : "");
      }
    }

    if (exception !== "") {
      reason = exception;
    }

    const key = `${info.time}|${pid}|${app}|${reason}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    events.push({
      id: `${info.time || index}-${pid || "unknown"}-${events.length}`,
      time: info.time,
      app: app || "未知进程",
      pid,
      reason,
    });
  }

  return events;
}

export function countCrashMarkers(lines: string[]): number {
  return lines.filter((line) => CRASH_MARKER.test(line)).length;
}

// 提取 W 级别日志，供超出 3000 行缓冲后继续保留
export function extractWarnings(lines: string[]): WarningEvent[] {
  const warnings: WarningEvent[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const info = parseLogLine(line);
    if (info.level !== "W") {
      continue;
    }
    const message = info.message.trim();
    if (message === "") {
      continue;
    }
    const key = `${info.time}|${info.pid}|${info.tag}|${message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    warnings.push({
      id: key,
      time: info.time,
      pid: info.pid,
      tag: info.tag,
      message,
    });
  }

  return warnings;
}
