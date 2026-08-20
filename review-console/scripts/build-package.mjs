import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const configPath = path.join(repoRoot, "review-console/package.config.json");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const releaseRoot = path.join(repoRoot, config.output);
const stagingRoot = path.join(repoRoot, `review-console/.release-stage-${process.pid}`);
const statePath = path.join(repoRoot, config.state);
const state = JSON.parse(await fs.readFile(statePath, "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeRelativePath(value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} must be a non-empty path`);
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  assert(!normalized.split("/").includes(".."), `${label} escapes the package root: ${value}`);
  return normalized;
}

function remoteVideoReference(video) {
  return [video.playback_url, video.original_media_url, video.embed_url, video.url]
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
}

async function copyPath(relativePath) {
  const safePath = safeRelativePath(relativePath, "copy path");
  const source = path.join(repoRoot, safePath);
  const target = path.join(stagingRoot, safePath);
  const sourceStat = await fs.stat(source);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (sourceStat.isDirectory()) {
    await fs.cp(source, target, { recursive: true, force: true });
  } else {
    await fs.copyFile(source, target);
  }
}

async function copyDataAsset(relativePath) {
  const safePath = safeRelativePath(relativePath, "data asset");
  const workspaceSource = path.join(repoRoot, safePath);
  const previousPackageSource = path.join(releaseRoot, safePath);
  let source = workspaceSource;
  try {
    await fs.access(source);
  } catch {
    source = previousPackageSource;
  }
  await fs.access(source);
  const target = path.join(stagingRoot, safePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function sha256(filePath) {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function walkFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files;
}

assert(Array.isArray(state.videos) && state.videos.length > 0, "State must contain videos");
assert(Array.isArray(state.source_files), "State must contain source_files");

const missingVideoLinks = state.videos.filter((video) => !remoteVideoReference(video));
assert(missingVideoLinks.length === 0, `Videos without a remote reference: ${missingVideoLinks.length}`);

const sourceFiles = [...new Set(state.source_files.map((value) => safeRelativePath(value, "source file")))].sort();
const contactSheets = [...new Set(state.videos
  .map((video) => video.contact_sheet)
  .filter((value) => typeof value === "string" && value.startsWith("/media/"))
  .map((value) => safeRelativePath(value.slice("/media/".length), "contact sheet")))].sort();

for (const relativePath of [...sourceFiles, ...contactSheets]) {
  assert(relativePath.startsWith("collect/"), `Packaged data asset must stay under collect/: ${relativePath}`);
  const existsInWorkspace = await fs.access(path.join(repoRoot, relativePath)).then(() => true).catch(() => false);
  const existsInPreviousPackage = await fs.access(path.join(releaseRoot, relativePath)).then(() => true).catch(() => false);
  assert(existsInWorkspace || existsInPreviousPackage, `Missing packaged data asset: ${relativePath}`);
}

await fs.rm(stagingRoot, { recursive: true, force: true });
await fs.mkdir(stagingRoot, { recursive: true });

for (const relativePath of [...config.runtime_paths, config.state, ...config.documentation_paths]) {
  await copyPath(relativePath);
}
for (const relativePath of [...sourceFiles, ...contactSheets]) await copyDataAsset(relativePath);
await fs.mkdir(path.join(stagingRoot, "scripts"), { recursive: true });
await fs.copyFile(
  path.join(repoRoot, "review-console/scripts/validate-package.mjs"),
  path.join(stagingRoot, "scripts/validate-package.mjs")
);

const packageJson = {
  name: "adgenie-review-console",
  version: "1.0.0",
  private: true,
  type: "module",
  scripts: {
    start: "node web/server.mjs",
    dev: "node web/server.mjs",
    check: "node --check web/public/app.js && node --check web/server.mjs && node --check web/lib/media-resolver.mjs && node --check web/lib/genre-defaults.mjs",
    test: "node --test web/test/*.test.mjs",
    "validate:package": "node scripts/validate-package.mjs",
    build: "npm run check && npm test && npm run validate:package"
  }
};

const vercelConfig = {
  version: 2,
  builds: [
    {
      src: "web/server.mjs",
      use: "@vercel/node",
      config: {
        includeFiles: [
          "web/public/**",
          "web/lib/**",
          "web/data/creative-library-state.json",
          "collect/**/*.json",
          "collect/**/*.jpg",
          "collect/**/*.jpeg",
          "collect/**/*.png"
        ]
      }
    }
  ],
  routes: [{ src: "/(.*)", dest: "web/server.mjs" }]
};

const readme = `# AdGenie Review Console\n\n独立部署的广告视频审核台。该目录由上游 AdGenie 工作区自动生成，不要直接编辑生成文件。\n\n## 数据范围\n\n- 完整审核状态：\`web/data/creative-library-state.json\`\n- 视频资源：仅远程链接，不包含 MP4/MOV/WebM 文件\n- 预览资源：仅包含表数据实际引用的联系表图片\n- 来源证据：包含状态文件 \`source_files\` 声明的 JSON\n\n## 本地验证\n\n\`\`\`bash\n+npm run build\n+npm start\n+\`\`\`\n\n默认地址：\`http://127.0.0.1:4173\`。\n\n## 研发接入\n\n- \`GET /api/bootstrap\`：获取完整审核台表数据。\n- \`GET /api/videos/:id/media\`：获取当前可播放/下载的视频链接。\n- \`POST /api/videos/:id/media\`：强制刷新临时媒体链接。\n- \`GET /api/videos/:id/media/download\`：跳转到当前有效的视频下载地址。\n\n当前 JSON 写入适合本地单人审核。Serverless 部署用于数据与播放链路验证；多人持久审核需要接入数据库或对象存储。\n`;

await fs.writeFile(path.join(stagingRoot, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
await fs.writeFile(path.join(stagingRoot, "vercel.json"), `${JSON.stringify(vercelConfig, null, 2)}\n`);
await fs.writeFile(path.join(stagingRoot, "README.md"), readme);

const filesBeforeManifest = await walkFiles(stagingRoot);
let packageBytes = 0;
for (const relativePath of filesBeforeManifest) {
  packageBytes += (await fs.stat(path.join(stagingRoot, relativePath))).size;
}

const manifest = {
  version: 1,
  generated_from_state_updated_at: state.updated_at || state.generated_at || null,
  state_sha256: await sha256(statePath),
  counts: {
    videos: state.videos.length,
    industries: state.industries?.length || 0,
    categories: state.categories?.length || 0,
    genres: state.genres?.length || 0,
    genre_groups: state.genre_groups?.length || 0,
    statuses: state.statuses?.length || 0,
    review_events: state.review_events?.length || 0,
    source_files: sourceFiles.length,
    contact_sheets: contactSheets.length,
    remote_video_references: state.videos.length,
    local_video_files: 0
  },
  source_files: sourceFiles,
  contact_sheets: contactSheets,
  package: {
    files_excluding_manifest: filesBeforeManifest.length,
    bytes_excluding_manifest: packageBytes
  }
};

await fs.writeFile(path.join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await fs.rm(releaseRoot, { recursive: true, force: true });
await fs.rename(stagingRoot, releaseRoot);
console.log(JSON.stringify({ output: config.output, ...manifest.counts, bytes: packageBytes }, null, 2));
