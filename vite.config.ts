import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { execFile, execFileSync } from "node:child_process";
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
// @ts-expect-error type error without @types/node package
import net from "node:net";
import Inspect from "vite-plugin-inspect";

const host = process.env.TAURI_DEV_HOST;
// 开发环境直接调用项目 tools 目录下的 adb / fastboot
const adbPath = `${process.cwd()}/tools/adb.exe`;
const fastbootPath = `${process.cwd()}/tools/fastboot.exe`;
const TIMEOUT = 600_000;

// Ctrl+C 或终止 Vite 开发服务器时同步停止 adb，避免后台残留
const stopAdb = () => {
  try {
    execFileSync(adbPath, ["kill-server"], {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {
    // adb 未启动时忽略
  }
};

process.once("SIGINT", () => {
  stopAdb();
  process.exit(130);
});

process.once("SIGTERM", () => {
  stopAdb();
  process.exit(143);
});

// 未安装 @types/node，声明中间件用到的最小请求接口
interface RawRequest {
  method?: string;
  on(event: "data", listener: (chunk: string) => void): void;
  on(event: "end", listener: () => void): void;
}

const allowedVerbs: Record<string, string[]> = {
  adb: [
    "devices",
    "shell",
    "install",
    "uninstall",
    "push",
    "pull",
    "reboot",
    "connect",
    "disconnect",
    "tcpip",
    "pair",
    "logcat",
    "version",
    "kill-server",
    "start-server",
    "forward",
    "reverse",
    "mdns",
  ],
  fastboot: [
    "devices",
    "flash",
    "flashing",
    "reboot",
    "oem",
    "getvar",
    "--version",
  ],
};

// 与 Rust 端保持一致，只允许受支持的子命令
function validateArgs(tool: string, args: string[]): string | null {
  let rest = args;

  // 跳过 -s <serial> 前缀，校验真正的子命令
  if (rest[0] === "-s") {
    if (rest.length < 3) {
      return "缺少设备序列号或命令";
    }
    rest = rest.slice(2);
  }

  while (
    rest[0] === "--disable-verity" ||
    rest[0] === "--disable-verification"
  ) {
    rest = rest.slice(1);
  }

  const verb = rest[0];
  if (!verb || !allowedVerbs[tool]?.includes(verb)) {
    return `不允许的 ${tool} 命令: ${verb ?? ""}`;
  }
  return null;
}

interface ScanAddress {
  host: string;
  port: number;
}

const SUBNET_SCAN_PORTS = [5555, 5557, 7555, 16384, 21503, 58526, 62001, 62025, 62026];

// 与 Rust 端保持一致，包含模拟器与常见无线调试工具的端口
function adbScanPorts(): number[] {
  const ports: number[] = [];
  for (let port = 5555; port <= 5685; port += 2) {
    ports.push(port);
  }
  ports.push(7555, 16384, 16416, 21503, 58526, 62001, 62025, 62026, 62027);
  return [...new Set(ports)].sort((a, b) => a - b);
}

function parseIpv4(value: string): number | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) {
      return null;
    }
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

function formatIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function formatScanAddress(address: ScanAddress): string {
  const host = address.host.includes(":") ? `[${address.host}]` : address.host;
  return `${host}:${address.port}`;
}

function parseScanTarget(value: string): {
  addresses: ScanAddress[];
  error: string;
} {
  const target = value.trim();
  if (target === "") {
    return { addresses: [], error: "请输入要扫描的主机或网段" };
  }

  if (target.includes("/")) {
    const [ipPart, prefixPart] = target.split("/");
    const ip = parseIpv4(ipPart);
    const prefix = Number(prefixPart);
    if (ip === null || !Number.isInteger(prefix) || prefix < 24 || prefix > 32) {
      return {
        addresses: [],
        error: "网段扫描仅支持 /24 到 /32 的 IPv4 地址",
      };
    }

    const mask = (0xffffffff << (32 - prefix)) >>> 0;
    const base = (ip & mask) >>> 0;
    const size = 2 ** (32 - prefix);
    const start = prefix <= 30 ? base + 1 : base;
    const end = prefix <= 30 ? base + size - 2 : base + size - 1;
    const addresses: ScanAddress[] = [];
    for (let current = start; current <= end; current += 1) {
      const host = formatIpv4(current);
      for (const port of SUBNET_SCAN_PORTS) {
        addresses.push({ host, port });
      }
    }
    return { addresses, error: "" };
  }

  const host = target.toLowerCase() === "localhost" ? "127.0.0.1" : target;
  return {
    addresses: adbScanPorts().map((port) => ({ host, port })),
    error: "",
  };
}

function probeScanAddress(address: ScanAddress, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address.host, port: address.port });
    let settled = false;
    const done = (open: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function scanTargets(addresses: ScanAddress[]): Promise<string[]> {
  const found: string[] = [];
  let next = 0;
  const workers = Math.min(128, addresses.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= addresses.length) {
          return;
        }
        const address = addresses[index];
        if (await probeScanAddress(address, 250)) {
          found.push(formatScanAddress(address));
        }
      }
    }),
  );
  return found.sort();
}

function adbScanApi(): Plugin {
  return {
    name: "adb-scan-api",
    configureServer(server) {
      // 扫描主机或网段上的常见 ADB 端口，开发环境与桌面端行为一致
      server.middlewares.use("/api/adb/scan", (request, response) => {
        const req = request as unknown as RawRequest;

        if (req.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }

        let body = "";
        req.on("data", (chunk: string) => {
          body += chunk;
        });

        req.on("end", async () => {
          response.setHeader("Content-Type", "application/json; charset=utf-8");

          let target: unknown;
          try {
            ({ target } = JSON.parse(body));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "请求格式错误" }));
            return;
          }

          if (typeof target !== "string") {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "缺少扫描地址" }));
            return;
          }

          const parsed = parseScanTarget(target);
          if (parsed.error !== "") {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: parsed.error }));
            return;
          }

          try {
            const endpoints = await scanTargets(parsed.addresses);
            response.end(JSON.stringify({ endpoints }));
          } catch (error) {
            response.statusCode = 500;
            response.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : "扫描失败",
              }),
            );
          }
        });
      });
    },
  };
}

function adbExecApi(): Plugin {
  return {
    name: "adb-exec-api",
    configureServer(server) {
      // 通用命令执行接口，返回可复制的原始输出
      server.middlewares.use("/api/adb/exec", (request, response) => {
        const req = request as unknown as RawRequest;

        if (req.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }

        let body = "";
        req.on("data", (chunk: string) => {
          body += chunk;
        });

        req.on("end", () => {
          response.setHeader("Content-Type", "application/json; charset=utf-8");

          let tool: unknown;
          let args: unknown;
          try {
            ({ tool, args } = JSON.parse(body));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "请求格式错误" }));
            return;
          }

          if (
            typeof tool !== "string" ||
            !allowedVerbs[tool] ||
            !Array.isArray(args) ||
            args.some((arg) => typeof arg !== "string")
          ) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "不支持的参数" }));
            return;
          }

          const invalid = validateArgs(tool, args as string[]);
          if (invalid) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: invalid }));
            return;
          }

          const executable = tool === "fastboot" ? fastbootPath : adbPath;
          execFile(
            executable,
            args as string[],
            { windowsHide: true, timeout: TIMEOUT },
            (
              error: (Error & { code?: number | string }) | null,
              stdout: string,
              stderr: string,
            ) => {
              const code = error
                ? typeof error.code === "number"
                  ? error.code
                  : null
                : 0;
              response.end(
                JSON.stringify({
                  code,
                  stdout,
                  stderr: stderr || (error ? error.message : ""),
                }),
              );
            },
          );
        });
      });
    },
  };
}

function adbScreenshotApi(): Plugin {
  return {
    name: "adb-screenshot-api",
    configureServer(server) {
      // 截图并以 PNG 保存到指定目录
      server.middlewares.use("/api/adb/screenshot", (request, response) => {
        const req = request as unknown as RawRequest;

        if (req.method !== "POST") {
          response.statusCode = 405;
          response.end();
          return;
        }

        let body = "";
        req.on("data", (chunk: string) => {
          body += chunk;
        });

        req.on("end", () => {
          response.setHeader("Content-Type", "application/json; charset=utf-8");

          let directory: unknown;
          let serial: unknown;
          try {
            ({ directory, serial } = JSON.parse(body));
          } catch {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "请求格式错误" }));
            return;
          }

          if (
            typeof directory !== "string" ||
            directory === "" ||
            !fs.existsSync(directory) ||
            !fs.statSync(directory).isDirectory()
          ) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "保存目录无效" }));
            return;
          }

          const args = [
            ...(typeof serial === "string" && serial !== "" ? ["-s", serial] : []),
            "exec-out",
            "screencap",
            "-p",
          ];

          execFile(
            adbPath,
            args,
            {
              windowsHide: true,
              timeout: 30_000,
              encoding: "buffer",
              maxBuffer: 64 * 1024 * 1024,
            },
            (error: Error | null, stdout: unknown) => {
              if (error) {
                response.statusCode = 500;
                response.end(JSON.stringify({ error: error.message }));
                return;
              }

              const file = `${directory}/screenshot-${Date.now()}.png`;
              try {
                fs.writeFileSync(file, stdout);
              } catch (writeError) {
                response.statusCode = 500;
                response.end(
                  JSON.stringify({
                    error:
                      writeError instanceof Error
                        ? writeError.message
                        : "保存截图失败",
                  }),
                );
                return;
              }
              response.end(JSON.stringify({ path: file }));
            },
          );
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [vue(), adbExecApi(), adbScreenshotApi(), adbScanApi(), Inspect()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
