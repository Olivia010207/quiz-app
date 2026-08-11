<script setup>
import { ref } from 'vue'
import {
  store, deleteBank, countQuestions, wrongCount, openWrongBook,
  exportBankToJson, exportAllBanksToJson, openManageView
} from '../store.js'

// 每个题库的菜单开关：bankId -> boolean
const openMenus = ref({})

function toggleMenu(bankId, e) {
  e.stopPropagation()
  openMenus.value = { [bankId]: !openMenus.value[bankId] }
}

function closeMenus() {
  openMenus.value = {}
}

function startQuiz(bank) {
  closeMenus()
  store.currentBank = bank
  store.view = 'quiz'
}

function remove(bank) {
  closeMenus()
  if (confirm(`确认删除题库「${bank.name}」？`)) {
    deleteBank(bank.id)
  }
}

function openWb(bank, e) {
  e.stopPropagation()
  closeMenus()
  openWrongBook(bank.id)
}

function manageBank(bank, e) {
  e.stopPropagation()
  closeMenus()
  openManageView(bank.id)
}

function fmtDate(s) {
  return new Date(s).toLocaleDateString('zh-CN')
}

// 导出单个题库为 JSON 文件
function exportOne(bank, e) {
  e.stopPropagation()
  closeMenus()
  const data = exportBankToJson(bank.id)
  if (!data) return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${bank.name}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 导出全部题库为单个 JSON 文件
function exportAll() {
  if (store.banks.length === 0) return
  const data = exportAllBanksToJson()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `题库备份-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 跳到导入页的 JSON 模式
function goImportJson() {
  store.view = 'import'
  store._importMode = 'json'
}
</script>

<template>
  <div v-if="store.banks.length === 0" class="empty">
    <div class="icon">📝</div>
    <div>还没有题库，点击右上角"导入"开始</div>
  </div>

  <div v-else>
    <!-- 顶部工具条：批量导出 / JSON 导入 -->
    <div class="toolbar">
      <button class="btn btn-sm btn-ghost" @click="exportAll">⬇ 导出全部</button>
      <button class="btn btn-sm btn-ghost" @click="goImportJson">⬆ 从 JSON 导入</button>
    </div>

    <div v-for="bank in store.banks" :key="bank.id" class="card bank-item">
      <div class="info" @click="startQuiz(bank)">
        <div class="name">{{ bank.name }}</div>
        <div class="meta">
          {{ countQuestions(bank) }} 题 · {{ bank.source === 'word' ? 'Word' : (bank.source === 'excel' ? 'Excel' : (bank.source === 'json' ? 'JSON' : '导入')) }} · {{ fmtDate(bank.createdAt) }}
          <template v-if="wrongCount(bank.id) > 0">
            · <span class="wrong-meta" @click.stop="openWb(bank, $event)">📖 {{ wrongCount(bank.id) }} 道错题</span>
          </template>
        </div>
      </div>
      <div class="ops">
        <button
          v-if="wrongCount(bank.id) > 0"
          class="btn btn-sm btn-ghost"
          title="查看错题"
          @click="openWb(bank, $event)"
        >错题</button>
        <button class="btn btn-sm" @click="startQuiz(bank)">开始</button>
        <div class="menu-wrap">
          <button class="btn btn-sm btn-ghost" @click="toggleMenu(bank.id, $event)">⋯</button>
          <div v-if="openMenus[bank.id]" class="menu">
            <div class="menu-item" @click="manageBank(bank, $event)">⚙ 管理题目</div>
            <div class="menu-item" @click="exportOne(bank, $event)">⬇ 导出 JSON</div>
            <div class="menu-item danger" @click="remove(bank)">🗑 删除题库</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bank-item .info { cursor: pointer; }
.wrong-meta {
  color: var(--primary);
  cursor: pointer;
  text-decoration: underline;
}
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.menu-wrap {
  position: relative;
}
.menu {
  position: absolute;
  right: 0;
  top: 100%;
  margin-top: 4px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 12px rgba(0,0,0,0.12);
  min-width: 140px;
  z-index: 20;
  overflow: hidden;
}
.menu-item {
  padding: 8px 14px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}
.menu-item:hover { background: var(--bg); }
.menu-item.danger { color: var(--danger); }
.menu-item.danger:hover { background: #ffece8; }
</style>
