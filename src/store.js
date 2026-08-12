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

    // 合并题库：远程覆盖同 id 的本地题库，本地独有的保留
    if (data.banks && data.banks.length > 0) {
      for (const remoteBank of data.banks) {
        const idx = store.banks.findIndex(b => b.id === remoteBank.id)
        if (idx >= 0) {
          store.banks[idx] = remoteBank
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

    // 合并错题：并集去重
    if (data.wrongQuestions) {
      const existingKeys = new Set(store.wrongQuestions.map(w =>
        (w.question.stem || w.question.sharedStem || '') + '|' + w.bankId
      ))
      const remoteOnly = data.wrongQuestions.filter(w =>
        !existingKeys.has((w.question.stem || w.question.sharedStem || '') + '|' + w.bankId)
      )
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
  store.wrongQuestions = (await get(WRONG_KEY)) || []
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
    await saveBanks()
  }
}

export async function updateQuestion(bankId, questionIndex, newQuestion) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[questionIndex]) return
  bank.questions[questionIndex] = { ...bank.questions[questionIndex], ...newQuestion }
  await saveBanks()
}

export async function insertQuestion(bankId, index, question) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank) return
  if (!bank.questions) bank.questions = []
  const i = Math.max(0, Math.min(index, bank.questions.length))
  bank.questions.splice(i, 0, question)
  await saveBanks()
}

export async function deleteQuestion(bankId, index) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[index]) return
  bank.questions.splice(index, 1)
  await saveBanks()
}

export async function moveQuestion(bankId, fromIndex, direction) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions) return
  const toIndex = fromIndex + direction
  if (toIndex < 0 || toIndex >= bank.questions.length) return
  const [item] = bank.questions.splice(fromIndex, 1)
  bank.questions.splice(toIndex, 0, item)
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
    createdAt: data.createdAt || new Date().toISOString()
  }
  newBank.id = (typeof data.id === 'string' && data.id) ? data.id : generateBankId()

  // 相同 id → 覆盖内容，保留进度
  const existing = store.banks.find(b => b.id === newBank.id)
  if (existing) {
    existing.questions = newBank.questions
    if (data.name) existing.name = newBank.name
    existing.source = existing.source || newBank.source
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
