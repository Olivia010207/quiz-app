<script setup>
import { ref, computed } from 'vue'
import {
  store, insertQuestion, deleteQuestion, moveQuestion
} from '../store.js'
import QuestionEditor from './QuestionEditor.vue'

const TYPE_LABEL = {
  single: '单选', multi: '多选', judge: '判断', blank: '填空', group: '案例'
}

const TYPE_COLOR = {
  single: 'tag-single',
  multi: 'tag-multi',
  judge: 'tag-judge',
  blank: 'tag-blank',
  group: 'tag-group'
}

const TYPES = [
  { key: 'single', label: '单选题' },
  { key: 'multi', label: '多选题' },
  { key: 'judge', label: '判断题' },
  { key: 'blank', label: '填空题' },
  { key: 'group', label: '案例题' }
]

const bank = computed(() =>
  store.banks.find(b => b.id === store.currentManageBankId)
)

const questions = computed(() => bank.value?.questions || [])

// 编辑器状态
const showEditor = ref(false)
const editorProps = ref(null) // { isNew, index, question }

// 题型选择弹窗状态
const showTypePicker = ref(false)
const insertIndex = ref(0) // 插入目标位置

function goBack() {
  store.view = 'list'
  store.currentManageBankId = null
}

// 题干截断显示
function truncateStem(q) {
  const text = q.type === 'group' ? (q.sharedStem || '') : (q.stem || '')
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 80 ? clean.slice(0, 80) + '…' : clean
}

// 摘要信息：选项数/子题数
function summary(q) {
  if (q.type === 'group') {
    const n = q.questions?.length || 0
    return `${n} 个子题`
  }
  if (q.type === 'blank') {
    const n = q.blanks?.length || 0
    return `${n} 个空`
  }
  if (q.type === 'judge') return '判断'
  const n = q.options?.length || 0
  return `${n} 个选项`
}

// ---------- 编辑 ----------
function editQuestion(idx) {
  const q = questions.value[idx]
  editorProps.value = {
    isNew: false,
    index: idx,
    question: JSON.parse(JSON.stringify(q))
  }
  showEditor.value = true
}

// ---------- 添加 / 插入：先弹题型选择 ----------
function openTypePickerForAppend() {
  insertIndex.value = questions.value.length
  showTypePicker.value = true
}

function openTypePickerForInsert(idx) {
  insertIndex.value = idx
  showTypePicker.value = true
}

function pickType(type) {
  showTypePicker.value = false
  // 构造空题
  const empty = makeEmptyQuestion(type)
  editorProps.value = {
    isNew: true,
    index: insertIndex.value,
    question: empty
  }
  showEditor.value = true
}

function makeEmptyQuestion(type) {
  const base = { type, analysis: '' }
  if (type === 'group') {
    return { ...base, sharedStem: '', questions: [] }
  }
  if (type === 'blank') {
    return { ...base, stem: '', blanks: [''] }
  }
  if (type === 'judge') {
    return { ...base, stem: '', answer: '正确' }
  }
  // single / multi
  return {
    ...base,
    stem: '',
    answer: '',
    options: [
      { key: 'A', label: '' },
      { key: 'B', label: '' },
      { key: 'C', label: '' },
      { key: 'D', label: '' }
    ]
  }
}

// ---------- 编辑器事件 ----------
async function onCreate(newQuestion) {
  if (!bank.value) return
  await insertQuestion(bank.value.id, editorProps.value.index, newQuestion)
}

async function onSaved() {
  // updateQuestion 已在 QuestionEditor 内执行
}

function onEditorClose() {
  showEditor.value = false
  editorProps.value = null
}

// ---------- 删除 / 移动 ----------
function removeQuestion(idx) {
  const q = questions.value[idx]
  const preview = truncateStem(q)
  if (!confirm(`确认删除第 ${idx + 1} 题？\n\n${preview}`)) return
  deleteQuestion(bank.value.id, idx)
}

function moveUp(idx) {
  if (idx === 0) return
  moveQuestion(bank.value.id, idx, -1)
}

function moveDown(idx) {
  if (idx === questions.value.length - 1) return
  moveQuestion(bank.value.id, idx, +1)
}
</script>

<template>
  <div class="manage-wrap">
    <div v-if="!bank" class="empty">题库不存在</div>
    <template v-else>
      <!-- 顶部操作栏 -->
      <div class="manage-toolbar">
        <button class="btn btn-ghost" @click="goBack">‹ 返回列表</button>
        <button class="btn" @click="openTypePickerForAppend">+ 添加题目</button>
      </div>

      <div v-if="questions.length === 0" class="empty">
        <div>题库还没有题目</div>
        <button class="btn" style="margin-top:12px" @click="openTypePickerForAppend">+ 添加第一道题</button>
      </div>

      <div v-else class="q-list">
        <template v-for="(q, idx) in questions" :key="idx">
          <!-- 题前插入按钮 -->
          <button
            v-if="idx === 0 || idx > 0"
            class="insert-btn"
            @click="openTypePickerForInsert(idx)"
          >+ 在此插入</button>

          <div class="q-card">
            <div class="q-head">
              <span class="q-index">第 {{ idx + 1 }} 题</span>
              <span class="tag" :class="TYPE_COLOR[q.type]">{{ TYPE_LABEL[q.type] }}</span>
              <span class="q-summary">{{ summary(q) }}</span>
            </div>
            <div class="q-stem">{{ truncateStem(q) }}</div>
            <div class="q-ops">
              <button class="btn btn-sm btn-ghost" :disabled="idx === 0" @click="moveUp(idx)">↑ 上移</button>
              <button class="btn btn-sm btn-ghost" :disabled="idx === questions.length - 1" @click="moveDown(idx)">↓ 下移</button>
              <button class="btn btn-sm" @click="editQuestion(idx)">✎ 编辑</button>
              <button class="btn btn-sm btn-danger" @click="removeQuestion(idx)">🗑 删除</button>
            </div>
          </div>
        </template>

        <!-- 末尾插入按钮 -->
        <button class="insert-btn insert-btn-last" @click="openTypePickerForAppend">
          + 添加到末尾
        </button>
      </div>
    </template>

    <!-- 题型选择弹窗 -->
    <div v-if="showTypePicker" class="picker-overlay" @click.self="showTypePicker = false">
      <div class="picker-modal">
        <div class="picker-header">
          <span>选择题型</span>
          <button class="close-btn" @click="showTypePicker = false">×</button>
        </div>
        <div class="picker-body">
          <button
            v-for="t in TYPES"
            :key="t.key"
            class="type-btn"
            @click="pickType(t.key)"
          >{{ t.label }}</button>
        </div>
      </div>
    </div>

    <!-- 题目编辑器 -->
    <QuestionEditor
      v-if="showEditor && editorProps && bank"
      :bank-id="bank.id"
      :question="editorProps.question"
      :index="editorProps.index"
      :is-new="editorProps.isNew"
      @close="onEditorClose"
      @saved="onSaved"
      @create="onCreate"
    />
  </div>
</template>

<style scoped>
.manage-wrap { padding-bottom: 24px; }

.manage-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  gap: 8px;
}

.q-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.insert-btn {
  align-self: center;
  background: none;
  border: 1px dashed var(--border);
  color: var(--primary);
  padding: 6px 16px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}
.insert-btn:hover {
  background: var(--primary-bg);
  border-color: var(--primary);
}
.insert-btn-last {
  margin-top: 4px;
  padding: 8px 24px;
  font-weight: 600;
}

.q-card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
}

.q-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.q-index {
  font-size: 13px;
  color: var(--text-2);
  font-weight: 600;
}
.q-summary {
  font-size: 12px;
  color: var(--text-3);
  margin-left: auto;
}

.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}
.tag-single { background: #e6f4ff; color: #1677ff; }
.tag-multi  { background: #f6ffed; color: #52c41a; }
.tag-judge  { background: #fff7e6; color: #fa8c16; }
.tag-blank  { background: #f9f0ff; color: #722ed1; }
.tag-group  { background: #fff0f6; color: #eb2f96; }

.q-stem {
  font-size: 14px;
  color: var(--text);
  line-height: 1.6;
  margin-bottom: 10px;
}

.q-ops {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.btn-danger {
  background: #fff2f0;
  color: var(--danger);
  border: 1px solid #ffccc7;
}
.btn-danger:hover {
  background: #ffccc7;
}

/* 题型选择弹窗 */
.picker-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 900;
  padding: 16px;
}
.picker-modal {
  background: #fff;
  border-radius: 8px;
  width: 100%; max-width: 360px;
}
.picker-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  font-weight: 600;
  display: flex; justify-content: space-between; align-items: center;
}
.close-btn {
  background: none; border: none; font-size: 24px;
  cursor: pointer; color: var(--text-3);
  line-height: 1; padding: 0;
}
.picker-body {
  padding: 16px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.type-btn {
  padding: 14px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s;
}
.type-btn:hover {
  border-color: var(--primary);
  background: var(--primary-bg);
  color: var(--primary);
}
</style>
