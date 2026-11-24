// 出口注册表。新增一种出口 = 这里加一行。

import stickerKit from './sticker-kit.mjs'
import catalogJson from './catalog-json.mjs'
import kohyaCaption from './kohya-caption.mjs'
import staticHtml from './static-html.mjs'

export const TARGETS = {
  'sticker-kit': stickerKit,
  'catalog-json': catalogJson,
  'kohya-caption': kohyaCaption,
  'static-html': staticHtml,
}

export function getTarget(name) {
  const t = TARGETS[name]
  if (!t) {
    throw new Error(`不认识的出口 "${name}"。可选：${Object.keys(TARGETS).join(' / ')}`)
  }
  return t
}

export function targetNames() {
  return Object.keys(TARGETS)
}
