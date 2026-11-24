# lookkit

**把一批图交给视觉模型复查，人只需要看「它说哪里不对」。**

`lookkit` 是一条可拆可重跑的视觉标注／审核流水线。它不假设你的图是什么——表情包、商品图、数据集、截图都行。
你要做的只是写一张 **profile**（字段、枚举、拼图参数、审核要看哪几项），引擎不动。

> 状态：骨架 + 契约 + 示例就位；引擎模块按 `docs/ROADMAP.md` 分阶段落地。
> 仓库里**只放通用引擎和中性示例**，我们自己用的场景档案在仓库外（见「私有档案放哪」）。

---

## 它解决的两种活

| 模式 | 你手上有什么 | 它做什么 | 人的角色 |
|---|---|---|---|
| **annotate** | 一堆没标签的图 | 拼成证据图 → 模型逐件打标签 | 抽查 |
| **audit** | 图 **＋** 已有的标签 | 让模型逐条**挑错**，只输出改动项 | 看报告、拍板 |

两个模式共用同一套数据结构：`id` 串起来的 JSONL。所以也可以串起来用——
先 `annotate` 打一遍，再 `audit` 复核一遍，最后人工只处理被改过的那几十条。

**为什么值得单独做个 audit**：模型第一次标注几乎总有系统性偏差（爱把背景色当成主色、爱凭猜测补细节、
爱把"看起来旧"写成具体瑕疵）。第二次用不同的眼光逐条对照图，能挑出大部分；人只看 diff，不用从头看。

---

## 五个概念

打比方：**像一条厨房流水线**，`lookkit` 是灶台和刀具，profile 是食谱卡。

| 概念 | 是什么 | 打个比方 |
|---|---|---|
| **Item** | 一个待处理的图：一张 GIF、一张 png、一帧画面 | 一道菜 |
| **Sheet** | 把 Item 编排成一张图，让模型一屏看全 | 拼盘小样 |
| **Batch** | 一批清单，一行一个 sheet 路径 | 点菜单的一页 |
| **Annotation** | 一行 JSONL，`id` + 字段 | 厨师的备注 |
| **Verdict** | 人的三态：`pass` / `fail` / `undo` + 评语 | 试菜打分 |

**段与段之间只用文件交接，不互相调用。** 好处：出错只重跑一段；模型（或人）可以直接读写中间产物；
跑到一半断了，清单还在。

---

## 流水线

```
素材（任意目录 / 清单）
   │  look scan            → items.jsonl  {id, src, hash, group}
   ▼
证据图
   │  look sheet            → sheets/ + batch.jsonl
   │    frames  一件多帧（动图抽帧，浅灰底＝透明）
   │    tiles   多件拼版（一格一件，带编号，可分页）
   ▼
模型第一遍
   │  【AI + prompt.annotate.md】
   ▼
annot/ai.jsonl
   │  look audit            → annot/audit.jsonl + audit-report.md   ← 二次审核
   │  【AI + prompt.audit.md，只输出改动项】
   ▼
annot/merged.jsonl  （按字段叠加，后覆盖前，枚举兜底，缺失报告）
   │  look merge
   ▼
人工审核
   │  look review            → 浏览器卡片墙，三态判定，点一下就落盘
   ▼
state.json
   │  look export            → 目标格式
   └  look import            → 批量入库
```

---

## 目录结构

```
lookkit/
├── README.md
├── PIPELINE.md            数据契约（三层文件格式）
├── docs/
│   ├── DESIGN.md          为什么这么分层
│   └── ROADMAP.md         分阶段落地清单
├── bin/
│   └── look               CLI 入口，子命令分发
├── lib/                   通用引擎（不认识任何具体业务）
│   ├── scan.mjs           扫描 → items.jsonl（含内容 hash）
│   ├── batch.mjs          清单生成 + stale 检测
│   ├── merge.mjs          JSONL 叠加 + schema 校验 + 缺失报告
│   ├── review-server.mjs  审核面板（profile 驱动）
│   ├── inbox-server.mjs   收件箱上传（默认只绑 127.0.0.1）
│   ├── import.mjs         入库（内容判重 / 序号接续 / dry-run）
│   ├── overview.mjs       全库核对分页拼图
│   └── target/            出口适配器
│       ├── sticker-kit.mjs
│       ├── kohya-caption.mjs
│       ├── catalog-json.mjs
│       └── static-html.mjs
├── img/                   图像精处理——**全仓库只有这里是 Python**
│   ├── sheet_frames.py    动图抽帧 → 一图
│   └── sheet_tiles.py     多图拼版 → 一版或多版
├── profiles/
│   └── example-catalog/   中性示例（可以删，但删了就不知道 profile 长什么样）
│       ├── profile.json
│       ├── prompt.annotate.md
│       └── prompt.audit.md
├── tools/
│   └── check-private.sh   发布前自检：扫私货
└── tests/
```

**为什么 `img/` 是 Python**：动图抽帧要处理采样、透明通道合背景、帧时长累加，Pillow 几行就稳；
换成 shell 工具输出会变，而 **prompt 里通常写着"浅灰=透明"这类视觉约定**，输出一变 prompt 就骗模型。

---

## 安装

```bash
node -v            # ≥ 22.5（用到内置 node:sqlite）
python3 -c 'import PIL; print(PIL.__version__)'
magick -version | head -1
```

零第三方 npm 包，`lib/` 只用 Node 内置模块。`img/` 只用 Pillow。

---

## 快速开始

```bash
# ① 扫描：给每件算内容 hash（图改了才知道要重标）
look scan ./素材 --out work/items.jsonl

# ② 出证据图
look sheet --mode frames --in work/items.jsonl --out work/sheets      # 动图
look sheet --mode tiles  --in ./素材 --out work/sheets --tile 240 --per 24   # 一堆静图

# ③ 生成待标清单，交给模型 + profile 里的 prompt
look batch --in work/items.jsonl --sheets work/sheets --out work/batch.jsonl

# ④ 合并模型产出（%1 之后人工修的放后面，覆盖前面的）
look merge --profile example-catalog --in work/annot/ai.jsonl work/annot/manual.jsonl --out work/annot/merged.jsonl

# ⑤ 人工审核
look review --profile example-catalog --data work/annot/merged.jsonl --raw ./素材 --port 18090
# → http://127.0.0.1:18090

# ⑥ 导出
look export --profile example-catalog --target catalog-json --in work/annot/merged.jsonl --out out/catalog.json

# ⑦ 收件箱（手机传图）
look inbox --dir ~/inbox --port 3010                       # 默认只绑 127.0.0.1
look inbox --dir ~/inbox --bind 0.0.0.0 --token 临时口令     # 要局域网才显式开
```

---

## profile 怎么写

一个场景 = 一个目录，最少两个文件：`profile.json` + prompt。

```json
{
  "id": "my-scene",
  "name": "我的场景",

  "sheet": { "mode": "tiles", "tile": 240, "per": 24, "background": "#222" },

  "fields": [
    { "key": "label",  "type": "string", "max": 120 },
    { "key": "mood",   "type": "enum", "values": ["开心","平静","难过"], "fallback": "平静" },
    { "key": "tags",   "type": "list", "max": 6 }
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

- `fields` = 模型要填的字段。`enum` 有 `fallback`，模型瞎写时自动兜底，不会污染数据。
- `review.checks` = 面板上那几个 ✓/✗ 行。`derived` 是「这种情况别判死，单独标一个状态」——
  比如"尾巴没画错，只是构图没拍进去"，和"尾巴画错了"要分开，否则统计会骗人。
- 规则里的 `when` 是极小表达式（`field == value` / `id in 35..46` / `note =~ /正则/`），够用就好，不搞 DSL。

---

## 私有档案放哪（重要）

**仓库里永远只放中性示例。** 自己用的场景档案放仓库外，这样 `git push` 出去不会带私货：

```bash
$LOOKKIT_PROFILES=~/.config/lookkit/profiles      # 环境变量，优先级最高
~/.config/lookkit/profiles/<场景>/                # 默认私有位置
<repo>/profiles/                                  # 示例，可公开
```

查找顺序：`--profile-dir` > `$LOOKKIT_PROFILES` > `~/.config/lookkit/profiles` > `<repo>/profiles`。

**发布前跑一次自检**：

```bash
bash tools/check-private.sh        # 扫 git 索引里将要提交的文件
bash tools/check-private.sh --all  # 扫整个工作区
```

它会抓：真实姓名/署名、内部角色名、本机绝对路径、内网地址、真凭据形态。
**这个脚本要在第一次 commit 之前跑通**——私货一旦进了 git 历史，删文件是删不掉的。

另外 `.gitignore` 默认忽略 `legacy/`、`work/`、`data/`、所有图片和 `.db`，
因为这些东西里面全是「审过的图」和「审的结果」。

---

## 数据契约

三个文件，全部用 `id` 串起来，详见 [PIPELINE.md](PIPELINE.md)：

```
items.jsonl    每件一行：{id, src, hash, group}        ← 素材是谁
annot/*.jsonl  每件一行：{id, ...字段}                 ← 说过什么（可多份叠加）
state.json     每件一行：{verdict, note, updated}      ← 人说了什么
```

`hash` 是这套东西的关键：图一改，hash 变，那件就自动进 stale 清单要重标。不需要额外数据库。

---

## 不做什么

- **不做生成**。出图、裁图、分桶是上游的事，`lookkit` 只处理已经存在的图。
- **不迁移数据**。你审过的图、判定结果、数据库都留在原地，仓库只管代码和 profile。
- **不改别人写的 prompt**。prompt 是场景档案的一部分，原样存放；其中的路径由 wrapper 运行时注入。
