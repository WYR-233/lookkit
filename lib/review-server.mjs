// 人工审核面板：卡片墙 + 三态判定 + 评语，点一下就落盘。
//
// 「profile 驱动」的意思是：面板不知道自己在审什么。
// 显示哪些字段、勾哪几个 ✓/✗、什么情况算「另有原因」，全部来自 profile.review。
//
// 安全默认值：只绑 127.0.0.1。要在局域网给手机看，显式 --bind 0.0.0.0，并建议配 --token。

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, createReadStream, copyFileSync, renameSync, mkdirSync } from 'node:fs'
import { join, resolve, sep, extname, dirname } from 'node:path'
import { checkState, splitId } from './schema.mjs'

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heif',
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function loadState(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return {} }
}

/** 先写临时文件再改名，防断电/并发写坏。 */
export function saveState(path, obj) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(obj, null, 1))
  renameSync(tmp, path)
}

function backupOnce(path) {
  const bak = path + '.bak'
  if (existsSync(path) && !existsSync(bak)) {
    copyFileSync(path, bak)
    return bak
  }
  return null
}

function readEntries(dataPath) {
  const text = readFileSync(dataPath, 'utf8')
  if (dataPath.endsWith('.jsonl')) {
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
  }
  const raw = JSON.parse(text)
  const list = Array.isArray(raw) ? raw : (raw.items || raw.stickers || [])
  return list
}

function cookieOf(req, name) {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '')
  return m ? decodeURIComponent(m[1]) : ''
}

export function buildPage(profile, { title } = {}) {
  const review = profile.review || {}
  const meta = {
    title: title || review.title || profile.name || profile.id,
    display: review.display || profile.fieldKeys,
    fields: profile.fields.map((f) => ({ key: f.key, type: f.type, ...(f.values ? { values: f.values } : {}) })),
    checks: (review.checks || []).map((c) => ({ key: c.key, label: c.label, note: c.note || null })),
  }

  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)} · 审核</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:12px 12px 80px;font:14px/1.55 system-ui,"Noto Sans CJK SC",sans-serif;background:#0f1420;color:#e8eefc}
h1{font-size:18px;margin:0 0 3px}
.meta{color:#8fa0c0;font-size:12.5px;margin-bottom:10px}
.bar{position:sticky;top:0;background:#0f1420cc;backdrop-filter:blur(6px);padding:9px 0;border-bottom:1px solid #1e2637;z-index:5;display:flex;gap:7px;flex-wrap:wrap;align-items:center}
input,select{padding:7px 10px;border-radius:9px;border:1px solid #2b3550;background:#141b29;color:#e8eefc;font:13px/1.4 inherit}
input#q{flex:1;min-width:140px}
button{padding:6px 11px;border-radius:9px;border:1px solid #33456b;background:#1c2942;color:#dce8ff;cursor:pointer;font-size:12.5px}
button.pass{background:#1d6b42;border-color:#2c8f5b;color:#eafff2}
button.fail{background:#7a2626;border-color:#a33;color:#ffeaea}
button.on{outline:2px solid #4f8cff}
.stat{color:#8fa0c0;font-size:12.5px;margin-left:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;margin-top:12px}
.card{background:#141b29;border:1px solid #202a3d;border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:7px;border-left:3px solid #2a3448}
.card.pass{border-left-color:#2f9e5a;border-color:#245038}
.card.fail{border-left-color:#c0392b;border-color:#4a2323}
.card.undo{border-left-color:#c9a227}
.head{display:flex;gap:9px}
.head img{width:110px;height:150px;object-fit:contain;border-radius:9px;background:#0b1018;flex:0 0 auto;cursor:zoom-in}
#lb{position:fixed;inset:0;background:rgba(6,10,16,.95);display:none;align-items:center;justify-content:center;z-index:50;cursor:zoom-out;padding:14px}
#lb.on{display:flex}
#lb img{max-width:96vw;max-height:92vh;border-radius:10px}
.hd{font-size:13px;font-weight:600;color:#9fd0ff;word-break:break-all}
table{border-collapse:collapse;font-size:11.5px;width:100%}
td{padding:0 4px 0 0;vertical-align:top;color:#a9b4c6}
td:first-child{color:#6d7889;width:22px}
.ok{color:#5fd68a;font-weight:700}.no{color:#e05a5a;font-weight:700}
.tag{font-style:normal;background:#2a3142;color:#8b95a7;border-radius:5px;padding:0 4px;font-size:10px;margin-right:3px}
.dim{font-size:11.5px;color:#7d8798}
.dim b{color:#5f6a7d;font-weight:400}
.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:2px}
textarea{width:100%;min-height:44px;resize:vertical;padding:7px;border-radius:9px;border:1px solid #2b3550;background:#0e1420;color:#e8eefc;font:12.5px/1.5 inherit}
.saved{color:#6d7f9c;font-size:11px}
</style></head><body>
<div id="lb"><img alt="preview"></div>
<h1>${esc(meta.title)}</h1>
<div class="meta">点「合格 / 不合格」立即保存；改完评语按 Ctrl+Enter 保存。</div>
<div class="bar">
  <input id="q" placeholder="搜索 id / 字段…">
  <select id="f">
    <option value="all">全部</option><option value="todo">未审</option>
    <option value="pass">已合格</option><option value="fail">已不合格</option><option value="undo">待定</option>
  </select>
  <button id="onlyBad">只看有问题</button>
  <span class="stat" id="stat"></span>
</div>
<div class="grid" id="grid"></div>
<script>
const META=${JSON.stringify(meta).replace(/</g, '\\u003c')};
let ITEMS=[],STATE={};
const grid=document.getElementById('grid'),stat=document.getElementById('stat');
const lb=document.getElementById('lb'),lbImg=lb.querySelector('img');
lb.onclick=()=>lb.classList.remove('on');
document.addEventListener('keydown',e=>{if(e.key==='Escape')lb.classList.remove('on')});
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function imgUrl(it){return 'img/'+encodeURIComponent(it.id)}

function render(){
  const kw=(document.getElementById('q').value||'').trim().toLowerCase();
  const f=document.getElementById('f').value;
  const onlyBad=document.getElementById('onlyBad').dataset.on==='1';
  let shown=0,pass=0,fail=0,undo=0;
  grid.innerHTML='';
  ITEMS.forEach(r=>{
    const st=STATE[r.id]||{};
    if(st.verdict==='pass')pass++; else if(st.verdict==='fail')fail++; else if(st.verdict==='undo')undo++;
    if(f==='todo'&&st.verdict)return;
    if(f==='pass'&&st.verdict!=='pass')return;
    if(f==='fail'&&st.verdict!=='fail')return;
    if(f==='undo'&&st.verdict!=='undo')return;
    if(onlyBad&&!(r._checks||[]).some(c=>!c.ok))return;
    if(kw){
      const hay=(r.id+' '+META.display.map(k=>{
        const v=r[k]; return Array.isArray(v)?v.join(' '):String(v??'')
      }).join(' ')).toLowerCase();
      if(!hay.includes(kw))return;
    }
    shown++;
    const cls=st.verdict==='pass'?'pass':st.verdict==='fail'?'fail':st.verdict==='undo'?'undo':'';
    const checks=(r._checks||[]).map(c=>
      '<tr><td>'+esc(c.label)+'</td><td>'+(c.ok?'<b class="ok">✓</b>':'<b class="no">✗</b>')+
      (c.tag?'<em class="tag">'+esc(c.tag)+'</em>':'')+esc(c.note||'')+'</td></tr>').join('');
    const fields=META.display.map(k=>{
      const v=r[k]; if(v==null||v===''||(Array.isArray(v)&&!v.length))return '';
      return '<div class="dim"><b>'+esc(k)+':</b> '+esc(Array.isArray(v)?v.join(' · '):v)+'</div>';
    }).join('');
    const card=document.createElement('div');
    card.className='card '+cls;
    card.innerHTML='<div class="head"><img data-id="'+esc(r.id)+'" src="'+imgUrl(r)+'" alt="'+esc(r.id)+'" loading="lazy">'+
      '<div style="min-width:0"><div class="hd">'+esc(r.id)+'</div>'+(checks?'<table>'+checks+'</table>':'')+'</div></div>'+
      fields+
      '<div class="row">'+
      '<button class="pass '+(st.verdict==='pass'?'on':'')+'" data-v="pass" data-id="'+esc(r.id)+'">✅ 合格</button>'+
      '<button class="fail '+(st.verdict==='fail'?'on':'')+'" data-v="fail" data-id="'+esc(r.id)+'">❌ 不合格</button>'+
      '<button class="'+(st.verdict==='undo'?'on':'')+'" data-v="undo" data-id="'+esc(r.id)+'">⏭ 待定</button>'+
      '<span class="saved" id="sv-'+esc(r.id)+'">'+(st.updated?'已存 '+esc(st.updated):'')+'</span></div>'+
      '<textarea data-id="'+esc(r.id)+'" placeholder="评语（可选）">'+esc(st.note||'')+'</textarea>';
    grid.appendChild(card);
  });
  stat.textContent='显示 '+shown+' / 共 '+ITEMS.length+' ｜ ✅'+pass+' ❌'+fail+' ⏭'+undo+
    ' ｜ 未审 '+(ITEMS.length-pass-fail-undo);
}

function save(id,verdict,note){
  return fetch('api/verdict',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({id,verdict,note})}).then(r=>r.json());
}

document.addEventListener('click',ev=>{
  const img=ev.target.closest('img[data-id]');
  if(img){lbImg.src=img.src;lb.classList.add('on');return}
  const btn=ev.target.closest('button[data-v]');
  if(!btn)return;
  const id=btn.dataset.id,v=btn.dataset.v;
  const ta=document.querySelector('textarea[data-id="'+CSS.escape(id)+'"]');
  save(id,v,ta?ta.value:'').then(j=>{
    if(!j.ok)return;
    STATE[id]=j.state; render();
  });
});
document.addEventListener('keydown',ev=>{
  if(ev.target.tagName!=='TEXTAREA')return;
  if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey)){
    const id=ev.target.dataset.id;
    const st=STATE[id]||{};
    save(id,st.verdict||'undo',ev.target.value);
  }
});
document.getElementById('q').oninput=render;
document.getElementById('f').onchange=render;
document.getElementById('onlyBad').onclick=function(){
  this.dataset.on=this.dataset.on==='1'?'0':'1';this.classList.toggle('on');render()};

fetch('api/data').then(r=>r.json()).then(j=>{ITEMS=j.items;STATE=j.state;render()});
</script></body></html>`
}

export function startReviewServer(opts) {
  const {
    data: dataPath,
    raw: rawDir,
    port = 18090,
    bind = '127.0.0.1',
    token = '',
    profile,
    stateFile,
    title,
  } = opts

  if (!profile) throw new Error('review 需要 profile')
  const statePath = resolve(stateFile)
  mkdirSync(dirname(statePath), { recursive: true })
  const bak = backupOnce(statePath)
  if (bak) console.log(`  已备份原判定: ${bak}`)

  const rawRoot = rawDir ? resolve(rawDir) : null
  const entries = readEntries(dataPath)
  const page = buildPage(profile, { title })

  // 服务端先把每个检查项的状态算好，前端只负责画
  const decorated = entries.map((e) => ({
    ...e,
    _checks: (profile.review?.checks || []).map((c) => {
      const st = checkState(e, c)
      return { key: c.key, label: c.label, ok: st.ok, status: st.status, tag: st.label || '', note: c.note ? e[c.note] : '' }
    }),
  }))

  const send = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra })
    res.end(body)
  }
  const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8')

  const authorized = (req, url) => {
    if (!token) return true
    const fromQuery = url.searchParams.get('token')
    if (fromQuery === token) return true
    return cookieOf(req, 'lk') === token
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')

    if (!authorized(req, url)) return send(res, 401, '需要口令：在网址后加 ?token=xxx')

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const headers = {}
      if (token && url.searchParams.get('token') === token) {
        headers['set-cookie'] = `lk=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
      }
      return send(res, 200, page, 'text/html; charset=utf-8', headers)
    }

    if (url.pathname === '/api/data') {
      return json(res, 200, {
        profile: { id: profile.id, name: profile.name, title: title || profile.review?.title },
        items: decorated,
        state: loadState(statePath),
      })
    }

    if (url.pathname === '/api/verdict' && req.method === 'POST') {
      let body = ''
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy() })
      req.on('end', () => {
        try {
          const { id, verdict, note } = JSON.parse(body)
          if (!id || !['pass', 'fail', 'undo'].includes(verdict)) {
            return json(res, 400, { ok: false, error: 'id 或 verdict 不合法' })
          }
          const st = loadState(statePath)
          st[id] = {
            verdict,
            note: String(note || '').slice(0, 2000),
            updated: new Date().toLocaleString('zh-CN', { hour12: false }),
          }
          saveState(statePath, st)
          return json(res, 200, { ok: true, state: st[id] })
        } catch (e) {
          return json(res, 400, { ok: false, error: String(e.message || e) })
        }
      })
      return
    }

    // 图片：必须落在 raw 目录内。用 resolve + 分隔符边界判断，不用字符串前缀。
    if (url.pathname.startsWith('/img/')) {
      if (!rawRoot) return send(res, 404, '这个场景没配图片目录')
      const id = decodeURIComponent(url.pathname.slice(5))
      const { group, stem } = splitId(id)
      const candidates = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].map((x) => join(rawRoot, group, stem + x))
      const abs = candidates.find((p) => existsSync(p))
      if (!abs || !insideRaw(abs)) return send(res, 404, 'not found')
      res.writeHead(200, { 'content-type': MIME[extname(abs).toLowerCase()] || 'application/octet-stream', 'cache-control': 'max-age=3600' })
      return createReadStream(abs).pipe(res)
    }

    send(res, 404, 'not found')
  })

  function insideRaw(p) {
    const abs = resolve(p)
    return abs === rawRoot || abs.startsWith(rawRoot + sep)
  }

  return new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(port, bind, () => {
      const addr = server.address()
      console.log(`审核面板: http://${bind}:${addr.port}`)
      if (token) console.log(`  需要口令: http://${bind}:${addr.port}/?token=${token}`)
      res({ server, port: addr.port, entries: entries.length })
    })
  })
}
