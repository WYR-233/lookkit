// 全库核对图：按库内固定顺序编号，每版 N 格，配一份 list.tsv。
//
// 用途是「人眼看一遍整个库，确认没有重复/放错/坏图」。
// 真正的拼图交给 img/sheet_tiles.py（唯一实现），这里只负责准备清单 + 转调。

import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readItems } from './scan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TILES_PY = join(HERE, '..', 'img', 'sheet_tiles.py')

/** 从一个图库（有 index.db）或 items.jsonl 读出 [{n, id, tag, caption, path}] */
export function loadLibrary({ libDir, itemsPath }) {
  if (itemsPath) {
    const items = readItems(itemsPath)
    return items.map((it, i) => ({
      n: i + 1, id: it.id, tag: it.group || '', caption: '', path: it.src,
    }))
  }
  if (!libDir) throw new Error('overview 需要 --lib <库目录> 或 --items <items.jsonl>')
  const dbPath = join(libDir, 'index.db')
  if (!existsSync(dbPath)) throw new Error(`库里没有 index.db: ${dbPath}`)
  const db = new DatabaseSync(dbPath)
  const rows = db.prepare('SELECT path, tag, caption FROM memes').all()
  db.close()
  rows.sort((a, b) => a.path.localeCompare(b.path))
  return rows.map((r, i) => ({
    n: i + 1, id: r.path, tag: r.tag, caption: r.caption,
    path: join(libDir, 'memes', r.path),
  }))
}

export function runOverview(opts = {}) {
  const { libDir, itemsPath, out, tile = 200, per = 36, label = 'number' } = opts
  if (!out) throw new Error('overview 需要 --out <输出目录>')

  const rows = loadLibrary({ libDir, itemsPath })
  if (!rows.length) throw new Error('库里是空的')

  mkdirSync(out, { recursive: true })

  // 生成一份 sheet_tiles 认的清单
  const tmpItems = join(out, '_items.tmp.jsonl')
  writeFileSync(tmpItems, rows.map((r) => JSON.stringify({ id: String(r.n), src: r.path })).join('\n') + '\n')

  const args = [
    '-I', TILES_PY,
    '--in', tmpItems,
    '--out', out,
    '--tile', String(tile),
    '--per', String(per),
    '--label', label,
    '--index', 'list.tsv',
  ]
  const r = spawnSync('python3', args, { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`拼图失败: ${r.stderr || r.stdout || '未知错误'}`)
  }

  // 再把 list.tsv 补上「字段」列（编号 标签 caption 路径）
  const tsv = rows.map((x) => `${x.n}\t${x.tag || '-'}\t${x.caption || '-'}\t${x.path}`).join('\n') + '\n'
  writeFileSync(join(out, 'list.tsv'), tsv)

  return { pages: r.stdout, rows: rows.length, out }
}
