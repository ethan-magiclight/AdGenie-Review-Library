import assert from "node:assert/strict";
import test from "node:test";

process.env.VERCEL = "1";
const { handleRequest } = await import("../server.mjs");

async function request(url) {
  const result = { status: null, headers: null, body: null };
  await handleRequest({ method: "GET", url, headers: { host: "127.0.0.1" } }, {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
    },
    end(body) {
      result.body = body;
    },
  });
  return result;
}

test("does not redirect HLS-only media to an MP4 download", async () => {
  const originalFetch = globalThis.fetch;
  const issuedAt = Math.floor(Date.now() / 1000);
  const configUrl = new URL("https://player.vimeo.com/video/1207188087/config/request");
  configUrl.searchParams.set("signature", "route-test");
  configUrl.searchParams.set("time", String(issuedAt));
  configUrl.searchParams.set("expires", "3600");
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes("player.vimeo.com/video/1207188087/config/request")) {
      return Response.json({
        files: {
          hls: {
            default_cdn: "route_test",
            cdns: { route_test: { url: "https://vod-adaptive-ak.vimeocdn.com/video/route-test/playlist.m3u8" } },
          },
        },
      });
    }
    if (value.includes("player.vimeo.com/video/1207188087")) {
      return new Response(`{"config_url":"${configUrl.href.replaceAll("&", "\\u0026")}"}`, { status: 200 });
    }
    throw new Error(`Unexpected route test URL: ${value}`);
  };

  try {
    const response = await request("/api/videos/stash%3AVID178%3A3%3A1207188087/media/download");
    assert.equal(response.status, 409);
    assert.equal(response.headers["Cache-Control"], "no-store");
    const payload = JSON.parse(response.body);
    assert.equal(payload.code, "MEDIA_DOWNLOAD_NOT_AVAILABLE");
    assert.equal(payload.playback_kind, "hls");
    assert.equal(payload.playback_url.endsWith("playlist.m3u8"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
