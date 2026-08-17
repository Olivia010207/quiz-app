import { reactive, watch } from 'vue'
import { get, set } from 'idb-keyval'
import { pushData, pullData, isConfigured } from './sync.js'

const BANKS_KEY = 'quiz-banks'
const WRONG_KEY = 'wrong-questions'
const PROGRESS_KEY = 'quiz-progress'

export const store = reactive({
  banks: [],
  currentBank: null,
  view: 'list', // 'list' | 'import' | 'quiz' | 'wrongbook' | 'settings' | 'manage'
  currentWrongBankId: null,
  currentManageBankId: null,
  progress: JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}'),
  wrongQuestions: [],
  loading: true,
  sync: {
    status: 'idle',
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
      banks: JSON.parse(JSON.stringify(store.banks)),
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

export async function syncNow() {
  if (!isConfigured()) return
  await doSync()
}

// 拉取并合并远程数据
export async function syncPull() {
  if (!isConfigured()) return false
  try {
    store.sync.status = 'syncing'
    const data = await pullData()

    // 合并题库：同 id 时按 updatedAt 取更新的一方，本地独有的保留，远程独有的新增
    if (data.banks && data.banks.length > 0) {
      for (const remoteBank of data.banks) {
        const idx = store.banks.findIndex(b => b.id === remoteBank.id)
        if (idx >= 0) {
          const localU = store.banks[idx].updatedAt || 0
          const remoteU = remoteBank.updatedAt || 0
          if (remoteU > localU) store.banks[idx] = remoteBank
        } else {
          store.banks.push(remoteBank)
        }
      }
      await saveBanks()
    }

    // 合并进度：取进度更靠前的
    if (data.progress) {
      for (const id of Object.keys(data.progress)) {
        const remote = data.progress[id]
        const local = store.progress[id]
        if (!local || (remote.index || 0) > (local.index || 0)) {
          store.progress[id] = remote
        }
      }
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(store.progress))
    }

    // 合并错题：并集去重（stemKey + bankId）
    if (data.wrongQuestions) {
      function keyOf(w) {
        // 兼容远端旧格式（带 question 快照）
        if (w.stemKey) return w.stemKey + '|' + w.bankId
        const shared = (w.question?.sharedStem || '').trim()
        const sub = (w.question?.stem || '').trim()
        const subIdx = w.question?.subQuestionIndex
        if (shared && subIdx != null) return `__group__|${shared}|${sub}|${w.bankId}`
        return sub + '|' + w.bankId
      }
      const existingKeys = new Set(store.wrongQuestions.map(keyOf))
      const remoteOnly = data.wrongQuestions.filter(w => !existingKeys.has(keyOf(w)))
        // 远端旧格式（question 快照）转新格式（stemKey）
        .map(w => {
          if (w.stemKey) return w
          const shared = (w.question?.sharedStem || '').trim()
          const sub = (w.question?.stem || '').trim()
          const subIdx = w.question?.subQuestionIndex
          let stemKey
          if (shared && subIdx != null) stemKey = `__group__|${shared}|${sub}`
          else stemKey = sub
          return {
            bankId: w.bankId,
            bankName: w.bankName || '',
            stemKey,
            addedAt: w.addedAt || Date.now()
          }
        })
      store.wrongQuestions = [...store.wrongQuestions, ...remoteOnly]
      await set(WRONG_KEY, JSON.parse(JSON.stringify(store.wrongQuestions)))
    }

    store.sync.status = 'success'
    store.sync.lastSyncedAt = data.updatedAt || new Date().toISOString()
    return true
  } catch (e) {
    store.sync.status = 'error'
    store.sync.error = e.message
    return false
  }
}

async function loadAll() {
  store.banks = (await get(BANKS_KEY)) || []
  // 兼容旧数据：补 updatedAt
  for (const b of store.banks) {
    if (!b.updatedAt) b.updatedAt = b.createdAt || Date.now()
  }
  store.wrongQuestions = (await get(WRONG_KEY)) || []
  // 兼容旧格式：带 question 快照的错题 → 转 stemKey
  let migrated = false
  store.wrongQuestions = store.wrongQuestions.map(w => {
    if (w.stemKey || !w.question) return w
    migrated = true
    const shared = (w.question.sharedStem || '').trim()
    const sub = (w.question.stem || '').trim()
    const subIdx = w.question.subQuestionIndex
    let stemKey
    if (shared && subIdx != null) stemKey = `__group__|${shared}|${sub}`
    else stemKey = sub
    return {
      bankId: w.bankId,
      bankName: w.bankName || '',
      stemKey,
      addedAt: w.addedAt || Date.now()
    }
  })
  if (migrated) saveWrongQuestions().catch(() => {})
  store.loading = false
  if (isConfigured()) {
    syncPull().catch(() => {})
  }
}
loadAll()

// ---------- 题库存取 ----------
export async function saveBanks() {
  await set(BANKS_KEY, JSON.parse(JSON.stringify(store.banks)))
}

function generateBankId() {
  const rnd =
    (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return 'b_' + rnd
}

export async function addBank(bank) {
  if (!bank.id) bank.id = generateBankId()
  bank.createdAt = bank.createdAt || new Date().toISOString()
  bank.updatedAt = Date.now()
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
    store.wrongQuestions = store.wrongQuestions.filter(w => w.bankId !== id)
    await saveWrongQuestions()
  }
}

export async function renameBank(id, name) {
  const bank = store.banks.find(b => b.id === id)
  if (bank) {
    bank.name = name
    bank.updatedAt = Date.now()
    await saveBanks()
  }
}

export async function updateQuestion(bankId, questionIndex, newQuestion) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[questionIndex]) return
  bank.questions[questionIndex] = { ...bank.questions[questionIndex], ...newQuestion }
  bank.updatedAt = Date.now()
  await saveBanks()
}

export async function insertQuestion(bankId, index, question) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank) return
  if (!bank.questions) bank.questions = []
  const i = Math.max(0, Math.min(index, bank.questions.length))
  bank.questions.splice(i, 0, question)
  bank.updatedAt = Date.now()
  await saveBanks()
}

export async function deleteQuestion(bankId, index) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[index]) return
  bank.questions.splice(index, 1)
  bank.updatedAt = Date.now()
  await saveBanks()
}

export async function moveQuestion(bankId, fromIndex, direction) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions) return
  const toIndex = fromIndex + direction
  if (toIndex < 0 || toIndex >= bank.questions.length) return
  const [item] = bank.questions.splice(fromIndex, 1)
  bank.questions.splice(toIndex, 0, item)
  bank.updatedAt = Date.now()
  await saveBanks()
}

export function openManageView(bankId) {
  store.currentManageBankId = bankId
  store.view = 'manage'
}

// ---------- JSON 导出/导入 ----------
export function exportBankToJson(bankId) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank) return null
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    id: bank.id,
    name: bank.name,
    source: bank.source,
    createdAt: bank.createdAt,
    questions: JSON.parse(JSON.stringify(bank.questions))
  }
}

export function exportAllBanksToJson() {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    banks: store.banks.map(b => ({
      id: b.id,
      name: b.name,
      source: b.source,
      createdAt: b.createdAt,
      questions: JSON.parse(JSON.stringify(b.questions))
    }))
  }
}

export async function importBankFromJson(data) {
  const newBank = {
    name: data.name || '未命名题库',
    questions: data.questions || [],
    source: data.source || 'json',
    createdAt: data.createdAt || new Date().toISOString(),
    updatedAt: Date.now()
  }
  newBank.id = (typeof data.id === 'string' && data.id) ? data.id : generateBankId()

  // 相同 id → 覆盖内容，保留进度
  const existing = store.banks.find(b => b.id === newBank.id)
  if (existing) {
    existing.questions = newBank.questions
    if (data.name) existing.name = newBank.name
    existing.source = existing.source || newBank.source
    existing.updatedAt = Date.now()
    await saveBanks()
    return { action: 'overwritten', bank: existing }
  }

  // 检查同名自动改名
  const sameName = store.banks.find(b => b.name === newBank.name)
  if (sameName) newBank.name = newBank.name + '(导入)'
  store.banks.push(newBank)
  await saveBanks()
  return { action: 'created', bank: newBank }
}

export async function importMultipleBanks(banks) {
  const results = []
  for (const data of banks) {
    const r = await importBankFromJson(data)
    results.push(r)
  }
  return results
}

// ---------- 进度持久化 ----------
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

export function wrongCount(bankId) {
  if (!bankId) return store.wrongQuestions.length
  return store.wrongQuestions.filter(w => w.bankId === bankId).length
}

export function openWrongBook(bankId = null) {
  store.currentWrongBankId = bankId
  store.view = 'wrongbook'
}

export function getWrongList() {
  if (!store.currentWrongBankId) return store.wrongQuestions
  return store.wrongQuestions.filter(w => w.bankId === store.currentWrongBankId)
}

// 题干→stemKey：普通题用题干，案例子题用 group|shared|sub
function stemKeyOf(question) {
  if (!question) return ''
  const shared = (question.sharedStem || '').trim()
  const sub = (question.stem || '').trim()
  const subIdx = question.subQuestionIndex
  if (shared && (subIdx != null || question.type === 'group')) {
    return `__group__|${shared}|${sub}`
  }
  return sub
}

export async function addWrongQuestion(question, bank) {
  const key = stemKeyOf(question)
  const bankId = bank?.id || ''
  if (!key) return
  if (store.wrongQuestions.some(w => w.bankId === bankId && w.stemKey === key)) return
  store.wrongQuestions.push({
    bankId,
    bankName: bank?.name || '',
    stemKey: key,
    addedAt: Date.now()
  })
  await saveWrongQuestions()
}

export async function removeWrongIfCorrect(question, bankId) {
  const key = stemKeyOf(question)
  if (!key) return
  const idx = store.wrongQuestions.findIndex(w =>
    w.stemKey === key && (!bankId || w.bankId === bankId)
  )
  if (idx >= 0) {
    store.wrongQuestions.splice(idx, 1)
    await saveWrongQuestions()
  }
}

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

export async function clearWrongQuestions(bankId) {
  if (bankId) {
    store.wrongQuestions = store.wrongQuestions.filter(w => w.bankId !== bankId)
  } else {
    store.wrongQuestions = []
  }
  await saveWrongQuestions()
}

// 根据错题记录从当前题库里找到对应题目；找不到返回 null
export function resolveWrongQuestion(wrong) {
  const key = wrong.stemKey || ''
  const bank = store.banks.find(b => b.id === wrong.bankId)
  if (!bank || !key) return null
  if (key.startsWith('__group__|')) {
    const parts = key.split('|')
    const shared = parts[1] || ''
    const sub = parts.slice(2).join('|') || ''
    for (const q of bank.questions || []) {
      if (q.type !== 'group') continue
      if ((q.sharedStem || '').trim() !== shared) continue
      if (!q.questions) continue
      for (let i = 0; i < q.questions.length; i++) {
        const subQ = q.questions[i]
        if ((subQ.stem || '').trim() === sub) {
          return { ...subQ, sharedStem: q.sharedStem, subQuestionIndex: i }
        }
      }
    }
    return null
  }
  for (const q of bank.questions || []) {
    if (q.type === 'group') continue
    if ((q.stem || '').trim() === key) return q
  }
  return null
}

export function startWrongPractice(bankId) {
  const list = bankId
    ? store.wrongQuestions.filter(w => w.bankId === bankId)
    : store.wrongQuestions
  if (list.length === 0) return
  const bankName = bankId
    ? (store.banks.find(b => b.id === bankId)?.name + ' 错题练习')
    : '全部错题练习'
  // 过滤掉找不到的失效题目
  const questions = list.map(w => resolveWrongQuestion(w)).filter(Boolean)
  if (questions.length === 0) return
  store.currentBank = {
    id: 'wrong-practice',
    name: bankName,
    source: 'wrong',
    questions
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
