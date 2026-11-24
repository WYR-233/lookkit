# 数据契约

> 三个文件，全部用 `id` 串起来。这是整个仓库最稳定的部分——比代码稳定，加场景时最先该定的是它。

## 1. `items.jsonl` — 素材是谁

一行一件，由 `look scan` 生成，**只读**（不手工改）。

```json
{"id":"组A/img-001","src":"/abs/path/组A/img-001.png","hash":"a3f9…","group":"组A","extra":{}}
```

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一，约定 `分组/文件名`（分组里允许带 `/`） |
| `src` | 源文件绝对路径 |
| `hash` | **内容**哈希（不是 mtime）。用它判断「图改过没有」——图一改，旧标注自动失效 |
| `group` | 分组（包名 / 批次 / 目录名），给筛选和分页用 |
| `extra` | 场景自定义，原样透传 |

## 2. `annot/*.jsonl` — 说过什么

一行一件。**可以有多份，按传入顺序叠加，后者按字段覆盖前者。**

```jsonl
{"id":"组A/img-001","label":"白色T恤","tags":["基础款"]}      ← ai.jsonl
{"id":"组A/img-001","label":"白色短袖T恤"}                    ← manual.jsonl
```

叠加结果：`{"label":"白色短袖T恤","tags":["基础款"]}`

一个机制覆盖四件事，不用各设一套：
- **模型复审**（audit 只写改动项）
- **人工微调**
- **断点续跑**（跑一半的产物也是合法的输入）
- **多版本对比**（保留每一份）

规则：
- 每行一个 JSON 对象。**不写数组、不带尾逗号、不加代码块围栏。**
- `merge` 时按 `profile.fields` 白名单挑字段，其余丢弃。
- 枚举字段不在 `values` 里 → 换成 `fallback`。
- `items.jsonl` 里有、标注里没有的 id → 打印到 **missing 清单**，不静默吞。

## 3. `state.json` — 人说了什么

```json
{"组A/img-001":{"verdict":"pass","note":"颜色对","updated":"2026-11-24 22:01:03"}}
```

| 字段 | 说明 |
|---|---|
| `verdict` | `pass` / `fail` / `undo` |
| `note` | 评语，可为空 |
| `updated` | 本地时间字符串，只给人看 |

**这是唯一由人直接写的文件**，所以服务端要做到两件事：启动时备份一份；写入时先写 `.tmp` 再 rename（防断电写坏）。

## 4. 版本戳与 stale

`export` 时给每件带上 `items.jsonl` 里的 `hash`。下次 `scan` 发现 hash 变了，那件就进 stale 清单。

这就是「图更新了，标注要跟着更新」的全部机制——不需要额外数据库，也不需要人肉记。

## 5. 一个工作目录长什么样

```
work/
├── items.jsonl          扫描结果          ← 别删
├── sheets/
│   ├── 组A/              frames 模式：每件一张
│   └── page-01.jpg       tiles  模式：每版一张
├── batch.jsonl          待处理清单（一行一个 sheet）
├── annot/
│   ├── ai.jsonl         模型第一遍
│   ├── audit.jsonl      模型复审（只有改动项）
│   ├── manual.jsonl     人工覆盖
│   └── merged.jsonl     合并成品
├── audit-report.md      复审报告（人看的）
└── state.json           审核判定          ← 别删
```

**除了 `items.jsonl` 和 `state.json`，其余全部可以删了重跑。**
