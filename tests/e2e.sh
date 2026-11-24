#!/usr/bin/env bash
# 端到端自测：不联网、不需要真实素材，造几张图跑完整条流水线。
# 用法: bash tests/e2e.sh
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT=$(pwd)
WORK=$(mktemp -d)
PORT=$((20000 + RANDOM % 10000))
FAIL=0
SERVERS=()

cleanup() {
  for p in "${SERVERS[@]}"; do kill "$p" 2>/dev/null; done
  rm -rf "$WORK"
}
trap cleanup EXIT

ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3（期望 $2，实际 $1）"; fi; }

# 造素材：拿仓库里没有的东西，用 python 现生成几个纯色 PNG
mkdir -p "$WORK/src/甲" "$WORK/src/乙"
python3 - "$WORK" <<'PY'
import sys
from PIL import Image, ImageDraw
w = sys.argv[1]
for grp, n, color in (("甲", 3, (60, 90, 200)), ("乙", 3, (200, 120, 60))):
    for i in range(1, n + 1):
        im = Image.new("RGB", (320, 480), (250, 250, 250))
        d = ImageDraw.Draw(im)
        d.rectangle([40, 60, 280, 420], fill=color)
        d.text((50, 30), f"{grp}-{i}", fill=(0, 0, 0))
        im.save(f"{w}/src/{grp}/{i:02d}.png")
PY

echo '① profile 校验'
./bin/look profiles >/dev/null 2>&1 && ok 'profiles 能列出' || bad 'profiles 失败'

echo '② scan'
./bin/look scan "$WORK/src" --out "$WORK/items.jsonl" >/dev/null
check "$(wc -l < "$WORK/items.jsonl")" 6 '扫到 6 件'
python3 -c "
import json,sys
rows=[json.loads(l) for l in open('$WORK/items.jsonl')]
assert all(len(r['hash'])==16 for r in rows), 'hash 长度不对'
assert {r['group'] for r in rows}=={'甲','乙'}, 'group 不对'
" && ok '条目结构正确' || bad '条目结构不对'

echo '③ sheet（tiles）'
./bin/look sheet --mode tiles --in "$WORK/src" --out "$WORK/sheets" --tile 160 --per 6 >/dev/null 2>&1
[ -f "$WORK/sheets/page-01.jpg" ] && ok '生成 page-01.jpg' || bad '没生成拼图'
[ -f "$WORK/sheets/index.tsv" ] && ok '生成 index.tsv' || bad '没生成索引'

echo '④ merge：清洗 + 规则 + 漏标'
cat > "$WORK/ai.jsonl" <<'EOF'
{"id":"甲/01","category":"服装","color":"蓝","condition":"全新","defects":[],"desc":"测试件一","en":"one"}
{"id":"甲/02","category":"衣服","color":"蓝","condition":"破损","defects":[],"desc":"测试件二","en":"two"}
{"id":"乙/03","category":"其他","color":"白","condition":"未知","defects":["划痕","划痕",""],"desc":"测试件三","en":"three"}
EOF
OUT=$(./bin/look merge --profile example-catalog --in "$WORK/ai.jsonl" --out "$WORK/merged.jsonl" --items "$WORK/items.jsonl" 2>&1)
echo "$OUT" | grep -q '衣服.*其他' && ok '枚举造词被兜底' || bad '枚举没兜底'
echo "$OUT" | grep -q '破损.*至少 1 项' && ok '规则校验命中' || bad '规则没命中'
echo "$OUT" | grep -q '漏标' && ok '漏标被报出来' || bad '漏标没报'
python3 -c "
import json
d=[json.loads(l) for l in open('$WORK/merged.jsonl')]
t=[x for x in d if x['id']=='乙/03'][0]
assert t['defects']==['划痕'], t['defects']
" && ok 'list 去重去空' || bad 'list 没洗干净'

echo '⑤ export'
./bin/look export --profile example-catalog --target catalog-json --in "$WORK/merged.jsonl" --out "$WORK/out/catalog.json" >/dev/null
python3 -c "
import json;d=json.load(open('$WORK/out/catalog.json'))
assert d['count']==3 and d['schema']=='lookkit/catalog/1'
" && ok 'catalog.json 结构正确' || bad 'catalog.json 不对'

echo '⑥ review 面板 API'
node bin/look review --profile example-catalog --data "$WORK/merged.jsonl" --raw "$WORK/src" --port "$PORT" >/dev/null 2>&1 &
SERVERS+=($!)
for _ in $(seq 1 30); do curl -sf "localhost:$PORT/api/data" >/dev/null 2>&1 && break; sleep 0.2; done
curl -sf "localhost:$PORT/api/data" | python3 -c "
import sys,json;d=json.load(sys.stdin)
assert len(d['items'])==3
assert d['items'][0]['_checks'][0]['key']=='shot_ok'
" && ok '/api/data 正常' || bad '/api/data 不对'
curl -sf -X POST "localhost:$PORT/api/verdict" -H 'content-type: application/json' \
  -d '{"id":"甲/01","verdict":"pass","note":"ok"}' | grep -q '"ok":true' && ok '判定写入' || bad '判定写入失败'
curl -s -o /dev/null -w '%{http_code}' "localhost:$PORT/img/../../etc/passwd" | grep -qE '^(403|404)$' && ok '路径穿越被挡' || bad '路径穿越没挡住'

echo '⑦ batch --stale'
echo '{"id":"甲/01","hash":"deadbeefdeadbeef"}' > "$WORK/known.jsonl"
./bin/look batch --stale --in "$WORK/items.jsonl" --known "$WORK/known.jsonl" --out "$WORK/stale.txt" >/dev/null
grep -q 'changed.*甲/01' "$WORK/stale.txt" && ok '改过的被标 changed' || bad 'changed 没识别'
check "$(grep -c 'new' "$WORK/stale.txt")" 5 '新增 5 件'

echo '⑧ import dry-run'
cat > "$WORK/list.json" <<'EOF'
{"memes":[{"file":"01.png","tag":"a","caption":"c1","keywords":"k1"}]}
EOF
./bin/look import --in "$WORK/list.json" --from "$WORK/src/甲" --to "$WORK/lib" --prefix t --dry 2>/dev/null | grep -q 't-001' && ok '入库 dry 正常' || bad '入库 dry 失败'

echo '⑨ prompt 注入（源文件不改）'
./bin/look prompt --profile example-catalog --kind annotate --workdir "$WORK" | grep -q "$WORK" && ok '路径被注入' || bad '路径没注入'
MD5A=$(md5sum profiles/example-catalog/prompt.annotate.md | cut -d' ' -f1)
./bin/look prompt --profile example-catalog --kind annotate --workdir /x >/dev/null
MD5B=$(md5sum profiles/example-catalog/prompt.annotate.md | cut -d' ' -f1)
check "$MD5B" "$MD5A" '源 prompt 未被改动'

echo '⑩ 私货自检'
bash tools/check-private.sh --all >/dev/null && ok '工作区干净' || bad '工作区有私货'

echo
if [ "$FAIL" -eq 0 ]; then echo '全部通过 ✅'; else echo "失败 $FAIL 项 ❌"; fi
exit "$FAIL"
