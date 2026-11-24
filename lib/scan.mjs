// 扫描素材 → items.jsonl
//
// 输入三种形态都认：
//   <目录>            扫里面的图片文件
//   <xxx.json>        清单：{items:[...]} 或 [...]，每项至少要有 src 或 path
//   <xxx.jsonl>       已经是 items 格式，重新算一遍 hash（图可能被换过）
//
// 输出一行一件：{id, src, hash, group, extra}
// hash 是**内容**哈希，不是 mtime —— 用它判断"图改过没有"。

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve, relative, basename, extname, dirname, sep } from 'node:path'

export const DEFAULT_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.heic', '.heif']

export function hashFile(path) {
  const buf = readFileSync(path)
  return createHash('sha1').update(buf).digest('hex').slice(0, 16)
}

export function hashBuffer(buf) {
  return createHash('sha1').update(buf).digest('hex').slice(0, 16)
}

function walk(dir, exts, recursive) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    let names
    try { names = readdirSync(cur) } catch { continue }
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue
      const abs = join(cur, name)
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) {
        if (recursive) stack.push(abs)
        continue
      }
      if (exts.includes(extname(name).toLowerCase())) out.push(abs)
    }
  }
  return out
}

/** 由「相对输入根目录的路径」推 group。单层文件 → 空 group。 */
function groupOf(relPath) {
  const parts = relPath.split(sep)
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function idOf(group, stem) {
  return group ? `${group}/${stem}` : stem
}

export function scan({ input, exts = DEFAULT_EXTS, recursive = true, groupMode = 'auto', fixedGroup = '' } = {}) {
  const p = resolve(input)
  if (!existsSync(p)) throw new Error(`输入不存在: ${p}`)
  const st = statSync(p)
  const items = []
  const warnings = []

  if (st.isDirectory()) {
    const files = walk(p, exts, recursive)
    for (const abs of files) {
      const rel = relative(p, abs)
      const group = groupMode === 'flat' ? '' : groupMode === 'fixed' ? fixedGroup : groupOf(rel)
      items.push({
        id: idOf(group, basename(abs, extname(abs))),
        src: abs,
        hash: hashFile(abs),
        group,
        extra: {},
      })
    }
    return { items, warnings, root: p }
  }

  if (p.endsWith('.json')) {
    const raw = JSON.parse(readFileSync(p, 'utf8'))
    const list = Array.isArray(raw) ? raw : (raw.items || raw.memes || [])
    for (const it of list) {
      const src = it.src || it.path || it.file
      if (!src) { warnings.push(`清单里有一项没有 src/path/file，跳过: ${JSON.stringify(it).slice(0, 80)}`); continue }
      const abs = resolve(dirname(p), src)
      if (!existsSync(abs)) { warnings.push(`找不到文件，跳过: ${abs}`); continue }
      const group = it.group ?? it.pack ?? fixedGroup ?? ''
      const stem = it.stem || basename(abs, extname(abs))
      items.push({
        id: it.id || idOf(group, stem),
        src: abs,
        hash: it.hash && !it.rehash ? it.hash : hashFile(abs),
        group,
        extra: it.extra || {},
      })
    }
    return { items, warnings, root: dirname(p) }
  }

  if (p.endsWith('.jsonl')) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const s = line.trim()
      if (!s) continue
      let it
      try { it = JSON.parse(s) } catch { warnings.push(`坏行跳过: ${s.slice(0, 60)}`); continue }
      if (!it.src) { items.push(it); continue }   // 没有 src 就原样保留
      const abs = resolve(it.src)
      if (!existsSync(abs)) { warnings.push(`找不到文件，保留原 hash: ${abs}`); items.push(it); continue }
      items.push({ ...it, src: abs, hash: hashFile(abs) })
    }
    return { items, warnings, root: dirname(p) }
  }

  throw new Error(`认不出的输入: ${p}（要目录、.json 或 .jsonl）`)
}

export function writeItems(items, outPath) {
  const lines = items.map((it) => JSON.stringify(it))
  writeFileSync(outPath, lines.join('\n') + (lines.length ? '\n' : ''))
  return items.length
}

export function readItems(path) {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
}
