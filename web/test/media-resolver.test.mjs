import assert from "node:assert/strict";
import test from "node:test";
import {
  directMediaDescriptor,
  MediaResolutionError,
  publicMediaFields,
  validateBestAdsMediaUrl,
} from "../lib/media-resolver.mjs";

const video = {
  video_id: "best_ads:185499:2227057d06",
  media_provider: "best_ads_signed_mp4",
  media_asset_id: "2227057d06",
};
const now = Date.parse("2026-08-20T08:00:00.000Z");

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
