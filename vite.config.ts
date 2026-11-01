import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { execFile, execFileSync } from "node:child_process";
// @ts-expect-error type error without @types/node package
import fs from "node:fs";
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
    "push",
    "reboot",
    "connect",
    "disconnect",
    "tcpip",
  ],
  fastboot: ["devices", "flash", "flashing", "reboot", "oem"],
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

  const verb = rest[0];
  if (!verb || !allowedVerbs[tool]?.includes(verb)) {
    return `不允许的 ${tool} 命令: ${verb ?? ""}`;
  }
  return null;
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
  plugins: [vue(), adbExecApi(), adbScreenshotApi(), Inspect()],

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
