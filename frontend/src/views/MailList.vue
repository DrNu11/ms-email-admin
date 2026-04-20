<script setup>
import { ref, reactive, onMounted } from "vue"
import { ElMessage, ElMessageBox } from "element-plus"
import { listEmails, refreshEmail, deleteEmail, deleteEmailsBatch } from "@/api/emails"
import ImportDialog from "@/components/ImportDialog.vue"
import InboxDialog from "@/components/InboxDialog.vue"

const loading = ref(false)
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const search = ref("")
const statusFilter = ref("")

const refreshingId = ref(null)
const passwordVisible = reactive({})
const importOpen = ref(false)
const inboxOpen = ref(false)
const inboxRow = ref(null)

const tableRef = ref(null)
const selected = ref([])
const batchDeleting = ref(false)

async function load() {
  loading.value = true
  try {
    const data = await listEmails({
      page: page.value,
      pageSize: pageSize.value,
      search: search.value.trim(),
      status: statusFilter.value,
    })
    rows.value = data.list ?? []
    total.value = data.total ?? 0
  } catch (error) {
    ElMessage.error(error?.message || "加载失败")
  } finally {
    loading.value = false
  }
}

onMounted(load)

function handleSearch() {
  page.value = 1
  load()
}

function handleReset() {
  search.value = ""
  statusFilter.value = ""
  page.value = 1
  load()
}

function handlePageChange(next) {
  page.value = next
  load()
}

function handleSizeChange(size) {
  pageSize.value = size
  page.value = 1
  load()
}

/** 把秒数格式化成「X天Y小时 / X小时Y分 / X分钟 / X秒」自适应可读字符串 */
function humanDuration(sec) {
  sec = Math.max(0, Math.floor(sec))
  if (sec < 60) return `${sec} 秒`
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟`
  if (sec < 86400) {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    return m ? `${h} 小时 ${m} 分` : `${h} 小时`
  }
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  return h ? `${d} 天 ${h} 小时` : `${d} 天`
}

/**
 * 给模板用：返回 { label, type }
 *   token_expiry 是 access_token 的过期时间（Unix 秒）。微软的 access_token 通常 1 小时寿命，
 *   所以这里以分钟为基本单位，避免出现「剩余 0 天」的误导显示。
 *     未刷新 → info
 *     已过期 → danger
 *     <5 分钟 → danger（需刷新）
 *     5–30 分钟 → warning（即将过期）
 *     >30 分钟 → success（有效 …）
 */
function expiryTag(expiry) {
  if (!expiry) return { label: "未刷新", type: "info" }
  const now = Math.floor(Date.now() / 1000)
  const diff = expiry - now
  if (diff <= 0) return { label: `已过期 ${humanDuration(-diff)}`, type: "danger" }
  if (diff < 300) return { label: `需刷新（${humanDuration(diff)}）`, type: "danger" }
  if (diff < 1800) return { label: `将过期 ${humanDuration(diff)}`, type: "warning" }
  return { label: `有效 ${humanDuration(diff)}`, type: "success" }
}

function maskToken(value) {
  if (!value) return "—"
  if (value.length <= 12) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function statusDescriptor(status) {
  if (status === "active") return { type: "success", label: "有效" }
  if (status === "invalid") return { type: "danger", label: "失效" }
  if (status === "disabled") return { type: "info", label: "已禁用" }
  return { type: "warning", label: status || "未知" }
}

async function copyToClipboard(value, label) {
  if (!value) {
    ElMessage.warning("内容为空")
    return
  }
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success(`${label}已复制`)
  } catch {
    ElMessage.warning("复制失败，请手动复制")
  }
}

function togglePassword(id) {
  passwordVisible[id] = !passwordVisible[id]
}

async function handleRefresh(row) {
  refreshingId.value = row.id
  try {
    const result = await refreshEmail(row.id)
    if (result?.ok) {
      ElMessage.success(`刷新成功：${row.email}（有效期 ${result.expiresIn}s）`)
    } else {
      ElMessage.error(result?.error || "刷新失败")
    }
  } catch (error) {
    ElMessage.error(error?.message || "刷新失败")
  } finally {
    refreshingId.value = null
    load()
  }
}

function handleInbox(row) {
  inboxRow.value = row
  inboxOpen.value = true
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除邮箱 ${row.email}？此操作不可撤销。`,
      "删除确认",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      },
    )
  } catch {
    return // 用户点了取消
  }
  try {
    await deleteEmail(row.id)
    ElMessage.success("已删除")
    load()
  } catch (error) {
    ElMessage.error(error?.message || "删除失败")
  }
}

function handleSelectionChange(rows) {
  selected.value = rows
}

function clearSelection() {
  tableRef.value?.clearSelection()
}

async function handleBatchDelete() {
  if (!selected.value.length) {
    ElMessage.warning("请先勾选至少一条")
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selected.value.length} 条邮箱？此操作不可撤销。`,
      "批量删除确认",
      {
        type: "warning",
        confirmButtonText: "确认删除",
        cancelButtonText: "取消",
      },
    )
  } catch {
    return
  }
  batchDeleting.value = true
  try {
    const ids = selected.value.map((row) => row.id)
    const result = await deleteEmailsBatch(ids)
    ElMessage.success(`已删除 ${result.deleted}/${result.requested} 条`)
    clearSelection()
    // 如果当前页被清空且不是第一页，回退一页
    if (rows.value.length === result.deleted && page.value > 1) {
      page.value -= 1
    }
    load()
  } catch (error) {
    ElMessage.error(error?.message || "批量删除失败")
  } finally {
    batchDeleting.value = false
  }
}
</script>

<template>
  <div class="mail-list">
    <!-- 工具栏 -->
    <el-card shadow="never" class="card toolbar-card">
      <div class="toolbar">
        <div class="filters">
          <el-input
            v-model="search"
            placeholder="搜索邮箱地址"
            clearable
            style="width: 260px"
            @keyup.enter="handleSearch"
            @clear="handleSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-select
            v-model="statusFilter"
            placeholder="状态"
            clearable
            style="width: 140px"
            @change="handleSearch"
            @clear="handleSearch"
          >
            <el-option label="有效" value="active" />
            <el-option label="失效" value="invalid" />
            <el-option label="已禁用" value="disabled" />
          </el-select>
          <el-button @click="handleSearch">
            <el-icon><Search /></el-icon>
            搜索
          </el-button>
          <el-button @click="handleReset">
            <el-icon><RefreshLeft /></el-icon>
            重置
          </el-button>
        </div>

        <div class="actions">
          <el-button
            type="danger"
            :disabled="!selected.length"
            :loading="batchDeleting"
            @click="handleBatchDelete"
          >
            <el-icon><Delete /></el-icon>
            批量删除<span v-if="selected.length">（{{ selected.length }}）</span>
          </el-button>
          <el-button type="primary" @click="importOpen = true">
            <el-icon><UploadFilled /></el-icon>
            批量导入
          </el-button>
          <el-button @click="load">
            <el-icon><Refresh /></el-icon>
            刷新列表
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 数据表格 -->
    <el-card shadow="never" class="card table-card">
      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="rows"
        stripe
        style="width: 100%"
        :header-cell-style="{ background: '#fafbfd', color: '#4a5064', fontWeight: 600 }"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="48" fixed="left" />
        <el-table-column prop="id" label="ID" width="70" />

        <el-table-column prop="email" label="邮箱" min-width="240">
          <template #default="{ row }">
            <div class="inline">
              <span class="email-text">{{ row.email }}</span>
              <el-tooltip content="复制邮箱" placement="top">
                <el-button link size="small" @click="copyToClipboard(row.email, '邮箱')">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="密码" min-width="170">
          <template #default="{ row }">
            <div class="inline">
              <span class="mono">
                {{ passwordVisible[row.id] ? row.password : "••••••••" }}
              </span>
              <el-tooltip :content="passwordVisible[row.id] ? '隐藏密码' : '显示密码'" placement="top">
                <el-button link size="small" @click="togglePassword(row.id)">
                  <el-icon>
                    <component :is="passwordVisible[row.id] ? 'Hide' : 'View'" />
                  </el-icon>
                </el-button>
              </el-tooltip>
              <el-tooltip content="复制密码" placement="top">
                <el-button link size="small" @click="copyToClipboard(row.password, '密码')">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="客户端 ID" min-width="180">
          <template #default="{ row }">
            <div class="inline">
              <span class="mono">{{ maskToken(row.client_id) }}</span>
              <el-tooltip content="复制 client_id" placement="top">
                <el-button link size="small" @click="copyToClipboard(row.client_id, 'client_id')">
                  <el-icon><CopyDocument /></el-icon>
                </el-button>
              </el-tooltip>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="令牌 / 剩余" min-width="240">
          <template #default="{ row }">
            <div class="token-cell">
              <div class="inline">
                <span class="mono">{{ maskToken(row.refresh_token) }}</span>
                <el-tooltip content="复制 refresh_token" placement="top">
                  <el-button link size="small" @click="copyToClipboard(row.refresh_token, 'refresh_token')">
                    <el-icon><CopyDocument /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
              <el-tag :type="expiryTag(row.token_expiry).type" size="small" effect="light" round>
                <el-icon style="margin-right: 2px"><Clock /></el-icon>
                {{ expiryTag(row.token_expiry).label }}
              </el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusDescriptor(row.status).type" effect="light">
              {{ statusDescriptor(row.status).label }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <div class="ops">
              <el-button
                size="small"
                type="primary"
                :loading="refreshingId === row.id"
                @click="handleRefresh(row)"
              >
                <el-icon><Refresh /></el-icon>
                刷新令牌
              </el-button>
              <el-button size="small" @click="handleInbox(row)">
                <el-icon><Message /></el-icon>
                收件箱
              </el-button>
              <el-popconfirm
                title="确认删除？此操作不可撤销。"
                confirm-button-text="删除"
                cancel-button-text="取消"
                :width="220"
                @confirm="handleDelete(row)"
              >
                <template #reference>
                  <el-button size="small" type="danger" plain>
                    <el-icon><Delete /></el-icon>
                    删除
                  </el-button>
                </template>
              </el-popconfirm>
            </div>
          </template>
        </el-table-column>

        <template #empty>
          <el-empty description="暂无邮箱，先批量导入一批试试">
            <el-button type="primary" @click="importOpen = true">
              <el-icon><UploadFilled /></el-icon>
              批量导入
            </el-button>
          </el-empty>
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </div>
    </el-card>

    <ImportDialog v-model="importOpen" @imported="load" />
    <InboxDialog v-model="inboxOpen" :email-row="inboxRow" />
  </div>
</template>

<style scoped>
.mail-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  border-radius: 16px;
  border: 1px solid #eef0f5;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.filters,
.actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.email-text {
  font-weight: 500;
  color: #1f2430;
}

.mono {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo,
    monospace;
  font-size: 13px;
  color: #4a5064;
}

.token-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ops {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

:deep(.el-card__body) {
  padding: 16px;
}

@media (max-width: 900px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
