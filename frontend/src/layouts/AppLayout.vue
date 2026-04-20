<script setup>
import { ref, computed, onMounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import { ElMessage, ElMessageBox } from "element-plus"
import { fetchHealth } from "@/api/emails"
import { currentUser, logout } from "@/stores/auth"

const route = useRoute()
const router = useRouter()

const menuItems = [
  { path: "/dashboard", title: "仪表盘", icon: "DataAnalysis" },
  { path: "/mails", title: "邮箱管理", icon: "Message" },
]

const activeMenu = computed(() => route.path)
const pageTitle = computed(
  () => menuItems.find((item) => route.path.startsWith(item.path))?.title ?? "微软邮箱批量管理系统",
)

const backendOk = ref(false)

async function pollHealth() {
  try {
    const data = await fetchHealth()
    backendOk.value = !!data.ok
  } catch {
    backendOk.value = false
  }
}

onMounted(() => {
  pollHealth()
  setInterval(pollHealth, 15_000)
})

function handleSelect(index) {
  if (index !== route.path) router.push(index)
}

const userInitial = computed(() =>
  (currentUser.value?.username || "U").trim().charAt(0).toUpperCase(),
)

async function handleUserCommand(command) {
  if (command === "logout") {
    try {
      await ElMessageBox.confirm("确认退出登录？", "退出确认", {
        type: "warning",
        confirmButtonText: "退出",
        cancelButtonText: "取消",
      })
    } catch {
      return
    }
    logout()
    ElMessage.success("已退出登录")
    router.replace({ path: "/login" })
  }
}
</script>

<template>
  <el-container class="app">
    <el-aside class="aside" width="220px">
      <div class="brand">
        <div class="brand-mark">M</div>
        <div class="brand-text">
          <div class="brand-title">MS 邮箱管家</div>
          <div class="brand-sub">批量管理 · 令牌刷新</div>
        </div>
      </div>

      <el-menu
        class="menu"
        :default-active="activeMenu"
        background-color="transparent"
        text-color="#3d4353"
        active-text-color="#6366f1"
        @select="handleSelect"
      >
        <el-menu-item
          v-for="item in menuItems"
          :key="item.path"
          :index="item.path"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>

      <div class="aside-footer">
        <div class="status-dot" :class="{ online: backendOk }"></div>
        <span class="status-label">{{ backendOk ? "后端已连接" : "后端未连接" }}</span>
      </div>
    </el-aside>

    <el-container>
      <el-header class="header" height="60px">
        <div class="header-title">
          <el-icon><ArrowRight /></el-icon>
          <span>{{ pageTitle }}</span>
        </div>
        <div class="header-right">
          <el-dropdown trigger="click" @command="handleUserCommand">
            <div class="user-trigger">
              <el-avatar :size="32" class="avatar">{{ userInitial }}</el-avatar>
              <span class="user-name">{{ currentUser?.username || "未登录" }}</span>
              <el-tag
                v-if="currentUser?.role === 'admin'"
                type="danger"
                effect="plain"
                size="small"
                round
              >
                admin
              </el-tag>
              <el-icon class="caret"><CaretBottom /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.app {
  height: 100vh;
  background: #f5f7fb;
}

.aside {
  background: #ffffff;
  border-right: 1px solid #eef0f5;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px 18px;
  border-bottom: 1px solid #eef0f5;
}
.brand-mark {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 18px;
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.35);
}
.brand-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2430;
}
.brand-sub {
  font-size: 12px;
  color: #9096a6;
  margin-top: 2px;
}

.menu {
  flex: 1;
  border-right: none !important;
  padding: 12px 10px;
}
.menu :deep(.el-menu-item) {
  border-radius: 10px;
  margin-bottom: 4px;
  font-size: 14px;
  height: 42px;
  line-height: 42px;
}
.menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.12), rgba(139, 92, 246, 0.1));
  font-weight: 600;
}
.menu :deep(.el-menu-item:hover) {
  background: #f4f5f9;
}

.aside-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid #eef0f5;
  font-size: 12px;
  color: #9096a6;
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d9534f;
  box-shadow: 0 0 0 3px rgba(217, 83, 79, 0.15);
}
.status-dot.online {
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.18);
}

.header {
  background: #fff;
  border-bottom: 1px solid #eef0f5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.header-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 600;
  color: #1f2430;
}
.header-title .el-icon {
  color: #9096a6;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.avatar {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  font-weight: 600;
}
.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.user-trigger:hover {
  background: #f4f5f9;
}
.user-name {
  font-size: 14px;
  font-weight: 500;
  color: #1f2430;
}
.caret {
  color: #9096a6;
  font-size: 14px;
}

.main {
  padding: 20px;
  overflow: auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
