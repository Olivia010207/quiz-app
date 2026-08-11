<script setup>
import { computed } from 'vue'
import { store } from './store.js'
import BankList from './components/BankList.vue'
import ImportPage from './components/ImportPage.vue'
import QuizPage from './components/QuizPage.vue'
import WrongBook from './components/WrongBook.vue'
import Settings from './components/Settings.vue'
import BankManage from './components/BankManage.vue'

const view = computed(() => store.view)
const title = computed(() => {
  if (view.value === 'import') return '导入题库'
  if (view.value === 'quiz') return store.currentBank?.name || '刷题'
  if (view.value === 'settings') return '设置'
  if (view.value === 'manage') {
    const b = store.banks.find(x => x.id === store.currentManageBankId)
    return b ? `${b.name} · 题目管理` : '题目管理'
  }
  if (view.value === 'wrongbook') {
    if (store.currentWrongBankId) {
      const b = store.banks.find(x => x.id === store.currentWrongBankId)
      return b ? `${b.name} · 错题本` : '错题本'
    }
    return '错题本'
  }
  return '我的题库'
})

function goList() {
  store.view = 'list'
  store.currentBank = null
  store.currentManageBankId = null
}
</script>

<template>
  <div class="navbar">
    <span
      v-if="view !== 'list'"
      class="back"
      @click="goList"
    >‹ 返回</span>
    <span v-else></span>
    <span class="title">{{ title }}</span>
    <span v-if="view === 'list'" class="actions">
      <span
        class="action"
        :class="{ 'sync-on': store.sync.status === 'success', 'sync-err': store.sync.status === 'error' }"
        title="设置"
        @click="store.view = 'settings'"
      >⚙</span>
      <span class="action" @click="store.view = 'import'">+ 导入</span>
    </span>
    <span v-else></span>
  </div>

  <main class="main">
    <div v-if="store.loading" class="empty">加载中...</div>
    <BankList v-else-if="view === 'list'" />
    <ImportPage v-else-if="view === 'import'" />
    <QuizPage v-else-if="view === 'quiz'" />
    <WrongBook v-else-if="view === 'wrongbook'" />
    <Settings v-else-if="view === 'settings'" />
    <BankManage v-else-if="view === 'manage'" />
  </main>
</template>
