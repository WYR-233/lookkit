// 出口：一次性静态 HTML 审核页（给不看服务的人，或者留档）。
//
// 和 review-server 的区别：这个不落盘、不交互，生成完就是一个可以发出去/存档的网页。

import { writeFileSync } from 'node:fs'
import { relative, dirname, resolve, sep } from 'node:path'
import { checkState } from '../schema.mjs'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function exportStaticHtml(entries, profile, opts = {}) {
  const title = opts.title || profile.review?.title || profile.name || profile.id
  const checks = profile.review?.checks || []
  const display = profile.review?.display || profile.fieldKeys
  const rawDir = opts.raw ? resolve(opts.raw) : null
  const outFile = opts.out
  const htmlDir = dirname(outFile)

  const relSrc = (id) => {
    if (!rawDir) return ''
    const stem = id.slice(id.lastIndexOf('/') + 1)
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
      const p = resolve(rawDir, stem + ext)
      const rel = relative(htmlDir, p).split(sep).join('/')
      return rel
    }
    return ''
  }

  // 统计
  const counters = new Map()   // check.key → {ok, bad, 派生状态各几个}
  const stat = { total: entries.length }
  for (const c of checks) counters.set(c.key, { ok: 0, bad: 0, derived: {} })
  for (const e of entries) {
    for (const c of checks) {
      const st = checkState(e, c)
      const box = counters.get(c.key)
      if (st.ok) box.ok++
      else if (st.status === 'bad') box.bad++
      else box.derived[st.status] = (box.derived[st.status] || 0) + 1
    }
  }

  const nav = checks.map((c) => {
    const b = counters.get(c.key)
    const derived = Object.entries(b.derived).map(([k, v]) => `${k} ${v}`).join(' ')
    return `<button data-f="bad:${c.key}">${esc(c.label)} 不合格 ${b.bad}</button>` +
      (derived ? ` <button data-f="derived:${c.key}">${esc(c.label)} 其他 ${esc(derived)}</button>` : '')
  }).join('')

  const cards = entries.map((e) => {
    const src = relSrc(e.id)
    const flags = checks.map((c) => {
      const st = checkState(e, c)
      return st.ok ? '' : `${c.key}:${st.status}`
    }).join(',')
    const rows = checks.map((c) => {
      const st = checkState(e, c)
      const mark = st.ok ? '<b class="ok">✓</b>' : '<b class="no">✗</b>'
      const tag = st.label ? `<em class="tag">${esc(st.label)}</em>` : ''
      const note = c.note ? esc(e[c.note] || '') : ''
      return `<tr><td>${esc(c.label)}</td><td>${mark} ${tag}${note}</td></tr>`
    }).join('')

    const fields = display.map((k) => {
      const v = e[k]
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) return ''
      const text = Array.isArray(v) ? v.join(' · ') : String(v)
      return `<div class="f"><span class="k">${esc(k)}</span> ${esc(text)}</div>`
    }).join('')

    return `<figure class="c" data-flag="${esc(flags)}">
  ${src ? `<a href="${esc(src)}" target="_blank"><img loading="lazy" src="${esc(src)}" alt="${esc(e.id)}"></a>` : ''}
  <figcaption>
    <div class="hd"><b>${esc(e.id)}</b></div>
    ${rows ? `<table>${rows}</table>` : ''}
    ${fields}
  </figcaption>
</figure>`
  }).join('\n')

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${entries.length}</title>
<style>
body{background:#14161c;color:#dde3ee;font:13px/1.55 system-ui,sans-serif;margin:0;padding:16px}
h1{font-size:18px;margin:0 0 6px}
.stat{color:#93a0b4;margin-bottom:10px}
.nav{position:sticky;top:0;background:#14161c;padding:8px 0;z-index:9;border-bottom:1px solid #262b36;margin-bottom:12px}
.nav button{background:#222836;color:#cdd6e5;border:1px solid #333c4d;border-radius:14px;padding:3px 11px;margin:0 6px 6px 0;cursor:pointer;font-size:12.5px}
.nav button.on{background:#3b6ef5;border-color:#3b6ef5;color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.c{margin:0;background:#1c2029;border-radius:8px;overflow:hidden}
.c img{width:100%;display:block;background:#0e1015}
figcaption{padding:8px 10px}
.hd{font-size:12.5px;margin-bottom:5px;color:#8ec8ff}
table{border-collapse:collapse;font-size:12px;width:100%;margin-bottom:5px}
td{padding:1px 4px 1px 0;vertical-align:top;color:#a9b4c6}
td:first-child{color:#6d7889;width:28px}
.ok{color:#5fd68a}.no{color:#e05a5a}
.tag{font-style:normal;background:#2a3142;color:#8b95a7;border-radius:6px;padding:0 5px;font-size:10px;margin-right:3px}
.f{color:#8d99ab;font-size:11.5px;word-break:break-word}
.f .k{color:#5f6a7d}
</style></head><body>
<h1>${esc(title)} · ${entries.length} 张</h1>
<div class="stat">${checks.map((c) => {
    const b = counters.get(c.key)
    return `${esc(c.label)} 合格 ${b.ok} / 不合格 ${b.bad}`
  }).join(' ｜ ')}</div>
<div class="nav"><button data-f="all" class="on">全部 ${entries.length}</button>${nav}</div>
<div class="grid">${cards}</div>
<script>
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  const f=b.dataset.f;
  document.querySelectorAll('.c').forEach(c=>{
    const flags=c.dataset.flag.split(',');
    c.style.display = f==='all' || flags.some(x=>x===f || x.startsWith(f+':')) ? '' : 'none';
  });
});
</script></body></html>`

  writeFileSync(outFile, html)
  return { count: entries.length, out: outFile }
}

export default { name: 'static-html', export: exportStaticHtml }
