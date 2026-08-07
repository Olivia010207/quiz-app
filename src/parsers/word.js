// Word 题库解析器
// 支持：单选、多选、判断、填空（下划线方案B）
// 依赖 mammoth 浏览器版本，图片转 base64 内联，下划线保留为 <u>
import * as mammoth from 'mammoth/mammoth.browser'

export async function parseWord(file) {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(image =>
        image.read('base64').then(buffer => ({
          src: `data:${image.contentType};base64,${buffer}`
        }))
      ),
      styleMap: ['u => u']
    }
  )
  return parseWordHtml(result.value, file.name)
}

function parseWordHtml(html, sourceName) {
  const doc = new DOMParser().parseFromString(
    `<div id="root">${html}</div>`,
    'text/html'
  )
  const root = doc.getElementById('root')
  const nodes = [...root.children]

  const questions = []
  let currentType = null
  let current = null

  const pushCurrent = () => {
    if (current) {
      const finalized = finalize(current)
      if (finalized) questions.push(finalized)
      current = null
    }
  }

  for (const node of nodes) {
    const text = node.textContent.trim()
    if (!text) continue

    // 题型块标题：一、单项选择题（...）
    const sectionMatch = text.match(
      /^[一二三四五六七八九十]+、\s*(单项选择题|单选题|多项选择题|多选题|判断题|填空题)/
    )
    if (sectionMatch) {
      pushCurrent()
      currentType = normalizeType(sectionMatch[1])
      continue
    }

    // 新题：以 数字. 或 数字、 开头
    const qMatch = text.match(/^\s*(\d+)[.．、]\s*/)
    if (qMatch) {
      pushCurrent()
      current = makeQuestion(currentType, node, qMatch[0].length)
      continue
    }

    // 解析行
    const analysisMatch = text.match(/^[【\[]?解析[】\][]]?[：:]\s*(.+)/)
    if (analysisMatch && current) {
      current.analysis = analysisMatch[1]
      continue
    }

    // 选项行（A. xxx B. xxx 或单独一行）
    if (current && (current.type === 'single' || current.type === 'multi')) {
      let opts = parseOptions(text)
      if (opts.length === 0) opts = parseOptions(text, true) // 宽松回退：A xxx 格式
      if (opts.length > 0) {
        current.options.push(...opts)
        continue
      }
    }

    // 其他情况：附加到当前题干（题干跨行）
    if (current && !current.stemDone) {
      current.stemHtml += node.innerHTML
      current.stemText += text
    }
  }
  pushCurrent()

  return questions
}

function makeQuestion(type, node, numPrefixLen) {
  const stemHtml = node.innerHTML
  const stemText = node.textContent.trim().slice(numPrefixLen)
  const q = {
    type: type || 'single',
    stemHtml,
    stemText,
    options: [],
    answer: null,
    analysis: null,
    stemDone: false
  }

  // 填空题：提取 <u> 答案
  if (type === 'blank') {
    const uEls = node.querySelectorAll('u')
    if (uEls.length > 0) {
      q.blanks = [...uEls].map(u => u.textContent.trim())
      q.stemHtml = q.stemHtml.replace(/<u>[\s\S]*?<\/u>/g, '____')
      q.stemText = q.stemText.replace(/\s+/g, ' ').trim()
    }
  }

  // 答案提取移到 finalize（题干完整后再提取，避免跨段落答案遗漏）
  return q
}

function extractAnswer(q) {
  // 匹配题干末尾括号里的答案：A / AC / √ / × / 对 / 错
  const m = q.stemText.match(/[（(]\s*([A-Ea-e]+|[√×Xx对错])\s*[）)]/)
  if (m) {
    q.answer = normalizeAnswer(m[1], q.type)
    // 从题干移除答案括号
    const bracketRe = /[（(]\s*(?:[A-Ea-e]+|[√×Xx对错])\s*[）)]/
    q.stemText = q.stemText.replace(bracketRe, '（  ）').trim()
    q.stemHtml = q.stemHtml.replace(bracketRe, '（  ）')
  }
}

// 切分选项：支持 "A.xx B.xx" 同行 和 "A.xx" 单行
// loose=true 时也匹配 "A xxx"（空格分隔，用于格式不统一的题库）
// 注意：Word 中的空格可能是全角空格(\u3000)或不间断空格(\u00a0)，需额外处理
function parseOptions(text, loose = false) {
  // 统一空格：全角空格、NBSP → 普通空格，便于正则匹配
  const normalized = text.replace(/[\u3000\u00a0]/g, ' ')
  const pattern = loose
    ? /([A-E])[.．、\s]\s*/g   // 宽松：字母+点或空格
    : /([A-E])[.．、]\s*/g      // 严格：字母+点
  const markers = []
  let m
  while ((m = pattern.exec(normalized)) !== null) {
    markers.push({ key: m[1], start: m.index, end: pattern.lastIndex })
  }
  if (markers.length === 0) return []

  const options = []
  for (let i = 0; i < markers.length; i++) {
    const labelStart = markers[i].end
    const labelEnd = i + 1 < markers.length ? markers[i + 1].start : normalized.length
    const label = normalized.slice(labelStart, labelEnd).trim()
    if (label) options.push({ key: markers[i].key, label })
  }
  return options
}

function normalizeType(name) {
  if (/单选/.test(name)) return 'single'
  if (/多选/.test(name)) return 'multi'
  if (/判断/.test(name)) return 'judge'
  if (/填空/.test(name)) return 'blank'
  return 'single'
}

function normalizeAnswer(raw, type) {
  if (type === 'judge') {
    if (/[√对]/.test(raw)) return '正确'
    if (/[×Xx错]/.test(raw)) return '错误'
  }
  return raw.toUpperCase()
}

function finalize(q) {
  if (!q) return null
  delete q.stemDone

  // 统一空格：全角空格(\u3000)、NBSP(\u00a0) → 普通空格，确保正则匹配
  q.stemText = q.stemText.replace(/[\u3000\u00a0]/g, ' ')
  q.stemHtml = q.stemHtml.replace(/[\u3000\u00a0]/g, ' ')

  // 填空题：不需要选项，直接返回
  if (q.type === 'blank') {
    q.options = null
    if (!q.blanks) q.blanks = []
    q.stem = q.stemHtml || q.stemText
    delete q.stemHtml
    delete q.stemText
    return q
  }

  // 单选/多选/判断：此时题干已完整（含跨段落），提取答案
  if (q.type === 'single' || q.type === 'multi' || q.type === 'judge') {
    extractAnswer(q)
    // 清理答案括号后残留的多余右括号（如 "（ B）)" → "（  ）)" → "（  ）"）
    q.stemText = q.stemText.replace(/（\s*）[）)]+/g, '（  ）')
    q.stemHtml = q.stemHtml.replace(/（\s*）[）)]+/g, '（  ）')
  }

  // 单选/多选：选项为空时，尝试从题干分离内嵌选项
  if ((q.type === 'single' || q.type === 'multi') && q.options.length === 0) {
    let opts = parseOptions(q.stemText)
    if (opts.length < 2) opts = parseOptions(q.stemText, true) // 宽松回退
    if (opts.length >= 2) {
      q.options = opts
      // 从题干文本移除选项部分（截取到第一个选项标记之前）
      const firstOptIdx = q.stemText.search(/\s[A-E][.．、\s]/)
      if (firstOptIdx > 0) {
        q.stemText = q.stemText.substring(0, firstOptIdx).trim()
      }
      // 从 HTML 移除选项部分
      const htmlMatch = q.stemHtml.match(/\s[A-E][.．、\s]/)
      if (htmlMatch) {
        q.stemHtml = q.stemHtml.substring(0, htmlMatch.index)
      }
    }
  }

  // 判断题不需要选项
  if (q.type === 'judge') {
    q.options = null
  }

  // 最终题干（HTML 优先，支持图片）
  q.stem = q.stemHtml || q.stemText
  delete q.stemHtml
  delete q.stemText
  return q
}
