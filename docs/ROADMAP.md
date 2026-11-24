# 落地路线

> 原则：**先搬家，后泛化**。先证明新结构能 1:1 跑出旧结果，再改行为。
> 任何一步不满意就停——迁移来源的原样快照在 `legacy/`（本地，不入 git）。

## 阶段 1 · 骨架 ✅ 已完成

- [x] 仓库初始化、目录分层
- [x] `PIPELINE.md` 数据契约
- [x] `docs/DESIGN.md` 设计决定
- [x] 中性示例 profile（`profiles/example-catalog/`）
- [x] `tools/check-private.sh` 私货自检
- [x] `legacy/` 原样快照 + md5 基准（**已 gitignore**）
- [x] 私有档案挪出仓库（`~/.config/lookkit/profiles/`）

**验收**：`bash tools/check-private.sh --all` 退出码 0。

## 阶段 2 · 参数化 + 包装（下一步）

只做三件事，**不改任何行为**：

- [ ] `bin/look` 子命令分发（`scan / sheet / batch / merge / review / export / import / inbox / overview`）
- [ ] 现有脚本搬进 `lib/` `img/`，路径/端口/默认包名从参数或 profile 取
- [ ] 建回归基准：同一份真实数据，新旧两版产物逐字节比对
      - 拼图 → 像素比对
      - 知识文件 → 键序/内容/分隔符一致
      - 入库 dry-run → 逐行一致

**验收**：所有比对全绿。**红一条就停下查，不要带着差异往下走**——差异说明"搬家"这一步不干净，后面所有判断都会失真。

## 阶段 3 · 抽 profile

- [ ] 把写死在源码里的枚举 / 署名 / 分组信息搬进 profile
- [ ] 拼图参数搬进 `profile.sheet`（**默认值必须等于原值**：改默认等于改 prompt 语义）
- [ ] 场景 prompt 原样搬入私有档案，**校验 md5 不变**
- [ ] `merge` 改为按 profile 白名单校验

**验收**：profile 驱动跑出的产物与阶段 2 完全一致。

## 阶段 4 · 审核面板泛化（最重）

- [ ] 第 1 步：现有面板加参数（`--data/--raw/--port`），行为不变，先跑一遍真实数据对照
- [ ] 第 2 步：改成读 `profile.review.checks` 渲染
- [ ] 第 3 步：静态导出 `look export --target static-html`
- [ ] 第 4 步：写入改 `.tmp` + rename，加并发保护

**验收**：已有判定数据逐条比对一致，一条不能丢。**迁移前先备份 `state.json`。**

## 阶段 5 · 收件箱加固

- [ ] `--bind` 默认 `127.0.0.1`
- [ ] 可选 `--token`
- [ ] `/stats` 不回绝对路径
- [ ] 大小上限改参数

## 阶段 6 · 收口

- [ ] 迁移来源目录保留 2 周，README 注明去向
- [ ] 删 `legacy/`
- [ ] 写交接文档

---

## 待定

- [ ] `audit` 能不能自动串进 `annotate`（一个命令跑两轮）？
- [ ] `sheet` 要不要支持视频抽帧（现在是动图帧，视频要加 ffmpeg）？
- [ ] 审核面板要不要支持多标签页并发（现在是全量读写 state 文件）？
