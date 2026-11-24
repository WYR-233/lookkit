# lookkit

**把一批图交给视觉模型复查，人只需要看「它说哪里不对」。**

`lookkit` 是一条可拆可重跑的视觉标注／审核流水线。它不假设你的图是什么——表情包、商品图、数据集截图都行。
你要做的只是写一张 **profile**（字段、枚举、拼图参数、审核看哪几项），引擎不动。

```
node ≥ 22.5 + python3 + Pillow     零 npm 依赖，不用 build
```

---

## 它干两种活

| 模式 | 你手上有什么 | 它做什么 | 人的角色 |
|---|---|---|---|
| **annotate** | 一堆没标签的图 | 拼证据图 → 模型逐件打标签 | 抽查 |
| **audit** | 图 **＋** 已有标签 | 让模型逐条**挑错**，只输出改动项 | 看报告、拍板 |

两者共用同一套数据结构（`id` 串起来的 JSONL），所以能串起来：
先 `annotate` 打一遍，再 `audit` 复核一遍，人只处理被改过的那几十条。

**为什么值得单独做 audit**：模型第一次标注几乎总有系统性偏差——把背景色当主色、凭猜测补细节、
把"看起来旧"写成具体瑕疵。第二次用不同的眼光逐条对着图挑，能抓出大部分；人只看 diff，不用从头看。

---

## 五个概念

打比方：**像一条厨房流水线**，`lookkit` 是灶台和刀具，profile 是食谱卡。

| 概念 | 是什么 | 打个比方 |
|---|---|---|
| **Item** | 一个待处理的图：一张 GIF、一张 png、一帧画面 | 一道菜 |
| **Sheet** | 把图编排成一张「证据图」，让模型一屏看全 | 拼盘小样 |
| **Batch** | 一批清单，一行一个 sheet 路径 | 点菜单一页 |
| **Annotation** | 一行 JSONL，`id` + 字段 | 厨师备注 |
| **Verdict** | 人的三态：`pass` / `fail` / `undo` + 评语 | 试菜打分 |

**段与段之间只用文件交接，不互相调用。** 出错只重跑一段；模型或人可以直接改中间产物；跑到一半断了也不丢进度。

---

## 流水线

```
素材（任意目录 / 清单）
   │  look scan            → items.jsonl  {id, src, hash, group}
   ▼
证据图
   │  look sheet            → sheets/ + index.tsv
   │    frames  一件多帧（动图抽帧，浅灰底＝透明）
   │    tiles   多件拼版（一格一件，带编号，可分页）
   ▼
模型第一遍
   │  look prompt --kind annotate  → 渲染好的指令，交给 AI
   ▼
annot/ai.jsonl
   │  look prompt --kind audit + AI  → annot/audit.jsonl + 报告   ← 二次审核
   ▼
annot/merged.jsonl   （按字段叠加，后覆盖前，枚举兜底，缺失报告）
   │  look merge
   ▼
人工审核
   │  look review  →  浏览器卡片墙，三态判定，点一下落盘
   ▼
state.json
   │  look export  →  目标格式
   └  look import  →  批量入库
```

---

## 目录结构

```
lookkit/
├── bin/look               CLI 入口
├── lib/
│   ├── profile.mjs        场景档案查找/加载/校验
│   ├── schema.mjs         字段清洗 + 极小条件表达式 + 派生状态
│   ├── scan.mjs           扫描 + 内容 hash
│   ├── batch.mjs          清单生成 + stale 检测
│   ├── merge.mjs          多份 JSONL 叠加 + 报告
│   ├── review-server.mjs  审核面板（profile 驱动）
│   ├── inbox-server.mjs   收件箱（默认只绑本机）
│   ├── import.mjs         入库（判重/接号/dry-run）
│   ├── overview.mjs       全库核对拼图
│   └── target/            出口：sticker-kit / catalog-json / kohya-caption / static-html
├── img/                   **全仓库只有这里是 Python**
│   ├── sheet_frames.py    动图抽帧 → 一图
│   └── sheet_tiles.py     多图拼版 → 一版或多版
├── profiles/
│   └── example-catalog/   中性示例（annotate + audit 都能跑）
├── tools/check-private.sh 发布前私货自检
├── tests/e2e.sh           端到端自测（造图跑全流程，不联网）
├── PIPELINE.md            三层文件契约
└── docs/                  DESIGN / ROADMAP
```

**为什么 `img/` 是 Python**：动图抽帧要处理采样、透明通道合背景、帧时长累加，Pillow 几行就稳；
换成外部工具输出会变，而 **profile 的 prompt 里通常写着"浅灰=透明"这类视觉约定**，输出一变 prompt 就骗模型。

---

## 快速开始

```bash
# ① 扫描：给每件算内容 hash（图改了才知道要重标）
look scan ./素材 --out work/items.jsonl

# ② 出证据图
look sheet --mode frames --in work/items.jsonl --out work/sheets          # 动图
look sheet --mode tiles  --in ./素材 --out work/sheets --tile 240 --per 24 # 一堆静图

# ③ 把渲染好的指令交给 AI（路径已注入，prompt 原文不动）
look prompt --profile example-catalog --kind annotate --workdir work

# ④ 合并模型产出（后面的覆盖前面的）
look merge --profile example-catalog \
  --in work/annot/ai.jsonl,work/annot/manual.jsonl \
  --out work/annot/merged.jsonl --items work/items.jsonl

# ⑤ 人工审核
look review --profile example-catalog --data work/annot/merged.jsonl --raw ./素材 --port 18090

# ⑥ 导出
look export --profile example-catalog --target catalog-json --in work/annot/merged.jsonl --out out/catalog.json

# ⑦ 收件箱（手机传图）
look inbox --dir ~/inbox --port 3010                        # 只绑 127.0.0.1
look inbox --dir ~/inbox --bind 0.0.0.0 --token 临时口令      # 要局域网才显式开
```

完整子命令列表：`look help`。可用场景：`look profiles`。

---

## profile 怎么写

一个场景 = 一个目录，最少两个文件：`profile.json` + prompt。

```json
{
  "id": "my-scene",
  "name": "我的场景",

  "sheet": { "mode": "tiles", "tile": 240, "per": 24, "background": "#222" },

  "fields": [
    { "key": "label", "type": "string", "max": 120 },
    { "key": "mood",  "type": "enum", "values": ["开心","平静","难过"], "fallback": "平静" },
    { "key": "tags",  "type": "list", "max": 6 },
    { "key": "quality_ok",  "type": "bool" },
    { "key": "quality_note","type": "string", "default": "" }
  ],

  "review": {
    "title": "我的场景审核",
    "display": ["label", "mood", "tags"],
    "checks": [
      { "key": "quality_ok", "label": "成片", "note": "quality_note",
        "derived": { "when": "note =~ /糊|压缩|噪点/", "then": "blurred", "label": "画质问题" } }
    ]
  },

  "prompts": { "annotate": "prompt.annotate.md", "audit": "prompt.audit.md" },
  "targets": ["catalog-json"]
}
```

要点：

- **`fields`** 是模型要填的字段。`enum` 有 `fallback`，模型造词时自动兜底，不会污染数据。
- **`review.checks`** 是面板上那几个 ✓/✗ 行。`derived` 是「这种情况别判死，单独标一个状态」——
  比如"画面没拍全"和"画错了"要分开，否则统计骗人。
- **`rules`** 可选，写硬约束：`{ "when": "condition == '破损'", "min_list": { "defects": 1 } }`。
- **`prompt_substitutions`**：历史 prompt 里如果有写死的绝对路径，在这里声明怎么换，
  引擎不认任何具体路径：

  ```json
  "prompt_substitutions": { "/tmp/old-workdir": "{{WORKDIR}}" }
  ```

- 规则里的 `when` 只支持三种，够用就好：
  `field == value` / `id in 35..46` / `note =~ /正则/`。

---

## 私有档案放哪（重要）

**仓库里永远只放中性示例。** 自己用的场景档案放仓库外：

```bash
$LOOKKIT_PROFILES=~/.config/lookkit/profiles      # 环境变量，优先级最高
~/.config/lookkit/profiles/<场景>/                # 默认私有位置
<repo>/profiles/                                  # 示例，可公开
```

查找顺序：`--profile-dir` > `$LOOKKIT_PROFILES` > `~/.config/lookkit/profiles` > `<repo>/profiles`。

**发布前跑自检**：

```bash
bash tools/check-private.sh        # 扫 git 索引里将要提交的文件
bash tools/check-private.sh --all  # 扫整个工作区
```

它会抓：真实姓名/署名、内部角色名、本机绝对路径、内网地址、真凭据形态。

`.gitignore` 默认忽略 `legacy/`、`work/`、`data/`、所有图片和 `.db`——
因为这些东西里面全是「审过的图」和「审的结果」。

---

## 数据契约

三个文件，全部用 `id` 串起来，详见 [PIPELINE.md](PIPELINE.md)：

```
items.jsonl    每件一行：{id, src, hash, group}        ← 素材是谁
annot/*.jsonl  每件一行：{id, ...字段}                 ← 说过什么（可多份叠加）
state.json     每件一行：{verdict, note, updated}      ← 人说了什么
```

`hash` 是整套东西的关键：图一改，hash 变，那件就自动进 stale 清单。不需要额外数据库。

---

## 自测

```bash
bash tests/e2e.sh
```

现造几张图，跑完 scan → sheet → merge → export → review API → stale → import，
最后跑一遍私货自检。不联网、不碰真实数据。

---

## 不做什么

- **不做生成**。出图、裁图、分桶是上游的事，`lookkit` 只处理已经存在的图。
- **不迁移数据**。你审过的图、判定结果、数据库都留在原地，仓库只管代码和 profile。
- **不改别人写的 prompt**。prompt 是场景档案的一部分，原样存放；路径由 wrapper 运行时注入。

## 许可

MIT，见 [LICENSE](LICENSE)。
