/**
 * Font discipline for stamps and AcroForm appearance streams.
 *
 * pdf-lib's standard fonts (Helvetica/Times/Courier) use WinAnsi encoding and **throw** on any
 * character outside it, so a Chinese watermark drawn with them fails outright. The dangerous case
 * is the other one: the appearance-stream generators call `widthOfTextAtSize`, which throws the
 * same way — a silent fallback would either fail deep in pdf-lib or (with a font that lacks the
 * glyphs) render tofu boxes. This module therefore never falls back silently: it asks pdf-lib's own
 * encoder whether the standard font can carry the text, and when it cannot it embeds a real CJK
 * font from an explicit path, the plugin config, or a probed system font — recording which one and
 * what failed along the way.
 *
 * TrueType/OpenType single-font files work; `.ttc`/`.otc` collections do not (pdf-lib calls
 * `font.createSubset`, which a fontkit collection object does not have), so collection candidates
 * are probed like any other and reported as failures rather than assumed usable.
 * @module dsh-pdf-editor/src/fonts
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

/** Where the embedded font came from, for honest reporting. */
export type FontSource = 'standard' | 'explicit' | 'configured' | 'probed'

/** A font ready to draw with, plus where it came from. */
export interface ResolvedFont {
  /** The embedded font. */
  font: PDFFont
  /** Which resolution step produced it. */
  source: FontSource
  /** Absolute path of the embedded font file; absent for a standard font. */
  path?: string
  /** Per-candidate failures (kept so the model sees why a fallback happened). */
  notes: string[]
}

/** Font resolution inputs, assembled from tool arguments and plugin config. */
export interface FontRequest {
  /** Absolute path the model passed as `font_path` (highest priority, failures are fatal). */
  explicit?: string
  /** Absolute path from `Config.cjkFontPath` (second priority). */
  configured?: string
  /** Extra probe candidates from `Config.fontCandidates`, tried before the built-in list. */
  candidates?: readonly string[]
}

/** Single-file CJK candidates probed per platform (collections are listed too: they fail loudly). */
const BUILTIN_CANDIDATES: readonly string[] = process.platform === 'win32'
  ? [
      'C:\\Windows\\Fonts\\simhei.ttf',
      'C:\\Windows\\Fonts\\Deng.ttf',
      'C:\\Windows\\Fonts\\simkai.ttf',
      'C:\\Windows\\Fonts\\simfang.ttf',
      'C:\\Windows\\Fonts\\msyh.ttc',
      'C:\\Windows\\Fonts\\simsun.ttc',
    ]
  : process.platform === 'darwin'
    ? [
        '/Library/Fonts/Arial Unicode.ttf',
        '/System/Library/Fonts/Supplemental/Songti.ttc',
        '/System/Library/Fonts/PingFang.ttc',
      ]
    : [
        '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
        '/usr/share/fonts/truetype/arphic/uming.ttc',
      ]

/**
 * Ask pdf-lib's own encoder whether a font can carry the text.
 *
 * A throw here is pdf-lib's `WinAnsi cannot encode "X" (0xNNNN)`, which is exactly the condition
 * every downstream `drawText`/`widthOfTextAtSize` call would later fail on.
 *
 * @param font - an embedded font.
 * @param text - the text to encode.
 * @returns whether the font can encode every character.
 */
export function canEncode(font: PDFFont, text: string): boolean {
  try {
    font.encodeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve a font able to draw every string in `texts`.
 *
 * With no text needing an embedded font this returns the standard Helvetica, which keeps everyday
 * Latin stamps free of font embedding. Otherwise candidates are tried in order — explicit path,
 * configured path, configured extra candidates, built-in platform probes — each *actually embedded*
 * so that a file that exists but cannot be subset (a `.ttc`) is reported as a failure, not accepted.
 *
 * @param doc - the document the font is embedded into.
 * @param texts - every string that will be drawn with the returned font.
 * @param request - explicit/config/probe candidates.
 * @returns the resolved font with its provenance.
 * @throws an Error listing every attempted candidate when no embeddable font can carry the text.
 */
export async function resolveTextFont(doc: PDFDocument, texts: readonly string[], request: FontRequest): Promise<ResolvedFont> {
  const notes: string[] = []
  const standard = await doc.embedFont(StandardFonts.Helvetica)
  if (texts.every((text) => canEncode(standard, text))) {
    return { font: standard, source: 'standard', notes }
  }
  const ordered: Array<{ path: string; source: FontSource }> = []
  if (request.explicit !== undefined && request.explicit.trim() !== '') ordered.push({ path: request.explicit.trim(), source: 'explicit' })
  if (request.configured !== undefined && request.configured.trim() !== '') ordered.push({ path: request.configured.trim(), source: 'configured' })
  for (const candidate of request.candidates ?? []) if (candidate.trim() !== '') ordered.push({ path: candidate.trim(), source: 'probed' })
  for (const candidate of BUILTIN_CANDIDATES) ordered.push({ path: candidate, source: 'probed' })

  doc.registerFontkit(fontkit)
  for (const candidate of ordered) {
    if (!existsSync(candidate.path)) {
      // An explicitly requested font that is missing is a caller error, not a probe miss.
      if (candidate.source === 'explicit') throw new Error(`指定的 font_path 不存在：${candidate.path}`)
      notes.push(`候选字体不存在：${candidate.path}`)
      continue
    }
    try {
      const bytes = new Uint8Array(await readFile(candidate.path))
      const font = await doc.embedFont(bytes, { subset: true })
      const missing = texts.filter((text) => !canEncode(font, text))
      if (missing.length > 0) {
        notes.push(`候选字体缺少字形（${candidate.path}）：${missing[0].slice(0, 20)}`)
        continue
      }
      return { font, source: candidate.source, path: candidate.path, notes }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      notes.push(`${candidate.path} 无法嵌入：${reason}`)
      if (candidate.source === 'explicit') throw new Error(`指定的 font_path 无法嵌入：${candidate.path}（${reason}）`)
    }
  }
  throw new Error([
    '要绘制的文本含非拉丁字符（如中文），必须嵌入一个 CJK 字体，但没有可用的字体：',
    ...notes.map((note) => `  - ${note}`),
    '请用 font_path 指定一个 TrueType/OpenType 单一字体文件（.ttf/.otf；.ttc/.otc 字体集合不受支持），或在本插件 Config 的 cjkFontPath 里写死一个。',
  ].join('\n'))
}
