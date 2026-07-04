/**
 * J 接通 smoke test — 真实写盘 + 真实演化路径。
 *
 *   SMOKE_TEST=1 pnpm -F luvu-electron test --run onReply.smoke
 *
 * 不需要 LLM；模拟 dialog.ts → emotional.onReply 的 4 步：
 *   sentiment 映射 → applyChatSentiment → topic 提取 → applyTopicMention → tick
 *
 * 验证 EmotionalState 真的被写盘 + reload 内容正确。
 */
import { describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (key: string) =>
      key === 'userData' ? `${process.env.HOME}/.luvu` : `${process.env.HOME}`,
    getVersion: () => '0.16.0-smoke',
  },
}))

const SHOULD_RUN = process.env.SMOKE_TEST === '1'

describe.skipIf(!SHOULD_RUN)('J emotional onReply smoke (real fs)', () => {
  it('模拟 5 轮对话 → mood 演化 + topic 累积 + state 写盘', async () => {
    const { getActiveCharacter } = await import('../character-store')
    const { loadEmotionalState, updateEmotionalState } = await import('./store')
    const { applyChatSentiment, applyTick, applyTopicMention } = await import('./evolution')
    const { emotionToSentiment } = await import('./sentiment')
    const { extractTopics } = await import('./topic-extractor')

    const active = getActiveCharacter()
    if (!active) {
      console.log('[smoke] 无 active character — 跳过')
      return
    }
    console.log(`[smoke] active character: ${active.id} (${active.name})`)

    // 备份：smoke 完了删 state 文件让下次 fresh
    const statePath = join(
      process.env.HOME!,
      '.luvu',
      'characters',
      active.id,
      'emotional-state.json',
    )
    const backedUp = existsSync(statePath)

    const before = loadEmotionalState(active.id)
    console.log(
      `[smoke] before: mood=${before.current_mood} intensity=${before.mood_intensity.toFixed(2)} ` +
        `missing=${before.missing_intensity.toFixed(2)} topics=${Object.keys(before.topic_imprints).length}`,
    )

    // 模拟 dialog.ts 的 5 轮：
    //   1. 主人："今天加班好累" + LLM emotion=sad/0.7
    //   2. 主人："这个 bug 让我头疼"  + LLM emotion=sad/0.6
    //   3. 主人："你嫉妒吗" + LLM emotion=tease/0.85
    //   4. 主人："想抱抱" + LLM emotion=shy/0.6
    //   5. 主人："晚安主人" + LLM emotion=happy/0.5
    const turns = [
      { user: '今天加班好累，老板又让我做日报', emotion: 'sad', intensity: 0.7 },
      { user: '这个 bug 让我头疼，调了半天', emotion: 'sad', intensity: 0.6 },
      { user: '你嫉妒吗', emotion: 'tease', intensity: 0.85 },
      { user: '想抱抱', emotion: 'shy', intensity: 0.6 },
      { user: '晚安主人', emotion: 'happy', intensity: 0.5 },
    ]

    for (const t of turns) {
      const sentiment = emotionToSentiment(t.emotion, t.intensity)
      const topics = extractTopics(t.user)
      updateEmotionalState(active.id, (s) => {
        let next = applyChatSentiment(s, sentiment)
        for (const topic of topics) {
          next = applyTopicMention(next, topic.topic, sentiment)
        }
        next = applyTick(next)
        return next
      })
      console.log(
        `[smoke] turn "${t.user.slice(0, 20)}..." emo=${t.emotion}/${t.intensity} ` +
          `→ sentiment=${sentiment.toFixed(2)} topics=[${topics.map((x) => x.topic).join(',')}]`,
      )
    }

    const after = loadEmotionalState(active.id)
    console.log(
      `[smoke] after: mood=${after.current_mood} intensity=${after.mood_intensity.toFixed(2)} ` +
        `topics=${Object.keys(after.topic_imprints).length} history_len=${after.mood_history.length}`,
    )
    console.log(`[smoke] topic_imprints:`, JSON.stringify(after.topic_imprints, null, 2))
    console.log(
      `[smoke] mood_history last 5:`,
      after.mood_history.slice(-5).map((h) => `${h.mood}(${h.trigger})`).join(' → '),
    )

    // 断言：state 真演化了
    expect(after.mood_history.length).toBeGreaterThan(before.mood_history.length)
    expect(Object.keys(after.topic_imprints).length).toBeGreaterThan(0)
    // 工作 / 健康 / 情感 至少命中一个
    const topicKeys = Object.keys(after.topic_imprints)
    expect(
      topicKeys.includes('工作') || topicKeys.includes('健康') || topicKeys.includes('情感'),
    ).toBe(true)

    // 验证 prompt fragment 真能渲染当前状态
    const { emotionalStateToPromptFragment } = await import('./text')
    const fragment = emotionalStateToPromptFragment(after)
    console.log(`[smoke] prompt fragment (会被注入到 LLM):\n${fragment}\n`)
    expect(fragment).toContain('你现在的状态')

    // 如果是这次 smoke 创建的，清理掉避免污染开发环境
    if (!backedUp && existsSync(statePath)) {
      rmSync(statePath)
      console.log(`[smoke] cleaned smoke-created state file`)
    }
  })
})
