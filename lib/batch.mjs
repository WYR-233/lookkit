// 批量清单与 stale 检测。
//
// 「清单」就是喂给视觉模型的那个文件：一行一个 sheet 路径。
// id 由路径推出（`<分组>/<文件名>.jpg` → `<分组>/<文件名>`），所以 sheet 目录结构
// 必须和 id 结构一致。这条规则写在场景 prompt 里，别改。

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, relative, basename, dirname, sep } from 'node:path'
import { readItems } from './scan.mjs'

/** 递归列出目录里的 sheet 图，按路径排序（编号/顺序必须稳定）。 */
export function listSheets(dir, exts = ['.jpg', '.jpeg', '.png']) {
  const out = []
  const walk = (d) => {
    let names
    try { names = readdirSync(d) } catch { return }
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue
      const abs = join(d, name)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) walk(abs)
      else if (exts.includes(extname(name).toLowerCase())) out.push(abs)
    }
  }
  walk(dir)
  return out
}

/** frames 模式：一件 ↔ 一张 sheet。路径按 `<sheetsDir>/<group>/<stem>.jpg` 拼。 */
export function sheetsFor(items, sheetsDir, ext = '.jpg') {
  return items.map((it) => {
    const group = it.group || (it.id.includes('/') ? it.id.slice(0, it.id.lastIndexOf('/')) : '')
    const stem = it.id.slice(it.id.lastIndexOf('/') + 1)
    return { id: it.id, sheet: join(sheetsDir, group, stem + ext), src: it.src }
  })
}

export function writeBatch(rows, outPath) {
  const lines = rows.map((r) => (typeof r === 'string' ? r : r.sheet))
  writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''))
  return lines.length
}

/** 读「已知标注」的来源，返回 Map<id, hash|null>。认几种常见形状。 */
export function loadKnown(path) {
  const known = new Map()
  if (!existsSync(path)) throw new Error(`known 文件不存在: ${path}`)

  if (path.endsWith('.jsonl')) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const o = JSON.parse(line)
        if (o && o.id) known.set(String(o.id), o.hash ?? null)
      } catch { /* 坏行跳过 */ }
    }
    return known
  }

  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const list = Array.isArray(raw) ? raw
    : raw.stickers || raw.items || raw.data || []
  if (Array.isArray(list)) {
    for (const o of list) if (o && o.id) known.set(String(o.id), o.hash ?? null)
    return known
  }
  // state 形态：{id: {...}}
  for (const k of Object.keys(raw || {})) known.set(k, raw[k]?.hash ?? null)
  return known
}

/**
 * 找出需要（重新）标注的件。
 * - 标注里没有这个 id → new
 * - 有，但 hash 变了    → changed（图被换过，旧标注不可信）
 * 已知来源里 hash 为 null 时只判 new，不判 changed（没法比）。
 */
export function findStale(items, known) {
  const out = []
  for (const it of items) {
    if (!known.has(it.id)) { out.push({ id: it.id, reason: 'new', src: it.src }); continue }
    const h = known.get(it.id)
    if (h && it.hash && h !== it.hash) out.push({ id: it.id, reason: 'changed', src: it.src })
  }
  return out
}

export { readItems }
