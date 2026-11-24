// 场景档案的加载与查找。
// 一个 profile = 一个目录：profile.json + 若干 prompt 文件。
//
// 查找顺序（先命中先用）：
//   --profile-dir  >  $LOOKKIT_PROFILES（冒号分隔）  >  ~/.config/lookkit/profiles  >  <repo>/profiles
// 这样「私有档案放仓库外」是默认行为，不用每次传参数。

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve, dirname, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_PROFILES = join(HERE, '..', 'profiles')
export const PRIVATE_PROFILES = join(homedir(), '.config', 'lookkit', 'profiles')
export const PROFILE_SCHEMA_VERSION = 1

export function searchDirs(cliDir) {
  const dirs = []
  if (cliDir) dirs.push(resolve(cliDir))
  const env = process.env.LOOKKIT_PROFILES
  if (env) for (const d of env.split(':')) if (d.trim()) dirs.push(resolve(d.trim()))
  dirs.push(PRIVATE_PROFILES, REPO_PROFILES)
  return [...new Set(dirs)]
}

function looksLikePath(ref) {
  return isAbsolute(ref) || ref.includes('/') || ref.endsWith('.json')
}

/** 把 "id" / "目录" / "profile.json 路径" 都解析成 profile.json 的绝对路径。 */
export function resolveProfileFile(ref, cliDir) {
  if (!ref) throw new Error('没给 profile。用 --profile <名字> 或 --profile <目录>')

  if (looksLikePath(ref)) {
    const p = isAbsolute(ref) ? ref : resolve(ref)
    if (!existsSync(p)) throw new Error(`profile 路径不存在: ${p}`)
    if (p.endsWith('.json')) return p
    const j = join(p, 'profile.json')
    if (!existsSync(j)) throw new Error(`目录里没有 profile.json: ${p}`)
    return j
  }

  const tried = []
  for (const dir of searchDirs(cliDir)) {
    const j = join(dir, ref, 'profile.json')
    if (existsSync(j)) return j
    tried.push(j)
  }
  throw new Error(`找不到 profile "${ref}"。找过这些位置：\n  ` + tried.join('\n  ') +
    `\n提示：私有档案放 ${PRIVATE_PROFILES}，或设 $LOOKKIT_PROFILES`)
}

function validate(raw, file) {
  const err = (m) => new Error(`${file}: ${m}`)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw err('不是一个 JSON 对象')
  if (!raw.id || typeof raw.id !== 'string') throw err('缺 id')
  if (raw.version != null && raw.version !== PROFILE_SCHEMA_VERSION) {
    throw err(`version=${raw.version}，本工具只认 ${PROFILE_SCHEMA_VERSION}`)
  }
  if (!Array.isArray(raw.fields) || raw.fields.length === 0) throw err('fields 必须是非空数组')

  const keys = new Set()
  for (const f of raw.fields) {
    if (!f || !f.key) throw err('fields 里有一项缺 key')
    if (keys.has(f.key)) throw err(`字段 key 重复: ${f.key}`)
    keys.add(f.key)
    if (!['string', 'enum', 'list', 'bool', 'number'].includes(f.type)) {
      throw err(`字段 ${f.key} 的 type 不认识: ${f.type}`)
    }
    if (f.type === 'enum' && (!Array.isArray(f.values) || !f.values.length)) {
      throw err(`字段 ${f.key} 是 enum 但没给 values`)
    }
  }

  const sheet = raw.sheet || {}
  if (sheet.mode && !['frames', 'tiles'].includes(sheet.mode)) {
    throw err(`sheet.mode 只能是 frames 或 tiles，现在是 ${sheet.mode}`)
  }
  const review = raw.review || {}
  for (const c of review.checks || []) {
    if (!c.key) throw err('review.checks 里有一项缺 key')
    if (c.note && !keys.has(c.note)) throw err(`checks.${c.key}.note 指向不存在的字段: ${c.note}`)
  }
  for (const k of review.display || []) {
    if (!keys.has(k)) throw err(`review.display 里有不存在的字段: ${k}`)
  }
  return raw
}

/** 加载并校验一个 profile；返回对象上额外挂了 dir / file / 方法。 */
export function loadProfile(ref, opts = {}) {
  const file = resolveProfileFile(ref, opts.profileDir)
  let raw
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new Error(`${file}: JSON 解析失败 — ${e.message}`)
  }
  validate(raw, file)

  const dir = dirname(file)
  const p = {
    ...raw,
    dir,
    file,
    sheet: { mode: 'tiles', tile: 240, per: 0, ...(raw.sheet || {}) },
    fields: raw.fields,
    review: { display: raw.fields.map((f) => f.key), checks: [], ...(raw.review || {}) },
  }

  p.fieldMap = new Map(p.fields.map((f) => [f.key, f]))
  p.fieldKeys = p.fields.map((f) => f.key)

  /** profile 里写的 prompt 是相对 profile 目录的；也可能是 null（这个场景不用）。 */
  p.promptPath = (kind) => {
    const rel = (p.prompts || {})[kind]
    if (!rel) return null
    const abs = isAbsolute(rel) ? rel : join(dir, rel)
    return existsSync(abs) ? abs : null
  }
  p.promptText = (kind) => {
    const f = p.promptPath(kind)
    return f ? readFileSync(f, 'utf8') : null
  }

  return p
}

export function listProfiles(opts = {}) {
  const out = []
  const seen = new Set()
  for (const dir of searchDirs(opts.profileDir)) {
    let names = []
    try {
      names = readdirSync(dir)
    } catch { continue }
    for (const name of names) {
      const j = join(dir, name, 'profile.json')
      if (!existsSync(j)) continue
      try {
        const raw = JSON.parse(readFileSync(j, 'utf8'))
        if (seen.has(raw.id)) continue
        seen.add(raw.id)
        out.push({ id: raw.id, name: raw.name || raw.id, file: j, dir, private: dir !== REPO_PROFILES })
      } catch { /* 坏档案不挡路 */ }
    }
  }
  return out
}
