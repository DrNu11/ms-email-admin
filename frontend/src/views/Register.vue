<script setup>
import { ref, reactive } from "vue"
import { useRouter } from "vue-router"
import { ElMessage } from "element-plus"
import { User, Lock, CircleCheck } from "@element-plus/icons-vue"
import { register } from "@/stores/auth"

const router = useRouter()

const form = reactive({
  username: "",
  password: "",
  confirm: "",
})
const loading = ref(false)
const formRef = ref(null)

const validateConfirm = (_rule, value, callback) => {
  if (value !== form.password) callback(new Error("两次输入的密码不一致"))
  else callback()
}

const rules = {
  username: [
    { required: true, message: "请输入用户名", trigger: "blur" },
    { min: 3, max: 20, message: "3-20 位字符", trigger: "blur" },
    {
      pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/,
      message: "仅允许字母/数字/下划线/中文",
      trigger: "blur",
    },
  ],
  password: [
    { required: true, message: "请输入密码", trigger: "blur" },
    { min: 6, max: 128, message: "6-128 位", trigger: "blur" },
  ],
  confirm: [
    { required: true, message: "请再次输入密码", trigger: "blur" },
    { validator: validateConfirm, trigger: "blur" },
  ],
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const user = await register(form.username.trim(), form.password)
    ElMessage.success(`注册成功，欢迎 ${user.username}！`)
    router.replace("/")
  } catch (error) {
    ElMessage.error(error?.message || "注册失败")
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="glass-card">
      <div class="brand">
        <div class="logo">✨</div>
        <h1>创建账号</h1>
        <p class="subtitle">注册后，你导入的邮箱只有你自己能看到</p>
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
          <el-input v-model="form.username" placeholder="3-20 位字母/数字/下划线/中文" :prefix-icon="User" clearable />
        </el-form-item>
        <el-form-item prop="password" label="密码">
          <el-input v-model="form.password" type="password" placeholder="至少 6 位" :prefix-icon="Lock" show-password />
        </el-form-item>
        <el-form-item prop="confirm" label="确认密码">
          <el-input
            v-model="form.confirm"
            type="password"
            placeholder="再次输入密码"
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
          <el-icon style="margin-right: 6px"><CircleCheck /></el-icon>
          注册
        </el-button>
      </el-form>

      <div class="foot">
        已经有账号？
        <router-link to="/login">去登录</router-link>
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
  max-width: 440px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 20px;
  padding: 32px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
}
.brand {
  text-align: center;
  margin-bottom: 20px;
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
  height: 46px;
  font-weight: 600;
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
