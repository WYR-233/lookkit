# Task: label product photos so a catalog can be searched

You are labelling product photos. Each contact sheet is a JPG showing up to 24 photos in a grid, left to right,
top to bottom, each numbered in its top-left corner. Look at EVERY sheet with your image viewing tool and write
one JSON line per photo.

## Output: one JSON object per line, keys in this order
{"id": "<group>/<stem>",
 "category": "<one of: 服装 鞋包 数码 家居 食品 其他>",
 "color": "the dominant colour, 1-3 characters",
 "condition": "<one of: 全新 轻微使用痕迹 明显磨损 破损 未知>",
 "defects": ["0 to 5 short defect notes, e.g. 边角磕碰, 划痕, 标签缺失. Empty array if none"],
 "desc": "one sentence, at most 120 chars: what the item is, as a shopper would describe it",
 "en": "short English gloss, at most 8 words"}

`defects` must be things you can SEE, not guesses. If you cannot tell, use "未知" for condition and say so
in `desc`. Never invent a defect to look thorough.

## Procedure
1. Read your batch list file (one contact sheet path per line). The item id is the group folder name + "/" +
   the sheet file stem.
2. For each sheet in order: view it, then APPEND its JSON lines to your output file immediately (so progress
   survives). If the output file already has a line for an id, skip that item (resume support).
3. Do not write anything else to the output file. Valid JSON per line, no trailing commas, no code fences.
4. When the whole list is done, append nothing more and reply DONE with the number of lines written.
