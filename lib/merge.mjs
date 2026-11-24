// 合并多份标注 + 清洗 + 校验。
//
// 核心行为：**按顺序叠加，字段级，后者覆盖前者**。
// 一个机制覆盖：模型复审（只写改动项）、人工微调、断点续跑、多版本对比。
//
// 清洗规则全部在 schema.mjs 里，这里只负责「读 → 叠 → 洗 → 报」。

import { readFileSync, writeFileSync } from 'node:fs'
import { cleanEntry, applyRules } from './schema.mjs'

export function readJsonl(path) {
  const rows = []
  const errors = []
  const text = readFileSync(path, 'utf8')
  text.split('\n').forEach((line, i) => {
    const s = line.trim()
    if (!s) return
    try {
      const o = JSON.parse(s)
      if (Array.isArray(o)) { errors.push(`${path}:${i + 1} 是数组，本工具要一行一个对象`); return }
      rows.push(o)
    } catch (e) {
      errors.push(`${path}:${i + 1} JSON 坏了 — ${e.message}`)
    }
  })
  return { rows, errors }
}

/** 多份 JSONL 字段级叠加。后面的覆盖前面的。 */
export function overlay(files) {
  const byId = new Map()
  const order = []
  const errors = []
  const perFile = []

  for (const f of files) {
    const { rows, errors: e } = readJsonl(f)
    errors.push(...e)
    perFile.push({ file: f, lines: rows.length })
    for (const row of rows) {
      const id = String(row?.id ?? '').trim()
      if (!id) { errors.push(`${f}: 有一行没有 id，跳过`); continue }
      if (!byId.has(id)) order.push(id)
      byId.set(id, { ...(byId.get(id) || {}), ...row })
    }
  }
  return { byId, order, errors, perFile }
}

/**
 * 合并 + 清洗。
 * 返回 { entries, report }，report 里是给人看的：改了哪些字段、哪些不合规、缺哪些。
 */
export function mergeAnnotations(files, profile, opts = {}) {
  const { byId, order, errors, perFile } = overlay(files)
  const entries = []
  const report = { errors, perFile, changes: [], problems: [], invalid: [], missing: [], extra: [] }

  for (const id of order) {
    const raw = byId.get(id)
    const { entry, changes, error } = cleanEntry(raw, profile)
    if (!entry) { report.invalid.push(`${id}: ${error}`); continue }
    report.problems.push(...applyRules(entry, profile))
    if (changes.length) report.changes.push({ id, changes })
    entries.push(entry)
  }

  // 和 items 对比：哪些该有却没有（漏标），哪些标注了但素材里没有（多余）
  if (opts.items) {
    const have = new Set(entries.map((e) => e.id))
    for (const it of opts.items) if (!have.has(it.id)) report.missing.push(it.id)
    const want = new Set(opts.items.map((it) => it.id))
    for (const e of entries) if (!want.has(e.id)) report.extra.push(e.id)
  }

  return { entries, report }
}

export function writeJsonl(entries, outPath) {
  writeFileSync(outPath, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''))
  return entries.length
}

/** 给人看的合并报告。 */
export function formatReport(report, { quiet = false } = {}) {
  const L = []
  const n = (a) => a.length

  if (!quiet) {
    for (const f of report.perFile) L.push(`  读 ${f.file}（${f.lines} 行）`)
  }

  if (n(report.errors)) {
    L.push(`\n✗ 解析错误 ${n(report.errors)}:`)
    for (const e of report.errors.slice(0, 10)) L.push(`    ${e}`)
  }
  if (n(report.invalid)) {
    L.push(`\n✗ 条目无效 ${n(report.invalid)}:`)
    for (const e of report.invalid.slice(0, 10)) L.push(`    ${e}`)
  }
  if (n(report.changes) && !quiet) {
    L.push(`\n· 清洗改写了 ${n(report.changes)} 条字段:`)
    for (const c of report.changes.slice(0, 8)) {
      L.push(`    ${c.id}`)
      for (const x of c.changes.slice(0, 4)) L.push(`      ${x}`)
    }
    if (n(report.changes) > 8) L.push(`    …还有 ${n(report.changes) - 8} 条`)
  }
  if (n(report.problems)) {
    L.push(`\n⚠ 规则校验 ${n(report.problems)} 处:`)
    for (const p of report.problems.slice(0, 10)) L.push(`    ${p}`)
  }
  if (n(report.missing)) {
    L.push(`\n⚠ 素材里有、标注里没有（漏标）${n(report.missing)}:`)
    for (const m of report.missing.slice(0, 12)) L.push(`    ${m}`)
    if (n(report.missing) > 12) L.push(`    …还有 ${n(report.missing) - 12}`)
  }
  if (n(report.extra)) {
    L.push(`\n⚠ 标注里有、素材里没有（多余）${n(report.extra)}:`)
    for (const m of report.extra.slice(0, 12)) L.push(`    ${m}`)
  }
  return L.join('\n')
}
