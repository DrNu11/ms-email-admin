/**
 * 极简的认证状态（不引入 Pinia）：
 * - token / user 保存到 localStorage
 * - 模块导出响应式引用，任何组件 import 即可直接用
 */
import { reactive, computed } from "vue"
import http from "@/api/client"

const TOKEN_KEY = "ms-email-admin:token"
const USER_KEY = "ms-email-admin:user"

const state = reactive({
  token: localStorage.getItem(TOKEN_KEY) || "",
  user: (() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null")
    } catch {
      return null
    }
  })(),
})

export const isAuthenticated = computed(() => Boolean(state.token && state.user))
export const currentUser = computed(() => state.user)
export const authToken = computed(() => state.token)

function persist() {
  if (state.token) {
    localStorage.setItem(TOKEN_KEY, state.token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
  if (state.user) {
    localStorage.setItem(USER_KEY, JSON.stringify(state.user))
  } else {
    localStorage.removeItem(USER_KEY)
  }
}

export async function login(username, password) {
  const { user, token } = await http.post("/auth/login", { username, password })
  state.token = token
  state.user = user
  persist()
  return user
}

export async function register(username, password) {
  const { user, token } = await http.post("/auth/register", { username, password })
  state.token = token
  state.user = user
  persist()
  return user
}

export async function loginAsGuest() {
  const { user, token } = await http.post("/auth/guest", {})
  state.token = token
  state.user = user
  persist()
  return user
}

export async function fetchMe() {
  const { user } = await http.get("/auth/me")
  state.user = user
  persist()
  return user
}

export function logout() {
  state.token = ""
  state.user = null
  persist()
}
