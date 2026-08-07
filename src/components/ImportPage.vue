<script setup>
import { ref } from 'vue'
import { parseFile } from '../parsers/index.js'
import { addBank, store } from '../store.js'

const fileInput = ref(null)
const dragover = ref(false)
const parsing = ref(false)
const error = ref('')
const preview = ref(null) // { name, source, questions }
const bankName = ref('')

function triggerUpload() {
  fileInput.value?.click()
}

async function handleFile(file) {
  if (!file) return
  error.value = ''
  parsing.value = true
  preview.value = null
  try {
    const result = await parseFile(file)
    if (!result.questions || result.questions.length === 0) {
      throw new Error('未解析到任何题目，请检查文件格式')
    }
    preview.value = {
      name: file.name.replace(/\.(docx|xlsx|xls)$/i, ''),
      source: result.source,
      questions: result.questions
    }
    bankName.value = preview.value.name
  } catch (e) {
    error.value = e.message || '解析失败'
  } finally {
    parsing.value = false
  }
}

function onFileChange(e) {
  const file = e.target.files?.[0]
  handleFile(file)
  e.target.value = '' // 允许重复选同一文件
}

function onDrop(e) {
  e.preventDefault()
  dragover.value = false
  const file = e.dataTransfer?.files?.[0]
  handleFile(file)
}

function onDragOver(e) {
  e.preventDefault()
  dragover.value = true
}

function onDragLeave() {
  dragover.value = false
}

async function save() {
  if (!preview.value) return
  if (!bankName.value.trim()) {
    error.value = '请输入题库名称'
    return
  }
  await addBank({
    name: bankName.value.trim(),
    source: preview.value.source,
    questions: preview.value.questions
  })
  store.view = 'list'
}

function reset() {
  preview.value = null
  error.value = ''
  bankName.value = ''
}

// 题型标签
const typeLabel = {
  single: '单选', multi: '多选', judge: '判断', blank: '填空', group: '案例'
}

// 统计各题型数量
function typeStats(questions) {
  const stats = {}
  for (const q of questions) {
    const t = q.type
    const count = t === 'group' ? (q.questions?.length || 0) : 1
    stats[t] = (stats[t] || 0) + count
  }
  return stats
}
</script>

<template>
  <input
    ref="fileInput"
    type="file"
    accept=".docx,.xlsx,.xls"
    style="display:none"
    @change="onFileChange"
  />

  <div v-if="!preview">
    <div
      class="upload-zone"
      :class="{ dragover }"
      @click="triggerUpload"
      @drop="onDrop"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
    >
      <div v-if="parsing">解析中...</div>
      <template v-else>
        <div style="font-size:32px">📁</div>
        <div>点击或拖拽文件到此处</div>
        <div class="hint">支持 .docx / .xlsx / .xls · 文件仅在本地解析，不会上传</div>
      </template>
    </div>
    <div v-if="error" style="color:var(--danger);margin-top:12px;text-align:center">{{ error }}</div>
    <div class="card" style="margin-top:16px;font-size:13px;color:var(--text-3);line-height:1.8">
      <div style="font-weight:600;color:var(--text-2);margin-bottom:6px">格式说明</div>
      <div>· Word：按"一、单选题""二、多选题"等分块，答案在题干括号内</div>
      <div>· Word 填空题：用下划线标出答案</div>
      <div>· Excel：支持多 sheet 分题型 / 单 sheet 含案例题两种格式</div>
      <div>· .doc 旧格式不支持，请先另存为 .docx</div>
    </div>
  </div>

  <div v-else>
    <div class="card">
      <label style="font-size:13px;color:var(--text-2)">题库名称</label>
      <input
        v-model="bankName"
        class="blank-input"
        style="width:100%;margin-top:6px;padding:8px"
      />
    </div>

    <div class="preview-bar">
      <span class="count">
        共 {{ preview.questions.length }} 题
        <template v-for="(c, t) in typeStats(preview.questions)" :key="t">
          · {{ typeLabel[t] }} {{ c }}
        </template>
      </span>
      <button class="btn btn-sm btn-ghost" @click="reset">重新选择</button>
    </div>

    <div style="max-height:50vh;overflow-y:auto">
      <div
        v-for="(q, i) in preview.questions.slice(0, 20)"
        :key="i"
        class="question"
        style="margin-bottom:8px"
      >
        <span class="q-type">{{ typeLabel[q.type] }}</span>
        <div class="q-stem" v-html="q.stem || q.sharedStem"></div>
        <div v-if="q.options" class="q-options">
          <div v-for="opt in q.options" :key="opt.key" class="opt" style="cursor:default">
            <span class="key">{{ opt.key }}.</span>
            <span class="label" v-html="opt.label"></span>
          </div>
        </div>
        <div v-if="q.type === 'group'" style="font-size:13px;color:var(--text-3)">
          含 {{ q.questions.length }} 个子题
        </div>
        <div v-if="q.answer" class="q-answer">
          <span class="label">答案：</span>
          <span class="value">{{ q.answer }}</span>
        </div>
      </div>
    </div>
    <div v-if="preview.questions.length > 20" style="text-align:center;color:var(--text-3);font-size:13px;margin:8px 0">
      仅预览前 20 题，共 {{ preview.questions.length }} 题
    </div>

    <button class="btn btn-block" style="margin-top:12px" @click="save">确认入库</button>
    <div v-if="error" style="color:var(--danger);margin-top:8px;text-align:center">{{ error }}</div>
  </div>
</template>
