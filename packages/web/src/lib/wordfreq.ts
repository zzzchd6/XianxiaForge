/**
 * 词频分析（开源借鉴 PRD v1.1 M4 / US-06）
 * 纯前端零 token 统计：中文 2-gram/3-gram + 英文单词 + 停用词过滤 + 口头禅检测（>3 次/千字）。
 */

/** 常见中文停用字（功能词/语气词），含这些字的 n-gram 不计入高频词 */
const STOP_CHARS = new Set(
  '的了是我你他她它们这那就不都在有着和与及或但要会被把对于从到向等也还很更最只又再已曾呢吧啊哦嗯呀么吗嘛得地给让跟同并如果因为所以虽然可没无没有这个那个什么怎么为什么自己我们你们他们她们它们之一二三四五六七八九十百千万上下左右前后里外中间旁边'.split(''),
)

export interface WordFreqItem {
  word: string
  count: number
  /** 每千字频率 */
  perKilo: number
  /** 疑似口头禅（每千字 > 3 次） */
  isCatchphrase: boolean
}

export interface WordFreqResult {
  /** 有效字符数（中文+字母数字） */
  totalChars: number
  /** 高频词 top N（去重后） */
  items: WordFreqItem[]
  /** 疑似口头禅清单 */
  catchphrases: WordFreqItem[]
}

/** 提取连续中文片段 */
function chineseSegments(text: string): string[] {
  return text.match(/[\u4e00-\u9fff]+/g) ?? []
}

/** 统计字符 n-gram（跳过含停用字的片段） */
function countNgrams(segments: string[], n: number, minCount: number): Map<string, number> {
  const map = new Map<string, number>()
  for (const seg of segments) {
    if (seg.length < n) continue
    for (let i = 0; i + n <= seg.length; i++) {
      const gram = seg.slice(i, i + n)
      let skip = false
      for (const ch of gram) {
        if (STOP_CHARS.has(ch)) {
          skip = true
          break
        }
      }
      if (skip) continue
      map.set(gram, (map.get(gram) ?? 0) + 1)
    }
  }
  // 低频剪枝
  for (const [k, v] of map) if (v < minCount) map.delete(k)
  return map
}

/** 统计英文单词（≥3 字母，小写归一） */
function countEnglishWords(text: string, minCount: number): Map<string, number> {
  const map = new Map<string, number>()
  const words = text.match(/[a-zA-Z]{3,}/g) ?? []
  for (const w of words) {
    const lw = w.toLowerCase()
    map.set(lw, (map.get(lw) ?? 0) + 1)
  }
  for (const [k, v] of map) if (v < minCount) map.delete(k)
  return map
}

/**
 * 词频分析入口。
 * @param text 正文全文
 * @param topN 高频词上限（默认50）
 */
export function analyzeWordFreq(text: string, topN = 50): WordFreqResult {
  const totalChars = (text.replace(/[\s\p{P}]/gu, '').match(/[\u4e00-\u9fff\p{L}\p{N}]/gu) ?? []).length
  const kilo = Math.max(totalChars / 1000, 0.001)

  const segments = chineseSegments(text)
  const minCount = 3
  const grams2 = countNgrams(segments, 2, minCount)
  const grams3 = countNgrams(segments, 3, minCount)
  const eng = countEnglishWords(text, minCount)

  // 冗余剪枝：若 2-gram 计数与其所在的某个 3-gram 计数相同，说明它总是作为该 3-gram 的一部分出现
  for (const [g2, c2] of grams2) {
    for (const [g3, c3] of grams3) {
      if (c2 === c3 && g3.includes(g2)) {
        grams2.delete(g2)
        break
      }
    }
  }
  // 同理剪枝重复的 2-gram 子串（不同 3-gram 场景下保留）
  const merged = new Map<string, number>()
  for (const [k, v] of grams3) merged.set(k, v)
  for (const [k, v] of grams2) {
    if (!merged.has(k)) merged.set(k, v)
  }
  for (const [k, v] of eng) {
    if (!merged.has(k)) merged.set(k, v)
  }

  const items: WordFreqItem[] = [...merged.entries()]
    .map(([word, count]) => {
      const perKilo = count / kilo
      return { word, count, perKilo, isCatchphrase: perKilo > 3 }
    })
    .sort((a, b) => b.count - a.count || b.word.length - a.word.length)
    .slice(0, topN)

  return {
    totalChars,
    items,
    catchphrases: items.filter((i) => i.isCatchphrase),
  }
}
