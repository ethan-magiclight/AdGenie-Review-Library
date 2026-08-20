import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { validateSourceCollectionMethodology } from "../lib/source-methodology.mjs";

const methodologyUrl = new URL("../../collect/source-collection-methodology-v1.json", import.meta.url);

test("accepts the committed Best Ads and Ads of the World collection ledger", async () => {
  const methodology = JSON.parse(await fs.readFile(methodologyUrl, "utf8"));
  assert.deepEqual(validateSourceCollectionMethodology(methodology), []);
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
