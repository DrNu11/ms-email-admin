<script setup>
import { ref, computed, watch } from "vue"
import { ElMessage } from "element-plus"
import { importEmails } from "@/api/emails"

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(["update:modelValue", "imported"])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
})

const text = ref("")
const separator = ref("") // 空字符串 = 后端自动识别
const submitting = ref(false)
const lastResult = ref(null)

const lineCount = computed(
  () => text.value.split(/\r?\n/).filter((line) => line.trim()).length,
)

watch(visible, (open) => {
  if (open) {
    text.value = ""
    separator.value = ""
    submitting.value = false
    lastResult.value = null
  }
})

async function handleConfirm() {
  const payload = text.value.trim()
  if (!payload) {
    ElMessage.warning("请先粘贴邮箱数据")
    return
  }
  submitting.value = true
  lastResult.value = null
  try {
    const result = await importEmails(payload, separator.value || "")
    lastResult.value = result
    if (result.skipped?.length) {
      console.warn("[导入] 被跳过的行：", result.skipped)
    }
    emit("imported", result)

    // 如果全部失败或大量跳过，不关闭弹窗，让用户看原因
    const allSkipped = (result.skipped?.length ?? 0) === result.received
    if (allSkipped) {
      ElMessage.error(
        `导入全部失败（分隔符识别为 "${result.separator}"），请检查下方跳过原因`,
      )
      return
    }

    ElMessage.success(
      `导入完成：新增 ${result.inserted} 条，更新 ${result.updated} 条，跳过 ${result.skipped?.length ?? 0} 条（分隔符：${result.separator}）`,
    )

    if (!result.skipped?.length) {
      visible.value = false
    }
  } catch (error) {
    ElMessage.error(error?.message || "导入失败")
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="粘贴导入邮箱"
    width="640px"
    :close-on-click-modal="false"
    append-to-body
  >
    <div class="head">
      <div class="head-left">
        <el-icon class="icon"><CopyDocument /></el-icon>
        <div>
          <div class="title">粘贴导入邮箱</div>
          <div class="sub">将邮箱数据粘贴到下方输入框中</div>
        </div>
      </div>
      <el-tag round effect="plain" type="info">
        <el-icon style="margin-right: 4px"><List /></el-icon>
        {{ lineCount }} 行
      </el-tag>
    </div>

    <el-form label-position="top" class="form">
      <el-form-item label="分隔符">
        <el-input
          v-model="separator"
          placeholder="留空自动识别（支持 ---、----、----- 等）"
          style="max-width: 320px"
          clearable
        />
      </el-form-item>

      <el-form-item label="邮箱数据">
        <el-input
          v-model="text"
          type="textarea"
          :autosize="{ minRows: 8, maxRows: 14 }"
          placeholder="请粘贴邮箱数据，每行一个&#10;格式：邮箱<分隔符>密码<分隔符>client_id<分隔符>refresh_token[<分隔符>token_expiry]"
          resize="vertical"
        />
      </el-form-item>
    </el-form>

    <el-alert type="info" show-icon :closable="false" class="tip">
      提示：分隔符留空即可，系统会自动识别；第 5 个字段（Unix 秒时间戳）会存入 <code>token_expiry</code>。
    </el-alert>

    <!-- 导入结果 / 跳过原因 -->
    <div v-if="lastResult?.skipped?.length" class="result">
      <el-alert
        :type="lastResult.inserted + lastResult.updated > 0 ? 'warning' : 'error'"
        :title="`识别分隔符 “${lastResult.separator}” · 新增 ${lastResult.inserted} · 更新 ${lastResult.updated} · 跳过 ${lastResult.skipped.length}`"
        :closable="false"
        show-icon
      />
      <el-collapse class="skipped">
        <el-collapse-item :title="`查看被跳过的 ${lastResult.skipped.length} 行`">
          <ul>
            <li v-for="(item, index) in lastResult.skipped.slice(0, 20)" :key="index">
              <el-tag type="danger" effect="plain" size="small" round>{{ item.reason }}</el-tag>
              <span class="mono">{{ item.line.slice(0, 120) }}{{ item.line.length > 120 ? "…" : "" }}</span>
            </li>
            <li v-if="lastResult.skipped.length > 20" class="more">
              ……等共 {{ lastResult.skipped.length }} 行，详情见浏览器控制台。
            </li>
          </ul>
        </el-collapse-item>
      </el-collapse>
    </div>

    <template #footer>
      <el-button @click="visible = false">
        <el-icon><Close /></el-icon>
        取消
      </el-button>
      <el-button type="primary" :loading="submitting" @click="handleConfirm">
        <el-icon><Check /></el-icon>
        确定导入
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 12px;
  border-bottom: 1px dashed #eef0f5;
  margin-bottom: 12px;
}
.head-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.icon {
  font-size: 22px;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  padding: 8px;
  border-radius: 10px;
}
.title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2430;
}
.sub {
  font-size: 12px;
  color: #9096a6;
  margin-top: 2px;
}
.form :deep(.el-form-item__label) {
  padding-bottom: 6px;
  color: #4a5064;
  font-weight: 500;
}
.tip {
  margin-top: 8px;
}
.tip code {
  background: #f4f4f5;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.result {
  margin-top: 12px;
}
.skipped {
  margin-top: 8px;
  border: 1px solid #eef0f5;
  border-radius: 10px;
  padding: 0 12px;
}
.skipped ul {
  margin: 0;
  padding-left: 0;
  list-style: none;
}
.skipped li {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px dashed #f4f4f5;
  font-size: 12px;
}
.skipped li:last-child {
  border-bottom: none;
}
.skipped .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #6b7185;
  word-break: break-all;
}
.skipped .more {
  color: #9096a6;
  justify-content: center;
}
</style>
