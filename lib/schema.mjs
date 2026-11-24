// 字段清洗与规则校验。
// 模型输出永远可能脏：枚举造词、列表塞空串、字符串超长、布尔写成 "true"。
// 这里统一洗干净，并给出「哪些被改了」，而不是静默吞。

import { loadProfile } from './profile.mjs'

/** id 约定：`分组/文件名`，分组里可以再带 `/`，所以只按最后一个 `/` 切。 */
export function splitId(id) {
  const s = String(id || '')
  const i = s.lastIndexOf('/')
  return i < 0 ? { group: '', stem: s } : { group: s.slice(0, i), stem: s.slice(i + 1) }
}

const truthy = new Set(['true', '1', 'yes', 'y', '是', '真'])
const falsy = new Set(['false', '0', 'no', 'n', '否', '假', ''])

/** 按字段定义清洗一个值。返回值永远是这个字段该有的类型。 */
export function cleanValue(field, value) {
  switch (field.type) {
    case 'enum': {
      const v = String(value ?? '').trim()
      return field.values.includes(v) ? v : (field.fallback ?? field.values[0] ?? '')
    }
    case 'list': {
      let arr = Array.isArray(value) ? value : String(value ?? '').split(/[,，;；\n]/)
      arr = arr.map((x) => String(x ?? '').trim()).filter(Boolean)
      // 去重，保留顺序
      arr = [...new Set(arr)]
      if (field.item_max) arr = arr.map((x) => x.slice(0, field.item_max))
      if (field.max != null) arr = arr.slice(0, field.max)
      return arr
    }
    case 'bool': {
      if (typeof value === 'boolean') return value
      const s = String(value ?? '').trim().toLowerCase()
      if (truthy.has(s)) return true
      if (falsy.has(s)) return false
      return Boolean(field.default)
    }
    case 'number': {
      const n = Number(value)
      if (!Number.isFinite(n)) return field.default ?? 0
      if (field.min != null && n < field.min) return field.min
      if (field.max != null && n > field.max) return field.max
      return n
    }
    case 'string':
    default: {
      let s = String(value ?? '').trim()
      if (field.max != null && s.length > field.max) s = s.slice(0, field.max)
      return s
    }
  }
}

/**
 * 清洗一整条标注。
 * 只保留 profile.fields 里的字段（白名单），缺的用默认值补。
 * 返回 { entry, changes } —— changes 是「洗掉了什么」，给人看。
 */
export function cleanEntry(raw, profile) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { entry: null, changes: [], error: '不是一个对象' }
  }
  const id = String(raw.id ?? '').trim()
  if (!id) return { entry: null, changes: [], error: '缺 id' }

  const entry = { id }
  const changes = []

  for (const f of profile.fields) {
    const incoming = raw[f.key]
    const cleaned = cleanValue(f, incoming)

    const same = JSON.stringify(incoming) === JSON.stringify(cleaned) ||
                 (incoming === undefined && JSON.stringify(cleaned) === JSON.stringify(defaultOf(f)))
    if (!same) {
      const from = incoming === undefined ? '(缺)' : JSON.stringify(incoming)
      changes.push(`${f.key}: ${from} → ${JSON.stringify(cleaned)}`)
    }
    entry[f.key] = cleaned
  }

  for (const k of Object.keys(raw)) {
    if (!profile.fieldMap.has(k) && k !== 'id' && !k.startsWith('_')) {
      changes.push(`(丢弃未声明字段 ${k})`)
    }
  }

  return { entry, changes }
}

function defaultOf(f) {
  if (f.type === 'list') return []
  if (f.type === 'bool') return Boolean(f.default)
  if (f.type === 'number') return f.default ?? 0
  if (f.type === 'string') return String(f.default ?? '')
  return f.fallback ?? f.values?.[0] ?? ''
}

// ── 极小条件表达式 ───────────────────────────────────────
// 支持三种，够用就行，不搞 DSL：
//   field == value          field != value
//   id in 35..46
//   field =~ /正则/
export function compileWhen(expr) {
  const s = String(expr || '').trim()
  if (!s) return () => false
  let m

  if ((m = /^(\w+)\s+in\s+(-?\d+)\s*\.\.\s*(-?\d+)$/.exec(s))) {
    const [, f, a, b] = m
    const lo = Number(a), hi = Number(b)
    return (e) => {
      const v = Number(e?.[f])
      return Number.isFinite(v) && v >= Math.min(lo, hi) && v <= Math.max(lo, hi)
    }
  }
  if ((m = /^(\w+)\s*=~\s*\/(.+)\/([gimsuy]*)$/.exec(s))) {
    const [, f, src, flags] = m
    let re
    try { re = new RegExp(src, flags.includes('g') ? flags : flags + 'g') } catch { return () => false }
    return (e) => { re.lastIndex = 0; return re.test(String(e?.[f] ?? '')) }
  }
  if ((m = /^(\w+)\s*(==|!=)\s*(.+)$/.exec(s))) {
    const f = m[1], op = m[2]
    const v = m[3].trim().replace(/^['"]|['"]$/g, '')
    return (e) => (String(e?.[f] ?? '') === v) === (op === '==')
  }
  return () => false
}

/** 跑 profile.rules：命中就 set / require / min_list。返回违规说明数组。 */
export function applyRules(entry, profile) {
  const problems = []
  for (const rule of profile.rules || []) {
    let hit = false
    try { hit = compileWhen(rule.when)(entry) } catch { hit = false }
    if (!hit) continue

    if (rule.set) Object.assign(entry, rule.set)
    for (const k of rule.require || []) {
      const v = entry[k]
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length)
      if (empty) problems.push(`${entry.id}: 规则「${rule.when}」要求 ${k} 不能为空`)
    }
    for (const [k, min] of Object.entries(rule.min_list || {})) {
      const v = entry[k]
      if (!Array.isArray(v) || v.length < min) {
        problems.push(`${entry.id}: 规则「${rule.when}」要求 ${k} 至少 ${min} 项`)
      }
    }
    for (const [k, max] of Object.entries(rule.max_list || {})) {
      const v = entry[k]
      if (Array.isArray(v) && v.length > max) entry[k] = v.slice(0, max)
    }
  }
  return problems
}

/**
 * 审核面板用：某个检查项当前该显示什么状态。
 * check = { key, label, note?, derived?: { when, then, label } }
 *
 * derived.when 里写 `note` 时，指的是 check.note 那个字段的值（把字段名统一成 note，
 * 这样 profile 里写条件不用关心实际叫什么）。也支持 `id in 35..46` 这类。
 */
export function checkState(entry, check) {
  if (Boolean(entry?.[check.key])) return { ok: true, status: 'ok', label: '' }

  if (check.derived?.when) {
    const probe = { ...entry, note: check.note ? String(entry?.[check.note] ?? '') : '' }
    let hit = false
    try { hit = compileWhen(check.derived.when)(probe) } catch { hit = false }
    if (hit) return { ok: false, status: check.derived.then, label: check.derived.label || '' }
  }
  return { ok: false, status: 'bad', label: '' }
}

export { loadProfile }
