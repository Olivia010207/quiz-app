<script setup>
import { ref, computed, reactive, watch, onBeforeUnmount } from 'vue'
import {
  store, shuffle, setProgress, getProgress, countQuestions,
  addWrongQuestion, removeWrongIfCorrect, syncNow
} from '../store.js'

const TYPE_LABEL = {
  single: '单选', multi: '多选', judge: '判断', blank: '填空', group: '案例'
}

const bank = computed(() => store.currentBank)
const shuffleOn = ref(false)
const shuffleOrder = ref(null) // null=顺序，array=洗牌后的原始索引序列
const index = ref(0)

// 用户答案与提交状态：key = 题号（含子题用 g{i}_{j}）
const userAnswers = reactive({})
const submitted = reactive({})

// 当前题目列表（按 shuffleOrder 重排，刷新后顺序不变）
const questions = computed(() => {
  if (!bank.value) return []
  if (shuffleOrder.value) {
    return shuffleOrder.value.map(i => bank.value.questions[i])
  }
  return bank.value.questions
})

const current = computed(() => questions.value[index.value])
const total = computed(() => questions.value.length)

// 恢复进度（含答题状态 + 洗牌顺序）
const prog = getProgress(bank.value?.id)
if (typeof prog.shuffle === 'boolean') shuffleOn.value = prog.shuffle
if (prog.shuffleOrder) shuffleOrder.value = prog.shuffleOrder
if (prog.index != null && prog.index < (bank.value?.questions.length || 0)) {
  index.value = prog.index
}
if (prog.answers) Object.assign(userAnswers, prog.answers)
if (prog.submitted) Object.assign(submitted, prog.submitted)

// 持久化进度（题号 + 答题状态 + 洗牌顺序）
let saveTimer = null
function persistProgress() {
  if (!bank.value) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    setProgress(bank.value.id, {
      index: index.value,
      shuffle: shuffleOn.value,
      shuffleOrder: shuffleOrder.value,
      answers: { ...userAnswers },
      submitted: { ...submitted }
    })
  }, 300)
}
watch([index, shuffleOn, shuffleOrder], persistProgress)
watch([userAnswers, submitted], persistProgress, { deep: true })

function toggleShuffle() {
  shuffleOn.value = !shuffleOn.value
  if (shuffleOn.value) {
    shuffleOrder.value = shuffle(bank.value.questions.map((_, i) => i))
  } else {
    shuffleOrder.value = null
  }
  index.value = 0
  Object.keys(userAnswers).forEach(k => delete userAnswers[k])
  Object.keys(submitted).forEach(k => delete submitted[k])
}

function prev() {
  if (index.value > 0) index.value--
}
function next() {
  if (index.value < total.value - 1) index.value++
}

// 单选/判断：选即提交
function pickSingle(i, key) {
  if (submitted[i]) return
  userAnswers[i] = key
  submitted[i] = true
  recordResult(i, questions.value[i])
}
function pickJudge(i, val) {
  if (submitted[i]) return
  userAnswers[i] = val
  submitted[i] = true
  recordResult(i, questions.value[i])
}

// 多选：切换选项，手动提交
function toggleMulti(i, key) {
  if (submitted[i]) return
  const arr = new Set(userAnswers[i] ? userAnswers[i].split('') : [])
  if (arr.has(key)) arr.delete(key)
  else arr.add(key)
  userAnswers[i] = [...arr].sort().join('')
}
function submitMulti(i) {
  submitted[i] = true
  recordResult(i, questions.value[i])
}

// 填空
function setBlank(groupKey, blankIdx, val) {
  const arr = userAnswers[groupKey] ? [...userAnswers[groupKey]] : []
  arr[blankIdx] = val
  userAnswers[groupKey] = arr
}
function submitBlank(i) {
  submitted[i] = true
  recordResult(i, questions.value[i])
}

// 判分
function isCorrect(i, q) {
  if (!submitted[i]) return null
  if (q.type === 'blank') {
    const arr = userAnswers[i] || []
    return q.blanks.every((ans, bi) => normalize(arr[bi]) === normalize(ans))
  }
  if (q.type === 'multi') {
    return (userAnswers[i] || '') === (q.answer || '')
  }
  return userAnswers[i] === q.answer
}

function normalize(s) {
  return String(s || '').trim().toLowerCase()
}

// 判分后记录/移出错题本
function recordResult(i, q) {
  const bid = bank.value?.id || ''
  if (isCorrect(i, q)) removeWrongIfCorrect(q, bid)
  else addWrongQuestion(q, bank.value)
}

// 统计
const stats = computed(() => {
  let answered = 0, correct = 0
  questions.value.forEach((q, i) => {
    if (q.type === 'group') {
      q.questions.forEach((sq, j) => {
        const k = `${i}_${j}`
        if (submitted[k]) {
          answered++
          if (isGroupSubCorrect(i, j, sq)) correct++
        }
      })
    } else {
      if (submitted[i]) {
        answered++
        if (isCorrect(i, q)) correct++
      }
    }
  })
  return { answered, correct }
})

function isGroupSubCorrect(i, j, sq) {
  const k = `${i}_${j}`
  if (!submitted[k]) return null
  if (sq.type === 'blank') {
    const arr = userAnswers[k] || []
    return sq.blanks.every((ans, bi) => normalize(arr[bi]) === normalize(ans))
  }
  return userAnswers[k] === sq.answer
}

// 题组子题操作
function groupPick(i, j, key) {
  const k = `${i}_${j}`
  if (submitted[k]) return
  userAnswers[k] = key
  submitted[k] = true
  recordGroupResult(i, j, questions.value[i].questions[j])
}
function groupToggleMulti(i, j, key) {
  const k = `${i}_${j}`
  if (submitted[k]) return
  const arr = new Set(userAnswers[k] ? userAnswers[k].split('') : [])
  if (arr.has(key)) arr.delete(key)
  else arr.add(key)
  userAnswers[k] = [...arr].sort().join('')
}
function groupSubmitMulti(i, j) {
  submitted[`${i}_${j}`] = true
  recordGroupResult(i, j, questions.value[i].questions[j])
}

function recordGroupResult(i, j, sq) {
  const bid = bank.value?.id || ''
  if (isGroupSubCorrect(i, j, sq)) removeWrongIfCorrect(sq, bid)
  else addWrongQuestion(sq, bank.value)
}

const totalCount = computed(() => countQuestions(bank.value))

// 离开做题页时自动同步（点击返回按钮触发）
onBeforeUnmount(() => {
  syncNow()
})
</script>

<template>
  <div v-if="!bank">未选择题库</div>

  <div v-else>
    <!-- 控制栏 -->
    <div class="quiz-controls">
      <span class="progress">{{ index + 1 }} / {{ total }}（共 {{ totalCount }} 题）</span>
      <label class="switch">
        <input type="checkbox" :checked="shuffleOn" @change="toggleShuffle" />
        乱序
      </label>
    </div>

    <!-- 统计 -->
    <div class="stats">
      <div class="stat">
        <div class="num">{{ stats.answered }}</div>
        <div class="lbl">已答</div>
      </div>
      <div class="stat">
        <div class="num" style="color:var(--success)">{{ stats.correct }}</div>
        <div class="lbl">正确</div>
      </div>
      <div class="stat">
        <div class="num" style="color:var(--danger)">{{ stats.answered - stats.correct }}</div>
        <div class="lbl">错误</div>
      </div>
    </div>

    <!-- 当前题目 -->
    <template v-if="current">
      <!-- 题组 -->
      <template v-if="current.type === 'group'">
        <div class="group-material">
          <div class="tag">案例材料</div>
          <div v-html="current.sharedStem"></div>
        </div>
        <div v-for="(sq, j) in current.questions" :key="j">
          <div class="question">
            <span class="q-type">{{ TYPE_LABEL[sq.type] }}</span>
            <div class="q-stem" v-html="sq.stem"></div>

            <!-- 子题：单选/判断 -->
            <div v-if="sq.type === 'single' || sq.type === 'judge'" class="q-options">
              <div
                v-for="opt in (sq.options || [{key:'正确',label:'正确'},{key:'错误',label:'错误'}])"
                :key="opt.key"
                class="opt"
                :class="{
                  selected: userAnswers[`${index}_${j}`] === opt.key,
                  correct: submitted[`${index}_${j}`] && opt.key === sq.answer,
                  wrong: submitted[`${index}_${j}`] && userAnswers[`${index}_${j}`] === opt.key && opt.key !== sq.answer
                }"
                @click="sq.type === 'judge' ? groupPick(index, j, opt.label) : groupPick(index, j, opt.key)"
              >
                <span class="key">{{ opt.key }}.</span>
                <span class="label" v-html="opt.label"></span>
              </div>
            </div>

            <!-- 子题：多选 -->
            <div v-else-if="sq.type === 'multi'" class="q-options">
              <div
                v-for="opt in sq.options"
                :key="opt.key"
                class="opt"
                :class="{
                  selected: (userAnswers[`${index}_${j}`] || '').includes(opt.key),
                  correct: submitted[`${index}_${j}`] && sq.answer.includes(opt.key),
                  wrong: submitted[`${index}_${j}`] && (userAnswers[`${index}_${j}`] || '').includes(opt.key) && !sq.answer.includes(opt.key)
                }"
                @click="groupToggleMulti(index, j, opt.key)"
              >
                <span class="key">{{ opt.key }}.</span>
                <span class="label" v-html="opt.label"></span>
              </div>
              <button
                v-if="!submitted[`${index}_${j}`]"
                class="btn btn-sm"
                @click="groupSubmitMulti(index, j)"
              >确认</button>
            </div>

            <!-- 子题答案 -->
            <div v-if="submitted[`${index}_${j}`]" class="q-answer">
              <span class="label">答案：</span>
              <span class="value">{{ sq.answer }}</span>
              <span style="margin-left:12px" :style="{color: isGroupSubCorrect(index, j, sq) ? 'var(--success)' : 'var(--danger)'}">
                {{ isGroupSubCorrect(index, j, sq) ? '✓ 正确' : '✗ 错误' }}
              </span>
            </div>
          </div>
        </div>
      </template>

      <!-- 普通题 -->
      <div v-else class="question">
        <span class="q-type">{{ TYPE_LABEL[current.type] }}</span>

        <!-- 单选 -->
        <template v-if="current.type === 'single'">
          <div class="q-stem" v-html="current.stem"></div>
          <div class="q-options">
            <div
              v-for="opt in current.options"
              :key="opt.key"
              class="opt"
              :class="{
                selected: userAnswers[index] === opt.key,
                correct: submitted[index] && opt.key === current.answer,
                wrong: submitted[index] && userAnswers[index] === opt.key && opt.key !== current.answer
              }"
              @click="pickSingle(index, opt.key)"
            >
              <span class="key">{{ opt.key }}.</span>
              <span class="label" v-html="opt.label"></span>
            </div>
          </div>
        </template>

        <!-- 多选 -->
        <template v-else-if="current.type === 'multi'">
          <div class="q-stem" v-html="current.stem"></div>
          <div class="q-options">
            <div
              v-for="opt in current.options"
              :key="opt.key"
              class="opt"
              :class="{
                selected: (userAnswers[index] || '').includes(opt.key),
                correct: submitted[index] && current.answer.includes(opt.key),
                wrong: submitted[index] && (userAnswers[index] || '').includes(opt.key) && !current.answer.includes(opt.key)
              }"
              @click="toggleMulti(index, opt.key)"
            >
              <span class="key">{{ opt.key }}.</span>
              <span class="label" v-html="opt.label"></span>
            </div>
            <button v-if="!submitted[index]" class="btn btn-sm" @click="submitMulti(index)">确认答案</button>
          </div>
        </template>

        <!-- 判断 -->
        <template v-else-if="current.type === 'judge'">
          <div class="q-stem" v-html="current.stem"></div>
          <div class="q-options" style="flex-direction:row;gap:12px">
            <div
              v-for="opt in [{key:'正确',label:'正确'},{key:'错误',label:'错误'}]"
              :key="opt.key"
              class="opt"
              style="flex:1;justify-content:center"
              :class="{
                selected: userAnswers[index] === opt.key,
                correct: submitted[index] && opt.key === current.answer,
                wrong: submitted[index] && userAnswers[index] === opt.key && opt.key !== current.answer
              }"
              @click="pickJudge(index, opt.key)"
            >
              <span class="label" style="text-align:center">{{ opt.label }}</span>
            </div>
          </div>
        </template>

        <!-- 填空 -->
        <template v-else-if="current.type === 'blank'">
          <div class="q-stem">
            <template v-for="(seg, bi) in (current.stem || '').split('____')" :key="bi">
              <span v-html="seg"></span>
              <input
                v-if="bi < (current.blanks?.length || 0)"
                class="blank-input"
                :value="(userAnswers[index] || [])[bi] || ''"
                @input="setBlank(index, bi, $event.target.value)"
                :disabled="submitted[index]"
              />
            </template>
          </div>
          <button v-if="!submitted[index]" class="btn btn-sm" @click="submitBlank(index)">确认答案</button>
        </template>

        <!-- 答案显示 -->
        <div v-if="submitted[index]" class="q-answer">
          <span class="label">答案：</span>
          <span class="value">
            {{ current.type === 'blank' ? (current.blanks || []).join(' / ') : current.answer }}
          </span>
          <span style="margin-left:12px" :style="{color: isCorrect(index, current) ? 'var(--success)' : 'var(--danger)'}">
            {{ isCorrect(index, current) ? '✓ 正确' : '✗ 错误' }}
          </span>
        </div>
      </div>
    </template>

    <!-- 底部导航 -->
    <div class="quiz-nav">
      <button class="btn btn-ghost" :disabled="index === 0" @click="prev">上一题</button>
      <button class="btn" :disabled="index >= total - 1" @click="next">下一题</button>
    </div>
  </div>
</template>
