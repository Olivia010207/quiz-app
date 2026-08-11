import { reactive, watch } from 'vue'
import { get, set } from 'idb-keyval'
import { pushData, pullData, isConfigured } from './sync.js'

const BANKS_KEY = 'quiz-banks'
const WRONG_KEY = 'wrong-questions'
const PROGRESS_KEY = 'quiz-progress'

// 统一题目模型说明：
// { id, type, stem, options, answer, analysis, sharedStem?, questions?, difficulty?, category?, source? }
// type: 'single' | 'multi' | 'judge' | 'blank' | 'group'
// single/multi: options=[{key:'A',label:'...'}], answer='A' 或 'AC'
// judge: options=null, answer='正确'|'错误'
// blank: stem 含 ____ 占位, blanks=['答案1','答案2']
// group: sharedStem=材料, questions=[子题]

// progress[bankId] = { index, shuffle, answers: {}, submitted: {} }
// answers/submitted 的 key = 题号（题组子题用 i_j）

export const store = reactive({
  banks: [],
  currentBank: null,
  view: 'list', // 'list' | 'import' | 'quiz' | 'wrongbook' | 'settings' | 'manage'
  currentWrongBankId: null, // wrongbook 视图参数：null=全部，否则=某题库
  currentManageBankId: null, // manage 视图参数：要管理的题库 id
  progress: JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'),
  wrongQuestions: [],
  loading: true,
  sync: {
    status: 'idle', // 'idle' | 'syncing' | 'success' | 'error'
    lastSyncedAt: null,
    error: null
  }
})

// ---------- 同步 ----------
async function doSync() {
  if (!isConfigured()) return
  store.sync.status = 'syncing'
  store.sync.error = null
  try {
    const { updatedAt } = await pushData({
      progress: store.progress,
      wrongQuestions: JSON.parse(JSON.stringify(store.wrongQuestions))
    })
    store.sync.status = 'success'
    store.sync.lastSyncedAt = updatedAt
  } catch (e) {
    store.sync.status = 'error'
    store.sync.error = e.message
  }
}

// 手动同步（设置页 / 离开页面 / 关闭页面调用）
export async function syncNow() {
  if (!isConfigured()) return
  await doSync()
}

// 拉取并合并远程数据（启动时调用）
export async function syncPull() {
  if (!isConfigured()) return false
  try {
    store.sync.status = 'syncing'
    const data = await pullData()
    if (data.progress) {
      // 合并进度（远程优先，但保留本地已有的题库进度）
      Object.keys(data.progress).forEach(k => {
        if (!store.progress[k] || confirm(`远程有「${k}」的进度，是否覆盖本地？`)) {
          store.progress[k] = data.progress[k]
        }
      })
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(store.progress))
    }
    if (data.wrongQuestions) {
      // 合并错题：以远程为基准，补上本地新增
      const remoteStems = new Set(data.wrongQuestions.map(w =>
        (w.question.stem || w.question.sharedStem || '') + '|' + w.bankId
      ))
      const localOnly = store.wrongQuestions.filter(w =>
        !remoteStems.has((w.question.stem || w.question.sharedStem || '') + '|' + w.bankId)
      )
      store.wrongQuestions = [...data.wrongQuestions, ...localOnly]
      await set(WRONG_KEY, JSON.parse(JSON.stringify(store.wrongQuestions)))
    }
    store.sync.status = 'success'
    store.sync.lastSyncedAt = data.updatedAt
    return true
  } catch (e) {
    store.sync.status = 'error'
    store.sync.error = e.message
    return false
  }
}

async function loadAll() {
  store.banks = (await get(BANKS_KEY)) || []
  store.wrongQuestions = (await get(WRONG_KEY)) || []
  store.loading = false
  // 启动时尝试拉取远程数据（静默，失败不报错）
  if (isConfigured()) {
    syncPull().catch(() => {})
  }
}
loadAll()

// ---------- 题库存取 ----------
export async function saveBanks() {
  await set(BANKS_KEY, JSON.parse(JSON.stringify(store.banks)))
}

// 内容指纹：基于题库名+题目数量+前3题题干，跨设备稳定
function computeFingerprint(bank) {
  const sample = (bank.questions || []).slice(0, 3)
    .map(q => (q.stem || q.sharedStem || '').substring(0, 50))
    .join('|')
  const text = (bank.name || '') + '|' + (bank.questions?.length || 0) + '|' + sample
  // 简单 DJB2 哈希
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

export function generateBankId(bank) {
  return 'bank_' + computeFingerprint(bank)
}

export async function addBank(bank) {
  bank.id = generateBankId(bank)
  bank.createdAt = new Date().toISOString()
  store.banks.push(bank)
  await saveBanks()
  return bank
}

export async function deleteBank(id) {
  const idx = store.banks.findIndex(b => b.id === id)
  if (idx >= 0) {
    store.banks.splice(idx, 1)
    delete store.progress[id]
    await saveBanks()
    // 删除题库时同步清理其错题
    store.wrongQuestions = store.wrongQuestions.filter(w => w.bankId !== id)
    await saveWrongQuestions()
  }
}

export async function renameBank(id, name) {
  const bank = store.banks.find(b => b.id === id)
  if (bank) {
    bank.name = name
    await saveBanks()
  }
}

// 编辑更新某题（题库内按原 index 替换）
export async function updateQuestion(bankId, questionIndex, newQuestion) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[questionIndex]) return
  bank.questions[questionIndex] = { ...bank.questions[questionIndex], ...newQuestion }
  await saveBanks()
}

// 在指定位置插入新题（index = bank.questions.length 表示末尾）
export async function insertQuestion(bankId, index, question) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank) return
  if (!bank.questions) bank.questions = []
  const i = Math.max(0, Math.min(index, bank.questions.length))
  bank.questions.splice(i, 0, question)
  await saveBanks()
}

// 删除指定位置的题目
export async function deleteQuestion(bankId, index) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[index]) return
  bank.questions.splice(index, 1)
  await saveBanks()
}

// 上移/下移题目（direction = -1 上移，+1 下移）
export async function moveQuestion(bankId, fromIndex, direction) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions) return
  const toIndex = fromIndex + direction
  if (toIndex < 0 || toIndex >= bank.questions.length) return
  const [item] = bank.questions.splice(fromIndex, 1)
  bank.questions.splice(toIndex, 0, item)
  await saveBanks()
}

// 打开题库管理视图
export function openManageView(bankId) {
  store.currentManageBankId = bankId
  store.view = 'manage'
}

// ---------- JSON 导出/导入 ----------
export function exportBankToJson(bankId) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank) return null
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    name: bank.name,
    questions: JSON.parse(JSON.stringify(bank.questions))
  }
}

export function exportAllBanksToJson() {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    banks: store.banks.map(b => ({
      name: b.name,
      questions: JSON.parse(JSON.stringify(b.questions))
    }))
  }
}

// 导入单个题库 JSON，返回 { action: 'created'|'overwritten'|'renamed', bank }
export async function importBankFromJson(data) {
  const newBank = {
    name: data.name || '未命名题库',
    questions: data.questions || []
  }
  const newId = generateBankId(newBank)
  const existing = store.banks.find(b => b.id === newId)

  if (existing) {
    // 指纹相同 = 同一份题库 → 覆盖内容，保留 id 和进度
    existing.questions = newBank.questions
    if (data.name) existing.name = data.name
    await saveBanks()
    return { action: 'overwritten', bank: existing }
  } else {
    // 检查同名题库
    const sameName = store.banks.find(b => b.name === newBank.name)
    if (sameName) {
      // 同名但内容不同 → 自动改名
      newBank.name = newBank.name + '(导入)'
    }
    newBank.id = newId
    newBank.createdAt = new Date().toISOString()
    store.banks.push(newBank)
    await saveBanks()
    return { action: 'created', bank: newBank }
  }
}

// 批量导入多个题库
export async function importMultipleBanks(banks) {
  const results = []
  for (const data of banks) {
    const r = await importBankFromJson(data)
    results.push(r)
  }
  return results
}

// ---------- 进度持久化（含答题状态） ----------
watch(() => store.progress, (val) => {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(val))
}, { deep: true })

export function setProgress(bankId, data) {
  store.progress[bankId] = { ...store.progress[bankId], ...data }
}

export function getProgress(bankId) {
  return store.progress[bankId] || {}
}

export function clearProgress(bankId) {
  delete store.progress[bankId]
}

// ---------- 错题本 ----------
async function saveWrongQuestions() {
  await set(WRONG_KEY, JSON.parse(JSON.stringify(store.wrongQuestions)))
}

// 统计某题库的错题数（bankId 为空或不传则返回总数）
export function wrongCount(bankId) {
  if (!bankId) return store.wrongQuestions.length
  return store.wrongQuestions.filter(w => w.bankId === bankId).length
}

// 打开某题库的错题本（bankId=null 则查看全部）
export function openWrongBook(bankId = null) {
  store.currentWrongBankId = bankId
  store.view = 'wrongbook'
}

// 获取当前错题本视图要显示的错题列表
export function getWrongList() {
  if (!store.currentWrongBankId) return store.wrongQuestions
  return store.wrongQuestions.filter(w => w.bankId === store.currentWrongBankId)
}

// 添加错题（同题库内按题干去重，跨题库相同题干不冲突）
export async function addWrongQuestion(question, bank) {
  const stem = question.stem || question.sharedStem || ''
  const bankId = bank?.id || ''
  if (!stem) return
  if (store.wrongQuestions.some(w => {
    const ws = w.question.stem || w.question.sharedStem || ''
    return ws === stem && w.bankId === bankId
  })) return
  store.wrongQuestions.push({
    question: JSON.parse(JSON.stringify(question)),
    bankId,
    bankName: bank?.name || '',
    addedAt: Date.now()
  })
  await saveWrongQuestions()
}

// 答对后移出错题本（同题库内按题干匹配）
export async function removeWrongIfCorrect(question, bankId) {
  const stem = question.stem || question.sharedStem || ''
  if (!stem) return
  const idx = store.wrongQuestions.findIndex(w => {
    const ws = w.question.stem || w.question.sharedStem || ''
    return ws === stem && (!bankId || w.bankId === bankId)
  })
  if (idx >= 0) {
    store.wrongQuestions.splice(idx, 1)
    await saveWrongQuestions()
  }
}

// 按当前视图 index 移除错题（filtered → 映射回原数组）
export async function removeWrongQuestionByFilteredIndex(index) {
  const list = getWrongList()
  const item = list[index]
  if (!item) return
  const realIdx = store.wrongQuestions.indexOf(item)
  if (realIdx >= 0) {
    store.wrongQuestions.splice(realIdx, 1)
    await saveWrongQuestions()
  }
}

// 清空当前题库的错题（bankId=null 则全部清空）
export async function clearWrongQuestions(bankId) {
  if (bankId) {
    store.wrongQuestions = store.wrongQuestions.filter(w => w.bankId !== bankId)
  } else {
    store.wrongQuestions = []
  }
  await saveWrongQuestions()
}

// 错题练习：把错题组装成临时题库（bankId=null 则练习全部）
export function startWrongPractice(bankId) {
  const list = bankId
    ? store.wrongQuestions.filter(w => w.bankId === bankId)
    : store.wrongQuestions
  if (list.length === 0) return
  const bankName = bankId
    ? (store.banks.find(b => b.id === bankId)?.name + ' 错题练习')
    : '全部错题练习'
  store.currentBank = {
    id: 'wrong-practice',
    name: bankName,
    source: 'wrong',
    questions: list.map(w => w.question)
  }
  store.view = 'quiz'
}

// ---------- 工具函数 ----------
export function shuffle(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function countQuestions(bank) {
  if (!bank || !bank.questions) return 0
  return bank.questions.reduce((sum, q) => {
    if (q.type === 'group') return sum + (q.questions ? q.questions.length : 0)
    return sum + 1
  }, 0)
}
