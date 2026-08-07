<script setup>
import { computed, onBeforeUnmount } from 'vue'
import {
  store, getWrongList, startWrongPractice,
  removeWrongQuestionByFilteredIndex, clearWrongQuestions, syncNow
} from '../store.js'

const TYPE_LABEL = {
  single: '单选', multi: '多选', judge: '判断', blank: '填空', group: '案例'
}

const bankId = computed(() => store.currentWrongBankId)

const title = computed(() => {
  if (bankId.value) {
    const b = store.banks.find(x => x.id === bankId.value)
    return b ? `${b.name} · 错题本` : '错题本'
  }
  return '全部错题'
})

const filtered = computed(() => getWrongList())

function remove(index) {
  removeWrongQuestionByFilteredIndex(index)
}

function clearAll() {
  if (filtered.value.length === 0) return
  if (confirm(`确认清空 ${filtered.value.length} 道错题？`)) {
    clearWrongQuestions(bankId.value || null)
  }
}

function practice() {
  startWrongPractice(bankId.value || null)
}

// 离开错题本时自动同步（删除/清空操作可能改动了错题）
onBeforeUnmount(() => {
  syncNow()
})
</script>

<template>
  <div v-if="filtered.length === 0" class="empty">
    <div class="icon">✅</div>
    <div>{{ bankId ? '该题库' : '当前' }}暂无错题，做题时答错的题会自动收录到这里</div>
  </div>

  <div v-else>
    <div class="preview-bar">
      <span class="count">共 {{ filtered.length }} 道错题 · {{ title }}</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-ghost" @click="clearAll">清空</button>
        <button class="btn btn-sm" @click="practice">错题练习</button>
      </div>
    </div>

    <div
      v-for="(item, i) in filtered"
      :key="i"
      class="question"
      style="margin-bottom:8px"
    >
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span class="q-type">{{ TYPE_LABEL[item.question.type] || '题' }}</span>
        <span style="font-size:12px;color:var(--text-3)">{{ item.bankName }}</span>
        <button class="btn btn-sm btn-danger" style="margin-left:auto" @click="remove(i)">移除</button>
      </div>

      <!-- 案例题显示材料 -->
      <div v-if="item.question.type === 'group'" class="group-material" style="margin-bottom:8px">
        <div class="tag">案例材料</div>
        <div v-html="item.question.sharedStem"></div>
      </div>

      <!-- 题干 -->
      <div class="q-stem" v-html="item.question.stem || item.question.sharedStem"></div>

      <!-- 选项 -->
      <div v-if="item.question.options" class="q-options">
        <div
          v-for="opt in item.question.options"
          :key="opt.key"
          class="opt"
          :class="{ correct: item.question.answer && item.question.answer.includes(opt.key) }"
          style="cursor:default"
        >
          <span class="key">{{ opt.key }}.</span>
          <span class="label" v-html="opt.label"></span>
        </div>
      </div>

      <!-- 答案 -->
      <div class="q-answer">
        <span class="label">正确答案：</span>
        <span class="value">
          {{ item.question.type === 'blank'
            ? (item.question.blanks || []).join(' / ')
            : item.question.answer }}
        </span>
      </div>
    </div>
  </div>
</template>
