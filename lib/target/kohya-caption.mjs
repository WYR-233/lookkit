// 出口：kohya 训练目录（图 + 同名 .txt caption）。
//
// caption 只写「变化的字段」，固定特征绑到触发词上——这是 LoRA 训练的通行做法，
// 所以模板里默认没有「角色外貌」这类字段。

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.webp']

function fill(template, entry, trigger) {
  const s = String(template || '{trigger}').replace(/\{trigger\}/g, trigger || '')
  return s.replace(/\{(\w+)\}/g, (_, k) => {
    const v = entry[k]
    if (v == null) return ''
    return Array.isArray(v) ? v.join(' ') : String(v)
  })
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .replace(/(^[,\s]+)|([,\s]+$)/g, '')
}

/**
 * @param {object[]} entries
 * @param {object} profile
 * @param {object} opts { raw, out, state, onlyPass }
 */
export function exportKohyaCaption(entries, profile, opts = {}) {
  const cfg = profile.target_kohya || {}
  const trigger = cfg.trigger || ''
  const template = cfg.caption_format || '{trigger}'
  const state = opts.state || {}
  const rawDir = opts.raw
  const outDir = opts.out
  if (!rawDir || !outDir) throw new Error('kohya 导出需要 --raw <原图目录> 和 --out <训练目录>')

  mkdirSync(outDir, { recursive: true })
  let written = 0
  const missing = []

  for (const e of entries) {
    if (opts.onlyPass && state[e.id]?.verdict !== 'pass') continue
    const stem = e.id.slice(e.id.lastIndexOf('/') + 1)
    const src = IMG_EXTS.map((x) => join(rawDir, stem + x)).find((p) => existsSync(p))
    if (!src) { missing.push(e.id); continue }

    const ext = extname(src)
    const destImg = join(outDir, stem + ext)
    if (src !== destImg) copyFileSync(src, destImg)
    writeFileSync(join(outDir, stem + '.txt'), fill(template, e, trigger) + '\n')
    written++
  }

  return { count: written, out: outDir, missing }
}

export default { name: 'kohya-caption', export: exportKohyaCaption }
