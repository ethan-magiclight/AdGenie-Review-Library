import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { validateSourceCollectionMethodology } from "../lib/source-methodology.mjs";

const methodologyUrl = new URL("../../collect/source-collection-methodology-v1.json", import.meta.url);

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
