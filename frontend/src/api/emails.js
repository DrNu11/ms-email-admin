import http from "./client"

/** 分页列表 */
export function listEmails(params = {}) {
  return http.get("/emails", { params })
}

/** 批量导入：text 为整段文本，separator 默认 "----" */
export function importEmails(text, separator = "----") {
  return http.post("/emails/import", { text, separator })
}

/** 刷新令牌 */
export function refreshEmail(id) {
  return http.post("/emails/refresh", { id })
}

/** 删除单条 */
export function deleteEmail(id) {
  return http.delete(`/emails/${id}`)
}

/** 批量删除 */
export function deleteEmailsBatch(ids) {
  return http.post("/emails/batch-delete", { ids })
}

/** 拉取指定邮箱的收件箱（IMAP） */
export function fetchInbox(id, top = 20) {
  return http.get(`/emails/${id}/messages`, { params: { top } })
}

/** 读取单封邮件的完整正文 */
export function fetchMessage(id, uid) {
  return http.get(`/emails/${id}/messages/${uid}`)
}

/** 健康检查（Layout 顶栏右上角指示用） */
export function fetchHealth() {
  return http.get("/health")
}
