// 收件箱：手机浏览器批量上传 → 落到本机目录，等后续处理。
//
// 默认只绑 127.0.0.1。要给手机用，得显式 --bind 0.0.0.0，并强烈建议配 --token。
// 原版是 0.0.0.0 硬编码 + 无鉴权 + /stats 回绝对路径，这里都收掉了。

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync, renameSync, unlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, basename, extname } from 'node:path'
import { networkInterfaces } from 'node:os'

const OK_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif', '.avif'])
const HEIC = new Set(['.heic', '.heif'])

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function lanIPs() {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address)
}

function buildPage(title, maxMb) {
  return `<!doctype html><html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:18px 14px 40px;font:16px/1.6 system-ui,-apple-system,"Noto Sans CJK SC",sans-serif;background:#0f1420;color:#e8eefc}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#8fa0c0;font-size:13px;margin-bottom:16px}
#drop{border:2px dashed #3a4a6b;border-radius:16px;padding:28px 14px;text-align:center;background:#151c2b}
#drop.hit{border-color:#54b0ff;background:#1a2438}
#pick,#pickFiles{display:none}
.pickBtn{display:block;margin:8px auto 0;max-width:320px;padding:14px 20px;border-radius:14px;background:#2b6cf6;color:#fff;font-weight:700;font-size:16.5px;cursor:pointer}
.pickBtn.alt{background:#334;border:1px solid #46557a;font-weight:600;font-size:15px}
.pickBtn:active{transform:scale(.98)}
.tip{color:#8fa0c0;font-size:12.5px;margin-top:10px}
#bar{margin-top:16px;height:12px;border-radius:8px;background:#1d2637;overflow:hidden;display:none}
#bar.on{display:block}
#fill{height:100%;width:0;background:linear-gradient(90deg,#2b6cf6,#54b0ff);transition:width .2s}
#stat{margin-top:10px;font-size:14px;color:#b9c8e4;white-space:pre-wrap}
#list{margin-top:12px;padding:0;list-style:none;font-size:13px;color:#8fa0c0;max-height:34vh;overflow:auto}
#list li{padding:3px 0;border-bottom:1px solid #1b2333;word-break:break-all}
#list li.err{color:#ff9b9b}
.done{margin-top:14px;padding:12px 14px;border-radius:12px;background:#173a26;color:#9ff0bd;display:none}
</style></head><body>
<h1>${esc(title)}</h1>
<div class="sub">选好图片，一口气丢进来<br>手机请连同一个 WiFi</div>
<div id="drop">
  <div style="font-size:34px">📥</div>
  <label class="pickBtn" for="pick">① 多选图片</label>
  <label class="pickBtn alt" for="pickFiles">② 多选文件（相册不让多选就用这个）</label>
  <input id="pick" type="file" accept="image/*" multiple>
  <input id="pickFiles" type="file" multiple>
  <div class="tip">
    <b>相册里怎么多选：</b><br>
    <b>长按</b>第一张 → 进入多选模式 → 再点其他的 → 右上角「完成/添加」<br>
    或先点右上角「选择」，再框选一片<br><br>
    支持 jpg/png/gif/webp/bmp/heic · 单张 ≤ ${maxMb}MB
  </div>
</div>
<div id="bar"><div id="fill"></div></div>
<div id="stat"></div>
<ul id="list"></ul>
<div class="done" id="done">全部传完啦</div>
<script>
const pick=document.getElementById('pick'),pickFiles=document.getElementById('pickFiles'),
      drop=document.getElementById('drop'),bar=document.getElementById('bar'),
      fill=document.getElementById('fill'),stat=document.getElementById('stat'),
      list=document.getElementById('list'),doneBox=document.getElementById('done');
let busy=false;
['dragenter','dragover'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('hit')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('hit')}));
drop.addEventListener('drop',ev=>ev.dataTransfer&&send(ev.dataTransfer.files));
pick.addEventListener('change',()=>send(pick.files));
pickFiles.addEventListener('change',()=>send(pickFiles.files));
async function send(files){
  if(!files||!files.length||busy)return;
  busy=true;doneBox.style.display='none';fill.style.width='0%';
  bar.classList.add('on');list.innerHTML='';
  const arr=[...files];let ok=0,fail=0,bytes=0;
  stat.textContent='准备上传 '+arr.length+' 张…';
  for(let i=0;i<arr.length;i++){
    const f=arr[i];
    stat.textContent='上传中 '+(i+1)+'/'+arr.length+'  成功 '+ok+' 失败 '+fail;
    fill.style.width=Math.round((i/arr.length)*100)+'%';
    try{
      const r=await fetch('upload?name='+encodeURIComponent(f.name),{method:'POST',body:f});
      const j=await r.json();
      if(r.ok&&j.ok){ok++;bytes+=f.size;add(j.dupe?'↺ 重复已跳过 '+f.name:'✓ '+f.name,false)}
      else{fail++;add('✗ '+f.name+' — '+(j.error||r.status),true)}
    }catch(e){fail++;add('✗ '+f.name+' — 网络断了?',true)}
  }
  fill.style.width='100%';
  stat.textContent='完成：成功 '+ok+' 张，失败 '+fail+' 张，共 '+(bytes/1048576).toFixed(1)+' MB';
  doneBox.style.display='block';pick.value='';busy=false;
}
function add(t,err){const li=document.createElement('li');li.textContent=t;if(err)li.className='err';list.appendChild(li);list.scrollTop=list.scrollHeight}
</script></body></html>`
}

export function startInboxServer(opts = {}) {
  const {
    dir,
    port = 3010,
    bind = '127.0.0.1',
    token = '',
    title = '收件箱',
    maxMb = 12,
  } = opts
  if (!dir) throw new Error('inbox 需要 --dir <收件目录>')

  const RAW_DIR = join(dir, 'raw')
  mkdirSync(RAW_DIR, { recursive: true })

  const MAX_BYTES = maxMb * 1024 * 1024
  const page = buildPage(title, maxMb)

  const sha1 = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 8)
  const hashIndex = new Map()
  const reindex = () => {
    hashIndex.clear()
    for (const f of readdirSync(RAW_DIR)) {
      const m = /__([0-9a-f]{8})(?:_[0-9]+)?\.[a-z0-9]+$/i.exec(f)
      if (m) hashIndex.set(m[1], f)
    }
  }
  reindex()

  function convertHeic(buf, ext) {
    const src = join(RAW_DIR, '.' + Date.now() + '-heic-src' + ext)
    const dst = src + '.jpg'
    try {
      writeFileSync(src, buf)
      execFileSync('magick', [src, '-quality', '92', dst], { timeout: 60000 })
      const out = readFileSync(dst)
      if (!out.length) throw new Error('转换结果为空')
      return out
    } catch (e) {
      console.warn('HEIC 转换失败: ' + (e && e.message))
      return null
    } finally {
      for (const f of [src, dst]) try { unlinkSync(f) } catch {}
    }
  }

  function uniqueName(orig, hash) {
    const ext = OK_EXT.has(extname(orig).toLowerCase()) ? extname(orig).toLowerCase() : '.jpg'
    let stem = basename(orig, extname(orig)).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^[._]+/, '')
    if (!stem) stem = 'img'
    stem = stem.slice(0, 60)
    let name = `${stem}__${hash}${ext}`
    let n = 1
    while (existsSync(join(RAW_DIR, name))) name = `${stem}__${hash}_${n++}${ext}`
    return name
  }

  const send = (res, code, body, type = 'text/plain; charset=utf-8', extra = {}) => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra })
    res.end(body)
  }
  const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8')

  const cookieOf = (req, name) => {
    const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '')
    return m ? decodeURIComponent(m[1]) : ''
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')

    if (token) {
      const ok = url.searchParams.get('token') === token || cookieOf(req, 'lk') === token
      if (!ok) return send(res, 401, '需要口令：在网址后加 ?token=xxx')
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const extra = {}
      if (token && url.searchParams.get('token') === token) {
        extra['set-cookie'] = `lk=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
      }
      return send(res, 200, page, 'text/html; charset=utf-8', extra)
    }

    // 只回数量，不回路径
    if (req.method === 'GET' && url.pathname === '/stats') {
      const files = readdirSync(RAW_DIR).filter((f) => !f.startsWith('.'))
      let bytes = 0
      for (const f of files) {
        try { const st = statSync(join(RAW_DIR, f)); if (st.isFile()) bytes += st.size } catch {}
      }
      return json(res, 200, { count: files.length, mb: +(bytes / 1048576).toFixed(2) })
    }

    if (req.method === 'POST' && url.pathname === '/upload') {
      const name = (url.searchParams.get('name') || 'img').slice(0, 120)
      const chunks = []
      let size = 0
      let tooBig = false
      req.on('data', (c) => {
        size += c.length
        if (size > MAX_BYTES) { tooBig = true; return }
        chunks.push(c)
      })
      req.on('end', () => {
        if (tooBig) return json(res, 413, { ok: false, error: `超过 ${maxMb}MB` })
        let buf = Buffer.concat(chunks)
        if (!buf.length) return json(res, 400, { ok: false, error: '空文件' })

        const origBytes = buf
        let ext = extname(name).toLowerCase()
        if (!OK_EXT.has(ext)) return json(res, 415, { ok: false, error: '不支持的格式 ' + (ext || '(无后缀)') })
        if (HEIC.has(ext)) {
          const out = convertHeic(buf, ext)
          if (!out) return json(res, 415, { ok: false, error: 'HEIC 转换失败，可先转成 jpg 再传' })
          buf = out
          ext = '.jpg'
        }

        const hash = sha1(origBytes)
        const seen = hashIndex.get(hash)
        if (seen) return json(res, 200, { ok: true, dupe: true, file: seen })

        const targetName = name.replace(/\.[^.]*$/, '') + ext
        const target = uniqueName(targetName, hash)
        const tmp = join(RAW_DIR, '.' + target + '.part')
        try {
          writeFileSync(tmp, buf)
          renameSync(tmp, join(RAW_DIR, target))
          hashIndex.set(hash, target)
        } catch (e) {
          return json(res, 500, { ok: false, error: String(e && e.message || e) })
        }
        process.stdout.write(`+ ${target} (${(buf.length / 1024).toFixed(0)}KB)\n`)
        return json(res, 200, { ok: true, file: target, size: buf.length })
      })
      return
    }

    send(res, 404, 'not found')
  })

  return new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(port, bind, () => {
      const addr = server.address()
      console.log(`收件箱: http://${bind}:${addr.port}`)
      console.log(`  落盘目录: ${RAW_DIR}`)
      if (bind === '0.0.0.0') {
        for (const ip of lanIPs()) console.log(`  手机打开: http://${ip}:${addr.port}${token ? '/?token=***' : ''}`)
        if (!token) console.warn('  ⚠ 对外监听但没设 token：同网段任何人都能上传')
      }
      res({ server, port: addr.port, dir: RAW_DIR })
    })
  })
}
