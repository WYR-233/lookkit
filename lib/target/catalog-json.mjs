// 出口：通用 JSON 清单（最朴素的「一套标注 = 一个 json 数组」）。
//
// 适合「先导出看看对不对」和给别的系统直接吃。

import { writeFileSync } from 'node:fs'

export function exportCatalogJson(entries, profile, opts = {}) {
  const rows = entries.map((e) => {
    const o = { id: e.id }
    for (const k of profile.fieldKeys) o[k] = e[k]
    if (opts.hashById?.has(e.id)) o.hash = opts.hashById.get(e.id)
    return o
  })
  const doc = {
    schema: 'lookkit/catalog/1',
    profile: profile.id,
    name: profile.name || profile.id,
    version: new Date().toISOString(),
    fields: profile.fields.map((f) => ({ key: f.key, type: f.type, ...(f.values ? { values: f.values } : {}) })),
    count: rows.length,
    items: rows,
  }
  writeFileSync(opts.out, JSON.stringify(doc, null, 2) + '\n')
  return { count: rows.length, out: opts.out }
}

export default { name: 'catalog-json', export: exportCatalogJson }
