// GitHub Gist 同步：只同步错题 + 进度（题库保持本地）
// 配置存在 localStorage，Gist 内容为 JSON

const TOKEN_KEY = 'gist-token'
const GIST_ID_KEY = 'gist-id'
const GIST_FILENAME = 'quiz-sync.json'
const API = 'https://api.github.com/gists'

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

// 验证 token 是否有效，返回 { ok, username, scope }
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

// 当本地没有 gistId 时：扫描用户的公开 Gists，找到 description/filename 匹配的
// 返回 gistId 或 null
export async function findExistingSyncGist(tokenOverride) {
  const token = tokenOverride || getToken()
  if (!token) return null
  try {
    // 每页最多 100 条，通常够用
    const resp = await fetch(`${API}?per_page=100`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!resp.ok) return null
    const list = await resp.json()
    if (!Array.isArray(list)) return null
    for (const g of list) {
      if (g.files && g.files[GIST_FILENAME]) return g.id
      if (g.description && g.description.includes('Quiz sync data')) return g.id
    }
    return null
  } catch (e) {
    return null
  }
}

// 上传数据到 Gist（若没 gistId 则创建，否则更新）
export async function pushData(payload) {
  const token = getToken()
  if (!token) throw new Error('未配置 Token')

  const content = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    ...payload
  }, null, 2)

  // 本地没 gistId 时先尝试找已有同步 Gist，避免多设备创建多个重复 Gist
  let gistId = getGistId()
  if (!gistId) {
    const found = await findExistingSyncGist(token)
    if (found) {
      gistId = found
      setGistId(found)
    }
  }

  const body = {
    description: 'Quiz sync data (progress + wrong questions)',
    files: { [GIST_FILENAME]: { content } }
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
  // 新建的 gist 记下 id，下次复用
  if (!gistId && data.id) setGistId(data.id)
  return { gistId: data.id || gistId, updatedAt: new Date().toISOString() }
}

// 从 Gist 拉取数据
export async function pullData() {
  const token = getToken()
  if (!token) throw new Error('未配置 Token')

  let gistId = getGistId()
  // 本地没 gistId 时先尝试扫描用户的 Gists 找到已有的同步 Gist
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
  const file = data.files && data.files[GIST_FILENAME]
  if (!file) throw new Error('Gist 中找不到同步文件')

  return JSON.parse(file.content)
}

// 清除本地 Gist 配置（不删除远程 Gist）
export function clearSyncConfig() {
  localStorage.removeItem(GIST_ID_KEY)
}
