import axios from "axios"

// 前端通过 Vite proxy 把 /api 转发到后端（见 vite.config.js）
// 生产环境可以通过 VITE_API_BASE 指定真实后端地址
const baseURL = import.meta.env.VITE_API_BASE || "/api"

const TOKEN_KEY = "ms-email-admin:token"
const USER_KEY = "ms-email-admin:user"

const http = axios.create({
  baseURL,
  timeout: 30_000,
})

// 请求拦截器：自动带上 Authorization
http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const status = error?.response?.status
    // 401：token 失效/未登录 → 清掉本地凭证并跳到 /login
    if (status === 401) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      // 避免登录/注册请求本身触发跳转陷入死循环
      const url = error.config?.url || ""
      const isAuthCall = url.includes("/auth/login") || url.includes("/auth/register")
      if (!isAuthCall && typeof window !== "undefined") {
        const here = window.location.pathname + window.location.search
        if (!here.startsWith("/login")) {
          window.location.href = `/login?redirect=${encodeURIComponent(here)}`
        }
      }
    }
    const message =
      error?.response?.data?.error ||
      error?.response?.statusText ||
      error?.message ||
      "请求失败"
    return Promise.reject(new Error(message))
  },
)

export default http
