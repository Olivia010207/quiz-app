<script setup>
import { ref, computed } from 'vue'
import { store, syncNow, syncPull } from '../store.js'
import {
  getToken, setToken, getGistId, verifyToken, clearSyncConfig, isConfigured
} from '../sync.js'

const tokenInput = ref(getToken())
const gistId = ref(getGistId())
const verifying = ref(false)
const verifyResult = ref(null)
const syncing = ref(false)
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
      message.value = `✓ Token 验证通过（用户：${result.username}）`
    } else {
      message.value = `✗ 验证失败：${result.error}`
    }
  } catch (e) {
    message.value = `✗ 错误：${e.message}`
  } finally {
    verifying.value = false
  }
}

async function pushNow() {
  syncing.value = true
  message.value = ''
  try {
    await syncNow()
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
    message.value = ok ? '✓ 已从 Gist 拉取并合并' : '✗ 拉取失败'
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
  gistId.value = ''
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
      <div v-if="gistId" class="row" style="font-size:12px;color:var(--text-3)">
        <span>Gist ID</span>
        <code>{{ gistId.substring(0, 12) }}…</code>
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
        <li>仅同步<b>错题</b>和<b>做题进度</b>，题库保持本地</li>
        <li>做题/答错后 2 秒自动推送到 GitHub Gist</li>
        <li>打开应用时自动拉取远程数据并合并</li>
        <li>换设备时：先在新设备配置 Token，再点"从远程拉取"</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.settings { max-width: 600px; margin: 0 auto; }
.row { display:flex; justify-content:space-between; align-items:center; }
.badge { padding:2px 8px; border-radius:10px; font-size:12px; }
.badge-idle { background: var(--bg-2, #eee); color: var(--text-3, #999); }
.badge-syncing { background: #fff3cd; color: #856404; }
.badge-success { background: #d4edda; color: #155724; }
.badge-error { background: #f8d7da; color: #721c24; }
.btn-block { width: 100%; }
.msg { margin-top: 12px; padding: 10px; background: #d4edda; color: #155724; border-radius: 6px; font-size: 14px; }
.msg-error { background: #f8d7da; color: #721c24; }
.hint { margin-top: 16px; padding: 12px; background: var(--bg-2, #f6f6f6); border-radius: 6px; font-size: 13px; color: var(--text-2, #666); }
.hint ul { margin: 4px 0 0; padding-left: 20px; }
.hint li { margin: 4px 0; }
code { background: var(--bg-2, #f0f0f0); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
</style>
