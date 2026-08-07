// Excel 题库解析器
// 格式1：多 sheet，sheet 名即题型（单选题/多选题/判断题）
//        列：序号|题型|题干|A|B|C|D|[E F G]|答案
//        判断题选项为空，答案 A=正确 B=错误
// 格式2：单 sheet，含案例题题组
//        列：题型|难易度|知识类别|题干|A-I|答案|出自规范|是否保命题
//        案例题连续行：材料行(空选项空答案) + 子题行(类型看题干后缀)
//        判断题子题选项为 错误/正确，A=错误 B=正确
import * as XLSX from 'xlsx'

export async function parseExcel(file) {
  const arrayBuffer = await file.arrayBuffer()
  const workbook = XLSX.read(arrayBuffer, { type: 'array' })
  const names = workbook.SheetNames

  // 格式嗅探：多 sheet 且 sheet 名含题型 → 格式1
  const isFormat1 =
    names.length > 1 &&
    names.some(n => /单选|多选|判断|填空/.test(n))

  return isFormat1
    ? parseFormat1(workbook)
    : parseFormat2(workbook)
}

// ---------- 格式1：多 sheet 分题型 ----------
function parseFormat1(workbook) {
  const questions = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    if (rows.length < 2) continue

    const type = normalizeType(sheetName)
    const colMap = buildColumnMap(rows[0])

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i]
      const stem = String(row[colMap.stem] || '').trim()
      if (!stem) continue

      const answer = String(row[colMap.answer] || '').trim()
      const opts = collectOptions(row, colMap)

      questions.push(buildQuestion(type, stem, opts, answer, colMap, row))
    }
  }
  return questions
}

// ---------- 格式2：单 sheet 含案例题 ----------
function parseFormat2(workbook) {
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
  if (rows.length < 2) return []

  const colMap = buildColumnMap(rows[0])
  const questions = []
  let group = null

  const flushGroup = () => {
    if (group) {
      questions.push(group)
      group = null
    }
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    const rowType = String(row[colMap.type] || '').trim()
    if (!rowType) continue

    const baseType = normalizeType(rowType)
    const stem = String(row[colMap.stem] || '').trim()
    const answer = String(row[colMap.answer] || '').trim()
    const opts = collectOptions(row, colMap)
    const meta = collectMeta(colMap, row)

    if (baseType === 'group') {
      // 案例题：材料行（空选项空答案）vs 子题行
      if (opts.length === 0 && !answer) {
        flushGroup()
        group = { type: 'group', sharedStem: stem, questions: [], ...meta }
      } else {
        if (!group) group = { type: 'group', sharedStem: '', questions: [] }
        // 子题类型看题干后缀（单选题）/（判断题）/（多选题）
        const subMatch = stem.match(/[（(](单选题|多选题|判断题|多项选择题)[）)]/)
        const subType = subMatch ? normalizeType(subMatch[1]) : 'single'
        const subQ = buildQuestion(subType, stem, opts, answer, colMap, row)
        Object.assign(subQ, meta)
        group.questions.push(subQ)
      }
    } else {
      flushGroup()
      const q = buildQuestion(baseType, stem, opts, answer, colMap, row)
      Object.assign(q, meta)
      questions.push(q)
    }
  }
  flushGroup()
  return questions
}

// ---------- 公共工具 ----------
function buildColumnMap(header) {
  const map = {}
  header.forEach((h, i) => {
    const hh = String(h).trim()
    if (!hh) return
    // 精确匹配短列名，避免被"备注(填空题多个填空答案...)"等长列名误匹配
    if (hh === '题干') map.stem = i
    else if (hh === '答案') map.answer = i
    else if (hh === '题型') map.type = i
    else if (hh === '序号') map.index = i
    else if (hh === '解析') map.analysis = i
    else if (/难易度|难度/.test(hh)) map.difficulty = i
    else if (/知识类别|类别|分类/.test(hh)) map.category = i
    else if (/出自规范|规范/.test(hh)) map.source = i
    else if (/是否保命题/.test(hh)) map.keyQuestion = i
    else if (/^[A-I]$/.test(hh)) map[hh] = i
  })
  return map
}

function collectOptions(row, colMap) {
  const opts = []
  for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) {
    const idx = colMap[key]
    if (idx != null && row[idx] != null && String(row[idx]).trim()) {
      opts.push({ key, label: String(row[idx]).trim() })
    }
  }
  return opts
}

function collectMeta(colMap, row) {
  const meta = {}
  if (colMap.difficulty != null) meta.difficulty = String(row[colMap.difficulty] || '').trim()
  if (colMap.category != null) meta.category = String(row[colMap.category] || '').trim()
  if (colMap.source != null) meta.source = String(row[colMap.source] || '').trim()
  if (colMap.analysis != null) meta.analysis = String(row[colMap.analysis] || '').trim()
  return meta
}

function buildQuestion(type, stem, opts, answer, colMap, row) {
  const q = { type, stem, options: null, answer: null, analysis: null }
  if (type === 'judge') {
    // 有选项（错误/正确）→ 按位置映射；无选项 → A=正确 B=错误
    q.answer = resolveJudgeAnswer(answer, opts)
    q.options = null
  } else if (type === 'blank') {
    q.options = null
    // 填空题答案用逗号分隔多个空
    q.blanks = answer
      ? answer.split(/[,，]/).map(s => s.trim()).filter(Boolean)
      : []
  } else {
    q.options = opts
    // 多选题答案可能是 "A,B,C,D" 格式，去掉逗号和空格
    q.answer = answer.replace(/[,，\s]/g, '').toUpperCase()
  }
  if (colMap.analysis != null) {
    q.analysis = String(row[colMap.analysis] || '').trim()
  }
  return q
}

function resolveJudgeAnswer(answer, options) {
  if (options && options.length > 0) {
    const opt = options.find(o => o.key === answer.toUpperCase())
    if (opt) {
      // 选项可能是 错误/正确 或 对/错
      if (/正确|对/.test(opt.label)) return '正确'
      if (/错误|错/.test(opt.label)) return '错误'
    }
  }
  // 无选项默认：A=正确 B=错误
  return answer.toUpperCase() === 'A' ? '正确' : '错误'
}

function normalizeType(name) {
  const s = String(name)
  if (/案例/.test(s)) return 'group'
  if (/单选/.test(s)) return 'single'
  if (/多选/.test(s)) return 'multi'
  if (/判断/.test(s)) return 'judge'
  if (/填空/.test(s)) return 'blank'
  return 'single'
}
