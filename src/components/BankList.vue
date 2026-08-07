<script setup>
import {
  store, deleteBank, countQuestions, wrongCount, openWrongBook
} from '../store.js'

function startQuiz(bank) {
  store.currentBank = bank
  store.view = 'quiz'
}

function remove(bank) {
  if (confirm(`确认删除题库「${bank.name}」？`)) {
    deleteBank(bank.id)
  }
}

function openWb(bank, e) {
  e.stopPropagation()
  openWrongBook(bank.id)
}

function fmtDate(s) {
  return new Date(s).toLocaleDateString('zh-CN')
}
</script>

<template>
  <div v-if="store.banks.length === 0" class="empty">
    <div class="icon">📝</div>
    <div>还没有题库，点击右上角"导入"开始</div>
  </div>

  <div v-else>
    <div v-for="bank in store.banks" :key="bank.id" class="card bank-item">
      <div class="info" @click="startQuiz(bank)">
        <div class="name">{{ bank.name }}</div>
        <div class="meta">
          {{ countQuestions(bank) }} 题 · {{ bank.source === 'word' ? 'Word' : 'Excel' }} · {{ fmtDate(bank.createdAt) }}
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
        <button class="btn btn-sm btn-danger" @click="remove(bank)">删除</button>
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
</style>
