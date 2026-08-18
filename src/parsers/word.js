// Word 题库解析器
// 支持：单选、多选、判断、填空（下划线方案B）
// 兼容：有 section 标题 的常规分行格式；以及 题目与选项连在一起不换行 的内联格式
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

  // ==== 第一步：把 nodes 中全部文本和 HTML 片段拼成段落列表 ====
  // 每段记录 { text, html }，便于后续处理
  const paragraphs = nodes.map(n => ({
    text: n.textContent.replace(/[\u3000\u00a0]/g, ' ').trim(),
    html: n.innerHTML.replace(/[\u3000\u00a0]/g, ' ')
  })).filter(p => p.text)

  // ==== 第二步：检测是否存在 题型 section 标题 ====
  // 只要任何一段 text 以 一、单项选择题 这类开头，就当作"分行格式"
  const hasSection = paragraphs.some(p =>
    /^[一二三四五六七八九十]+、\s*(单项选择题|单选题|多项选择题|多选题|判断题|填空题)/.test(p.text)
  )

  if (hasSection) {
    return parseSectionFormat(paragraphs)
  }

  // 没有 section 标题：走"内联无换行格式"的解析分支
  return parseInlineFormat(paragraphs)
}

/* ---------------- 常规分行格式（有 section 标题） ---------------- */

function parseSectionFormat(paragraphs) {
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

  for (const para of paragraphs) {
    const text = para.text
    const html = para.html

    // 题型块标题
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
      current = makeQuestion(currentType, html, qMatch[0].length)
      continue
    }

    // 解析行
    const analysisMatch = text.match(/^[【\[]?解析[】\][]]?[：:]\s*(.+)/)
    if (analysisMatch && current) {
      current.analysis = analysisMatch[1]
      continue
    }

    // 选项行
    if (current && (current.type === 'single' || current.type === 'multi')) {
      let opts = parseOptions(text)
      if (opts.length === 0) opts = parseOptions(text, true)
      if (opts.length > 0) {
        current.options.push(...opts)
        continue
      }
    }

    // 题干跨行
    if (current && !current.stemDone) {
      current.stemHtml += html
      current.stemText += text
    }
  }
  pushCurrent()

  return questions
}

/* ---------------- 内联无换行格式（无 section，题干选项连一起） ---------------- */

function parseInlineFormat(paragraphs) {
  // 1. 把所有段落文本用空格拼起来（Word 可能分成若干段）
  //    同时记录 HTML 版本，便于后续切片
  const rawText = paragraphs.map(p => p.text).join(' ')
  // const rawHtml = paragraphs.map(p => p.html).join(' ') // HTML 暂时只按文本解析

  const questions = []

  // 2. 按题号边界切出每个题的文本片段
  //    题号：数字 + .．、
  //    切分：在"下一题号"或字符串末尾之前 都是当前题的内容
  const qSplits = []
  const qRe = /(\d+)[.．、]\s*/g
  let m
  while ((m = qRe.exec(rawText)) !== null) {
    qSplits.push({ index: m.index, endIndex: m.index + m[0].length })
  }
  if (qSplits.length === 0) return questions

  const qRanges = qSplits.map((s, i) => ({
    start: s.endIndex,
    end: i + 1 < qSplits.length ? qSplits[i + 1].index : rawText.length
  }))

  for (const range of qRanges) {
    const chunk = rawText.substring(range.start, range.end).trim()
    if (!chunk) continue

    const q = parseInlineChunk(chunk)
    if (q) questions.push(q)
  }

  return questions
}

// 解析单个题的文本（已经去掉题号前缀）
// 示例：
//   单选：题干（A）...A工具袋; B工具箱;C绳索;D梯子。
//   多选：题干（A）、（B）、（C）...  A立体化;B透明化;  C源头化。
//   判断：题干（A）   A正确;  B错误。
function parseInlineChunk(chunk) {
  // 先抓括号答案（可能多个，多选多个括号）
  const answerSet = new Set()
  const bracketRe = /[（(]\s*([A-Ea-e]|[√×Xx对错])\s*[）)]/g
  let am
  while ((am = bracketRe.exec(chunk)) !== null) answerSet.add(am[1])
  const bracketAns = [...answerSet]

  // 移除括号答案，保留括号数量和后面跟随的分隔符
  // 如 （A），→（  ），    （A）、（B）、（C）。→（  ）、（  ）、（  ）。
  let clean = chunk
    .replace(/[（(]\s*(?:[A-Ea-e]|[√×Xx对错])\s*[）)]/g, '（  ）')
    .trim()

  // 判分题型：
  // - 如果 bracketAns 里包含 √/×/对/错 → 判断
  // - 如果 有多个字母答案 → 多选
  // - 有单个字母答案 → 单选/判断（看选项里是不是 正确/错误）
  let type
  if (bracketAns.some(a => /[√×Xx对错]/.test(a))) {
    type = 'judge'
  } else if (bracketAns.length > 1) {
    type = 'multi'
  } else if (bracketAns.length === 1) {
    // 先试着找选项，如果选项 label 第一第二是"正确/错误"或"是/否"，就判判断
    type = 'single'
  } else {
    type = 'single'
  }

  // 现在要从 clean 里分离：[题干] + [选项 A ... B ...]
  // 最可靠：从后向前切——找最后一个 "A..." 起点
  const optStart = findOptionsStart(clean)
  let stemText = clean
  let options = []

  if (optStart > 0) {
    stemText = clean.substring(0, optStart).trim()
    const optsRaw = clean.substring(optStart).trim()
    options = parseInlineOptions(optsRaw)
  }

  // 清理题干末尾残留标点/多余空格/句号
  stemText = stemText.replace(/[。；;\s]+$/g, '').trim()

  // 如果判断答案是 A/B 形式且选项里出现 正确/错误 → 归一化到 judge
  if (type === 'single' && options.length === 2) {
    const labels = options.map(o => o.label.replace(/[。.]/g, '').trim())
    if ((labels[0] === '正确' || labels[0] === '对') &&
        (labels[1] === '错误' || labels[1] === '错')) {
      type = 'judge'
    }
  }

  // 归一化答案
  let answer
  if (bracketAns.length === 0) {
    answer = null
  } else if (type === 'judge') {
    answer = bracketAns.some(a => /[√对A]/.test(a)) ? '正确' : '错误'
  } else {
    answer = bracketAns.join('').toUpperCase()
  }

  const q = {
    type,
    stemHtml: stemText,
    stemText,
    options: type === 'judge' ? null : options,
    answer,
    analysis: null,
    stemDone: true
  }
  return finalize(q, true /* inline */)
}

// 在一串题干+选项连在一起的文本里，找到选项开始的位置
// 策略：找最后一次 A + (点/分号/空格/...) 出现在合理字母区间里的起始
function findOptionsStart(text) {
  // 严格模式：A. / B. / C. 等
  const strict = [...text.matchAll(/[A-E][.．、]\s*/g)]
  if (strict.length >= 2) return strict[0].index

  // 宽松模式：A后直接中文（例如 "A工具袋"）
  // 这种情况下，A后面紧跟的是非空白非字母字符
  const loose = [...text.matchAll(/(?<!\w)[A-E](?=[\u4e00-\u9fa5（(《"“'`·])/g)]
  if (loose.length >= 2) return loose[0].index

  // 混合：Axxx; Bxxx; Cxxx   —— 找选项分号 ";" 至少 2 个再加上 Axxx Bxxx 的组合
  const semicolon = [...text.matchAll(/(?<!\w)[A-E][\s]*(?=[\u4e00-\u9fa5A-Z（(])/g)]
  if (semicolon.length >= 2) return semicolon[0].index

  return -1
}

// 从内联选项字符串里解析 [{key,label}, ...]
// 输入示例："A工具袋;    B工具箱;C绳索;D梯子。"  / "A立体化;B透明化;   C源头化。"
// 选项 label 可能含中文标点，以 ; 或下一个字母 切分
function parseInlineOptions(raw) {
  // 先把结尾句号/空格去掉
  let s = raw.trim().replace(/[。.\s]+$/g, '')

  // 切出每个选项标记：A/B/C/D/E，前面是开头或非字母字符
  const markers = []
  const re = /(?<![A-Za-z])([A-E])(?=[\u4e00-\u9fa5（(《"“'`·])/g
  // 以及 A.  B. 这种带点的
  const re2 = /(?<![A-Za-z])([A-E])[.．、]\s*/g
  // 合并，按位置排
  let m
  while ((m = re.exec(s)) !== null) markers.push({ key: m[1], end: m.index + m[0].length, start: m.index })
  while ((m = re2.exec(s)) !== null) markers.push({ key: m[1], end: m.index + m[0].length, start: m.index })
  markers.sort((a, b) => a.start - b.start)

  // 去重（同一位置可能被 re 和 re2 都匹配了）
  const uniq = []
  for (const mk of markers) {
    if (uniq.length === 0 || mk.start !== uniq[uniq.length - 1].start) uniq.push(mk)
  }
  if (uniq.length < 2) return []

  const out = []
  for (let i = 0; i < uniq.length; i++) {
    const labelStart = uniq[i].end
    const labelEnd = i + 1 < uniq.length ? uniq[i + 1].start : s.length
    let label = s.substring(labelStart, labelEnd)
    // 去掉分隔符（分号/逗号/全角分号/全角逗号/空格）
    label = label.replace(/^[\s;,，；、.．]+/, '').replace(/[\s;,，；、.．]+$/g, '').trim()
    if (label) out.push({ key: uniq[i].key, label })
  }
  return out
}

/* ---------------- 公共工具函数 ---------------- */

function makeQuestion(type, nodeHtml, numPrefixLen) {
  const stemHtml = nodeHtml
  const stemText = stemHtml.replace(/<[^>]+>/g, '').trim().slice(numPrefixLen)
  const q = {
    type: type || 'single',
    stemHtml,
    stemText,
    options: [],
    answer: null,
    analysis: null,
    stemDone: false
  }

  if (type === 'blank') {
    // 把 nodeHtml 里的 <u>xxx</u> 提出来作为 blanks，题干替换为 ____
    const placeholder = document.createElement('div')
    placeholder.innerHTML = nodeHtml
    const uEls = placeholder.querySelectorAll('u')
    if (uEls.length > 0) {
      q.blanks = [...uEls].map(u => u.textContent.trim())
      q.stemHtml = nodeHtml.replace(/<u>[\s\S]*?<\/u>/g, '____')
      q.stemText = stemText.replace(/\s+/g, ' ').trim()
    }
  }
  return q
}

function extractAnswer(q) {
  // 提取答案并替换所有（答案）→（  ）
  // multi/single 括号里可能是 A 或 AC（组合）；multi 也可能出现多组单独括号：（A）、（B）、（C）
  // judge：可能是 √×对错 或 A/B
  const ans = new Set()
  const bracketRe = /[（(]\s*([A-Ea-e]+|[√×Xx对错])\s*[）)]/g
  let m
  while ((m = bracketRe.exec(q.stemText)) !== null) {
    const val = m[1]
    // 如果是 multi 且是单字母，每个括号一个答案；如果是 AC 多字母，拆成多个
    if (q.type === 'multi' || q.type === 'single') {
      for (const ch of val.toUpperCase().split('')) {
        if (/[A-E]/.test(ch)) ans.add(ch)
      }
    } else if (q.type === 'judge') {
      ans.add(val)
    } else {
      ans.add(val)
    }
  }
  if (ans.size > 0) {
    if (q.type === 'judge') {
      q.answer = [...ans].some(a => /[√对A]/.test(a)) ? '正确' : '错误'
    } else {
      q.answer = [...ans].sort().join('')
    }
    const removeBracket = /[（(]\s*(?:[A-Ea-e]+|[√×Xx对错])\s*[）)]/g
    q.stemText = q.stemText.replace(removeBracket, '（  ）').trim()
    q.stemHtml = q.stemHtml.replace(removeBracket, '（  ）')
  }
}

// parseOptions：分行格式用
function parseOptions(text, loose = false) {
  const normalized = text.replace(/[\u3000\u00a0]/g, ' ')
  const pattern = loose
    ? /([A-E])[.．、\s]\s*/g
    : /([A-E])[.．、]\s*/g
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
    if (/[√对A]/.test(raw)) return '正确'
    if (/[×Xx错B]/.test(raw)) return '错误'
  }
  return raw.toUpperCase()
}

function finalize(q, inline = false) {
  if (!q) return null
  delete q.stemDone

  q.stemText = q.stemText.replace(/[\u3000\u00a0]/g, ' ')
  q.stemHtml = q.stemHtml.replace(/[\u3000\u00a0]/g, ' ')

  if (q.type === 'blank') {
    q.options = null
    if (!q.blanks) q.blanks = []
    q.stem = q.stemHtml || q.stemText
    delete q.stemHtml
    delete q.stemText
    return q
  }

  // 分行格式：需要 extractAnswer + 分离选项
  if (!inline) {
    if (q.type === 'single' || q.type === 'multi' || q.type === 'judge') {
      extractAnswer(q)
      q.stemText = q.stemText.replace(/（\s*）[）)]+/g, '（  ）')
      q.stemHtml = q.stemHtml.replace(/（\s*）[）)]+/g, '（  ）')
    }

    // 如果 single 提取到的答案字母数 ≥ 2 → 纠正为 multi（section标题可能判断错）
    if (q.type === 'single' && q.answer && typeof q.answer === 'string' && q.answer.length >= 2) {
      q.type = 'multi'
    }

    if ((q.type === 'single' || q.type === 'multi') && q.options.length === 0) {
      // 常规：A.xxx / A、xxx / A xxx
      let opts = parseOptions(q.stemText)
      if (opts.length < 2) opts = parseOptions(q.stemText, true)
      if (opts.length >= 2) {
        q.options = opts
        const firstOptIdx = q.stemText.search(/\s[A-E][.．、\s]/)
        if (firstOptIdx > 0) q.stemText = q.stemText.substring(0, firstOptIdx).trim()
        const htmlMatch = q.stemHtml.match(/\s[A-E][.．、\s]/)
        if (htmlMatch) q.stemHtml = q.stemHtml.substring(0, htmlMatch.index)
      } else {
        // 兜底：内联格式（A工具袋;B工具箱…字母直接接中文，分号分隔）
        const optStart = findOptionsStart(q.stemText)
        if (optStart > 0) {
          const optsRaw = q.stemText.substring(optStart)
          const inlineOpts = parseInlineOptions(optsRaw)
          if (inlineOpts.length >= 2) {
            q.options = inlineOpts
            q.stemText = q.stemText.substring(0, optStart)
              .replace(/[。；;\s]+$/g, '').replace(/[。.]$/g, '').trim()
            // 对 HTML 做近似处理：按相同长度切或直接用 stemText
            const htmlOptIdx = q.stemHtml.length >= optStart
              ? optStart
              : q.stemHtml.length
            q.stemHtml = q.stemHtml.substring(0, htmlOptIdx)
              .replace(/[。；;\s]+$/g, '').replace(/[。.]$/g, '').trim()
          }
        }
      }
    }

    // judge：如果题干里残留 "A正确;B错误" 这类内联选项，清掉
    if (q.type === 'judge') {
      const optStart = findOptionsStart(q.stemText)
      if (optStart > 0) {
        q.stemText = q.stemText.substring(0, optStart)
          .replace(/[。；;\s]+$/g, '').replace(/[。.]$/g, '').trim()
        if (q.stemHtml.length >= optStart) {
          q.stemHtml = q.stemHtml.substring(0, optStart)
            .replace(/[。；;\s]+$/g, '').replace(/[。.]$/g, '').trim()
        }
      }
      q.options = null
    }
  }

  // 内联格式：题干/选项/答案已在 parseInlineChunk 中提取完，这里只清理尾部标点
  if (inline) {
    if (q.type !== 'judge' && q.options) {
      q.options = q.options.map(o => ({
        key: o.key,
        label: o.label.replace(/[。.]$/g, '').trim()
      }))
    }
    q.stemText = q.stemText.replace(/[。.]$/g, '').trim()
    q.stemHtml = q.stemText
  }

  q.stem = q.stemHtml || q.stemText
  delete q.stemHtml
  delete q.stemText
  return q
}
