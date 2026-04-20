<script setup>
import { ref, computed, onMounted } from "vue"
import { useRouter } from "vue-router"
import { listEmails } from "@/api/emails"
import ImportDialog from "@/components/ImportDialog.vue"

const router = useRouter()

const loading = ref(false)
const total = ref(0)
const activeCount = ref(0)
const invalidCount = ref(0)
const recent = ref([])
const importOpen = ref(false)

const validRatio = computed(() => {
  if (!total.value) return 0
  return Math.round((activeCount.value / total.value) * 100)
})

async function load() {
  loading.value = true
  try {
    // 总数 & 最近 5 条
    const listResponse = await listEmails({ page: 1, pageSize: 5 })
    total.value = listResponse.total ?? 0
    recent.value = listResponse.list ?? []

    // 有效数量
    const activeResponse = await listEmails({ page: 1, pageSize: 1, status: "active" })
    activeCount.value = activeResponse.total ?? 0

    // 失效数量
    const invalidResponse = await listEmails({ page: 1, pageSize: 1, status: "invalid" })
    invalidCount.value = invalidResponse.total ?? 0
  } finally {
    loading.value = false
  }
}

function formatDate(value) {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleString("zh-CN")
  } catch {
    return value
  }
}

function statusTag(status) {
  if (status === "active") return { type: "success", label: "有效" }
  if (status === "invalid") return { type: "danger", label: "失效" }
  if (status === "disabled") return { type: "info", label: "已禁用" }
  return { type: "warning", label: status || "未知" }
}

onMounted(load)
</script>

<template>
  <div class="dashboard" v-loading="loading">
    <header class="hero">
      <div>
        <div class="hero-tag">
          <el-icon><DataAnalysis /></el-icon>
          <span>系统仪表盘</span>
        </div>
        <h1 class="hero-title">欢迎使用，批量管理更高效</h1>
        <p class="hero-sub">查看账号整体状态、令牌健康度以及快捷操作入口。</p>
      </div>
      <div class="hero-actions">
        <el-button type="primary" size="large" @click="importOpen = true">
          <el-icon><UploadFilled /></el-icon>
          批量导入
        </el-button>
        <el-button size="large" @click="router.push('/mails')">
          <el-icon><List /></el-icon>
          邮箱管理
        </el-button>
      </div>
    </header>

    <section class="stats">
      <el-card shadow="never" class="stat-card primary">
        <div class="stat-inner">
          <div class="stat-meta">
            <div class="stat-label">邮箱总数</div>
            <div class="stat-value">{{ total }}</div>
            <div class="stat-hint">数据来源：GET /api/emails</div>
          </div>
          <div class="stat-icon">
            <el-icon><Message /></el-icon>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="stat-card success">
        <div class="stat-inner">
          <div class="stat-meta">
            <div class="stat-label">有效账号</div>
            <div class="stat-value">{{ activeCount }}</div>
            <div class="stat-hint">占比 {{ validRatio }}%</div>
          </div>
          <div class="stat-icon">
            <el-icon><CircleCheckFilled /></el-icon>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="stat-card danger">
        <div class="stat-inner">
          <div class="stat-meta">
            <div class="stat-label">失效账号</div>
            <div class="stat-value">{{ invalidCount }}</div>
            <div class="stat-hint">刷新令牌失败时自动标记</div>
          </div>
          <div class="stat-icon">
            <el-icon><WarningFilled /></el-icon>
          </div>
        </div>
      </el-card>
    </section>

    <section class="panels">
      <el-card shadow="never" class="panel">
        <template #header>
          <div class="panel-head">
            <span class="panel-title">
              <el-icon><Clock /></el-icon>
              最近导入
            </span>
            <el-button text type="primary" @click="router.push('/mails')">
              查看全部
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
        </template>
        <el-empty v-if="!recent.length" description="暂无数据，先粘贴导入一批邮箱吧">
          <el-button type="primary" @click="importOpen = true">
            <el-icon><Plus /></el-icon>
            立即导入
          </el-button>
        </el-empty>
        <el-table v-else :data="recent" style="width: 100%">
          <el-table-column prop="id" label="ID" width="60" />
          <el-table-column prop="email" label="邮箱" min-width="220" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTag(row.status).type" effect="light">
                {{ statusTag(row.status).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="更新时间" width="180">
            <template #default="{ row }">
              {{ formatDate(row.updated_at) }}
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card shadow="never" class="panel">
        <template #header>
          <div class="panel-head">
            <span class="panel-title">
              <el-icon><Guide /></el-icon>
              使用指南
            </span>
          </div>
        </template>
        <ol class="guide">
          <li>点击右上方的 <b>批量导入</b>，粘贴按行格式化的邮箱数据。</li>
          <li>格式：<code>邮箱----密码----client_id----refresh_token</code>。</li>
          <li>导入后进入 <b>邮箱管理</b>，可以刷新令牌、查看过期时间、删除失效账号。</li>
          <li>后端接口：<code>POST /api/emails/import</code> · <code>GET /api/emails</code> · <code>POST /api/emails/refresh</code>。</li>
        </ol>
      </el-card>
    </section>

    <ImportDialog v-model="importOpen" @imported="load" />
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 26px 30px;
  border-radius: 18px;
  background: linear-gradient(135deg, #eef2ff 0%, #faf5ff 55%, #fff 100%);
  border: 1px solid #eef0f5;
}
.hero-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
  font-size: 12px;
  font-weight: 500;
}
.hero-title {
  margin: 10px 0 4px;
  font-size: 24px;
  font-weight: 700;
  color: #1f2430;
}
.hero-sub {
  margin: 0;
  color: #6b7185;
  font-size: 14px;
}
.hero-actions {
  display: flex;
  gap: 10px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.stat-card {
  border-radius: 16px;
  border: 1px solid #eef0f5;
}
.stat-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.stat-label {
  font-size: 13px;
  color: #6b7185;
}
.stat-value {
  font-size: 30px;
  font-weight: 700;
  color: #1f2430;
  margin-top: 4px;
}
.stat-hint {
  margin-top: 2px;
  font-size: 12px;
  color: #9096a6;
}
.stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #fff;
}
.stat-card.primary .stat-icon {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
}
.stat-card.success .stat-icon {
  background: linear-gradient(135deg, #22c55e, #10b981);
}
.stat-card.danger .stat-icon {
  background: linear-gradient(135deg, #ef4444, #f97316);
}

.panels {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 16px;
}
.panel {
  border-radius: 16px;
  border: 1px solid #eef0f5;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #1f2430;
}

.guide {
  margin: 0;
  padding-left: 18px;
  line-height: 1.9;
  color: #4a5064;
}
.guide code {
  background: #f4f4f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
}

@media (max-width: 1024px) {
  .stats {
    grid-template-columns: 1fr;
  }
  .panels {
    grid-template-columns: 1fr;
  }
  .hero {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
