import test from "node:test";
import assert from "node:assert/strict";

import {
  brandLogoAssetMap,
  brandLogoFileMap,
  buildBrandGovernance,
  resolveBrandLogoAsset,
} from "../lib/brand-governance.mjs";

const mapping = {
  version: 1,
  canonical_brands: [
    {
      canonical_brand_id: "nike",
      display_name: "Nike",
      video_count: 1,
      primary_video_count: 1,
      raw_aliases: ["NIKE"],
      source_labels: [],
      mapping_statuses: ["proposed"],
      identity_confirmed: false,
      logo_collection_readiness: "identity_review_required",
    },
  ],
  video_mappings: [
    {
      video_id: "formal-1",
      raw_brand: "NIKE",
      canonical_brands: [{ id: "nike", name: "Nike" }],
      primary_brand_id: "nike",
      mapping_status: "proposed",
      mapping_method: "manual_alias_override",
    },
    {
      video_id: "youtube-1",
      raw_brand: "Legacy",
      canonical_brands: [{ id: "legacy", name: "Legacy" }],
      primary_brand_id: "legacy",
      mapping_status: "proposed",
    },
  ],
};

const catalog = {
  version: 3,
  brands: [
    {
      canonical_brand_id: "nike",
      display_name: "Nike",
      status: "official_asset_collected_pending_approval",
      approved_for_product: false,
      permission_status: "legal_review_required",
      normalized: { file: "nike/output/nike-icon@4x.png", sha256: "logo-sha", width: 224, height: 224 },
    },
    {
      canonical_brand_id: "blocked",
      display_name: "Blocked",
      status: "official_asset_collected_permission_blocked",
      approved_for_product: false,
      permission_status: "express_permission_required",
      normalized: { file: "blocked/output/blocked-icon@4x.png", width: 224, height: 224 },
    },
  ],
};

const auditReport = {
  audit: {
    rule_version: "brand-governance-audit-v1",
    generated_at: "2026-08-23T00:00:00.000Z",
    state_sha256: "state-sha",
  },
  field_quality: {
    brand_missing_or_placeholder: 0,
    dedicated_brand_evidence_fields: 0,
  },
};

const recordRisks = {
  rule_version: "brand-governance-audit-v1",
  state_sha256: "state-sha",
  records: [
    {
      video_id: "formal-1",
      resolution_lane: "manual_confirmation",
      risk_codes: ["title_brand_mismatch"],
      suggested_actions: ["Confirm the visible consumer brand."],
      title_brand_claim: "Nike",
      approval_effect: "none",
    },
  ],
};

test("builds an exact-match candidate sidecar for formal channels only", () => {
  const videos = [
    { video_id: "formal-1", source_site: "stash", brand: "NIKE" },
    { video_id: "formal-unmatched", source_site: "best_ads", brand: "Other" },
    { video_id: "youtube-1", source_site: "youtube", brand: "Legacy" },
  ];
  const governance = buildBrandGovernance(videos, mapping, catalog, {
    mapping_sha256: "mapping-sha",
    audit_report: auditReport,
    record_risks: recordRisks,
    state_sha256: "state-sha",
  });

  assert.equal(governance.summary.formal_record_count, 2);
  assert.equal(governance.summary.audited_record_count, 2);
  assert.equal(governance.summary.records_with_audit_risk, 1);
  assert.deepEqual(governance.summary.resolution_lane_counts, {
    safe_auto: 0,
    manual_confirmation: 1,
    cannot_determine: 0,
    no_flag: 1,
    not_audited: 0,
  });
  assert.equal(governance.summary.exact_mapping_count, 1);
  assert.equal(governance.summary.mapping_record_count, 1);
  assert.deepEqual(governance.summary.mapping_status_counts, { proposed: 1, unmapped: 1 });
  assert.equal(governance.summary.unmatched_record_count, 1);
  assert.equal(governance.summary.records_with_logo_candidate, 1);
  assert.equal(governance.summary.records_with_product_approved_logo, 0);
  assert.equal(governance.video_candidates["youtube-1"], undefined);
  assert.equal(governance.video_candidates["formal-1"].sidecar_only, true);
  assert.equal(governance.video_candidates["formal-1"].logos[0].approved_for_product, false);
  assert.equal(governance.video_candidates["formal-1"].logos[0].logo_url, "/brand-logos/nike.png");
  assert.equal(governance.video_candidates["formal-1"].resolution_lane, "manual_confirmation");
  assert.deepEqual(governance.video_candidates["formal-1"].risk_codes, ["title_brand_mismatch"]);
  assert.equal(governance.video_candidates["formal-unmatched"].mapping_status, "unmapped");
  assert.equal(governance.video_candidates["formal-unmatched"].resolution_lane, "no_flag");
  assert.equal(governance.brand_registry[0].candidate_brand_key, "nike");
  assert.equal(governance.brand_registry[0].brand_id, null);
  assert.equal(governance.brand_registry[0].logo.preview_download_url, "/brand-logos/nike.png?download=1");
  assert.equal(governance.brand_registry[0].logo.release_download_url, null);
  assert.equal(governance.provenance.audit_state_match, true);
  assert.equal(governance.provenance.audit_applied, true);
  assert.equal(governance.provenance.audit_freshness_status, "current");
});

test("does not apply an audit generated from a different state file", () => {
  const governance = buildBrandGovernance(
    [{ video_id: "formal-1", source_site: "stash", brand: "NIKE" }],
    mapping,
    catalog,
    { audit_report: auditReport, record_risks: recordRisks, state_sha256: "new-state-sha" },
  );

  assert.equal(governance.provenance.audit_state_match, false);
  assert.equal(governance.provenance.audit_applied, false);
  assert.equal(governance.provenance.audit_freshness_status, "stale");
  assert.equal(governance.summary.audited_record_count, 0);
  assert.equal(governance.video_candidates["formal-1"].resolution_lane, "not_audited");
  assert.deepEqual(governance.video_candidates["formal-1"].risk_codes, []);
});

test("requires both audit artifacts before exposing current lanes", () => {
  const governance = buildBrandGovernance(
    [{ video_id: "formal-1", source_site: "stash", brand: "NIKE" }],
    mapping,
    catalog,
    { record_risks: recordRisks, state_sha256: "state-sha" },
  );

  assert.equal(governance.provenance.audit_freshness_status, "missing");
  assert.equal(governance.provenance.audit_applied, false);
  assert.equal(governance.video_candidates["formal-1"].resolution_lane, "not_audited");
});

test("exposes only normalized catalog files through the logo file map", () => {
  assert.deepEqual([...brandLogoFileMap(catalog)], [["nike", "nike/output/nike-icon@4x.png"]]);
  assert.deepEqual([...brandLogoFileMap(catalog, { requireProductApproval: true })], []);
});

test("resolves v4 Logo assets across catalog-whitelisted roots and keeps release gated", () => {
  const v4Catalog = {
    version: 4,
    asset_roots: {
      base_v3: { repo_relative_root: "collect/brand-assets-v3" },
      overlay: { repo_relative_root: "collect/runs/logo-overlay/brand-assets" },
    },
    brands: [
      {
        canonical_brand_id: "base-brand",
        permission_status: "legal_review_required",
        approved_for_product: false,
        normalized: { sha256: "base-sha", width: 224, height: 224 },
        asset_ref: {
          asset_root_id: "base_v3",
          asset_scope: "internal_preview",
          repo_relative_normalized_path: "collect/brand-assets-v3/base-brand/output/base-brand.png",
        },
      },
      {
        canonical_brand_id: "overlay-brand",
        permission_status: "identity_and_legal_review_required",
        approved_for_product: false,
        normalized: { sha256: "overlay-sha", width: 224, height: 224 },
        asset_ref: {
          asset_root_id: "overlay",
          asset_scope: "internal_preview",
          repo_relative_normalized_path: "collect/runs/logo-overlay/brand-assets/overlay-brand/output/overlay-brand.png",
        },
      },
      {
        canonical_brand_id: "release-brand",
        permission_status: "approved",
        approved_for_product: true,
        normalized: { sha256: "release-sha", width: 224, height: 224 },
        asset_ref: {
          asset_root_id: "overlay",
          asset_scope: "product_release",
          repo_relative_normalized_path: "collect/runs/logo-overlay/brand-assets/release-brand/output/release-brand.png",
        },
      },
      {
        canonical_brand_id: "blocked-brand",
        permission_status: "express_permission_required",
        approved_for_product: false,
        normalized: { sha256: "blocked-sha", width: 224, height: 224 },
        asset_ref: {
          asset_root_id: "base_v3",
          asset_scope: "permission_blocked",
          repo_relative_normalized_path: "collect/brand-assets-v3/blocked-brand/output/blocked-brand.png",
        },
      },
    ],
  };
  const options = { repoRoot: "/repo", legacyAssetRoot: "/repo/collect/brand-assets-v3" };
  const preview = brandLogoAssetMap(v4Catalog, options);
  const release = brandLogoAssetMap(v4Catalog, { ...options, requireProductApproval: true });

  assert.equal(preview.size, 3);
  assert.equal(preview.get("base-brand").absolute_path, "/repo/collect/brand-assets-v3/base-brand/output/base-brand.png");
  assert.equal(preview.get("overlay-brand").absolute_path, "/repo/collect/runs/logo-overlay/brand-assets/overlay-brand/output/overlay-brand.png");
  assert.equal(preview.has("blocked-brand"), false);
  assert.deepEqual([...release.keys()], ["release-brand"]);
  assert.deepEqual([...brandLogoFileMap(v4Catalog, { requireProductApproval: true })], [[
    "release-brand",
    "collect/runs/logo-overlay/brand-assets/release-brand/output/release-brand.png",
  ]]);
});

test("rejects v4 Logo path traversal and unlisted asset roots", () => {
  const record = {
    canonical_brand_id: "unsafe",
    permission_status: "legal_review_required",
    approved_for_product: false,
    normalized: { width: 224, height: 224 },
    asset_ref: {
      asset_root_id: "overlay",
      asset_scope: "internal_preview",
      repo_relative_normalized_path: "collect/runs/logo-overlay/brand-assets/../secret/output/unsafe.png",
    },
  };
  assert.throws(() => resolveBrandLogoAsset({
    version: 4,
    asset_roots: { overlay: { repo_relative_root: "collect/runs/logo-overlay/brand-assets" } },
  }, record, { repoRoot: "/repo" }), /unsafe path segments/);
  assert.throws(() => resolveBrandLogoAsset({
    version: 4,
    asset_roots: { other: { repo_relative_root: "collect/runs/logo-overlay/brand-assets" } },
  }, {
    ...record,
    asset_ref: {
      ...record.asset_ref,
      repo_relative_normalized_path: "collect/runs/logo-overlay/brand-assets/unsafe/output/unsafe.png",
    },
  }, { repoRoot: "/repo" }), /not catalog-whitelisted/);
  assert.throws(() => resolveBrandLogoAsset({
    version: 4,
    asset_roots: { overlay: { repo_relative_root: "collect/../outside" } },
  }, {
    ...record,
    asset_ref: {
      ...record.asset_ref,
      repo_relative_normalized_path: "collect/outside/unsafe/output/unsafe.png",
    },
  }, { repoRoot: "/repo" }), /unsafe path segments/);
});
