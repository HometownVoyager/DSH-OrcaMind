/**
 * pdf_metadata 工具测试：读取（真只读）、写入/删除、日期解析、XMP 保留与可选同步。
 * 用法：node tests/metadata.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { loadEditorTools, makeChecker } from './harness.mjs'
import { makePdf, makeXmpPdf, tempDir } from './fixtures.mjs'

const { check, done } = makeChecker('pdf-editor · pdf_metadata')
const dir = tempDir('metadata')
const env = await loadEditorTools()
const path = (name) => join(dir, name)
const reload = async (file) => PDFDocument.load(new Uint8Array(readFileSync(file)), { updateMetadata: false })

console.log('== 只读：不改文件、不改 Producer/ModDate ==')
{
  await makePdf(path('plain.pdf'), { pages: 1 })
  const before = readFileSync(path('plain.pdf'))
  const result = await env.call('pdf_metadata', { source: path('plain.pdf') })
  check('只读不产生 output', result.output === undefined && result.applied.length === 0)
  check('before 与 after 相同', JSON.stringify(result.before.info) === JSON.stringify(result.after.info))
  check('源文件字节未被改动', Buffer.compare(before, readFileSync(path('plain.pdf'))) === 0)
  check('只读时 verified=false 且无 checks（没有写就没有校验）', result.verified === false && result.checks.length === 0)
  check('渲染文案包含「XMP：无 /Metadata 包」', env.render('pdf_metadata', result)[0].text.includes('无 /Metadata 包'))
}

console.log('== 写入信息字典：字段、日期、关键词 ==')
{
  await makePdf(path('meta.pdf'), { pages: 1 })
  const result = await env.call('pdf_metadata', {
    source: path('meta.pdf'),
    set: {
      title: '论文标题',
      author: '张三',
      subject: '主题',
      keywords: ['关键词一', '关键词二'],
      creator: 'Creator App',
      producer: 'Producer App',
      creation_date: '2026-01-02T03:04:05Z',
      modification_date: '2026-02-03',
    },
    output: path('meta-out.pdf'),
  })
  check('8 个字段全部写入', result.applied.length === 8, JSON.stringify(result.applied))
  check('verified=true 且含元数据回读校验', result.verified === true && result.checks.some((entry) => entry.name === '元数据'), JSON.stringify(result.problems))
  const back = await reload(path('meta-out.pdf'))
  check('重读标题/作者/主题', back.getTitle() === '论文标题' && back.getAuthor() === '张三' && back.getSubject() === '主题')
  check('重读关键词', back.getKeywords() === '关键词一, 关键词二', String(back.getKeywords()))
  check('重读创建时间（ISO 往返）', back.getCreationDate()?.toISOString() === '2026-01-02T03:04:05.000Z', String(back.getCreationDate()))
  check('重读修改时间', back.getModificationDate()?.toISOString().startsWith('2026-02-03'), String(back.getModificationDate()))
  check('缺省输出名 <原名>-meta.pdf', (await env.call('pdf_metadata', { source: path('meta.pdf'), set: { title: 'x' } })).output.endsWith('meta-meta.pdf'))
  check('渲染文案对比写入前后', env.render('pdf_metadata', result)[0].text.includes('写入后 信息字典'))
}

console.log('== PDF 原生日期形式（带时区） ==')
{
  await makePdf(path('date.pdf'), { pages: 1 })
  const result = await env.call('pdf_metadata', {
    source: path('date.pdf'),
    set: { creation_date: "D:20260102030405+08'00'" },
    output: path('date-out.pdf'),
  })
  const back = await reload(path('date-out.pdf'))
  check("D:...+08'00' 解析为 UTC 时间", back.getCreationDate()?.toISOString() === '2026-01-01T19:04:05.000Z', String(back.getCreationDate()))
  check('校验通过', result.verified === true, JSON.stringify(result.problems))
  const bad = await env.fail('pdf_metadata', { source: path('date.pdf'), set: { creation_date: '昨天' } })
  check('无法解析的日期报错并给出两种格式', bad.includes('日期格式无效') && bad.includes("+08'00'"), bad)
  const unknown = await env.fail('pdf_metadata', { source: path('date.pdf'), set: { ttitle: 'x' } })
  check('未知字段报错并列出可写字段', unknown.includes('未知的元数据字段：ttitle') && unknown.includes('modification_date'), unknown)
}

console.log('== 删除字段 ==')
{
  await makePdf(path('del.pdf'), { pages: 1 })
  const seeded = await env.call('pdf_metadata', { source: path('del.pdf'), set: { title: 't', producer: 'p', creator: 'c' }, output: path('del-seed.pdf') })
  check('先播下三个字段', seeded.applied.length === 3)
  const result = await env.call('pdf_metadata', { source: path('del-seed.pdf'), delete: ['producer', 'creator'], output: path('del-out.pdf') })
  check('deleted 列出两个字段', result.deleted.join(',') === 'producer,creator', JSON.stringify(result.deleted))
  check('校验含逐字段删除检查', result.checks.filter((entry) => entry.name.includes('已删除')).length === 2, JSON.stringify(result.checks))
  const back = await reload(path('del-out.pdf'))
  check('重读：producer/creator 已被删除', back.getProducer() === undefined && back.getCreator() === undefined)
  check('重读：标题仍在', back.getTitle() === 't')
  check('after 快照里不再有 producer', result.after.info.producer === undefined, JSON.stringify(result.after.info))
}

console.log('== XMP：默认保留并在结果里对比，sync_xmp 定点同步 ==')
{
  await makeXmpPdf(path('xmp.pdf'))
  const result = await env.call('pdf_metadata', { source: path('xmp.pdf'), set: { title: '新标题', author: '新作者' }, output: path('xmp-out.pdf') })
  check('报告 XMP 包存在', result.before.xmp_present === true && result.xmp.present === true)
  check('保留模式下未改动 XMP 元素', result.xmp.updated.length === 0 && result.xmp.skipped.length === 0)
  check('XMP 保留校验通过（旧标题仍在包里）', result.checks.some((entry) => entry.name === 'XMP 保留' && entry.ok), JSON.stringify(result.checks))
  check('before 的 XMP 读到旧标题', result.before.xmp.title === '旧标题', JSON.stringify(result.before.xmp))
  check('after 的信息字典是新标题，XMP 仍是旧标题（差异被如实报告）', result.after.info.title === '新标题' && result.after.xmp.title === '旧标题', JSON.stringify(result.after))

  const synced = await env.call('pdf_metadata', { source: path('xmp.pdf'), set: { title: '同步标题', author: '同步作者' }, sync_xmp: true, output: path('xmp-sync.pdf') })
  check('dc:title 已同步', synced.xmp.updated.includes('dc:title'), JSON.stringify(synced.xmp))
  check('包里没有 dc:creator → 列入 skipped 而不是凭空插入', synced.xmp.skipped.includes('dc:creator'), JSON.stringify(synced.xmp))
  const back = await reload(path('xmp-sync.pdf'))
  const { readMetadata } = await import('../lib/metadata.js')
  const snapshot = readMetadata(back)
  check('重读 XMP：title 已是新值', snapshot.xmp.title === '同步标题', JSON.stringify(snapshot.xmp))
  check('重读 XMP：未在同步清单里的元素原样保留', snapshot.xmp.creator_tool === undefined && readFileSync(path('xmp-sync.pdf')).includes('fixture') === true)

  const compressed = await makeXmpPdf(path('xmp-flate.pdf'), { compressed: true })
  const flateResult = await env.call('pdf_metadata', { source: compressed.path, set: { title: '压缩包同步' }, sync_xmp: true, output: path('xmp-flate-out.pdf') })
  check('压缩的 XMP 也能解压改写', flateResult.xmp.updated.includes('dc:title'), JSON.stringify(flateResult.xmp))
  const flateBack = readMetadata(await reload(path('xmp-flate-out.pdf')))
  check('压缩包重读为新标题', flateBack.xmp.title === '压缩包同步', JSON.stringify(flateBack.xmp))
  check('压缩包仍然是压缩的（Filter 保留）', flateBack.xmpCompressed === true)
  const noXmp = await env.call('pdf_metadata', { source: path('xmp.pdf'), set: { title: 'T' }, sync_xmp: true, output: path('xmp-none.pdf') })
  check('sync_xmp 有元素可改时不留警告', noXmp.warnings.length === 0, JSON.stringify(noXmp.warnings))
  const plainSync = await env.call('pdf_metadata', { source: path('plain.pdf'), set: { title: 'T' }, sync_xmp: true, output: path('plain-sync.pdf') })
  check('无 XMP 包时 sync_xmp 如实说明「无事可做」', plainSync.warnings.some((line) => line.includes('没有 XMP 包')), JSON.stringify(plainSync.warnings))
}

console.log('== 覆盖策略 ==')
{
  await makePdf(path('cover.pdf'), { pages: 1 })
  await env.call('pdf_metadata', { source: path('cover.pdf'), set: { title: 'a' }, output: path('cover-out.pdf') })
  const exists = await env.fail('pdf_metadata', { source: path('cover.pdf'), set: { title: 'b' }, output: path('cover-out.pdf') })
  check('目标已存在且未给 in_place 时报错', exists.includes('in_place=true'), exists)
  const overwritten = await env.call('pdf_metadata', { source: path('cover.pdf'), set: { title: 'b' }, output: path('cover-out.pdf'), in_place: true })
  check('in_place=true 覆盖并备份', overwritten.backup === `${path('cover-out.pdf')}.bak` && existsSync(overwritten.backup))
  const inPlace = await env.call('pdf_metadata', { source: path('cover.pdf'), set: { title: 'c' }, in_place: true })
  check('in_place 直接改写源文件', inPlace.output === path('cover.pdf') && inPlace.backup === `${path('cover.pdf')}.bak`)
  check('源文件确实带上了新标题', (await reload(path('cover.pdf'))).getTitle() === 'c')
}

process.exit(done())
