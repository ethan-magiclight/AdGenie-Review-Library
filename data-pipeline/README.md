# JSON 数据整理链路

该目录是广告视频数据的新整理入口。它不依赖数据库、不产生人工审核状态，也不依赖仓库中的其他目录；整体复制后仍可独立清洗和校验。

## 目录

```text
data-pipeline/
├── source/                 # 不可被清洗覆盖的源数据，按渠道拆分
│   ├── ads_of_the_world/records.json
│   ├── best_ads/records.json
│   ├── stash/records.json
│   └── youtube/records.json
├── result/                 # 每轮清洗原子覆盖，只保留最新结果
│   ├── ads_of_the_world/records.json
│   ├── best_ads/records.json
│   ├── stash/records.json
│   ├── youtube/records.json
│   ├── creative-library.json
│   └── report.json
├── rules/                  # cleaning/mapping/taxonomy/contracts 四类规则
├── resources/              # Logo、Contact Sheet 资源清单及资源入口
└── scripts/                # 导入、清洗、汇总和校验脚本
```

## 数据约定

- `source/<channel>/records.json` 是渠道源数据。清洗程序只读，不在这里删除失败数据。
- `result/<channel>/records.json` 是各渠道最新清洗结果，每次执行都会原子替换旧文件。
- `result/creative-library.json` 是页面和后续系统应读取的唯一聚合结果。
- `result/report.json` 只记录本轮数量和过滤原因，不保存历史批次。
- 无法映射或不符合规则的数据只从结果排除，仍保留在源数据中。
- Logo 图片实体保存在 `resources/brand-assets/`，品牌与 Logo 的对应关系保存在 `resources/brand-logo-catalog.json`。
- Contact Sheet 实体保存在 `resources/contact-sheets/`，清单记录在 `resources/manifest.json`。
- 旧快照引用但当前目录没有实体文件的 Logo 或 Contact Sheet 不输出假路径，结果字段设为 `null` 并写入缺失标记。
- 每条源记录统一提供 `crawl_collected_at`；历史来源没有真实爬取时间时保持 `null`，不会用导入时间冒充。

## 固定清洗顺序

1. 读取四个渠道源文件。
2. 生成稳定记录 ID，并排除精确重复 ID。
3. 排除时长超过 60 秒的数据；时长缺失时保留并标记。
4. 使用 `rules/mapping/industry-map.json` 中的 20 个正式行业和别名归一化行业；不能确定时排除。
5. 使用唯一的 `rules/mapping/brand-normalization-map.json` 归一化品牌；规则中存在的映射立即生效，不能映射时排除。
6. 商品分类使用 `rules/mapping/product-category-map.json` 安全映射；不能映射时保留视频并将分类设为 `null`。
7. 只保留正式题材注册表中的题材值。
8. 原子覆盖四个渠道结果和唯一聚合结果。

## 命令

```bash
cd data-pipeline
npm run refresh
```

新增爬取数据时，传入一个 JSON 数组，或包含 `records` / `videos` 的 JSON：

```bash
npm run merge -- --channel ads_of_the_world --file /path/to/new-records.json
npm run refresh
```

合并命令按稳定 ID 幂等新增或更新对应渠道源文件。输入记录应按 `rules/contracts/source-video-record-contract.json` 提供字段，并写入真实 `collected_at`；不要直接修改 `result/`。

## 单一规则原则

- 每类规则只有一个当前文件，文件名不携带 `v1`、`v2` 等版本后缀。
- 品牌映射没有 `proposed`、`verified` 或人工审核状态；出现在映射文件中即为有效规则。
- 规则有问题时直接修改当前文件并重新执行 `npm run refresh`，结果文件原子覆盖，不保存并行旧版本。
- 来源快照中的审核台状态字段会在导入时移除，也不会进入清洗结果。
