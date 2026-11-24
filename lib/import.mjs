// 入库：把「清单 + 源目录」变成「带分类的图库」。
//
// 三件事：
//   1. 内容哈希判重 —— 同一张图改名/二次导入都不会重复占号
//   2. 序号接续     —— 新图从库里最大号往后排，不复用号
//   3. 分发到子目录 —— <库>/<tag>/<prefix>-NNN.ext，同时维护 index.db 和 manifest.json
//
// `--dry` 只打印不落盘，先看清要干什么。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, extname, basename, dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const slug = (t) => String(t || 'other').toLowerCase().replace(/[^a-z0-9_\u4e00-\u9fa5-]+/g, '') || 'other'
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')

const SCHEMA = `CREATE TABLE IF NOT EXISTS memes (
  path TEXT PRIMARY KEY, tag TEXT, file_name TEXT,
  caption TEXT, keywords TEXT, mtime REAL, imported_at REAL
)`

export function readList(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const list = Array.isArray(raw) ? raw : (raw.memes || raw.items || [])
  if (!Array.isArray(list) || !list.length) throw new Error(`清单里没有条目: ${path}`)
  return list
}

export function runImport(opts = {}) {
  const {
    listPath,
    fromDir,
    libDir,
    prefix,
    tagField = 'tag',
    captionField = 'caption',
    keywordsField = 'keywords',
    dry = false,
    captionMax = 120,
    keywordsMax = 200,
    manifest = true,
  } = opts

  if (!listPath) throw new Error('import 需要 --in <清单.json>')
  if (!fromDir) throw new Error('import 需要 --from <源目录>')
  if (!libDir) throw new Error('import 需要 --to <库目录>')

  const items = readList(listPath)
  const from = existsSync(fromDir) ? readdirSync(fromDir) : []
  const fromSet = new Set(from)

  const missing = items.filter((it) => !fromSet.has(it.file || it.src || it.name))
  if (missing.length) {
    console.warn(`⚠ 源目录里找不到 ${missing.length} 个: ` + missing.slice(0, 5).map((m) => m.file || m.src).join(', '))
  }

  const outRoot = join(libDir, 'memes')
  mkdirSync(outRoot, { recursive: true })

  const dbPath = join(libDir, 'index.db')
  const db = new DatabaseSync(dbPath)
  db.exec(SCHEMA)
  try { db.exec('ALTER TABLE memes ADD COLUMN imported_at REAL') } catch { /* 已存在 */ }

  // 已入库内容的哈希索引
  const libHash = new Map()
  for (const rel of db.prepare('SELECT path FROM memes').all().map((r) => r.path)) {
    const abs = join(outRoot, rel)
    if (!existsSync(abs)) continue
    try { libHash.set(sha1(readFileSync(abs)), rel) } catch {}
  }

  const seqOf = (rel) => Number((/-(\d+)\.\w+$/.exec(rel) || [0, 0])[1]) || 0
  let seq = [...libHash.values()].reduce((max, p) => Math.max(max, seqOf(p)), 0)

  let added = 0, skipped = 0, dup = 0
  const planned = []

  for (const it of items) {
    const file = it.file || it.src || it.name
    if (!fromSet.has(file)) { skipped++; continue }

    const srcPath = join(fromDir, file)
    let hash
    try { hash = sha1(readFileSync(srcPath)) } catch { skipped++; continue }

    if (libHash.has(hash)) { dup++; continue }

    seq++
    const tag = slug(it[tagField])
    const ext = extname(file).toLowerCase() || '.jpg'
    const rel = `${tag}/${prefix}-${String(seq).padStart(3, '0')}${ext}`
    const abs = join(outRoot, rel)
    const caption = String(it[captionField] || '').trim().slice(0, captionMax)
    const keywords = String(it[keywordsField] || '').trim().slice(0, keywordsMax)

    planned.push({ file, rel, tag, caption, keywords })

    if (dry) {
      console.log(`[dry] ${file} -> ${rel}  tag=${tag} | ${caption} | ${keywords}`)
      continue
    }

    mkdirSync(dirname(abs), { recursive: true })
    copyFileSync(srcPath, abs)
    libHash.set(hash, rel)
    db.prepare('INSERT OR REPLACE INTO memes (path, tag, file_name, caption, keywords, mtime, imported_at) VALUES (?,?,?,?,?,?,?)')
      .run(rel, tag, basename(rel), caption, keywords, statSync(srcPath).mtimeMs, Date.now())
    added++
  }

  const total = db.prepare('SELECT COUNT(*) c FROM memes').get().c
  const tags = db.prepare('SELECT tag, COUNT(*) c FROM memes GROUP BY tag ORDER BY c DESC').all()
  db.close()

  if (manifest && !dry) {
    const mfPath = join(libDir, 'manifest.json')
    const prev = existsSync(mfPath) ? JSON.parse(readFileSync(mfPath, 'utf8')) : {}
    writeFileSync(mfPath, JSON.stringify({
      id: prev.id || basename(libDir),
      name: prev.name || basename(libDir),
      version: String(prev.version || '1.0.0'),
      description: prev.description || '',
      tags: prev.tags || [],
      license: prev.license || 'personal',
    }, null, 2) + '\n')
  }

  return { added, skipped, dup, total, tags, libDir, dry, planned }
}

export function formatImportResult(r) {
  const L = [`图库: ${r.libDir}`]
  if (r.dry) L.push(`[dry] 计划入库 ${r.planned.length} 张`)
  else L.push(`本次入库 ${r.added} 张${r.skipped ? `，跳过 ${r.skipped} 张` : ''}${r.dup ? `，重复 ${r.dup} 张` : ''}；库内共 ${r.total} 张`)
  if (r.tags.length) L.push('分类分布: ' + r.tags.map((t) => `${t.tag}=${t.c}`).join(' '))
  return L.join('\n')
}
