import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2]?.trim();
const semver = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

if (!version || !semver.test(version)) {
  console.error(
    "用法: npm run version:set -- <版本号>\n例如: npm run version:set -- 0.1.5",
  );
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const write = (file, content) => writeFileSync(join(root, file), content, "utf8");
const updated = [];

// package.json 和 tauri.conf.json
for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
  const data = JSON.parse(read(file));
  data.version = version;
  write(file, `${JSON.stringify(data, null, 2)}\n`);
  updated.push(file);
}

// Cargo.toml 中 [package] 下的 version
{
  const file = "src-tauri/Cargo.toml";
  const content = read(file);
  const pattern = /^(\[+package\]+[\s\S]*?^version\s*=\s*")[^"]+(")/m;
  if (!pattern.test(content)) {
    throw new Error("未在 Cargo.toml 的 [package] 中找到 version");
  }
  write(
    file,
    content.replace(pattern, (_, prefix, suffix) => `${prefix}${version}${suffix}`),
  );
  updated.push(file);
}

// Cargo.lock 中本项目的 package 块
{
  const file = "src-tauri/Cargo.lock";
  const content = read(file);
  const pattern =
    /(\[\[package\]\]\r?\nname = "cat-android-box"\r?\nversion = ")[^"]+(")/;
  if (!pattern.test(content)) {
    throw new Error("未在 Cargo.lock 中找到 cat-android-box");
  }
  write(file, content.replace(pattern, `$1${version}$2`));
  updated.push(file);
}

console.log(`版本号已更新为 ${version}:`);
for (const file of updated) {
  console.log(`  - ${file}`);
}
