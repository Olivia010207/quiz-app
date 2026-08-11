<script setup>
import { ref, watch } from 'vue'
import { updateQuestion } from '../store.js'

const props = defineProps({
  bankId: { type: String, required: true },
  question: { type: Object, required: true },
  index: { type: Number, required: true },
  isNew: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'saved', 'create'])

const TYPE_LABEL = {
  single: '单选', multi: '多选', judge: '判断', blank: '填空', group: '案例'
}

const form = ref(null)

function initForm() {
  const q = props.question
  if (q.type === 'group') {
    // 案例题编辑：共用题干 + 各子题
    form.value = {
      type: 'group',
      sharedStem: q.sharedStem || '',
      questions: (q.questions || []).map(sq => ({ ...sq }))
    }
  } else if (q.type === 'blank') {
    form.value = {
      type: 'blank',
      stem: q.stem || '',
      blanks: [...(q.blanks || [])]
    }
  } else if (q.type === 'judge') {
    form.value = {
      type: 'judge',
      stem: q.stem || '',
      answer: q.answer || '正确'
    }
  } else {
    // single / multi
    form.value = {
      type: q.type,
      stem: q.stem || '',
      options: (q.options || []).map(o => ({ ...o })),
      answer: q.answer || ''
    }
  }
  form.value.analysis = q.analysis || ''
}

watch(() => props.question, initForm, { immediate: true })

function addOption() {
  if (!form.value.options) return
  const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  const nextKey = keys[form.value.options.length] || String.fromCharCode(65 + form.value.options.length)
  form.value.options.push({ key: nextKey, label: '' })
}

function removeOption(idx) {
  form.value.options.splice(idx, 1)
  // 重新编号
  const keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  form.value.options.forEach((o, i) => o.key = keys[i] || String.fromCharCode(65 + i))
  // 答案里如果包含被删的字母也要清理
  if (form.value.type === 'single') {
    // 单选：若答案被删则清空
    const validKeys = new Set(form.value.options.map(o => o.key))
    if (form.value.answer && !validKeys.has(form.value.answer)) form.value.answer = ''
  } else if (form.value.type === 'multi') {
    const validKeys = new Set(form.value.options.map(o => o.key))
    form.value.answer = (form.value.answer || '').split('').filter(c => validKeys.has(c)).join('')
  }
}

function toggleMultiAnswer(key) {
  if (!form.value.answer) form.value.answer = key
  else if (form.value.answer.includes(key)) form.value.answer = form.value.answer.replace(key, '')
  else form.value.answer = (form.value.answer + key).split('').sort().join('')
}

function addBlank() {
  if (!form.value.blanks) form.value.blanks = []
  form.value.blanks.push('')
}

function removeBlank(idx) {
  form.value.blanks.splice(idx, 1)
}

async function save() {
  // 构造新题目数据
  const newQuestion = { ...form.value }
  // 案例题子题也要带上 analysis 等字段
  if (newQuestion.type === 'group') {
    newQuestion.questions = newQuestion.questions.map(sq => ({ ...sq }))
  }
  if (props.isNew) {
    emit('create', newQuestion)
  } else {
    await updateQuestion(props.bankId, props.index, newQuestion)
    emit('saved')
  }
  emit('close')
}

function cancel() {
  emit('close')
}

// 案例题：添加子题
function addSubQuestion(type = 'single') {
  if (!form.value.questions) form.value.questions = []
  const sq = { type, stem: '', answer: '', analysis: '' }
  if (type === 'single' || type === 'multi') {
    sq.options = [
      { key: 'A', label: '' },
      { key: 'B', label: '' },
      { key: 'C', label: '' },
      { key: 'D', label: '' }
    ]
  }
  if (type === 'blank') sq.blanks = ['']
  form.value.questions.push(sq)
}

function removeSubQuestion(idx) {
  form.value.questions.splice(idx, 1)
}
</script>

<template>
  <div class="editor-overlay" @click.self="cancel">
    <div class="editor-modal">
      <div class="editor-header">
        <span>{{ isNew ? '新建题目' : '编辑题目' }}（{{ TYPE_LABEL[form.type] }}）</span>
        <button class="close-btn" @click="cancel">×</button>
      </div>

      <div class="editor-body">
        <!-- 案例题 -->
        <template v-if="form.type === 'group'">
          <label>共用题干材料</label>
          <textarea v-model="form.sharedStem" rows="4" />

          <div v-for="(sq, i) in form.questions" :key="i" class="sub-question">
            <div class="sub-header">
              子题 {{ i + 1 }}（{{ TYPE_LABEL[sq.type] }}）
              <button class="mini-btn" @click="removeSubQuestion(i)">×</button>
            </div>
            <label>题干</label>
            <textarea v-model="sq.stem" rows="3" />
            <label v-if="sq.type !== 'judge' && sq.type !== 'blank'">选项</label>
            <div v-if="sq.type !== 'judge' && sq.type !== 'blank'" class="options-list">
              <div v-for="(opt, j) in sq.options" :key="j" class="option-row">
                <input v-model="opt.key" class="opt-key" />
                <input v-model="opt.label" class="opt-label" />
              </div>
            </div>
            <label>答案</label>
            <input v-model="sq.answer" />
            <label>解析</label>
            <textarea v-model="sq.analysis" rows="2" />
          </div>
          <div class="sub-add-group">
            <button class="add-btn" @click="addSubQuestion('single')">+ 添加单选子题</button>
            <button class="add-btn" @click="addSubQuestion('multi')">+ 添加多选子题</button>
            <button class="add-btn" @click="addSubQuestion('judge')">+ 添加判断子题</button>
            <button class="add-btn" @click="addSubQuestion('blank')">+ 添加填空子题</button>
          </div>
        </template>

        <!-- 填空题 -->
        <template v-else-if="form.type === 'blank'">
          <label>题干（用 ____ 标记空位）</label>
          <textarea v-model="form.stem" rows="4" />
          <label>答案（每个空一个）</label>
          <div v-for="(b, i) in form.blanks" :key="i" class="option-row">
            <span class="opt-key">{{ i + 1 }}.</span>
            <input v-model="form.blanks[i]" class="opt-label" />
            <button class="mini-btn" @click="removeBlank(i)">×</button>
          </div>
          <button class="add-btn" @click="addBlank">+ 添加空</button>
        </template>

        <!-- 判断题 -->
        <template v-else-if="form.type === 'judge'">
          <label>题干</label>
          <textarea v-model="form.stem" rows="4" />
          <label>答案</label>
          <div class="radio-group">
            <label><input type="radio" v-model="form.answer" value="正确" /> 正确</label>
            <label><input type="radio" v-model="form.answer" value="错误" /> 错误</label>
          </div>
        </template>

        <!-- 单选/多选 -->
        <template v-else>
          <label>题干</label>
          <textarea v-model="form.stem" rows="4" />
          <label>选项</label>
          <div class="options-list">
            <div v-for="(opt, i) in form.options" :key="i" class="option-row">
              <input
                v-if="form.type === 'single'"
                type="radio"
                :checked="form.answer === opt.key"
                @change="form.answer = opt.key"
              />
              <input
                v-else
                type="checkbox"
                :checked="(form.answer || '').includes(opt.key)"
                @change="toggleMultiAnswer(opt.key)"
              />
              <input v-model="opt.key" class="opt-key" />
              <input v-model="opt.label" class="opt-label" />
              <button class="mini-btn" @click="removeOption(i)">×</button>
            </div>
          </div>
          <button class="add-btn" @click="addOption">+ 添加选项</button>
          <div class="answer-display">当前答案：{{ form.answer || '（未选）' }}</div>
        </template>

        <!-- 通用：解析 -->
        <label>解析</label>
        <textarea v-model="form.analysis" rows="3" />
      </div>

      <div class="editor-footer">
        <button class="btn" @click="save">保存</button>
        <button class="btn btn-ghost" @click="cancel">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  padding: 16px;
}
.editor-modal {
  background: #fff;
  border-radius: 8px;
  width: 100%; max-width: 600px;
  max-height: 90vh;
  display: flex; flex-direction: column;
}
.editor-header {
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
.editor-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}
.editor-body label {
  display: block;
  font-size: 13px;
  color: var(--text-2);
  margin: 8px 0 4px;
}
.editor-body textarea,
.editor-body input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 14px;
  box-sizing: border-box;
}
.editor-body input[type="radio"],
.editor-body input[type="checkbox"] {
  width: auto;
  flex-shrink: 0;
  margin: 0;
}
.editor-body textarea { resize: vertical; }
.options-list { display: flex; flex-direction: column; gap: 6px; }
.option-row {
  display: flex; align-items: center; gap: 6px;
}
.opt-key { width: 40px !important; flex-shrink: 0; text-align: center; }
.opt-label { flex: 1; }
.mini-btn {
  background: none; border: none; color: var(--danger);
  cursor: pointer; font-size: 18px; padding: 0 4px;
}
.add-btn {
  background: none; border: 1px dashed var(--border);
  padding: 6px 12px; border-radius: 6px;
  cursor: pointer; color: var(--primary);
  margin-top: 6px; font-size: 13px;
  margin-right: 6px;
}
.answer-display {
  margin-top: 8px; padding: 6px 10px;
  background: var(--primary-bg); border-radius: 6px;
  font-size: 13px; color: var(--primary);
}
.radio-group { display: flex; gap: 16px; }
.radio-group label { display: flex; align-items: center; gap: 4px; }
.sub-question {
  border-left: 3px solid var(--primary);
  padding-left: 12px; margin: 12px 0;
}
.sub-header {
  font-weight: 600; font-size: 13px; color: var(--primary); margin-bottom: 4px;
  display: flex; justify-content: space-between; align-items: center;
}
.sub-add-group { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
.editor-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  display: flex; gap: 8px; justify-content: flex-end;
}
</style>
