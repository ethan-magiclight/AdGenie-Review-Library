import assert from "node:assert/strict";
import test from "node:test";
import { genreDefaultsFromCandidates } from "../lib/genre-defaults.mjs";

test("writes every candidate and uses the highest-confidence genre as primary", () => {
  assert.deepEqual(genreDefaultsFromCandidates([
    { genre: "Story-Driven Product Ad", confidence: 0.87 },
    { genre: "TVC / Brand Commercial", confidence: 0.9 },
  ]), {
    genres: ["Story-Driven Product Ad", "TVC / Brand Commercial"],
    primary_genre: "TVC / Brand Commercial",
    secondary_genres: ["Story-Driven Product Ad"],
  });
});

test("deduplicates candidates and keeps their best confidence", () => {
  assert.deepEqual(genreDefaultsFromCandidates([
    { genre: "Product Demo", confidence: 0.4 },
    { genre: "Feature Callout", confidence: 0.7 },
    { genre: "Product Demo", confidence: 0.8 },
  ]), {
    genres: ["Product Demo", "Feature Callout"],
    primary_genre: "Product Demo",
    secondary_genres: ["Feature Callout"],
  });
});

test("supports string candidates and ignores empty values", () => {
  assert.deepEqual(genreDefaultsFromCandidates(["TVC / Brand Commercial", "", null]), {
    genres: ["TVC / Brand Commercial"],
    primary_genre: "TVC / Brand Commercial",
    secondary_genres: [],
  });
});
