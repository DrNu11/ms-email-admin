import { createRouter, createWebHistory } from "vue-router"
import AppLayout from "../layouts/AppLayout.vue"
import { isAuthenticated } from "@/stores/auth"

const routes = [
  {
    path: "/login",
    name: "login",
    component: () => import("../views/Login.vue"),
    meta: { title: "登录", public: true },
  },
  {
    path: "/register",
    name: "register",
    component: () => import("../views/Register.vue"),
    meta: { title: "注册", public: true },
  },
  {
    path: "/",
    component: AppLayout,
    redirect: "/dashboard",
    children: [
      {
        path: "dashboard",
        name: "dashboard",
        component: () => import("../views/Dashboard.vue"),
        meta: { title: "仪表盘" },
      },
      {
        path: "mails",
        name: "mails",
        component: () => import("../views/MailList.vue"),
        meta: { title: "邮箱管理" },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 路由守卫：受保护的页面未登录时跳去 /login
router.beforeEach((to) => {
  const authed = isAuthenticated.value
  if (to.meta?.public) {
    // 已登录访问 /login、/register 时，直接回首页
    if (authed && (to.name === "login" || to.name === "register")) {
      return { path: "/" }
    }
    return true
  }
  if (!authed) {
    return { path: "/login", query: { redirect: to.fullPath } }
  }
  return true
})

router.afterEach((to) => {
  if (to.meta?.title) {
    document.title = `${to.meta.title} · 微软邮箱批量管理系统`
  }
})

export default router
