// 出口：站点知识文件（一个 JSON，给前端/插件消费）。
//
// 这是从 "把 JSONL 拼成 meta.json" 那段逻辑抽出来的——它本来就只做三件事：
// 合并多份标注（已由 merge 做完）、补 hash、套上场景的元信息（分组/署名/枚举/版本）。

import { writeFileSync } from 'node:fs'
import { splitId } from '../schema.mjs'

function pick(entry, keys) {
  const o = {}
  for (const k of keys) o[k] = entry[k]
  return o
}

function utcMinute(d = new Date()) {
  return d.toISOString().slice(0, 16) + 'Z'   // 2026-11-24T14:30Z
}

/**
 * @param {object[]} entries   merge 出来的条目
 * @param {object}   profile   场景档案
 * @param {object}   opts      { hashById: Map, kit, version, onlyGroups }
 */
export function exportStickerKit(entries, profile, opts = {}) {
  const groups = profile.groups || []
  const declared = opts.onlyGroups || (groups.length ? groups.map((g) => g.key) : null)
  const allowed = declared ? new Set(declared) : null

  const stickers = entries
    .filter((e) => !allowed || allowed.has(splitId(e.id).group))
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id, 'zh'))
    .map((e) => {
      const out = { id: e.id }
      if (opts.hashById?.has(e.id)) out.hash = opts.hashById.get(e.id)
      return Object.assign(out, pick(e, profile.fieldKeys))
    })

  const meta = {
    schema: profile.target_sticker_kit?.schema || 'sticker-kit/1',
    kit: opts.kit || profile.target_sticker_kit?.kit || profile.id,
    version: opts.version || utcMinute(),
    attribution: profile.attribution || null,
    packs: groups,
    emotions: profile.fieldMap?.get('emotion')?.values || [],
    stickers,
  }

  // 没声明的场景就不写这两栏，别塞空壳
  if (!meta.attribution) delete meta.attribution

  writeFileSync(opts.out, JSON.stringify(meta) + '\n')
  return { count: stickers.length, out: opts.out }
}

export default { name: 'sticker-kit', export: exportStickerKit }
