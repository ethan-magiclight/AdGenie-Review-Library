import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function executableCandidates(name) {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
    : [""];
  return pathEntries.flatMap((directory) => extensions.map((extension) => path.join(directory, `${name}${extension}`)));
}

export function resolveExecutable(environmentVariable, names, fallbackPaths = []) {
  const explicit = process.env[environmentVariable];
  if (explicit) {
    if (fs.existsSync(explicit)) return explicit;
    throw new Error(`${environmentVariable} points to a missing executable: ${explicit}`);
  }
  for (const candidate of [...names.flatMap(executableCandidates), ...fallbackPaths]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing executable (${names.join(" / ")}). Install it or set ${environmentVariable}.`);
}

function loadPackage(names) {
  const attempted = [];
  for (const name of names) {
    try {
      return require(name);
    } catch (error) {
      attempted.push(`${name}: ${error.code ?? error.message}`);
    }
  }
  const externalModules = process.env.ADGENIE_NODE_MODULES;
  if (externalModules) {
    for (const name of names) {
      const candidate = path.join(externalModules, name);
      try {
        return require(candidate);
      } catch (error) {
        attempted.push(`${candidate}: ${error.code ?? error.message}`);
      }
    }
  }
  throw new Error(`Missing Node dependency (${names.join(" / ")}). Run \`npm --prefix collect install\`. ${attempted.join("; ")}`);
}

export function loadSharp() {
  return loadPackage(["sharp"]);
}

export function loadPlaywright() {
  return loadPackage(["playwright-core", "playwright"]);
}

export function resolveCurl() {
  return resolveExecutable("CURL_PATH", ["curl"], ["/usr/bin/curl"]);
}

export function resolveFfmpeg() {
  return resolveExecutable("FFMPEG_PATH", ["ffmpeg"]);
}

export function resolveChromeExecutable(explicitPath) {
  if (explicitPath) {
    if (fs.existsSync(explicitPath)) return explicitPath;
    throw new Error(`--executable-path points to a missing browser: ${explicitPath}`);
  }
  return resolveExecutable("CHROME_PATH", ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome", "msedge"], [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ]);
}

export function curlProxyArgs() {
  return process.env.ADGENIE_NO_PROXY === "1" ? ["--noproxy", "*"] : [];
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function inspectImage(filePath) {
  const sharp = loadSharp();
  const metadata = await sharp(filePath, { density: 300 }).metadata();
  return { width: metadata.width ?? null, height: metadata.height ?? null };
}

export async function normalizeLogo(sourcePath, outputPath) {
  const sharp = loadSharp();
  await sharp(sourcePath, { density: 300 })
    .rotate()
    .resize(184, 184, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 20, bottom: 20, left: 20, right: 20, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toColourspace("srgb")
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
}
