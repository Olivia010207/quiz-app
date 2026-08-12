<script setup>
import { ref, computed } from 'vue'
import { store, syncNow, syncPull } from '../store.js'
import {
  getToken, setToken, getGistId, setGistId, verifyToken, clearSyncConfig,
  isConfigured, findExistingSyncGist
} from '../sync.js'

const tokenInput = ref(getToken())
const gistIdInput = ref(getGistId())
const verifying = ref(false)
const verifyResult = ref(null)
const syncing = ref(false)
const discovering = ref(false)
const message = ref('')

const configured = computed(() => isConfigured())
const syncStatus = computed(() => store.sync.status)
const lastSyncedAt = computed(() => {
  if (!store.sync.lastSyncedAt) return '从未'
  return new Date(store.sync.lastSyncedAt).toLocaleString('zh-CN')
})

async function saveAndVerify() {
  if (!tokenInput.value.trim()) {
    message.value = '请填入 Token'
    return
  }
  verifying.value = true
  message.value = ''
  try {
    const result = await verifyToken(tokenInput.value.trim())
    verifyResult.value = result
    if (result.ok) {
      setToken(tokenInput.value.trim())
      // Token 验证通过后，如果本地没有 gistId，自动尝试发现已有同步 Gist
      if (!gistIdInput.value.trim()) {
        const found = await findExistingSyncGist(tokenInput.value.trim())
        if (found) {
          setGistId(found)
          gistIdInput.value = found
          message.value = `✓ Token 验证通过（用户：${result.username}），已自动绑定 Gist（${found.substring(0, 8)}…）`
        } else {
          message.value = `✓ Token 验证通过（用户：${result.username}），还没发现已有同步 Gist，请点一次"立即推送"初始化`
        }
      } else {
        message.value = `✓ Token 验证通过（用户：${result.username}）`
      }
    } else {
      message.value = `✗ 验证失败：${result.error}`
    }
  } catch (e) {
    message.value = `✗ 错误：${e.message}`
  } finally {
    verifying.value = false
  }
}

function saveGistIdManually() {
  const id = gistIdInput.value.trim()
  if (id) {
    setGistId(id)
    message.value = `✓ Gist ID 已保存（${id.substring(0, 8)}…）`
  } else {
    setGistId('')
    message.value = '已清空 Gist ID'
  }
}

async function discoverGist() {
  if (!tokenInput.value.trim()) {
    message.value = '请先保存并验证 Token'
    return
  }
  discovering.value = true
  message.value = ''
  try {
    const found = await findExistingSyncGist(tokenInput.value.trim())
    if (found) {
      setGistId(found)
      gistIdInput.value = found
      message.value = `✓ 已找到并绑定同步 Gist（${found.substring(0, 8)}…）`
    } else {
      message.value = '没发现已有同步 Gist，请先在旧设备点一次"立即推送"初始化'
    }
  } catch (e) {
    message.value = `✗ 搜索失败：${e.message}`
  } finally {
    discovering.value = false
  }
}

async function pushNow() {
  syncing.value = true
  message.value = ''
  try {
    await syncNow()
    // 推送后同步显示 gistId
    gistIdInput.value = getGistId()
    message.value = '✓ 已推送到 Gist'
  } catch (e) {
    message.value = `✗ 推送失败：${e.message}`
  } finally {
    syncing.value = false
  }
}

async function pullNow() {
  syncing.value = true
  message.value = ''
  try {
    const ok = await syncPull()
    gistIdInput.value = getGistId()
    if (ok) {
      const bc = (store.banks || []).length
      const wp = Object.keys(store.progress || {}).length
      const wc = (store.wrongQuestions || []).length
      message.value = `✓ 已拉取并合并（题库 ${bc} 个，进度 ${wp} 个，错题 ${wc} 道）`
    } else {
      message.value = store.sync.error ? `✗ 拉取失败：${store.sync.error}` : '✗ 拉取失败'
    }
  } catch (e) {
    message.value = `✗ 拉取失败：${e.message}`
  } finally {
    syncing.value = false
  }
}

function disconnect() {
  if (!confirm('确认断开同步？本地 Token 和 Gist ID 会被清除（远程数据保留）。')) return
  clearSyncConfig()
  setToken('')
  tokenInput.value = ''
  setGistId('')
  gistIdInput.value = ''
  verifyResult.value = null
  message.value = '已断开同步'
}
</script>

<template>
  <div class="settings">
    <!-- 状态卡片 -->
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="margin-bottom:8px">
        <span>同步状态</span>
        <span :class="['badge', `badge-${syncStatus}`]">
          {{ syncStatus === 'idle' ? '未启用'
             : syncStatus === 'syncing' ? '同步中…'
             : syncStatus === 'success' ? '已同步'
             : '同步失败' }}
        </span>
      </div>
      <div class="row" style="font-size:13px;color:var(--text-3)">
        <span>上次同步</span>
        <span>{{ lastSyncedAt }}</span>
      </div>
      <div v-if="gistIdInput" class="row" style="font-size:12px;color:var(--text-3);margin-top:6px">
        <span>Gist ID</span>
        <code>{{ (gistIdInput || '（空）').substring(0, 12) }}{{ gistIdInput && gistIdInput.length > 12 ? '…' : '' }}</code>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div v-if="configured" class="card" style="margin-bottom:16px">
      <div class="row">
        <button class="btn" :disabled="syncing" @click="pushNow">
          {{ syncing ? '处理中…' : '立即推送' }}
        </button>
        <button class="btn btn-ghost" :disabled="syncing" @click="pullNow">从远程拉取</button>
      </div>
      <button class="btn btn-danger btn-block" style="margin-top:8px" @click="disconnect">
        断开同步
      </button>
    </div>

    <!-- Gist ID 手动绑定 -->
    <div v-if="configured" class="card" style="margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px">Gist ID（可选，自动发现失败时手动填入）</div>
      <p style="font-size:13px;color:var(--text-3);margin-bottom:8px">
        如果新设备填入 Token 后仍无法拉取：从旧设备设置页复制 Gist ID 粘到这里。
      </p>
      <div class="gist-input-row">
        <input
          v-model="gistIdInput"
          placeholder="粘贴 Gist ID（形如 abc123def456…）"
          class="gist-input"
        />
        <button class="btn btn-ghost btn-sm" @click="saveGistIdManually">保存</button>
      </div>
      <button
        class="btn btn-block"
        style="margin-top:8px"
        :disabled="discovering || !configured"
        @click="discoverGist"
      >
        {{ discovering ? '扫描中…' : '🔎 自动扫描并绑定已有 Gist' }}
      </button>
    </div>

    <!-- Token 配置 -->
    <div class="card">
      <div style="font-weight:600;margin-bottom:8px">GitHub Token 配置</div>
      <p style="font-size:13px;color:var(--text-3);margin-bottom:12px">
        在 GitHub Settings → Developer settings → Personal access tokens 生成 Token，
        只需勾选 <code>gist</code> 权限。Token 仅保存在本地浏览器。
      </p>
      <textarea
        v-model="tokenInput"
        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
        rows="2"
        style="width:100%;font-family:monospace;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:6px;resize:vertical"
      />
      <button class="btn btn-block" style="margin-top:8px" :disabled="verifying" @click="saveAndVerify">
        {{ verifying ? '验证中…' : '保存并验证' }}
      </button>
    </div>

    <div v-if="message" class="msg" :class="{ 'msg-error': message.startsWith('✗') }">
      {{ message }}
    </div>

    <!-- 说明 -->
    <div class="hint">
      <div style="font-weight:600;margin-bottom:4px">同步说明</div>
      <ul>
        <li>同步<b>题库</b>、<b>做题进度</b>和<b>错题</b>到 GitHub Gist（3 个文件）</li>
        <li>换设备步骤：①填 Token 并验证 → ②点"从远程拉取"（题库会自动同步过来）</li>
        <li>离开做题页 / 切换标签 / 关闭页面时自动推送</li>
        <li>打开应用时自动拉取远程数据并合并</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.settings { max-width: 600px; margin: 0 auto; }
.row { display:flex; justify-content:space-between; align-items:center; gap: 8px; flex-wrap: wrap; }
.badge { padding:2px 8px; border-radius:10px; font-size:12px; }
.badge-idle { background: var(--bg-2, #eee); color: var(--text-3, #999); }
.badge-syncing { background: #fff3cd; color: #856404; }
.badge-success { background: #d4edda; color: #155724; }
.badge-error { background: #f8d7da; color: #721c24; }
.btn-block { width: 100%; }
.btn-sm { padding: 6px 12px; font-size: 13px; }
.msg { margin-top: 12px; padding: 10px; background: #d4edda; color: #155724; border-radius: 6px; font-size: 14px; }
.msg-error { background: #f8d7da; color: #721c24; }
.hint { margin-top: 16px; padding: 12px; background: var(--bg-2, #f6f6f6); border-radius: 6px; font-size: 13px; color: var(--text-2, #666); }
.hint ul { margin: 4px 0 0; padding-left: 20px; }
.hint li { margin: 4px 0; }
code { background: var(--bg-2, #f0f0f0); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.gist-input-row { display: flex; gap: 6px; }
.gist-input {
  flex: 1;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: monospace;
  font-size: 13px;
}
</style>
