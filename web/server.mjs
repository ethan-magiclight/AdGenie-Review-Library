import http from "node:http";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const webRoot = path.dirname(__filename);
const repoRoot = path.resolve(webRoot, "..");
const publicRoot = path.join(webRoot, "public");
const dataPath = path.join(webRoot, "data", "creative-library-state.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function readState() {
  if (!fssync.existsSync(dataPath)) {
    throw new Error("Missing web/data/creative-library-state.json. Run: npm run import");
  }
  return JSON.parse(await fs.readFile(dataPath, "utf8"));
}

async function writeState(state) {
  state.updated_at = new Date().toISOString();
  await fs.writeFile(dataPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, payload) {
  send(res, status, JSON.stringify(payload), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function safeJoin(root, requestPath) {
  const clean = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const resolved = path.resolve(root, clean);
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function statusById(state, id) {
  return state.statuses.find((status) => status.id === id);
}

function videoById(state, id) {
  return state.videos.find((video) => video.id === id || video.video_id === id);
}

function cloneReviewValue(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function appendReview(state, video, event) {
  const now = new Date().toISOString();
  const reviewEvent = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    video_id: video.video_id,
    action: event.action,
    reason_code: event.reason_code || null,
    reason_text: event.reason_text || "",
    before: cloneReviewValue(event.before),
    after: cloneReviewValue(event.after),
    methodology_candidate: Boolean(event.methodology_candidate),
    created_by: event.created_by || "local-user",
    created_at: now,
  };
  state.review_events.unshift(reviewEvent);
  video.review_events = video.review_events || [];
  video.review_events.unshift(reviewEvent);
  video.updated_at = now;
  return reviewEvent;
}

async function handleApi(req, res, url) {
  const state = await readState();
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(res, 200, state);
  }

  if (req.method === "POST" && url.pathname === "/api/statuses") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim();
    if (!name) return json(res, 400, { error: "状态名称不能为空" });
    const existing = state.statuses.find((status) => status.name === name);
    if (existing) return json(res, 200, existing);
    const status = {
      id: `custom_${Date.now()}`,
      name,
      color: body.color || "#64748b",
      is_system: false,
      sort_order: state.statuses.length + 1,
    };
    state.statuses.push(status);
    await writeState(state);
    return json(res, 201, status);
  }

  if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "statuses" && parts[2]) {
    const target = statusById(state, parts[2]);
    if (!target) return json(res, 404, { error: "状态不存在" });
    if (target.is_system) return json(res, 400, { error: "系统状态不能删除" });
    state.statuses = state.statuses.filter((status) => status.id !== target.id);
    for (const video of state.videos) {
      video.status_ids = (video.status_ids || []).filter((id) => id !== target.id);
    }
    await writeState(state);
    return json(res, 200, { ok: true });
  }

  if (parts[0] === "api" && parts[1] === "videos" && parts[2]) {
    const video = videoById(state, parts[2]);
    if (!video) return json(res, 404, { error: "视频不存在" });

    if (req.method === "POST" && parts[3] === "statuses") {
      const body = await parseBody(req);
      const nextIds = [...new Set((body.status_ids || []).filter((id) => statusById(state, id)))];
      const before = [...(video.status_ids || [])];
      video.status_ids = nextIds;
      const event = appendReview(state, video, {
        action: "status_update",
        before,
        after: nextIds,
        reason_text: body.reason_text || "",
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }

    if (req.method === "POST" && parts[3] === "classification") {
      const body = await parseBody(req);
      const before = {
        product_category: video.product_category,
        primary_genre: video.primary_genre,
        genres: [...(video.genres || [])],
      };
      video.product_category = body.product_category || video.product_category;
      video.primary_genre = body.primary_genre || null;
      video.genres = [...new Set(body.genres || [])];
      video.secondary_genres = video.genres.filter((genre) => genre !== video.primary_genre);
      const event = appendReview(state, video, {
        action: "classification_update",
        reason_code: body.reason_code || "MANUAL_RECLASSIFICATION",
        reason_text: body.reason_text || "",
        methodology_candidate: Boolean(body.methodology_candidate),
        before,
        after: {
          product_category: video.product_category,
          primary_genre: video.primary_genre,
          genres: video.genres,
        },
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }

    if (req.method === "POST" && parts[3] === "blacklist") {
      const body = await parseBody(req);
      const blacklisted = body.blacklisted !== false;
      const before = { blacklisted: video.blacklisted, status_ids: [...(video.status_ids || [])] };
      video.blacklisted = blacklisted;
      video.status_ids = video.status_ids || [];
      if (blacklisted && !video.status_ids.includes("blacklisted")) video.status_ids.push("blacklisted");
      if (!blacklisted) video.status_ids = video.status_ids.filter((id) => id !== "blacklisted");
      const event = appendReview(state, video, {
        action: blacklisted ? "blacklist" : "unblacklist",
        reason_code: body.reason_code || (blacklisted ? "MANUAL_BLACKLIST" : "MANUAL_RESTORE"),
        reason_text: body.reason_text || "",
        methodology_candidate: Boolean(body.methodology_candidate),
        before,
        after: { blacklisted: video.blacklisted, status_ids: video.status_ids },
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }

    if (req.method === "POST" && parts[3] === "review") {
      const body = await parseBody(req);
      const event = appendReview(state, video, {
        action: body.action || "note",
        reason_code: body.reason_code || null,
        reason_text: body.reason_text || "",
        methodology_candidate: Boolean(body.methodology_candidate),
      });
      await writeState(state);
      return json(res, 200, { video, event });
    }
  }

  return json(res, 404, { error: "API not found" });
}

async function serveStatic(req, res, url) {
  if (url.pathname.startsWith("/media/collect/")) {
    const mediaPath = safeJoin(repoRoot, url.pathname.replace(/^\/media\//, ""));
    if (!mediaPath || !mediaPath.startsWith(path.join(repoRoot, "collect"))) {
      return send(res, 403, "Forbidden");
    }
    try {
      const body = await fs.readFile(mediaPath);
      return send(res, 200, body, {
        "Content-Type": mime[path.extname(mediaPath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      });
    } catch {
      return send(res, 404, "Not found");
    }
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeJoin(publicRoot, pathname);
  if (!filePath) return send(res, 403, "Forbidden");
  try {
    const body = await fs.readFile(filePath);
    return send(res, 200, body, {
      "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
  } catch {
    return send(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    return json(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`AdGenie Creative Library running at http://${host}:${port}`);
});
