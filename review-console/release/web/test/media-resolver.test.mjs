import assert from "node:assert/strict";
import test from "node:test";
import {
  directMediaDescriptor,
  MediaResolutionError,
  publicMediaFields,
  refreshStashMedia,
  refreshStashMediaViaProxy,
  validateBestAdsDirectMediaUrl,
  validateBestAdsMediaUrl,
} from "../lib/media-resolver.mjs";

const video = {
  video_id: "best_ads:185499:2227057d06",
  media_provider: "best_ads_signed_mp4",
  media_asset_id: "2227057d06",
};
const now = Date.parse("2026-08-20T08:00:00.000Z");

function vimeoConfigRequestUrl(videoId, issuedAt, expiresIn = 3600) {
  const url = new URL(`https://player.vimeo.com/video/${videoId}/config/request`);
  url.searchParams.set("signature", "test-signature");
  url.searchParams.set("time", String(issuedAt));
  url.searchParams.set("expires", String(expiresIn));
  return url.href;
}

test("validates a signed Best Ads URL for the expected asset", () => {
  const result = validateBestAdsMediaUrl(
    "https://bestads-files.b-cdn.net/download/2227057d06.mp4?token=secret&expires=1787216400",
    video,
    now,
  );
  assert.equal(result.access_status, "temporary");
  assert.equal(result.expires_at, "2026-08-20T09:00:00.000Z");
  assert.match(result.playback_url, /token=secret/);
});

test("rejects a signed URL for another asset", () => {
  assert.throws(
    () => validateBestAdsMediaUrl("https://bestads-files.b-cdn.net/download/wrong.mp4?token=secret&expires=1787216400", video, now),
    (error) => error instanceof MediaResolutionError && error.code === "MEDIA_ASSET_MISMATCH",
  );
});

test("rejects untrusted hosts and expired signatures", () => {
  assert.throws(
    () => validateBestAdsMediaUrl("https://example.com/download/2227057d06.mp4?token=secret&expires=1787216400", video, now),
    (error) => error.code === "UNTRUSTED_MEDIA_HOST",
  );
  assert.throws(
    () => validateBestAdsMediaUrl("https://bestads-files.b-cdn.net/download/2227057d06.mp4?token=secret&expires=1787212800", video, now),
    (error) => error.code === "MEDIA_SIGNATURE_EXPIRED",
  );
});

test("uses a stable Best Ads CDN URL for cloud playback and download", () => {
  const result = validateBestAdsDirectMediaUrl(
    "https://bestads-files.b-cdn.net/download/2227057d06.mp4",
    video,
    now,
  );
  assert.equal(result.playback_url, "https://bestads-files.b-cdn.net/download/2227057d06.mp4");
  assert.equal(result.download_url, result.playback_url);
  assert.equal(result.access_status, "available");
  assert.equal(result.expires_at, null);
});

test("rejects an untrusted or mismatched stable Best Ads URL", () => {
  assert.throws(
    () => validateBestAdsDirectMediaUrl("https://example.com/download/2227057d06.mp4", video, now),
    (error) => error.code === "UNTRUSTED_MEDIA_HOST",
  );
  assert.throws(
    () => validateBestAdsDirectMediaUrl("https://bestads-files.b-cdn.net/download/wrong.mp4", video, now),
    (error) => error.code === "MEDIA_ASSET_MISMATCH",
  );
});

test("exposes stable resolver and download paths", () => {
  assert.deepEqual(publicMediaFields(video), {
    media_resolver_url: "/api/videos/best_ads%3A185499%3A2227057d06/media",
    media_download_url: "/api/videos/best_ads%3A185499%3A2227057d06/media/download",
  });
  assert.deepEqual(publicMediaFields({ video_id: "youtube", media_provider: "youtube" }), {});
});

test("uses an existing direct MP4 URL without refreshing", () => {
  const result = directMediaDescriptor({
    media_provider: "aotw_cdn",
    playback_url: "https://cdn.example.test/video.mp4",
    media_access_status: "available",
  }, now);
  assert.equal(result.download_url, "https://cdn.example.test/video.mp4");
  assert.equal(result.access_status, "available");
});

test("resolves a STASH Vimeo locator to a temporary HLS URL without credentials", async () => {
  const stashVideo = {
    video_id: "stash:VID178:3:1207188087",
    source_site: "stash",
    media_provider: "hls",
    media_asset_id: "1207188087",
    original_media_url: "https://player.vimeo.com/video/1207188087",
  };
  const issuedAt = Math.floor(now / 1000);
  const expiresIn = 3600;
  const configUrl = vimeoConfigRequestUrl("1207188087", issuedAt, expiresIn);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), credentials: options.credentials });
    if (String(url) === stashVideo.original_media_url) {
      return new Response(`<html><script>window.playerConfig={"config_url":"${configUrl.replaceAll("&", "\\u0026")}"}</script></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (String(url) === configUrl) {
      return Response.json({
        files: {
          hls: {
            default_cdn: "akfire_interconnect_quic",
            cdns: {
              akfire_interconnect_quic: {
                avc_url: "https://vod-adaptive-ak.vimeocdn.com/video/fixture/playlist.m3u8",
              },
            },
          },
        },
      });
    }
    return new Response("not found", { status: 404 });
  };

  const result = await refreshStashMedia(stashVideo, { fetchImpl, now: () => now });

  assert.equal(result.playback_url, "https://vod-adaptive-ak.vimeocdn.com/video/fixture/playlist.m3u8");
  assert.equal(result.download_url, result.playback_url);
  assert.equal(result.access_status, "temporary");
  assert.equal(result.expires_at, new Date((issuedAt + expiresIn) * 1000).toISOString());
  assert.deepEqual(calls.map(({ credentials }) => credentials), ["omit", "omit"]);
});

test("rejects mismatched STASH Vimeo IDs and untrusted HLS hosts", async () => {
  const stashVideo = {
    source_site: "stash",
    media_provider: "hls",
    media_asset_id: "1207188087",
    original_media_url: "https://player.vimeo.com/video/9999999999",
  };
  await assert.rejects(
    () => refreshStashMedia(stashVideo, { fetchImpl: async () => new Response("unused"), now: () => now }),
    (error) => error instanceof MediaResolutionError && error.code === "MEDIA_ASSET_MISMATCH",
  );

  const issuedAt = Math.floor(now / 1000);
  const playerUrl = "https://player.vimeo.com/video/1207188087";
  const configUrl = vimeoConfigRequestUrl("1207188087", issuedAt);
  const fetchImpl = async (url) => String(url) === playerUrl
    ? new Response(`{"config_url":"${configUrl.replaceAll("&", "\\u0026")}"}`, { status: 200 })
    : Response.json({ files: { hls: { default_cdn: "bad", cdns: { bad: { url: "https://example.com/video.m3u8" } } } } });
  await assert.rejects(
    () => refreshStashMedia({ ...stashVideo, original_media_url: playerUrl }, { fetchImpl, now: () => now }),
    (error) => error instanceof MediaResolutionError && error.code === "UNTRUSTED_MEDIA_HOST",
  );
});

test("resolves STASH HLS through the local CDP fallback without credentials and closes its tab", async () => {
  const issuedAt = Math.floor(now / 1000);
  const playerUrl = "https://player.vimeo.com/video/1207188087";
  const configUrl = vimeoConfigRequestUrl("1207188087", issuedAt);
  const proxyCalls = [];
  let evaluation = 0;
  const proxyFetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    proxyCalls.push({ pathname: parsed.pathname, method: options.method || "GET", body: options.body || "" });
    if (parsed.pathname === "/new") return Response.json({ targetId: "stash-vimeo-tab" });
    if (parsed.pathname === "/navigate") return Response.json({ ok: true });
    if (parsed.pathname === "/close") return Response.json({ ok: true });
    if (parsed.pathname === "/eval") {
      evaluation += 1;
      if (evaluation === 1) {
        return Response.json({ value: JSON.stringify({
          ok: true,
          status: 200,
          body: `{"config_url":"${configUrl.replaceAll("&", "\\u0026")}"}`,
        }) });
      }
      return Response.json({ value: JSON.stringify({
        ok: true,
        status: 200,
        body: JSON.stringify({
          files: {
            hls: {
              default_cdn: "fastly_skyfire",
              cdns: {
                fastly_skyfire: {
                  url: "https://skyfire.vimeocdn.com/video/fixture/playlist.m3u8",
                },
              },
            },
          },
        }),
      }) });
    }
    return Response.json({ ok: true });
  };

  const result = await refreshStashMediaViaProxy({
    video_id: "stash:VID178:3:1207188087",
    source_site: "stash",
    media_provider: "hls",
    media_asset_id: "1207188087",
    original_media_url: playerUrl,
  }, { proxyFetchImpl, now: () => now });

  assert.equal(result.playback_url, "https://skyfire.vimeocdn.com/video/fixture/playlist.m3u8");
  assert.equal(proxyCalls.filter((call) => call.pathname === "/eval").length, 2);
  assert.ok(proxyCalls.filter((call) => call.pathname === "/eval").every((call) => call.body.includes('credentials:"omit"')));
  assert.equal(proxyCalls.at(-1).pathname, "/close");
});
