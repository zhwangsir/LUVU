/**
 * 简易 topic 提取 (Phase 1 J 接通) — 从中文 user_text 命中关键词。
 *
 * 不用 LLM（避免每轮额外延迟）；只用静态 keyword 列表 + 简单匹配。
 * 后续可升级到 LLM 提取，接口保持 (text, emotion) -> Topic[] 不变。
 */

/** topic 归一化标签 → 触发关键词列表 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  工作: ['工作', '上班', '下班', '加班', '老板', '同事', '开会', '会议', 'KPI', '项目', '代码', 'bug', '日报'],
  学习: ['学习', '考试', '论文', '作业', '上课', '老师', '同学', '复习'],
  游戏: ['游戏', '打游戏', '王者', 'lol', '原神', 'steam', '主机', '吃鸡', '联机'],
  吃饭: ['吃', '饭', '菜', '饿', '外卖', '点餐', '做饭', '餐厅'],
  睡觉: ['睡', '困', '失眠', '熬夜', '早起', '床', '困死了'],
  健康: ['累', '病', '感冒', '发烧', '头疼', '难受', '不舒服', '医院', '药'],
  情感: ['想你', '想念', '难过', '开心', '生气', '吃醋', '嫉妒', '喜欢', '爱', '抱'],
  社交: ['朋友', '聚会', '约', '出去', '逛街', '看电影'],
  家人: ['妈', '爸', '爸爸', '妈妈', '爷爷', '奶奶', '父母', '家人', '家里', '回家'],
  天气: ['天气', '下雨', '下雪', '冷', '热', '太阳'],
  运动: ['跑步', '健身', '锻炼', '瑜伽', '游泳', '骑车'],
}

export interface ExtractedTopic {
  /** 归一化 topic 标签 */
  topic: string
  /** 命中的关键词数（多个命中 = 这个 topic 在文中更突出） */
  hits: number
}

/**
 * 从文本中提取所有命中的 topic（按命中次数排序）。
 * 上限返回 top 3 — 防止 mood 被单轮聊天稀释成 10 个 imprints。
 */
export function extractTopics(text: string): ExtractedTopic[] {
  if (!text || typeof text !== 'string') return []
  const lower = text.toLowerCase()
  const out: ExtractedTopic[] = []

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let hits = 0
    for (const kw of keywords) {
      // 用 indexOf 全局计数（不区分大小写）
      const kwLower = kw.toLowerCase()
      let idx = lower.indexOf(kwLower)
      while (idx !== -1) {
        hits += 1
        idx = lower.indexOf(kwLower, idx + kwLower.length)
        if (hits >= 5) break // 单 topic cap 5 防 spam
      }
    }
    if (hits > 0) out.push({ topic, hits })
  }

  out.sort((a, b) => b.hits - a.hits)
  return out.slice(0, 3)
}
