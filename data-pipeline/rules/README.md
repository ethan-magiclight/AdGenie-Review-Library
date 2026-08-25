# 规则目录

规则按用途分组，清洗规则严格遵守“一条规则一个文件”。

```text
rules/
├── cleaning/   # 可直接执行的过滤、去重和输出规则
├── mapping/    # 每类独立的行业、商品分类和品牌映射
├── taxonomy/   # 正式题材注册表
└── contracts/  # 来源数据及本流水线字段合同
```

`mapping/` 下的当前规则文件：

- `industry-map.json`：20 个正式行业、行业别名和行业定义。
- `product-category-map.json`：正式商品分类、商品分类别名和分类定义。
- `brand-normalization-map.json`：品牌别名到规范品牌的映射。

行业与商品分类映射彼此独立；不要再使用合并的 `taxonomy.json`。

清洗脚本只读取本目录，不在代码中另设隐藏业务阈值。修改规则后执行：

```bash
npm --prefix data-pipeline run build
npm --prefix data-pipeline run validate
```

每类规则只保留一个无版本后缀的当前文件。规则文件不保存候选、已验证或待人工审核状态；规则存在即生效，无法映射的数据按对应清洗规则排除或置空。
