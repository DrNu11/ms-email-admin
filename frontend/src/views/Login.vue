<script setup>
import { ref, reactive } from "vue"
import { useRouter, useRoute } from "vue-router"
import { ElMessage } from "element-plus"
import { User, Lock, Right, Avatar } from "@element-plus/icons-vue"
import { login, loginAsGuest } from "@/stores/auth"

const router = useRouter()
const route = useRoute()

const form = reactive({ username: "", password: "" })
const loading = ref(false)
const formRef = ref(null)

const rules = {
  username: [{ required: true, message: "请输入用户名", trigger: "blur" }],
  password: [{ required: true, message: "请输入密码", trigger: "blur" }],
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const user = await login(form.username.trim(), form.password)
    ElMessage.success(`欢迎回来，${user.username}`)
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/"
    router.replace(redirect)
  } catch (error) {
    ElMessage.error(error?.message || "登录失败")
  } finally {
    loading.value = false
  }
}

const guestLoading = ref(false)
async function handleGuest() {
  guestLoading.value = true
  try {
    const user = await loginAsGuest()
    ElMessage.success(`以游客身份进入，${user.username}`)
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "/"
    router.replace(redirect)
  } catch (error) {
    ElMessage.error(error?.message || "游客登录失败")
  } finally {
    guestLoading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="glass-card">
      <div class="brand">
        <div class="logo">📮</div>
        <h1>MS 邮箱管家</h1>
        <p class="subtitle">登录你的账号以查看邮箱</p>
      </div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        label-position="top"
        @submit.prevent="handleSubmit"
      >
        <el-form-item prop="username" label="用户名">
          <el-input v-model="form.username" placeholder="你的用户名" :prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item prop="password" label="密码">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="至少 6 位"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-button
          type="primary"
          :loading="loading"
          class="submit"
          size="large"
          @click="handleSubmit"
        >
          <span>登录</span>
          <el-icon style="margin-left: 6px"><Right /></el-icon>
        </el-button>
      </el-form>

      <el-divider class="divider">或</el-divider>

      <el-button
        :loading="guestLoading"
        class="guest-btn"
        size="large"
        @click="handleGuest"
      >
        <el-icon style="margin-right: 6px"><Avatar /></el-icon>
        游客登录·免注册体验
      </el-button>
      <p class="guest-note">❗ 游客账号与其他游客共用，导入的数据对所有游客可见，请勿填写真实凭证。</p>

      <div class="foot">
        还没有账号？
        <router-link to="/register">立即注册</router-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(64, 158, 255, 0.35), transparent 60%),
    radial-gradient(1200px 600px at 90% 110%, rgba(103, 194, 58, 0.25), transparent 60%),
    linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
  padding: 24px;
}
.glass-card {
  width: 100%;
  max-width: 420px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.7);
  backdrop-filter: saturate(160%) blur(20px);
  border-radius: 20px;
  padding: 32px;
  box-shadow:
    0 24px 48px rgba(0, 0, 0, 0.2),
    0 1px 2px rgba(0, 0, 0, 0.05);
}
.brand {
  text-align: center;
  margin-bottom: 24px;
}
.brand .logo {
  font-size: 42px;
  margin-bottom: 8px;
}
.brand h1 {
  margin: 0;
  font-size: 22px;
  color: #1f2937;
}
.brand .subtitle {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 13px;
}
.submit {
  width: 100%;
  margin-top: 8px;
  height: 46px;
  font-weight: 600;
}
.divider {
  margin: 20px 0 16px;
}
:deep(.divider .el-divider__text) {
  background: rgba(255, 255, 255, 0.96);
  color: #9ca3af;
  font-size: 12px;
}
.guest-btn {
  width: 100%;
  height: 46px;
  font-weight: 500;
}
.guest-note {
  margin: 10px 0 0;
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.6;
  text-align: center;
}
.foot {
  margin-top: 20px;
  text-align: center;
  color: #6b7280;
  font-size: 13px;
}
.foot a {
  color: #409eff;
  text-decoration: none;
  font-weight: 600;
  margin-left: 4px;
}
.foot a:hover {
  text-decoration: underline;
}
</style>
