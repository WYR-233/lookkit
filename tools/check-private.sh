#!/usr/bin/env bash
# 发布前自检：扫一遍「准备进 git 的文件」里有没有私货。
# 用法: bash tools/check-private.sh          （扫 git 索引里将要提交的文件）
#       bash tools/check-private.sh --all    （扫整个工作区，含未跟踪）
# 退出码 1 = 发现私货，别推。
#
# 注意：本脚本会扫描除自身以外的所有文件——规则表里那些正则就是"私货"的词，
# 所以必须显式排除自己，否则永远报错。
set -u
cd "$(dirname "$0")/.." || exit 1
SELF="./tools/check-private.sh"

if [ "${1:-}" = "--all" ]; then
  mapfile -d '' FILES < <(find . -type f -not -path './.git/*' -not -path './legacy/*' -not -path "$SELF" -print0)
else
  mapfile -d '' FILES < <(git ls-files -z | grep -zv '^tools/check-private\.sh$')
fi

# 每条 = 「说明<TAB>正则」。想加规则直接往下写一行。
# 凭据规则刻意写成"真凭据形态"而不是裸词，否则文档里写 --token 就会误报。
RULES=(
  $'作者署名\tkiriyuki|云大人|103739|space\\.bilibili'
  $'自有角色\t大肥鱼|GPT娘|鲸鱼娘|肥鱼|DeepSeek|deepseek'
  $'自有数据集\t铉雨|xuanyu|character-sheet'
  $'本机路径\t/home/wyr233|dsh-home|资产/'
  $'本机临时目录\t/tmp/dshsticker|/tmp/imgout|/tmp/lib-overview'
  $'内网/域名\twyr233|feiyu\\.|192\\.168\\.|18118'
  $'真凭据形态\tBearer [A-Za-z0-9]|ghp_[A-Za-z0-9]{20}|sk-[A-Za-z0-9]{20}|api[_-]?key\\s*[:=]\\s*["'"'"'][A-Za-z0-9]|password\\s*[:=]\\s*["'"'"'][^"'"'"']'
)

hit=0
for rule in "${RULES[@]}"; do
  label="${rule%%$'\t'*}"; re="${rule#*$'\t'}"
  for f in "${FILES[@]}"; do
    [ -f "$f" ] || continue
    grep -Iq . "$f" 2>/dev/null || continue     # 跳过二进制
    if grep -nEq "$re" "$f" 2>/dev/null; then
      echo "✗ [$label] ${f#./}"
      grep -nE "$re" "$f" | head -3 | sed 's/^/     /'
      hit=1
    fi
  done
done

if [ "$hit" -eq 0 ]; then
  echo "✓ 干净：$( [ "${1:-}" = "--all" ] && echo 工作区 || echo 'git 索引' )里没扫到私货"
  exit 0
else
  echo
  echo "✗ 发现私货，别推。要么加进 .gitignore，要么改成中性示例。"
  exit 1
fi
