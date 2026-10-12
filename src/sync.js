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

  // 预序列化 + 校验（保证每个文件都是合法 JSON，大小不超限）
  function serialize(label, obj) {
    const str = JSON.stringify(obj, null, 2)
    // 自校验：再 parse 回来确保是合法 JSON
    try { JSON.parse(str) } catch (e) {
      throw new Error(`${label} 序列化后不是合法 JSON: ${e.message}`)
    }
    // Gist 单文件上限约 1MB，超过则告警（不阻止，GitHub 会自己拒绝）
    if (str.length > 950000) {
      console.warn(`${label} 大小 ${(str.length / 1024).toFixed(1)}KB 接近 Gist 1MB 上限`)
    }
    return str
  }

  const banksContent = serialize('banks.json', { updatedAt, banks: payload.banks })
  const progressContent = serialize('progress.json', { updatedAt, progress: payload.progress })
  const wrongContent = serialize('wrong-questions.json', { updatedAt, wrongQuestions: payload.wrongQuestions })

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
      [FILE_BANKS]: { content: banksContent },
      [FILE_PROGRESS]: { content: progressContent },
      [FILE_WRONG]: { content: wrongContent }
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

  // 拉取单个文件内容，处理 GitHub 对大文件的 inline content 截断
  async function fetchFileContent(file) {
    if (!file) return null
    // 如果 GitHub 标记了 truncated，或者 content 看起来不够用（长度和 size 不匹配），走 raw_url
    if (file.truncated || (file.size != null && file.content && file.content.length < file.size)) {
      try {
        const rawResp = await fetch(file.raw_url)
        if (rawResp.ok) return await rawResp.text()
      } catch (e) {
        console.warn('raw_url fetch failed, falling back to inline content:', e.message)
      }
    }
    return file.content || null
  }

  function safeParse(content) {
    if (!content || typeof content !== 'string') return null
    try {
      return JSON.parse(content)
    } catch (e) {
      console.warn('JSON parse failed:', e.message)
      return null
    }
  }

  // 题库文件
  const banksFile = data.files && data.files[FILE_BANKS]
  if (banksFile) {
    const content = await fetchFileContent(banksFile)
    const parsed = safeParse(content)
    if (!parsed && content) {
      throw new Error('云端题库数据已损坏（JSON 不完整，可能是之前推送被中断）。请在数据完好的设备上点「立即推送」覆盖修复后，再在本设备拉取')
    }
    if (parsed) {
      result.banks = parsed.banks || []
      result.updatedAt = parsed.updatedAt
    }
  }

  // 进度文件
  const progressFile = data.files && data.files[FILE_PROGRESS]
  if (progressFile) {
    const content = await fetchFileContent(progressFile)
    const parsed = safeParse(content)
    if (parsed) result.progress = parsed.progress || {}
  }

  // 错题文件
  const wrongFile = data.files && data.files[FILE_WRONG]
  if (wrongFile) {
    const content = await fetchFileContent(wrongFile)
    const parsed = safeParse(content)
    if (parsed) result.wrongQuestions = parsed.wrongQuestions || []
  }

  return result
}

export function clearSyncConfig() {
  localStorage.removeItem(GIST_ID_KEY)
}
