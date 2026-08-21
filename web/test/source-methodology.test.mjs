import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { validateSourceCollectionMethodology } from "../lib/source-methodology.mjs";

const methodologyUrl = new URL("../../collect/source-collection-methodology-v1.json", import.meta.url);

async function loadReviewUiModule() {
  globalThis.document = { querySelector: () => null };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  return import(`../public/app.js?source-methodology-test=${Date.now()}`);
}

test("accepts the committed Best Ads, Ads of the World, and STASH collection ledger", async () => {
  const methodology = JSON.parse(await fs.readFile(methodologyUrl, "utf8"));
  assert.deepEqual(validateSourceCollectionMethodology(methodology), []);
});

test("rejects an incomplete STASH channel entry", async () => {
  const methodology = JSON.parse(await fs.readFile(methodologyUrl, "utf8"));
  const stash = methodology.channels.find((channel) => channel.id === "stash");
  stash.collection_plan = [];

  assert.deepEqual(validateSourceCollectionMethodology(methodology), [
    "collection_plan is required: stash",
  ]);
});

test("rejects progress that is not safe to continue from", async () => {
  const methodology = JSON.parse(await fs.readFile(methodologyUrl, "utf8"));
  const best = methodology.channels.find((channel) => channel.id === "best_ads");
  best.progress.remaining_candidates = 1;
  methodology.shared_rules.next_run_requires_ledger_update = false;

  assert.deepEqual(validateSourceCollectionMethodology(methodology), [
    "next run must require a ledger update",
    "Best Ads remaining_candidates must be 0",
  ]);
});

test("surfaces the incomplete zero-record STASH trial state in the platform filter and empty result", async () => {
  const methodology = JSON.parse(await fs.readFile(methodologyUrl, "utf8"));
  const { platformFilterItems, emptyVideosMessage } = await loadReviewUiModule();
  const stashOption = platformFilterItems([], methodology).find(([value]) => value === "stash");

  assert.deepEqual(stashOption, ["stash", "STASH（0 · 试采未完成）"]);
  assert.equal(
    emptyVideosMessage("stash", [], methodology),
    "STASH 当前 0 条可审核视频：10/10 媒体解析已通过；详情、10 帧、去重、导入与侧栏验收尚未完成，暂不扩量。详情见“方法论记录”。",
  );
});
