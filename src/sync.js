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

// 上传数据到 Gist（若没 gistId 则创建，否则更新）
export async function pushData(payload) {
  const token = getToken()
  if (!token) throw new Error('未配置 Token')

  const content = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    ...payload
  }, null, 2)

  const gistId = getGistId()
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
  return { gistId: data.id, updatedAt: new Date().toISOString() }
}

// 从 Gist 拉取数据
export async function pullData() {
  const token = getToken()
  const gistId = getGistId()
  if (!token) throw new Error('未配置 Token')
  if (!gistId) throw new Error('尚未创建同步数据（请先推送一次）')

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
