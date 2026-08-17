<script setup>
import { computed, onBeforeUnmount } from 'vue'
import {
  store, getWrongList, startWrongPractice,
  removeWrongQuestionByFilteredIndex, clearWrongQuestions, syncNow,
  resolveWrongQuestion
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

// 每条错题从题库里取最新题目（找不到为 null）
const hydrated = computed(() => filtered.value.map(w => ({
  ...w,
  liveQuestion: resolveWrongQuestion(w)
})))

function shortKey(key) {
  if (!key) return ''
  const s = key.startsWith('__group__|') ? key.split('|').slice(-1)[0] : key
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

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
      v-for="(item, i) in hydrated"
      :key="i"
      class="question"
      style="margin-bottom:8px"
    >
      <!-- 失效卡：题库里找不到这道题（删了 or 题干改了） -->
      <template v-if="!item.liveQuestion">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span class="q-type" style="background:var(--surface-2);color:var(--text-3);border:1px dashed var(--border)">失效</span>
          <span style="font-size:12px;color:var(--text-3)">{{ item.bankName || '（题库已删除）' }}</span>
          <button class="btn btn-sm btn-danger" style="margin-left:auto" @click="remove(i)">移除</button>
        </div>
        <div class="q-stem" style="color:var(--text-3)">
          该题已从题库删除或修改，无法显示。可能原因：题干文字改了、题目删了、所属题库删了。可直接移除。
          <div style="margin-top:6px;font-size:12px;color:var(--text-3)">题干摘要：{{ shortKey(item.stemKey) }}</div>
        </div>
      </template>

      <!-- 正常错题：来自题库的最新版本 -->
      <template v-else>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span class="q-type">{{ TYPE_LABEL[item.liveQuestion.type] || '题' }}</span>
          <span style="font-size:12px;color:var(--text-3)">{{ item.bankName }}</span>
          <button class="btn btn-sm btn-danger" style="margin-left:auto" @click="remove(i)">移除</button>
        </div>

        <!-- 案例题显示材料（子题带 sharedStem 时展示） -->
        <div v-if="item.liveQuestion.sharedStem && item.liveQuestion.subQuestionIndex != null" class="group-material" style="margin-bottom:8px">
          <div class="tag">案例材料</div>
          <div v-html="item.liveQuestion.sharedStem"></div>
        </div>

        <!-- 题干 -->
        <div class="q-stem" v-html="item.liveQuestion.stem || item.liveQuestion.sharedStem"></div>

        <!-- 选项 -->
        <div v-if="item.liveQuestion.options" class="q-options">
          <div
            v-for="opt in item.liveQuestion.options"
            :key="opt.key"
            class="opt"
            :class="{ correct: item.liveQuestion.answer && item.liveQuestion.answer.includes(opt.key) }"
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
            {{ item.liveQuestion.type === 'blank'
              ? (item.liveQuestion.blanks || []).join(' / ')
              : item.liveQuestion.answer }}
          </span>
        </div>
      </template>
    </div>
  </div>
</template>
