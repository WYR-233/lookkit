#!/usr/bin/env python3
"""把一堆图拼成「证据图」：一格一件，带编号，可分页。

用法:
  python3 sheet_tiles.py --in <目录|items.jsonl> --out DIR
        [--tile 240] [--per 24] [--cols 0] [--cell-h 0]
        [--bg "#222222"] [--label number|filename|none] [--index index.tsv]

· per=0  → 全部拼在一张（大图）
· per>0  → 每版一张：page-01.jpg, page-02.jpg ...
· 编号/文件名画在格子左上角，和读图顺序一致（按路径排序）
· 同时写 index.tsv：`编号<TAB>标签<TAB>源路径`，给下游对照

为什么不用 imagemagick：Pillow 能精确控制留白、字背景、失败兜底，
而且少一个系统依赖。分页拼图内存占用可控。
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw

EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".heic", ".heif"}


def collect(src):
    """返回 [(label, path)]，按路径排序保证编号稳定。"""
    p = Path(src)
    if p.is_dir():
        files = sorted(
            (f for f in p.rglob("*") if f.is_file() and f.suffix.lower() in EXTS),
            key=lambda f: str(f),
        )
        return [(f.stem, str(f)) for f in files]
    if p.suffix == ".jsonl":
        rows = []
        for line in p.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            it = json.loads(line)
            rows.append((str(it.get("id", Path(it["src"]).stem)), it["src"]))
        return rows
    raise SystemExit(f"输入要目录或 .jsonl: {src}")


def auto_cols(per):
    if per <= 3:
        return per
    c = 1
    for i in range(1, int(math.sqrt(per)) + 1):
        if per % i == 0:
            c = i
    return c


def fit_cell(im, w, h):
    im = im.copy()
    im.thumbnail((w - 8, h - 8), Image.LANCZOS)
    return im


def paste_label(img, d, x, y, text, size):
    """左上角：黑底半透明 + 白字。"""
    if not text:
        return
    try:
        bbox = d.textbbox((0, 0), text)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except Exception:
        tw, th = len(text) * size * 0.6, size
    d.rectangle([x, y, x + tw + 8, y + th + 6], fill=(0, 0, 0))
    d.text((x + 4, y + 2), text, fill=(255, 255, 255))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tile", type=int, default=240)
    ap.add_argument("--cell-h", type=int, default=0, help="格子高，0 = 与宽相同")
    ap.add_argument("--per", type=int, default=24, help="每版几张，0 = 不分页")
    ap.add_argument("--cols", type=int, default=0, help="列数，0 = 自动取接近方阵")
    ap.add_argument("--bg", default="#222222")
    ap.add_argument("--label", choices=["number", "filename", "none"], default="number")
    ap.add_argument("--index", default="index.tsv")
    a = ap.parse_args()

    rows = collect(a.src)
    if not rows:
        raise SystemExit("没找到图")

    cw = a.tile
    ch = a.cell_h or a.tile
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bg = tuple(int(a.bg.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) if a.bg.startswith("#") else (34, 34, 34)

    per = a.per if a.per > 0 else len(rows)
    cols = a.cols or auto_cols(per)
    rows_per_page = -(-per // cols)

    index_lines = []
    page = 0
    for start in range(0, len(rows), per):
        chunk = rows[start:start + per]
        page += 1
        img = Image.new("RGB", (cols * cw, rows_per_page * ch), bg)
        d = ImageDraw.Draw(img)
        font_size = max(11, round(cw / 12))

        for k, (label, path) in enumerate(chunk):
            n = start + k + 1
            x0 = (k % cols) * cw
            y0 = (k // cols) * ch
            try:
                im = Image.open(path)
                im.seek(0)
                im = im.convert("RGB")
                cell = fit_cell(im, cw, ch)
                img.paste(cell, (x0 + (cw - cell.width) // 2, y0 + (ch - cell.height) // 2))
            except Exception as e:
                d.text((x0 + 6, y0 + ch // 2), "ERR", fill=(220, 80, 80))
                print(f"✗ 跳过坏图 {path}: {e}", file=sys.stderr)

            text = str(n) if a.label == "number" else (label if a.label == "filename" else "")
            paste_label(img, d, x0 + 3, y0 + 3, text, font_size)
            index_lines.append(f"{n}\t{label}\t{path}")

        name = f"page-{page:02d}.jpg" if a.per > 0 else "sheet.jpg"
        dest = out / name
        img.save(dest, quality=88, optimize=True)
        print(f"  {dest}  （第 {start + 1}~{start + len(chunk)} 号）")

    if a.index:
        (out / a.index).write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    print(f"完成：{page} 版 / {len(rows)} 张 → {out}")


if __name__ == "__main__":
    main()
