# 落地路线

> 原则：**先搬家，后泛化**。先证明新结构能 1:1 跑出旧结果，再改行为。

## 阶段 1 · 骨架 ✅

- [x] 仓库初始化、目录分层
- [x] `PIPELINE.md` 数据契约
- [x] `docs/DESIGN.md` 设计决定
- [x] 中性示例 profile
- [x] `tools/check-private.sh` 私货自检
- [x] `legacy/` 原样快照（已 gitignore，不进仓库）
- [x] 私有档案隔离到 `~/.config/lookkit/profiles/`

## 阶段 2 · 参数化 + 包装 ✅

- [x] `bin/look` 子命令分发（11 个）
- [x] 路径/端口/默认值全部改成参数或 profile
- [x] **抽帧回归**：新旧 `sheet_frames` 对同一 GIF 输出 **md5 完全一致**
- [x] 拼图脚本三份合一（`sheet_tiles.py`）
- [ ] **`sticker-kit` 逐字节回归**：缺“旧版 + 真实 manifest”的同输入对比，
      目前只验证了结构与字段序。等下次跑真实场景时补。

## 阶段 3 · 抽 profile ✅

- [x] 枚举 / 署名 / 分组信息搬进 profile
- [x] 拼图参数进 `profile.sheet`（默认值 = 原值）
- [x] 场景 prompt 原样搬入私有档案，**md5 校验一致**
- [x] `merge` 按 profile 白名单校验

## 阶段 4 · 审核面板泛化 ✅

- [x] 面板完全由 `profile.review` 驱动（字段、检查项、派生状态）
- [x] 静态导出 `look export --target static-html`
- [x] 写盘改 `.tmp` + rename；启动时自动备份原判定
- [x] `/img/` 用 `resolve` + 分隔符边界，不再用字符串前缀
- [ ] **多标签页并发**：现在是「读全量→改→写全量」，两个人同时点会互相覆盖。
      量小可接受；要修需要加锁或改成单条追加。

## 阶段 5 · 收件箱加固 ✅

- [x] `--bind` 默认 `127.0.0.1`
- [x] 可选 `--token`
- [x] `/stats` 不回绝对路径
- [x] 大小上限可配（`--max-mb`）
- [x] 对外监听但没设 token 时打印警告

## 阶段 6 · 收口 ⏳

- [x] 写交接文档
- [ ] 迁移来源目录保留观察 2 周，再删
- [ ] 删 `legacy/`

---

## 待定

- [ ] `audit` 自动串进 `annotate`（一条命令跑两轮）
- [ ] 视频抽帧（现在只处理动图的帧，视频要加 ffmpeg）
- [ ] 审核面板并发保护
- [ ] 内容寻址缓存（同一张图换了文件名，sheet 能不能复用）
