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
    // 给每个 progress entry 附上 _fingerprint / _bankName / totalQuestions，
    // 这样跨端导入时即使 bank.id 不同，也能按 fingerprint/题库名/题数 精准找回
    const progressForSync = {}
    for (const id of Object.keys(store.progress)) {
      const bank = store.banks.find(b => b.id === id)
      const entry = store.progress[id]
      if (!entry) continue
      progressForSync[id] = {
        ...entry,
        _fingerprint: bank ? (bank.fingerprint || computeFingerprint(bank)) : null,
        _bankName: bank ? bank.name : null,
        _totalQuestions: bank ? countQuestions(bank) : null
      }
    }
    const { updatedAt } = await pushData({
      progress: progressForSync,
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
      // 判断一个 progress entry 是否是空（没做题过）
      function isEmpty(p) {
        if (!p) return true
        if ((p.index || 0) === 0
          && !p.shuffle
          && (!p.answers || Object.keys(p.answers).length === 0)
          && (!p.submitted || Object.keys(p.submitted).length === 0)) {
          return true
        }
        return false
      }
      // 远程 bankId → 本地 bank.id 的映射（远程可能是旧 bank_xxx/b_xxx 格式，
      // 就通过 entry 自带的 _fingerprint / _bankName / _totalQuestions 或 模糊匹配找回）
      function resolveLocalBankId(remoteKey) {
        if (store.banks.some(b => b.id === remoteKey)) return remoteKey
        const remote = data.progress[remoteKey] || {}
        // 1. 优先用进度条目自带的 fingerprint（最准）
        if (typeof remote._fingerprint === 'string' && remote._fingerprint) {
          const hit = store.banks.find(b =>
            (b.fingerprint || computeFingerprint(b)) === remote._fingerprint
          )
          if (hit) return hit.id
        }
        // 2. 尝试把 remoteKey 当成 fingerprint 多种变体匹配
        const variants = new Set([
          remoteKey,
          remoteKey.startsWith('fp_') ? remoteKey : null,
          remoteKey.startsWith('bank_') ? 'fp_' + remoteKey.slice(5) : null,
          /^[a-z0-9]+$/i.test(remoteKey) ? 'fp_' + remoteKey : null
        ])
        variants.delete(null)
        for (const b of store.banks) {
          const bf = b.fingerprint || computeFingerprint(b)
          if (variants.has(bf)) return b.id
        }
        // 3. 按题库名 + 总题数 兜底匹配（同一用户题库数量一般不多，撞库概率低）
        const totalCmp = remote._totalQuestions
        const nameCmp = remote._bankName
        if (nameCmp) {
          const sameName = store.banks.filter(b => b.name === nameCmp)
          if (sameName.length === 1) return sameName[0].id
          if (sameName.length > 1 && totalCmp) {
            const match = sameName.find(b => countQuestions(b) === totalCmp)
            if (match) return match.id
          }
        }
        return null  // 确实找不到就跳过
      }

      // 合并进度（远程优先，但保留本地已有的非空进度）
      const keys = Object.keys(data.progress)
      for (let i = 0; i < keys.length; i++) {
        const remoteKey = keys[i]
        const remote = data.progress[remoteKey]
        const localKey = resolveLocalBankId(remoteKey)
        if (!localKey) continue   // 本地没有对应题库，跳过，不写入 progress 占用脏 key
        const local = store.progress[localKey]
        const bank = store.banks.find(b => b.id === localKey)
        const label = bank ? `${bank.name}（${countQuestions(bank)}题）` : remoteKey
        if (!local || isEmpty(local)) {
          store.progress[localKey] = remote
        } else if (!isEmpty(remote)) {
          if (confirm(`远程和本地都有「${label}」的做题记录，是否用远程覆盖本地？\n\n本地进度：第 ${local.index || 0} 题\n远程进度：第 ${remote.index || 0} 题`)) {
            store.progress[localKey] = remote
          }
        }
      }
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(store.progress))
    }
    if (data.wrongQuestions) {
      // 把远程错题的 bankId 也做一次本地 bank.id 归一化
      function normWrongBankId(remoteBankId) {
        if (store.banks.some(b => b.id === remoteBankId)) return remoteBankId
        // 把 remoteBankId 当 fingerprint 变体去匹配
        const variants = new Set([
          remoteBankId,
          remoteBankId.startsWith('fp_') ? remoteBankId : null,
          remoteBankId.startsWith('bank_') ? 'fp_' + remoteBankId.slice(5) : null,
          /^[a-z0-9]+$/i.test(remoteBankId) ? 'fp_' + remoteBankId : null
        ])
        variants.delete(null)
        for (const b of store.banks) {
          const bf = b.fingerprint || computeFingerprint(b)
          if (variants.has(bf)) return b.id
        }
        return remoteBankId  // 找不到则保留原值，错题库只是 bankId 对不上但不会丢数据
      }
      const remoteNorm = data.wrongQuestions.map(w => ({
        ...w,
        bankId: normWrongBankId(w.bankId)
      }))
      // 合并错题：以远程为基准，补上本地新增（本地独有才追加）
      const remoteStems = new Set(remoteNorm.map(w =>
        (w.question.stem || w.question.sharedStem || '') + '|' + w.bankId
      ))
      const localOnly = store.wrongQuestions.filter(w =>
        !remoteStems.has((w.question.stem || w.question.sharedStem || '') + '|' + w.bankId)
      )
      store.wrongQuestions = [...remoteNorm, ...localOnly]
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

  // 旧题库迁移：
  // 1) 所有 bank 补 fingerprint 字段
  // 2) 如果 bank.id 是旧的内容指纹（bank_xxx），并且还能匹配到 fingerprint，
  //    那就把 progress 和 wrongQuestions 里对应这个 key 的记录和 bank.id 对齐
  //    （其实 bank.id 本来就是 key，所以这一步主要是为旧的 progress 用 bank_xxx key
  //     但题库因为改名/改题目 id 变成了 b_xxx 的新随机 id 的场景；
  //     先让 ensure 跑，然后再整体做一次 按 fingerprint 的 key 对齐）
  if (ensureBankFingerprints()) await saveBanks()
  const needSaveWrong = migrateOldProgressAndWrongKeysOnLoad()
  if (needSaveWrong) await saveWrongQuestions()

  store.loading = false
  // 启动时尝试拉取远程数据（静默，失败不报错）
  if (isConfigured()) {
    syncPull().catch(() => {})
  }
}
loadAll()

// 启动时：遍历本地 banks，根据每个 bank.fingerprint 把 progress/wrong 里用旧 key
// （bank_xxx 或 fp_xxx 或裸 hash）存储的记录迁移到 bank.id 下。返回是否改了错题。
function migrateOldProgressAndWrongKeysOnLoad() {
  let progChanged = false
  let wrongChanged = false
  for (const b of store.banks) {
    const fp = b.fingerprint || computeFingerprint(b)
    const possible = new Set([
      fp,
      fp.startsWith('fp_') ? fp.slice(3) : null,
      fp.startsWith('fp_') ? 'bank_' + fp.slice(3) : null
    ])
    possible.delete(null)
    possible.delete(b.id)
    for (const k of possible) {
      if (store.progress[k] && !store.progress[b.id]) {
        store.progress[b.id] = store.progress[k]
        delete store.progress[k]
        progChanged = true
      }
      for (const w of store.wrongQuestions) {
        if (w.bankId === k) {
          w.bankId = b.id
          wrongChanged = true
        }
      }
    }
  }
  if (progChanged) localStorage.setItem(PROGRESS_KEY, JSON.stringify(store.progress))
  return wrongChanged
}

// ---------- 题库存取 ----------
export async function saveBanks() {
  await set(BANKS_KEY, JSON.parse(JSON.stringify(store.banks)))
}

// 内容指纹：基于题库名+题目数量+前3题题干，用于"跨端导入时按内容匹配已有进度"（稳定，不受 bank.id 影响）
export function computeFingerprint(bank) {
  const sample = (bank.questions || []).slice(0, 3)
    .map(q => (q.stem || q.sharedStem || '').substring(0, 50))
    .join('|')
  const text = (bank.name || '') + '|' + (bank.questions?.length || 0) + '|' + sample
  // 简单 DJB2 哈希
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return 'fp_' + h.toString(36)
}

// bankId 改成随机唯一 ID（和内容解耦，编辑题目不会改 ID，跨端 JSON 导入也复用原 ID）
function generateUniqueBankId() {
  const rnd =
    (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return 'b_' + rnd
}

// 兼容旧调用：把 fingerprint 功能单独暴露出来；addBank/import 不再用这个生成 id
export function generateBankId(bank) {
  return computeFingerprint(bank)
}

export async function addBank(bank) {
  if (!bank.id) bank.id = generateUniqueBankId()
  bank.fingerprint = computeFingerprint(bank)
  bank.createdAt = bank.createdAt || new Date().toISOString()
  store.banks.push(bank)
  await saveBanks()
  return bank
}

// 在编辑题库题目/重命名后刷新 fingerprint（供跨端模糊匹配用，bank.id 保持不变）
export function refreshBankFingerprint(bank) {
  if (!bank) return
  bank.fingerprint = computeFingerprint(bank)
}

// 迁移已存在的 bank：给旧题库补上 fingerprint（因为本地已有的 bank 是内容指纹 id，没有 fingerprint 字段）
function ensureBankFingerprints() {
  let changed = false
  for (const b of store.banks) {
    if (!b.fingerprint) {
      b.fingerprint = computeFingerprint(b)
      changed = true
    }
  }
  return changed
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
    refreshBankFingerprint(bank)
    await saveBanks()
  }
}

// 编辑更新某题（题库内按原 index 替换）
export async function updateQuestion(bankId, questionIndex, newQuestion) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[questionIndex]) return
  bank.questions[questionIndex] = { ...bank.questions[questionIndex], ...newQuestion }
  refreshBankFingerprint(bank)
  await saveBanks()
}

// 在指定位置插入新题（index = bank.questions.length 表示末尾）
export async function insertQuestion(bankId, index, question) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank) return
  if (!bank.questions) bank.questions = []
  const i = Math.max(0, Math.min(index, bank.questions.length))
  bank.questions.splice(i, 0, question)
  refreshBankFingerprint(bank)
  await saveBanks()
}

// 删除指定位置的题目
export async function deleteQuestion(bankId, index) {
  const bank = store.banks.find(b => b.id === bankId)
  if (!bank || !bank.questions[index]) return
  bank.questions.splice(index, 1)
  refreshBankFingerprint(bank)
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
  refreshBankFingerprint(bank)
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
    version: 2,
    exportedAt: new Date().toISOString(),
    name: bank.name,
    id: bank.id,              // 保留 bank id，跨端导入复用
    fingerprint: bank.fingerprint || computeFingerprint(bank),
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
      fingerprint: b.fingerprint || computeFingerprint(b),
      source: b.source,
      createdAt: b.createdAt,
      questions: JSON.parse(JSON.stringify(b.questions))
    }))
  }
}

// 导入单个题库 JSON，返回 { action: 'created'|'overwritten'|'renamed'|'matched-progress', bank }
export async function importBankFromJson(data) {
  const newBank = {
    name: data.name || '未命名题库',
    questions: data.questions || [],
    source: data.source || 'json',
    createdAt: data.createdAt || new Date().toISOString()
  }
  // 优先使用 JSON 里的原 id；没有原 id 再生成新的
  if (typeof data.id === 'string' && data.id) {
    newBank.id = data.id
  } else {
    newBank.id = generateUniqueBankId()
  }
  newBank.fingerprint =
    (typeof data.fingerprint === 'string' && data.fingerprint) || computeFingerprint(newBank)

  // 相同 id（JSON 里原 id 已在本地存在）→ 覆盖内容，保留 id 和 进度
  const existingById = store.banks.find(b => b.id === newBank.id)
  if (existingById) {
    existingById.questions = newBank.questions
    if (data.name) existingById.name = newBank.name
    existingById.source = existingById.source || newBank.source
    refreshBankFingerprint(existingById)
    await saveBanks()
    return { action: 'overwritten', bank: existingById }
  }

  // 没有相同 id → 检查 fingerprint 是否相同（旧格式 bank 的 id 可能是 fingerprint 值），同内容覆盖
  const existingByFp = store.banks.find(b => (b.fingerprint || computeFingerprint(b)) === newBank.fingerprint)
  if (existingByFp) {
    // 内容相同 → 直接覆盖题目/名字，保留已有 bank id
    existingByFp.questions = newBank.questions
    if (data.name) existingByFp.name = newBank.name
    existingByFp.source = existingByFp.source || newBank.source
    refreshBankFingerprint(existingByFp)
    await saveBanks()
    return { action: 'overwritten', bank: existingByFp }
  }

  // 本地完全没有 → 新建；检查同名自动改名
  const sameName = store.banks.find(b => b.name === newBank.name)
  if (sameName) newBank.name = newBank.name + '(导入)'
  store.banks.push(newBank)
  refreshBankFingerprint(newBank)

  // ↓↓ 尝试把远程已经同步到本地但 key 是旧 id/fingerprint 的进度/错题 对齐到新 bank
  const migrated = remapProgressAndWrongAfterImport(newBank)
  await saveBanks()
  return {
    action: migrated ? 'matched-progress' : 'created',
    bank: newBank,
    migrated
  }
}

// 当新 bank 导入成功后，如果 progress / wrongQuestions 里存在用该 bank 的 fingerprint 作 key 的记录
// （旧浏览器推送时 key 可能是内容指纹 id 或 fingerprint 本身），则把它搬到新 bank.id 下
function remapProgressAndWrongAfterImport(newBank) {
  let changed = false
  const fp = newBank.fingerprint
  const possibleKeys = new Set([
    fp,                                    // 新格式 fingerprint（'fp_xxx'）
    fp && fp.startsWith('fp_') ? fp.slice(3) : null,   // 去掉 fp_ 前缀
    fp && fp.startsWith('fp_') ? 'bank_' + fp.slice(3) : null  // 旧格式 bank_<hash>
  ])
  possibleKeys.delete(null)
  possibleKeys.delete(newBank.id)  // 已经对得上的不用动

  for (const k of possibleKeys) {
    if (store.progress[k]) {
      if (!store.progress[newBank.id]) {
        store.progress[newBank.id] = store.progress[k]
      }
      delete store.progress[k]
      changed = true
    }
    // 错题本里的 bankId 匹配
    for (const w of store.wrongQuestions) {
      if (w.bankId === k) {
        w.bankId = newBank.id
        changed = true
      }
    }
  }
  if (changed) {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(store.progress))
    // 错题保存
    saveWrongQuestions().catch(() => {})
  }
  return changed
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
