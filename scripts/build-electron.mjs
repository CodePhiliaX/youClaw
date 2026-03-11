import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// 1. 构建 renderer（Vite）
console.log("Building renderer with Vite...");
execSync("npx vite build", { cwd: path.join(root, "web"), stdio: "inherit" });

// 将 web/dist 的产物移动到 dist/renderer
const webDist = path.join(root, "web", "dist");
const rendererDist = path.join(root, "dist", "renderer");

if (fs.existsSync(rendererDist)) {
  fs.rmSync(rendererDist, { recursive: true });
}
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.renameSync(webDist, rendererDist);
console.log("Renderer output moved to dist/renderer/");

// 2. 编译后端 TypeScript（src/ → dist/src/）
console.log("Compiling backend TypeScript...");
execSync("npx tsc -p tsconfig.build.json", { cwd: root, stdio: "inherit" });

// 3. 编译 Electron TypeScript（electron/ → dist/electron/）
console.log("Compiling Electron TypeScript...");
execSync("npx tsc -p electron/tsconfig.json", { cwd: root, stdio: "inherit" });

console.log("Build complete.");
