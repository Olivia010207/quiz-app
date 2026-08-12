<script setup>
import { ref, onMounted } from 'vue'
import { parseFile } from '../parsers/index.js'
import { addBank, store, importBankFromJson, computeFingerprint } from '../store.js'

// 模式切换：'file' | 'json'
const mode = ref('file')

// 进入页面时，若 BankList 设置了 _importMode='json' 则切到 json
onMounted(() => {
  if (store._importMode === 'json') {
    mode.value = 'json'
    store._importMode = null
  }
})

function switchMode(m) {
  mode.value = m
  resetFile()
  resetJson()
}

// ============ 文件导入 ============
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

async function saveFile() {
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

function resetFile() {
  preview.value = null
  error.value = ''
  bankName.value = ''
}

// ============ JSON 导入 ============
const jsonInput = ref(null)
const jsonError = ref('')
const jsonPreview = ref(null) // { banks: [{ name, questions, count, conflict }] } 或 { bank }
const jsonImporting = ref(false)
const importResults = ref(null)

function triggerJsonUpload() {
  jsonInput.value?.click()
}

async function handleJsonFile(file) {
  if (!file) return
  jsonError.value = ''
  jsonPreview.value = null
  importResults.value = null
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    // 兼容两种格式：单个题库 / 多题库
    if (Array.isArray(data.banks)) {
      jsonPreview.value = {
        type: 'multi',
        banks: data.banks.map(b => ({
          name: b.name || '未命名题库',
          questions: b.questions || [],
          count: countQuestionsRaw(b.questions || []),
          conflict: detectConflict(b)
        }))
      }
    } else if (data.questions) {
      jsonPreview.value = {
        type: 'single',
        bank: {
          name: data.name || file.name.replace(/\.json$/i, ''),
          questions: data.questions,
          count: countQuestionsRaw(data.questions),
          conflict: detectConflict(data)
        }
      }
    } else {
      throw new Error('JSON 格式不正确：缺少 questions 或 banks 字段')
    }
  } catch (e) {
    jsonError.value = e.message || 'JSON 解析失败'
  } finally {
    jsonInput.value = null
  }
}

function onJsonChange(e) {
  const file = e.target.files?.[0]
  handleJsonFile(file)
}

// 简单统计题量（含案例题子题）
function countQuestionsRaw(questions) {
  if (!Array.isArray(questions)) return 0
  return questions.reduce((sum, q) => {
    if (q && q.type === 'group') return sum + (q.questions ? q.questions.length : 0)
    return sum + 1
  }, 0)
}

// 冲突检测：返回 'same'(同一份覆盖) | 'samename'(同名不同内容) | 'new'(无冲突)
function detectConflict(bankData) {
  const newBank = {
    name: bankData.name || '未命名题库',
    questions: bankData.questions || []
  }
  const fp = computeFingerprint(newBank)
  const sameFp = store.banks.find(b =>
    // 如果 JSON 里带了 id，id 相同也算同一份
    (bankData.id && b.id === bankData.id) ||
    (b.fingerprint && b.fingerprint === fp) ||
    // 兜底：旧题库没有 fingerprint 时实时重算比较
    (!b.fingerprint && computeFingerprint({ name: b.name, questions: b.questions }) === fp)
  )
  if (sameFp) return 'same'
  if (store.banks.some(b => b.name === newBank.name)) return 'samename'
  return 'new'
}

function conflictLabel(c) {
  if (c === 'same') return '覆盖（同一题库，将更新内容）'
  if (c === 'samename') return '同名（内容不同，将自动改名）'
  return '新增'
}

async function doImport() {
  if (!jsonPreview.value) return
  jsonImporting.value = true
  jsonError.value = ''
  try {
    const results = []
    if (jsonPreview.value.type === 'single') {
      const r = await importBankFromJson({
        name: jsonPreview.value.bank.name,
        questions: jsonPreview.value.bank.questions
      })
      results.push({ name: r.bank.name, action: r.action })
    } else {
      for (const b of jsonPreview.value.banks) {
        const r = await importBankFromJson({
          name: b.name,
          questions: b.questions
        })
        results.push({ name: r.bank.name, action: r.action })
      }
    }
    importResults.value = results
    jsonPreview.value = null
  } catch (e) {
    jsonError.value = e.message || '导入失败'
  } finally {
    jsonImporting.value = false
  }
}

function resetJson() {
  jsonPreview.value = null
  jsonError.value = ''
  importResults.value = null
}

function actionLabel(a) {
  if (a === 'overwritten') return '已覆盖'
  if (a === 'created') return '已新增'
  if (a === 'renamed') return '已改名新增'
  return a
}

function backToList() {
  store.view = 'list'
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
  <!-- 模式切换 -->
  <div class="tabs">
    <button class="tab" :class="{ active: mode === 'file' }" @click="switchMode('file')">📄 文件导入</button>
    <button class="tab" :class="{ active: mode === 'json' }" @click="switchMode('json')">🗂 JSON 导入/导出</button>
  </div>

  <!-- ============ 文件导入 ============ -->
  <template v-if="mode === 'file'">
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
        <button class="btn btn-sm btn-ghost" @click="resetFile">重新选择</button>
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

      <button class="btn btn-block" style="margin-top:12px" @click="saveFile">确认入库</button>
      <div v-if="error" style="color:var(--danger);margin-top:8px;text-align:center">{{ error }}</div>
    </div>
  </template>

  <!-- ============ JSON 导入 ============ -->
  <template v-else>
    <input
      ref="jsonInput"
      type="file"
      accept=".json,application/json"
      style="display:none"
      @change="onJsonChange"
    />

    <!-- 导入结果 -->
    <div v-if="importResults">
      <div class="card" style="text-align:center">
        <div style="font-size:32px;margin-bottom:8px">✅</div>
        <div style="font-weight:600;margin-bottom:12px">导入完成</div>
        <div v-for="(r, i) in importResults" :key="i" class="result-row">
          <span>{{ r.name }}</span>
          <span class="badge" :class="r.action">{{ actionLabel(r.action) }}</span>
        </div>
        <button class="btn btn-block" style="margin-top:12px" @click="backToList">完成</button>
      </div>
    </div>

    <!-- 选择文件 / 预览 -->
    <div v-else-if="!jsonPreview">
      <div
        class="upload-zone"
        @click="triggerJsonUpload"
      >
        <div style="font-size:32px">🗂</div>
        <div>选择 JSON 文件</div>
        <div class="hint">支持单个题库（含 questions）或多题库（含 banks）格式</div>
      </div>
      <div v-if="jsonError" style="color:var(--danger);margin-top:12px;text-align:center">{{ jsonError }}</div>
      <div class="card" style="margin-top:16px;font-size:13px;color:var(--text-3);line-height:1.8">
        <div style="font-weight:600;color:var(--text-2);margin-bottom:6px">JSON 格式说明</div>
        <div>· 单题库格式：{"name":"题库名","questions":[...]}</div>
        <div>· 多题库格式：{"banks":[{"name":"...","questions":[...]}]}</div>
        <div>· 可在题库列表用「导出全部」生成备份文件</div>
        <div>· 同一题库（指纹相同）：覆盖内容，保留进度</div>
        <div>· 同名但内容不同：自动改名为「原名(导入)」</div>
      </div>
    </div>

    <!-- 预览 + 冲突提示 -->
    <div v-else>
      <div class="preview-bar">
        <span class="count">
          {{ jsonPreview.type === 'single' ? '1 个题库' : `${jsonPreview.banks.length} 个题库` }}
        </span>
        <button class="btn btn-sm btn-ghost" @click="resetJson">重新选择</button>
      </div>

      <!-- 单题库 -->
      <div v-if="jsonPreview.type === 'single'" class="card">
        <div class="bank-name">{{ jsonPreview.bank.name }}</div>
        <div class="bank-meta">{{ jsonPreview.bank.count }} 题</div>
        <div class="conflict-tag" :class="jsonPreview.bank.conflict">
          {{ conflictLabel(jsonPreview.bank.conflict) }}
        </div>
      </div>

      <!-- 多题库 -->
      <div v-else>
        <div v-for="(b, i) in jsonPreview.banks" :key="i" class="card">
          <div class="bank-name">{{ b.name }}</div>
          <div class="bank-meta">{{ b.count }} 题</div>
          <div class="conflict-tag" :class="b.conflict">
            {{ conflictLabel(b.conflict) }}
          </div>
        </div>
      </div>

      <button
        class="btn btn-block"
        style="margin-top:12px"
        :disabled="jsonImporting"
        @click="doImport"
      >{{ jsonImporting ? '导入中...' : '确认导入' }}</button>
      <div v-if="jsonError" style="color:var(--danger);margin-top:8px;text-align:center">{{ jsonError }}</div>
    </div>
  </template>
</template>

<style scoped>
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  background: var(--card);
  padding: 4px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
}
.tab {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-2);
  transition: background 0.15s, color 0.15s;
}
.tab.active {
  background: var(--primary);
  color: #fff;
}
.bank-name {
  font-weight: 600;
  font-size: 15px;
  margin-bottom: 4px;
}
.bank-meta {
  font-size: 13px;
  color: var(--text-3);
  margin-bottom: 8px;
}
.conflict-tag {
  display: inline-block;
  font-size: 12px;
  padding: 2px 10px;
  border-radius: 4px;
}
.conflict-tag.new {
  background: var(--primary-bg);
  color: var(--primary);
}
.conflict-tag.same {
  background: #fff7e6;
  color: var(--warn);
}
.conflict-tag.samename {
  background: #ffece8;
  color: var(--danger);
}
.result-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
.result-row:last-child { border-bottom: none; }
.badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text-2);
}
.badge.overwritten { background: #fff7e6; color: var(--warn); }
.badge.created { background: var(--primary-bg); color: var(--primary); }
.badge.renamed { background: #ffece8; color: var(--danger); }
</style>
