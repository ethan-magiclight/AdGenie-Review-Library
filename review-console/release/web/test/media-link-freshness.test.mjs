import assert from "node:assert/strict";
import test from "node:test";
import { isStableBestAdsCdnUrl, mediaLinkIsFresh } from "../public/media-link-freshness.mjs";

const now = Date.parse("2026-08-20T08:00:00.000Z");

test("treats an available stable Best Ads CDN URL as fresh without an expiry", () => {
  assert.equal(mediaLinkIsFresh({
    media_provider: "best_ads_signed_mp4",
    media_access_status: "available",
    playback_url: "https://bestads-files.b-cdn.net/download/2227057d06.mp4",
    media_expires_at: null,
  }, now), true);
});

test("keeps signed Best Ads URLs subject to their expiry", () => {
  assert.equal(mediaLinkIsFresh({
    media_provider: "best_ads_signed_mp4",
    media_access_status: "temporary",
    playback_url: "https://bestads-files.b-cdn.net/download/2227057d06.mp4?token=test&expires=1",
    media_expires_at: "2026-08-20T08:04:00.000Z",
  }, now), false);
  assert.equal(mediaLinkIsFresh({
    media_provider: "best_ads_signed_mp4",
    media_access_status: "temporary",
    playback_url: "https://bestads-files.b-cdn.net/download/2227057d06.mp4?token=test&expires=2",
    media_expires_at: "2026-08-20T09:00:00.000Z",
  }, now), true);
});

test("does not trust an unapproved host as a stable Best Ads URL", () => {
  assert.equal(isStableBestAdsCdnUrl("https://example.com/download/2227057d06.mp4"), false);
  assert.equal(mediaLinkIsFresh({
    media_provider: "best_ads_signed_mp4",
    media_access_status: "available",
    playback_url: "https://example.com/download/2227057d06.mp4",
    media_expires_at: null,
  }, now), false);
});

test("keeps other direct providers immediately playable", () => {
  assert.equal(mediaLinkIsFresh({
    media_provider: "aotw_cdn",
    media_access_status: "available",
    playback_url: "https://video.adsoftheworld.com/example.mp4",
  }, now), true);
});
