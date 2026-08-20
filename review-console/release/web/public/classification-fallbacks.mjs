export function effectiveIndustry(video = {}) {
  return video.industry
    || video.industry_candidate
    || video.classification_candidate?.industry
    || null;
}

export function effectiveProductCategory(video = {}) {
  return video.product_category
    || video.product_category_candidate
    || video.classification_candidate?.product_category
    || null;
}
