import assert from "node:assert/strict";
import test from "node:test";
import { effectiveIndustry, effectiveProductCategory } from "../public/classification-fallbacks.mjs";

test("prefers confirmed classification values", () => {
  const video = {
    industry: "Food & Beverage",
    industry_candidate: "Education & Digital Services",
    product_category: "Confectionery & Snacks",
    product_category_candidate: "Education & Learning Services",
  };

  assert.equal(effectiveIndustry(video), "Food & Beverage");
  assert.equal(effectiveProductCategory(video), "Confectionery & Snacks");
});

test("falls back to top-level candidate values", () => {
  const video = {
    industry: null,
    industry_candidate: "Education & Digital Services",
    product_category: null,
    product_category_candidate: "Education & Learning Services",
  };

  assert.equal(effectiveIndustry(video), "Education & Digital Services");
  assert.equal(effectiveProductCategory(video), "Education & Learning Services");
});

test("falls back to the classification candidate and handles missing data", () => {
  const video = {
    classification_candidate: {
      industry: "Financial Services",
      product_category: "Insurance Services",
    },
  };

  assert.equal(effectiveIndustry(video), "Financial Services");
  assert.equal(effectiveProductCategory(video), "Insurance Services");
  assert.equal(effectiveIndustry(), null);
  assert.equal(effectiveProductCategory(), null);
});
