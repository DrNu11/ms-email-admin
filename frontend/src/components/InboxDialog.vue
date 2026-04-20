<template>
  <el-dialog
    v-model="visibleProxy"
    :title="dialogTitle"
    width="860"
    destroy-on-close
    append-to-body
    @open="handleOpen"
  >
    <!-- 列表视图 -->
    <template v-if="view === 'list'">
      <div v-if="loading" style="padding: 8px 0">
        <el-skeleton :rows="5" animated />
        <p style="color:#909399; font-size:12px; margin-top:12px">
          正在通过 IMAP 拉取，首次约 3–8 秒……
        </p>
      </div>

      <el-alert
        v-else-if="errorMsg"
        :title="errorMsg"
        type="error"
        show-icon
        :closable="false"
      />

      <el-empty v-else-if="!messages.length" description="收件箱里目前没有邮件" />

      <el-table
        v-else
        :data="messages"
        max-height="480"
        size="small"
        stripe
        row-key="uid"
        class="inbox-table"
        @row-click="openMessage"
      >
        <el-table-column width="36" align="center">
          <template #default="{ row }">
            <span
              :class="['dot', row.seen ? 'dot-seen' : 'dot-unseen']"
              :title="row.seen ? '已读' : '未读'"
            />
          </template>
        </el-table-column>
        <el-table-column
          label="发件人"
          prop="from"
          min-width="200"
          show-overflow-tooltip
        />
        <el-table-column
          label="主题"
          prop="subject"
          min-width="280"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <span :style="{ fontWeight: row.seen ? 400 : 600 }">{{ row.subject }}</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.date) }}</template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 详情视图 -->
    <template v-else>
      <div class="detail-header">
        <el-button text @click="backToList">
          <el-icon><ArrowLeft /></el-icon>
          返回列表
        </el-button>
      </div>

      <div v-if="detailLoading" style="padding: 8px 0">
        <el-skeleton :rows="6" animated />
      </div>

      <el-alert
        v-else-if="detailError"
        :title="detailError"
        type="error"
        show-icon
        :closable="false"
      />

      <template v-else-if="detail">
        <h3 class="detail-subject">{{ detail.subject }}</h3>
        <div class="detail-meta">
          <div><span class="meta-label">发件人</span>{{ detail.from || "—" }}</div>
          <div><span class="meta-label">收件人</span>{{ detail.to || "—" }}</div>
          <div v-if="detail.cc"><span class="meta-label">抄送</span>{{ detail.cc }}</div>
          <div><span class="meta-label">时间</span>{{ formatDate(detail.date) }}</div>
        </div>
        <div v-if="detail.attachments?.length" class="attachments">
          <el-tag
            v-for="a in detail.attachments"
            :key="a.filename"
            size="small"
            type="info"
            effect="plain"
          >
            📎 {{ a.filename }} · {{ humanSize(a.size) }}
          </el-tag>
        </div>
        <iframe
          v-if="detail.html"
          :srcdoc="iframeDoc"
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          class="body-frame"
        />
        <pre v-else class="body-text">{{ detail.text || "(无正文)" }}</pre>
      </template>
    </template>

    <template #footer>
      <div class="inbox-footer">
        <span v-if="view === 'list' && !loading && !errorMsg && total" class="inbox-stat">
          邮箱共 {{ total }} 封，已显示最近 {{ messages.length }} 封
        </span>
        <span v-else />
        <div>
          <el-button v-if="view === 'list'" :loading="loading" @click="load">刷新</el-button>
          <el-button v-else :loading="detailLoading" @click="loadDetail(currentUid)">重新读取</el-button>
          <el-button type="primary" @click="visibleProxy = false">关闭</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref } from "vue"
import { fetchInbox, fetchMessage } from "@/api/emails"

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  emailRow: { type: Object, default: null },
  top: { type: Number, default: 20 },
})
const emit = defineEmits(["update:modelValue"])

const visibleProxy = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
})

// 视图切换
const view = ref("list") // 'list' | 'detail'

// 列表状态
const loading = ref(false)
const errorMsg = ref("")
const messages = ref([])
const total = ref(0)

// 详情状态
const detailLoading = ref(false)
const detailError = ref("")
const detail = ref(null)
const currentUid = ref(null)

const dialogTitle = computed(() => {
  const email = props.emailRow?.email || ""
  return view.value === "list" ? `收件箱 · ${email}` : `邮件 · ${email}`
})

const iframeDoc = computed(() => {
  if (!detail.value?.html) return ""
  const css = `body{font:14px/1.7 -apple-system,system-ui,'PingFang SC',sans-serif;color:#303133;margin:0;padding:12px 14px;background:#fff;word-break:break-word}img{max-width:100%;height:auto}a{color:#409eff}table{max-width:100%}pre{white-space:pre-wrap}blockquote{border-left:3px solid #dcdfe6;margin:8px 0;padding:4px 12px;color:#606266}`
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${css}</style></head><body>${detail.value.html}</body></html>`
})

function formatDate(raw) {
  if (!raw) return ""
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return String(raw)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function humanSize(bytes) {
  if (!bytes) return "0 B"
  const u = ["B", "KB", "MB", "GB"]
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

async function load() {
  if (!props.emailRow?.id) return
  loading.value = true
  errorMsg.value = ""
  try {
    const res = await fetchInbox(props.emailRow.id, props.top)
    messages.value = res.messages || []
    total.value = res.total || 0
  } catch (err) {
    errorMsg.value = err?.message || "拉取收件箱失败"
    messages.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadDetail(uid) {
  if (!props.emailRow?.id || !uid) return
  detailLoading.value = true
  detailError.value = ""
  detail.value = null
  try {
    const res = await fetchMessage(props.emailRow.id, uid)
    detail.value = res.message
    // 后端已标记为已读，同步更新本地列表状态
    const target = messages.value.find((m) => m.uid === uid)
    if (target) target.seen = true
  } catch (err) {
    detailError.value = err?.message || "读取邮件失败"
  } finally {
    detailLoading.value = false
  }
}

function openMessage(row) {
  if (!row?.uid) return
  currentUid.value = row.uid
  view.value = "detail"
  loadDetail(row.uid)
}

function backToList() {
  view.value = "list"
  detail.value = null
  detailError.value = ""
  currentUid.value = null
}

function handleOpen() {
  view.value = "list"
  messages.value = []
  total.value = 0
  errorMsg.value = ""
  detail.value = null
  detailError.value = ""
  currentUid.value = null
  load()
}
</script>

<style scoped>
.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.dot-unseen {
  background: #409eff;
}
.dot-seen {
  background: #c0c4cc;
}
.inbox-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.inbox-stat {
  color: #909399;
  font-size: 12px;
}
.inbox-table :deep(.el-table__row) {
  cursor: pointer;
}

.detail-header {
  margin-bottom: 8px;
}
.detail-subject {
  margin: 4px 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: #1f2430;
  line-height: 1.4;
  word-break: break-word;
}
.detail-meta {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  font-size: 13px;
  color: #606266;
  padding: 10px 12px;
  background: #f7f8fa;
  border: 1px solid #eef0f5;
  border-radius: 10px;
  margin-bottom: 10px;
  word-break: break-word;
}
.meta-label {
  display: inline-block;
  min-width: 52px;
  color: #909399;
  margin-right: 8px;
}
.attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.body-frame {
  width: 100%;
  height: 460px;
  border: 1px solid #eef0f5;
  border-radius: 10px;
  background: #fff;
}
.body-text {
  width: 100%;
  max-height: 460px;
  overflow: auto;
  padding: 12px 14px;
  margin: 0;
  border: 1px solid #eef0f5;
  border-radius: 10px;
  background: #fafbfd;
  font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
