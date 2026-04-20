import { createApp } from "vue"
import ElementPlus from "element-plus"
import zhCn from "element-plus/es/locale/lang/zh-cn"
import "element-plus/dist/index.css"
import * as ElementPlusIconsVue from "@element-plus/icons-vue"

import App from "./App.vue"
import router from "./router"
import "./styles/global.css"

const app = createApp(App)

// 注册所有 Element Plus 图标为全局组件
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.use(router)
app.use(ElementPlus, { locale: zhCn })

app.mount("#app")
