// GitHub Gist 同步：同步题库 + 进度 + 错题（3 个文件）
const TOKEN_KEY = 'gist-token'
const GIST_ID_KEY = 'gist-id'
const API = 'https://api.github.com/gists'

const FILE_BANKS = 'banks.json'
const FILE_PROGRESS = 'progress.json'
const FILE_WRONG = 'wrong-questions.json'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || ''
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token.trim())
  else localStorage.removeItem(TOKEN_KEY)
}

export function getGistId() {
  return localStorage.getItem(GIST_ID_KEY) || ''
}

export function setGistId(id) {
  if (id) localStorage.setItem(GIST_ID_KEY, id.trim())
  else localStorage.removeItem(GIST_ID_KEY)
}

export function isConfigured() {
  return !!getToken()
}

export async function verifyToken(token) {
  try {
    const resp = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` }
    const data = await resp.json()
    return { ok: true, username: data.login }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// 扫描用户的 Gists，找到已有的同步 Gist
export async function findExistingSyncGist(tokenOverride) {
  const token = tokenOverride || getToken()
  if (!token) return null
  try {
    const resp = await fetch(`${API}?per_page=100`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!resp.ok) return null
    const list = await resp.json()
    if (!Array.isArray(list)) return null
    for (const g of list) {
      if (g.files && (g.files[FILE_BANKS] || g.files['quiz-sync.json'])) return g.id
      if (g.description && g.description.includes('Quiz sync data')) return g.id
    }
    return null
  } catch (e) {
    return null
  }
}

// 上传数据到 Gist（3 个文件）
export async function pushData(payload) {
  const token = getToken()
  if (!token) throw new Error('未配置 Token')

  const updatedAt = new Date().toISOString()

  let gistId = getGistId()
  if (!gistId) {
    const found = await findExistingSyncGist(token)
    if (found) {
      gistId = found
      setGistId(found)
    }
  }

  const body = {
    description: 'Quiz sync data (banks + progress + wrong questions)',
    files: {
      [FILE_BANKS]: { content: JSON.stringify({ updatedAt, banks: payload.banks }, null, 2) },
      [FILE_PROGRESS]: { content: JSON.stringify({ updatedAt, progress: payload.progress }, null, 2) },
      [FILE_WRONG]: { content: JSON.stringify({ updatedAt, wrongQuestions: payload.wrongQuestions }, null, 2) }
    }
  }

  const resp = await fetch(gistId ? `${API}/${gistId}` : API, {
    method: gistId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`同步失败 (HTTP ${resp.status}): ${text.substring(0, 200)}`)
  }

  const data = await resp.json()
  if (!gistId && data.id) setGistId(data.id)
  return { gistId: data.id || gistId, updatedAt }
}

// 从 Gist 拉取数据（3 个文件）
export async function pullData() {
  const token = getToken()
  if (!token) throw new Error('未配置 Token')

  let gistId = getGistId()
  if (!gistId) {
    const found = await findExistingSyncGist(token)
    if (!found) throw new Error('找不到同步数据（请在旧设备先点一次"立即推送"，或手动填入 Gist ID）')
    gistId = found
    setGistId(found)
  }

  const resp = await fetch(`${API}/${gistId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!resp.ok) throw new Error(`拉取失败 (HTTP ${resp.status})`)

  const data = await resp.json()
  const result = { banks: [], progress: {}, wrongQuestions: [] }

  const banksFile = data.files && data.files[FILE_BANKS]
  if (banksFile) {
    const parsed = JSON.parse(banksFile.content)
    result.banks = parsed.banks || []
    result.updatedAt = parsed.updatedAt
  }

  const progressFile = data.files && data.files[FILE_PROGRESS]
  if (progressFile) {
    result.progress = JSON.parse(progressFile.content).progress || {}
  }

  const wrongFile = data.files && data.files[FILE_WRONG]
  if (wrongFile) {
    result.wrongQuestions = JSON.parse(wrongFile.content).wrongQuestions || []
  }

  return result
}

export function clearSyncConfig() {
  localStorage.removeItem(GIST_ID_KEY)
}
