/**
 * Page-selector grammar shared by every PDF plugin in this repository.
 *
 * `N` single page · `N-M` inclusive range · `N-` from N to the end · `-M` from page 1 to M ·
 * `rN` the Nth page from the end (`r1` is the last page) · `z` the last page · comma-separated
 * combinations of any of those. 1-based and inclusive; an out-of-range endpoint is an error rather
 * than a silent clamp, because a clamped page selector silently edits the wrong pages.
 * @module dsh-pdf-editor/src/pages
 */

/**
 * Parse a page selector into page numbers within the document's page count.
 * @param selector - the model-supplied selector, or undefined for "every page".
 * @param pageCount - document page count.
 * @returns selected page numbers in selector order, de-duplicated; empty when no selector was given.
 * @throws an Error naming the offending token when the selector is malformed or out of range.
 */
export function parsePages(selector: string | undefined, pageCount: number): number[] {
  const text = selector?.trim() ?? ''
  if (text === '') return []
  const pages: number[] = []
  const seen = new Set<number>()
  const push = (page: number, token: string): void => {
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new Error(`页码范围 ${token} 解析出第 ${page} 页，超出文档页数（共 ${pageCount} 页）`)
    }
    if (seen.has(page)) return
    seen.add(page)
    pages.push(page)
  }
  for (const part of text.split(',')) {
    const token = part.trim()
    if (token === '') continue
    if (/^z$/iu.test(token)) {
      push(pageCount, token)
      continue
    }
    const fromEnd = /^r\s*(\d+)$/iu.exec(token)
    if (fromEnd !== null) {
      push(pageCount - Number(fromEnd[1]) + 1, token)
      continue
    }
    const openStart = /^-\s*(\d+)$/u.exec(token)
    if (openStart !== null) {
      const last = Number(openStart[1])
      for (let p = 1; p <= last; p++) push(p, token)
      continue
    }
    const openEnd = /^(\d+)\s*-$/u.exec(token)
    if (openEnd !== null) {
      for (let p = Number(openEnd[1]); p <= pageCount; p++) push(p, token)
      continue
    }
    const range = /^(\d+)\s*-\s*(\d+)$/u.exec(token)
    if (range !== null) {
      const first = Number(range[1])
      const last = Number(range[2])
      if (last < first) throw new Error(`页码范围 ${token} 的结束页小于起始页`)
      for (let p = first; p <= last; p++) push(p, token)
      continue
    }
    const single = /^(\d+)$/u.exec(token)
    if (single === null) {
      throw new Error(`页码范围格式无效：${token}（可用：12 单页、12-35 区间、12- 到末页、-35 从首页、r2 倒数第 2 页、z 末页，或逗号分隔的组合如 3,7,10-）`)
    }
    push(Number(single[1]), token)
  }
  return pages
}

/**
 * Render page numbers back into a compact selector token, for derived file names (`p1-3`, `p7`, `p2-z`).
 * @param pages - page numbers already sorted ascending.
 * @param pageCount - document page count, used to spell a trailing run as `z`.
 * @returns the compact token.
 */
export function pagesToken(pages: readonly number[], pageCount: number): string {
  if (pages.length === 0) return 'none'
  const runs: Array<[number, number]> = []
  let start = pages[0]
  let previous = pages[0]
  for (const page of pages.slice(1)) {
    if (page === previous + 1) {
      previous = page
      continue
    }
    runs.push([start, previous])
    start = page
    previous = page
  }
  runs.push([start, previous])
  return runs
    .map(([first, last]) => {
      if (first === last) return first === pageCount ? 'z' : String(first)
      if (last === pageCount) return `${first}-z`
      return `${first}-${last}`
    })
    .join('_')
}
