import json
import os
import sys

collect_dir = os.path.dirname(__file__)
library_path = os.path.join(collect_dir, "library-v5.json")
taxonomy_path = os.path.join(
    collect_dir, "consumer-electronics-taxonomy-v1.json"
)
genre_taxonomy_path = os.path.join(collect_dir, "ad-video-genres-v1.json")
blocked_urls = {
    "https://www.youtube.com/watch?v=rsAyQgd52cg": "OUTDATED_PRODUCT_OR_VISUALS",
    "https://www.youtube.com/watch?v=e_hKji_nTac": "DURATION_OUT_OF_RANGE",
    "https://www.youtube.com/watch?v=zzCNUfz7U80": "TALKING_HEAD_DOMINANT",
    "https://www.youtube.com/watch?v=CSWanX7UTVk": "DOCUMENTARY_STYLE",
    "https://www.youtube.com/watch?v=V3dbG9pAi8I": "BEHIND_THE_SCENES",
    "https://www.youtube.com/watch?v=-LGu9Qd16_0": "DOCUMENTARY_STYLE",
    "https://www.youtube.com/watch?v=dnwsQFUXYvQ": "SOURCE_NOT_VERIFIED",
    "https://www.youtube.com/watch?v=9G99z2nHQvg": "DURATION_OUT_OF_RANGE",
    "https://www.youtube.com/watch?v=JXCXTQIIvM0": "EVENT_OR_LAUNCH",
    "https://www.youtube.com/watch?v=D-pf-XcFoO8": "QUALITY_REVIEW_REJECTED",
    "https://www.youtube.com/watch?v=xa1LGVWoy30": "SUPPORT_CONTENT",
    "https://www.youtube.com/watch?v=H1R_YQLiGzk": "OUTDATED_PRODUCT_OR_VISUALS",
    "https://www.youtube.com/watch?v=a6zDDcGjFtM": "LOW_AI_CREATIVE_HEADROOM",
}
allowed_industries = {
    "Consumer Electronics",
    "Skincare",
    "Color Cosmetics",
    "Fragrance",
    "Personal Care",
    "Jewelry & Watches",
    "Apparel & Footwear",
    "Bags & Accessories",
    "Home Appliances & Living",
    "Food & Beverage",
    "Sports & Outdoor",
    "Other",
}
required_fields = {
    "industry",
    "brand",
    "title",
    "url",
    "genres",
    "source_type",
    "note",
}

with open(taxonomy_path, encoding="utf-8") as taxonomy_file:
    taxonomy = json.load(taxonomy_file)
allowed_product_categories = {
    item["category"] for item in taxonomy["categories"]
}

with open(genre_taxonomy_path, encoding="utf-8") as genre_taxonomy_file:
    genre_taxonomy = json.load(genre_taxonomy_file)
allowed_genres = {item["english"] for item in genre_taxonomy["genres"]}
if len(allowed_genres) != 29:
    raise ValueError("题材事实源必须包含 29 个唯一英文标签")

with open(library_path, encoding="utf-8") as library_file:
    library = json.load(library_file)

new_videos = json.load(sys.stdin)
if not isinstance(new_videos, list):
    raise ValueError("输入必须是视频对象数组")

seen_urls = {video["url"] for video in library["videos"]}
added_count = 0
for video in new_videos:
    missing_fields = required_fields - video.keys()
    if missing_fields:
        raise ValueError(f"缺少字段: {sorted(missing_fields)}")
    if video["industry"] not in allowed_industries:
        raise ValueError(f"无效行业: {video['industry']}")
    if video["industry"] == "Consumer Electronics":
        if "product_category" not in video:
            raise ValueError(
                "Consumer Electronics 样片必须包含 product_category"
            )
        if video["product_category"] not in allowed_product_categories:
            raise ValueError(
                f"无效消费电子商品品类: {video['product_category']}"
            )
    invalid_genres = set(video["genres"]) - allowed_genres
    if invalid_genres:
        raise ValueError(f"无效题材: {sorted(invalid_genres)}")
    if not video["genres"]:
        raise ValueError("genres 至少包含一个正式题材")
    if not video["url"].startswith((
        "https://www.youtube.com/watch?v=",
        "https://www.youtube.com/playlist?",
        "https://x.com/",
    )):
        raise ValueError(f"无效视频 URL: {video['url']}")
    if video["url"] in blocked_urls:
        raise ValueError(
            "该 URL 已在质量回归中剔除，不允许重新入库: "
            f"{video['url']} ({blocked_urls[video['url']]})"
        )
    if video["url"] in seen_urls:
        continue
    seen_urls.add(video["url"])
    library["videos"].append(video)
    added_count += 1

temporary_path = f"{library_path}.tmp"
with open(temporary_path, "w", encoding="utf-8") as library_file:
    json.dump(library, library_file, ensure_ascii=False, indent=1)
    library_file.write("\n")
os.replace(temporary_path, library_path)
print(f"+{added_count}  总计 {len(library['videos'])}")
