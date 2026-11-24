# Task: strict second-pass audit of existing annotations

A previous pass already labelled these items. Your job is NOT to re-label everything — it is to find the
entries that are **wrong or unsupported by the image**, and fix only those.

Input: `{{WORKDIR}}/annot/merged.jsonl`, one JSON object per line (schema as in `profile.json`).
Contact sheet for id `<group>/<stem>` is `{{SHEETS}}/<group>/<stem>.jpg`. View the sheet for every entry you
change or doubt.

## What to check

1. **`defects` must be visible.** Each note must describe something a buyer could point at in the photo.
   Vague impressions ("看起来旧", "感觉有问题") are not defects. If you cannot see it, drop it.
2. **`condition` must not contradict `defects`.** "破损" with an empty `defects` is a contradiction; so is
   "全新" with a visible crack. Fix whichever is wrong.
3. **`color` must be the dominant colour of the item itself**, not the background, packaging, or the studio
   backdrop.
4. Fix any other obvious factual error you notice in the same entry.

Do not rewrite entries that are already correct. Do not "improve" wording for style — only fix what is wrong.

## Output

Write ONLY the entries you changed, full objects with all keys, one per line, to
`{{WORKDIR}}/annot/audit.jsonl` (create it, even if empty).

Then write a short report to `{{WORKDIR}}/annot/audit-report.md`: how many entries you looked at, how many you
changed, and one line per change saying what was wrong and why.

Reply with the two numbers when done.
