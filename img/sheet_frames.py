#!/usr/bin/env python3
"""把动图的帧拼成一张「证据图」，让视觉模型一屏看完整段动作。

用法:
  python3 sheet_frames.py OUT_DIR [--max-frames 12] [--cell 200] [--cols 4] GIF [GIF ...]
  python3 sheet_frames.py OUT_DIR --list batch.txt      # 一行一个路径

输出的 jpg 里：
  · 头部一行：`<文件名>  frames=N  duration=Xms  (left->right, top->bottom)`
  · 每格左上角红字帧号 `#i`
  · 透明背景合成到浅灰 (236,236,236) —— **这个色值是契约**，
    场景的 prompt 里通常写着「浅灰 = 透明」，改这里等于让 prompt 说谎。

默认值（12 帧 / 200px / 4 列 / 浅灰底 / quality 85）不是随手定的，
它们和已有场景 prompt 里的描述绑死。要改就同步改 prompt。
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageSequence

BG = (236, 236, 236, 255)   # 浅灰：让透明区域可见，prompt 依赖这个约定
HEAD_H = 24


def frames_of(path, cell):
    im = Image.open(path)
    out, total_ms = [], 0
    for fr in ImageSequence.Iterator(im):
        total_ms += fr.info.get("duration", 100) or 100
        bg = Image.new("RGBA", fr.size, BG)
        bg.alpha_composite(fr.convert("RGBA"))
        out.append(bg.convert("RGB"))
    return out, total_ms


def make_sheet(path, out_dir, max_frames, cell, cols_opt):
    frames, total_ms = frames_of(path, cell)
    n = len(frames)
    idx = list(range(n)) if n <= max_frames else [
        round(i * (n - 1) / (max_frames - 1)) for i in range(max_frames)
    ]
    cols = min(cols_opt, len(idx))
    rows = -(-len(idx) // cols)

    img = Image.new("RGB", (cols * cell, rows * cell + HEAD_H), "white")
    d = ImageDraw.Draw(img)
    d.text(
        (6, 5),
        f"{Path(path).name}  frames={n}  duration={total_ms}ms  (left->right, top->bottom)",
        fill="black",
    )
    for k, i in enumerate(idx):
        fr = frames[i].copy()
        fr.thumbnail((cell - 8, cell - 22))
        x, y = (k % cols) * cell, (k // cols) * cell + HEAD_H
        img.paste(fr, (x + (cell - fr.width) // 2, y + 18))
        d.text((x + 4, y + 3), f"#{i}", fill=(200, 0, 0))

    out = Path(out_dir) / (Path(path).stem + ".jpg")
    img.save(out, quality=85)
    return out


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("out_dir")
    ap.add_argument("files", nargs="*")
    ap.add_argument("--list", help="一行为一个输入路径（和 files 合并）")
    ap.add_argument("--max-frames", type=int, default=12)
    ap.add_argument("--cell", type=int, default=200)
    ap.add_argument("--cols", type=int, default=4)
    a = ap.parse_args()

    inputs = list(a.files)
    if a.list:
        inputs += [l.strip() for l in Path(a.list).read_text(encoding="utf-8").splitlines() if l.strip()]
    if not inputs:
        ap.error("没给输入文件")

    out_dir = Path(a.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    for p in inputs:
        try:
            print(make_sheet(p, out_dir, a.max_frames, a.cell, a.cols))
            ok += 1
        except Exception as e:
            print(f"✗ {p}: {e}", file=sys.stderr)
    print(f"完成 {ok}/{len(inputs)}")


if __name__ == "__main__":
    main()
