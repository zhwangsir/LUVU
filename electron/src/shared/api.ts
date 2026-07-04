/**
 * 渲染进程通过 window.api.* 调用主进程能力的接口契约。
 * preload 与 renderer 共享此类型。
 */
import type {
  ChatMessage,
  ChatOptions,
  IpcStreamChunk,
  LlmProvider,
  ModelInfo,
  RuntimeConfig,
  SoulConfig,
} from './types'
import type { Character, CreateCharacterInput } from './character'
import type {
  ApprovalDecision,
  ApprovalRequest,
  ToolDefinition,
  ToolInvocation,
  ToolPolicy,
  ToolResult,
} from './tools'
import type { ModelMotionSummary, MotionDraft } from './motion'
import type { SemanticsMap } from './motion-semantics'
import type { ApplyResult, LibrarySummary, MotionTemplate } from './motion-library'
import type { MotionEntry, MotionFilter, MotionVersion, SyncReport } from './motion-engine'
import type { TriggerDecision, TriggerEvent, TriggerRule } from './trigger'
import type { PerceptionConfig, PerceptionEvent, PerceptionEventType } from './perception'
import type { AttentionConfig, AttentionSnapshot, BehaviorPlan } from './attention'

export interface SystemPaths {
  projectRoot: string
  userDataDir: string
  soulDir: string
  modelSearchPaths: string[]
  historyDbPath: string
}

export type ModelInfoExt = ModelInfo & { file_url: string }

/** v0.12: character enrichment 进度 */
export interface EnrichProgress {
  total: number
  done: number
  failed: number
  current?: string
  error?: string
}

/** v0.12: 在线资源 */
export type RepoSource = 'huggingface' | 'github' | 'browse_only'
export interface RecommendedRepo {
  id: string
  name: string
  description: string
  kind: 'rvc' | 'live2d'
  source: RepoSource
  asset_path?: string
  hint?: string
  browse_url?: string
}
export interface OnlineAsset {
  type: 'file' | 'directory'
  path: string
  size: number
}
export interface OnlineInstallProgress {
  install_id: string
  asset_path: string
  stage: 'download' | 'extract' | 'deploy' | 'done' | 'fail'
  percent: number
  message?: string
  bytes_done?: number
  bytes_total?: number
}
export interface OnlineInstallDone {
  install_id: string
  ok: boolean
  voice_id?: string
  reason?: string
}

export interface LuvuApi {
  system: {
    version(): Promise<string>
    paths(): Promise<SystemPaths>
    revealDataDir(): Promise<string>
    revealModelsDir(): Promise<string>
    openExternal(url: string): Promise<{ ok: boolean; reason?: string }>
    diskUsage(force?: boolean): Promise<{
      entries: Array<{
        label: string
        path: string
        bytes: number
        exists: boolean
        hint: string
        cleanable: boolean
      }>
      total_bytes: number
      computed_at_ms: number
    }>
    cleanPath(path: string): Promise<{ ok: boolean; freed_bytes: number; reason?: string }>
    /** v0.17 P3: 监听 macOS tray / Windows 托盘菜单点击，id 跟 ContextMenu menuItems 一一对应 */
    onTrayAction(cb: (id: string) => void): () => void
  }
  window: {
    startDrag(): Promise<{ ok: boolean; reason?: string }>
    softDrag(x: number, y: number): void
    setIgnoreMouse(ignore: boolean, forward?: boolean): Promise<{ ok: boolean }>
    getBounds(): Promise<{ x: number; y: number; width: number; height: number } | null>
    setBounds(b: Partial<{ x: number; y: number; width: number; height: number }>): Promise<{ ok: boolean }>
    close(): Promise<void>
    minimize(): Promise<void>
    togglePin(pin: boolean): Promise<void>
  }
  cursor: {
    pollStart(): Promise<void>
    pollStop(): Promise<void>
    onTick(cb: (pt: { x: number; y: number; inside: boolean }) => void): () => void
  }
  config: {
    load(): Promise<RuntimeConfig>
    save(dto: RuntimeConfig): Promise<RuntimeConfig>
    onChanged(cb: (cfg: RuntimeConfig) => void): () => void
  }
  models: {
    scan(): Promise<ModelInfoExt[]>
    heal(payload: { model_json_path: string }): Promise<{
      ok: boolean
      reason?: string
      added: {
        motions: string[]
        expressions: string[]
        bound_orphans: { motions: string[]; expressions: string[] }
      }
    }>
    findDuplicates(): Promise<{
      total_models: number
      groups: Array<{
        group_key: string
        confidence: 'exact' | 'same_moc' | 'similar_dir'
        keep: ModelInfoExt
        others: ModelInfoExt[]
      }>
      exact_duplicates: number
      exact_disk_kb: number
    }>
    applyDedup(payload?: { group_keys?: string[]; dry_run?: boolean }): Promise<{
      ok: boolean
      deleted: string[]
      failed: Array<{ path: string; reason: string }>
      freed_kb: number
    }>
    mergeGroups(payload?: { group_keys?: string[] }): Promise<{
      ok: boolean
      merged_groups: number
      added_motions: number
      added_expressions: number
      archived_model_jsons: string[]
      skipped: Array<{ group_key: string; reason: string }>
    }>
    describe(payload: {
      model_dir: string
      model_json_path: string
      display: string
      ip: string
      motion_count: number
      expression_count: number
    }): Promise<{ ok: boolean; text?: string; reason?: string; from_cache?: boolean }>
    cachedDescriptions(): Promise<Record<string, string>>
    getPreference(
      characterId: string,
    ): Promise<{ scale: number; offset_x?: number; offset_y: number; last_used_at: number } | null>
    setPreference(payload: {
      character_id: string
      scale: number
      offset_x?: number
      offset_y: number
    }): Promise<{ ok: boolean }>
    // v0.12
    favorites(): Promise<{
      favorites: string[]
      recent: Array<{ dir: string; used_at: number }>
    }>
    toggleFavorite(dir: string): Promise<{ is_favorite: boolean }>
    markRecent(dir: string): Promise<{ ok: boolean }>
    clearRecent(): Promise<{ ok: boolean }>
    enrichCached(): Promise<
      Record<string, {
        character_id: string
        chinese_name: string
        intro_one_line: string
        tags: string[]
        source_dir: string
        enriched_at: number
      }>
    >
    enrichStart(): Promise<{ ok: boolean }>
    enrichAbort(): Promise<{ ok: boolean }>
    enrichClear(): Promise<{ ok: boolean }>
    onEnrichProgress(cb: (p: EnrichProgress) => void): () => void
    /** v0.15 E1: 模型行业标准学习库 */
    computeLearnings(force?: boolean): Promise<{
      total_models: number
      complete_models: number
      standard_motion_groups: string[]
      standard_expression_names: string[]
      physics_coverage: number
      [k: string]: unknown
    }>
    getLearnings(): Promise<{
      total_models: number
      standard_motion_groups: string[]
      standard_expression_names: string[]
      [k: string]: unknown
    } | null>
    evaluate(payload: { model_json_path: string }): Promise<{
      score: number
      grade: 'A' | 'B' | 'C' | 'D'
      missing_motion_groups: string[]
      missing_expression_names: string[]
      missing_physics: boolean
      missing_eye_blink: boolean
      missing_lip_sync: boolean
      hints: string[]
    } | null>
    /** v0.15 E2 / v0.16: 自动补 motion + expression */
    autoFill(payload: { model_json_path: string; skip_expressions?: boolean }): Promise<{
      ok: boolean
      added_motions: string[]
      added_expressions: string[]
      failed: string[]
      reason?: string
    }>
    /** v0.16 T2: 8 标准 expression 一键 */
    applyExpressionPack(payload: { model_json_path: string }): Promise<{
      ok: boolean
      added: string[]
      skipped: string[]
      reason?: string
    }>
    /** v0.16 T3: 物理预设 */
    listPhysicsPresets(): Promise<Array<{ id: string; label: string; description: string }>>
    applyPhysicsPreset(payload: { model_json_path: string; preset_id: string }): Promise<{
      ok: boolean
      applied_outputs: string[]
      reason?: string
    }>
    /** v0.16 T4: 参数命名分析 */
    analyzeParams(payload: { model_json_path: string }): Promise<{
      total_params: number
      non_standard_count: number
      usages: Array<{
        param_id: string
        motion_refs: number
        expression_refs: number
        observed_min: number
        observed_max: number
        non_standard: boolean
        reason?: string
        suggested_id?: string
      }>
    }>
  }
  thumbs: {
    get(characterId: string): Promise<{
      exists: boolean
      url?: string
      size_bytes?: number
      age_ms?: number
      failed?: boolean
    }>
    /** v0.13: 批量查询，消除 N+1 IPC（performance audit ROI 2） */
    getBatch(characterIds: string[]): Promise<Record<string, {
      exists: boolean
      url?: string
      size_bytes?: number
      age_ms?: number
      failed?: boolean
    }>>
    save(payload: {
      character_id: string
      webp_base64: string
    }): Promise<{ ok: boolean; reason?: string }>
    markFailed(payload: { character_id: string; reason: string }): Promise<{ ok: boolean }>
    listMissing(characterIds: string[]): Promise<string[]>
    clearAll(): Promise<{ deleted: number }>
  }
  characters: {
    list(): Promise<Character[]>
    active(): Promise<Character | null>
    get(id: string): Promise<Character | null>
    create(input: CreateCharacterInput): Promise<
      { ok: true; character: Character } | { ok: false; reason: string }
    >
    update(payload: { id: string; patch: Partial<Character> }): Promise<
      { ok: true; character: Character } | { ok: false; reason: string }
    >
    delete(id: string): Promise<{ ok: boolean; reason?: string }>
    /** v0.15 B3: 克隆角色 (复制灵魂 + 偏好，重置亲密度/历史) */
    clone(payload: { source_id: string; new_name?: string }): Promise<{
      ok: boolean
      character?: Character
      reason?: string
    }>
    switch(id: string): Promise<{ ok: boolean; character?: Character; reason?: string }>
    /**
     * v0.21 Round J:M8 灵魂社会 — list 当前 mounted character(代码层并行存活的角色)。
     * 总返非空数组(含 active);旧 schema 用户返 [active]。
     */
    listMounted(): Promise<Character[]>
    /**
     * v0.21 Round J:M8 — 设置 mounted character 列表。
     * 校验:空数组 / 不存在 id / 超 16 个(DoS 防护)→ {ok:false, reason}
     * 自动:去重 + 若 active 不在列表自动补首位 + 持久化
     */
    setMounted(ids: string[]): Promise<
      | { ok: true; mounted_ids: string[]; mounted: Character[] }
      | { ok: false; reason: string }
    >
    /** v0.14 T5: 对话完成时调用，更新亲密度 */
    recordChat(): Promise<{ ok: boolean; character?: Character | null; reason?: string }>
    /** v0.14 T8: 读 character 灵魂目录的 yaml 文件（filename 限 [a-zA-Z0-9_-]+.yaml） */
    readSoulFile(payload: { id: string; filename: string }): Promise<{ ok: boolean; content?: string; reason?: string }>
    writeSoulFile(payload: { id: string; filename: string; content: string }): Promise<{ ok: boolean; reason?: string }>
    onSwitched(cb: (character: Character) => void): () => void
  }
  soul: {
    load(): Promise<{ config: SoulConfig; sources: string[] }>
    systemPrompt(): Promise<string>
    pickDirectory(): Promise<string | null>
    saveAvatar(avatar: Partial<SoulConfig['avatar']>): Promise<{ ok: boolean; path: string; reason?: string }>
    onChanged(cb: () => void): () => void
  }
  llm: {
    chatStream(payload: {
      streamId: string
      messages: ChatMessage[]
      options?: Partial<ChatOptions>
      provider_override?: { provider?: LlmProvider; endpoint?: string; api_key?: string; model?: string }
      tools?: ToolDefinition[]
      tool_results?: Array<{ tool_use_id: string; content: string; is_error?: boolean }>
    }): Promise<{ ok: boolean; reason?: string }>
    abort(streamId: string): Promise<{ ok: boolean }>
    test(payload: {
      provider: LlmProvider
      endpoint: string
      api_key: string
      model: string
    }): Promise<{ ok: boolean; message: string }>
    healthCheck(payload?: {
      provider?: LlmProvider
      endpoint?: string
      api_key?: string
      model?: string
      test_vision?: boolean
    }): Promise<{
      provider: LlmProvider
      endpoint: string
      model: string
      overall_ok: boolean
      results: Array<{
        test: string
        ok: boolean
        detail: string
        is_thinking_model?: boolean
        supports_vision?: boolean
        latency_ms?: number
      }>
      recommendations: string[]
    }>
    /** UX R20: 一键自动检测本机常见 LLM endpoint + 拉模型列表 */
    autoDetect(payload?: { customEndpoint?: string }): Promise<{
      found: Array<{
        endpoint: string
        label: string
        models: string[]
        latencyMs: number
      }>
      failed: Array<{ endpoint: string; reason: string }>
      totalMs: number
    }>
    onChunk(cb: (chunk: IpcStreamChunk) => void): () => void
  }
  motion: {
    summarize(modelDir: string): Promise<ModelMotionSummary>
    /** 推断参数语义（cdi3 / 命名规则 / 协同分析） */
    introspect(modelDir: string): Promise<SemanticsMap>
    /** Markdown 格式的人类可读 introspection 报告 */
    introspectDebug(modelDir: string): Promise<string>
    generate(payload: {
      model_dir: string
      description: string
      style?: string
      examples?: number
      strategy?: string
    }): Promise<{ ok: boolean; draft?: MotionDraft; reason?: string; strategy_used?: string }>
    write(payload: {
      model_json_path: string
      draft: MotionDraft
      group?: string
    }): Promise<{ ok: boolean; motion_path?: string; reason?: string }>
    onWritten(
      cb: (e: { model_json_path: string; motion_relative?: string }) => void,
    ): () => void
  }
  library: {
    summary(): Promise<LibrarySummary>
    list(): Promise<MotionTemplate[]>
    get(id: string): Promise<MotionTemplate | undefined>
    reload(): Promise<LibrarySummary>
    apply(payload: {
      template_id: string
      model_dir: string
      speed_scale?: number
      intensity_scale?: number
      name_suffix?: string
    }): Promise<ApplyResult>
  }
  attention: {
    getConfig(): Promise<AttentionConfig>
    updateConfig(patch: Partial<AttentionConfig>): Promise<AttentionConfig>
    snapshot(): Promise<AttentionSnapshot>
    recentPlans(limit?: number): Promise<BehaviorPlan[]>
    onPlan(cb: (plan: BehaviorPlan) => void): () => void
  }
  perception: {
    getConfig(): Promise<PerceptionConfig>
    updateConfig(patch: Partial<PerceptionConfig>): Promise<PerceptionConfig>
    recent(payload: { limit?: number; types?: PerceptionEventType[] }): Promise<PerceptionEvent[]>
    onEvent(cb: (e: PerceptionEvent) => void): () => void
    triggerSnapshot(
      reason?: 'mouse_focus' | 'app_changed' | 'user_request' | 'idle_concern',
    ): Promise<void>
  }
  trigger: {
    decide(payload: {
      event: TriggerEvent
      model_dir?: string
      ignore_cooldown?: boolean
    }): Promise<TriggerDecision | null>
    listRules(): Promise<TriggerRule[]>
    saveRules(rules: TriggerRule[]): Promise<TriggerRule[]>
    resetDefaults(): Promise<TriggerRule[]>
    resetCooldowns(): Promise<{ ok: boolean }>
  }
  strategy: {
    list(): Promise<
      Array<{
        id: string
        display_name_zh: string
        description: string
        cost: 'low' | 'medium' | 'high'
      }>
    >
  }
  engine: {
    list(filter?: MotionFilter): Promise<MotionEntry[]>
    get(id: number): Promise<MotionEntry | null>
    create(input: {
      model_dir: string
      name: string
      file_path: string
      group_name?: string
      source: MotionEntry['source']
      strategy?: string | null
      prompt?: string | null
      llm_provider?: string | null
      llm_model?: string | null
      duration_ms?: number
      loop_flag?: boolean
      param_count?: number
      validator_score?: number | null
      scorer_score?: number | null
      parent_entry_id?: number | null
      emotion_tags?: string[]
      context_tags?: string[]
    }): Promise<MotionEntry>
    update(payload: { id: number; patch: Partial<MotionEntry> }): Promise<MotionEntry>
    delete(id: number): Promise<{ ok: boolean }>
    saveVersion(payload: {
      entry_id: number
      snapshot_json: string
      edited_by: string
    }): Promise<MotionVersion>
    listVersions(entryId: number): Promise<MotionVersion[]>
    getVersion(payload: { entry_id: number; version_no: number }): Promise<MotionVersion | null>
    recordPlay(id: number): Promise<void>
    setRating(payload: { id: number; rating: -1 | 0 | 1 }): Promise<void>
    byEmotion(payload: { model_dir: string; emotion: string; limit?: number }): Promise<MotionEntry[]>
    byContext(payload: { model_dir: string; context: string; limit?: number }): Promise<MotionEntry[]>
    topRated(payload: { model_dir: string; n?: number }): Promise<MotionEntry[]>
    sync(modelDir: string): Promise<SyncReport>
  }
  market: {
    installZip(zipPath: string): Promise<{
      ok: boolean
      installed_to?: string
      detected_name?: string
      model_file?: string
      reason?: string
    }>
    installUrl(url: string): Promise<{
      ok: boolean
      installed_to?: string
      detected_name?: string
      model_file?: string
      reason?: string
    }>
    installPath(path: string): Promise<{
      ok: boolean
      installed_to?: string
      detected_name?: string
      model_file?: string
      reason?: string
    }>
    installPaths(paths: string[]): Promise<
      Array<{
        ok: boolean
        installed_to?: string
        detected_name?: string
        model_file?: string
        reason?: string
      }>
    >
    onInstalled(
      cb: (
        results: Array<{
          ok: boolean
          installed_to?: string
          detected_name?: string
          model_file?: string
        }>,
      ) => void,
    ): () => void
  }
  tools: {
    list(): Promise<ToolDefinition[]>
    /** v0.21：按 query 检索相关工具子集（工具膨胀时减少发给 LLM 的数量） */
    relevant(payload: { query: string; k?: number }): Promise<ToolDefinition[]>
    run(call: ToolInvocation): Promise<ToolResult>
    policyGet(): Promise<ToolPolicy>
    policySet(payload: {
      tool_name: string
      decision: 'always_allow' | 'always_deny' | null
    }): Promise<ToolPolicy>
    policyClear(): Promise<ToolPolicy>
    onApprovalRequest(cb: (req: ApprovalRequest) => void): () => void
    sendApprovalDecision(payload: { invocation_id: string; decision: ApprovalDecision }): void
    /** v0.17: MCP server register/unregister 后主进程推送，让 renderer 重拉 tools list */
    onChanged(cb: () => void): () => void
  }
  tts: {
    speak(payload: {
      text: string
      voice?: string
      emotion?: string
      /** P5: 0..1 emotion intensity, prosody mood-aware 调节用 */
      intensity?: number
    }): Promise<{
      ok: boolean
      audio_b64?: string
      mime?: string
      reason?: string
    }>
    probe(): Promise<{ ok: boolean; status?: number; reason?: string }>
    listRvcVoices(): Promise<{
      ok: boolean
      voices: string[]
      reason?: string
      sidecar?: string
    }>
  }
  history: {
    listRecent(limit?: number): Promise<
      Array<{
        id: string
        role: 'user' | 'assistant' | 'system'
        text: string
        emotion: string | null
        intensity: number | null
        ts: number
        error: string | null
        session_id: string
      }>
    >
    append(turn: {
      id: string
      role: 'user' | 'assistant' | 'system'
      text: string
      emotion: string | null
      intensity: number | null
      ts: number
      error: string | null
    }): Promise<{ ok: boolean }>
    clear(): Promise<{ deleted: number }>
  }
  online: {
    listRecommended(): Promise<RecommendedRepo[]>
    listAssets(payload: { repo_id: string; sub_path?: string }): Promise<OnlineAsset[]>
    checkInstalled(payload: {
      kind: 'rvc' | 'live2d'
      voice_id?: string
      repo_slug?: string
      asset_name?: string
    }): Promise<{ installed: boolean }>
    install(payload: {
      repo_id: string
      asset_path: string
      kind: 'rvc' | 'live2d'
    }): Promise<{ ok: boolean; install_id: string }>
    cancelInstall(installId: string): Promise<{ ok: boolean }>
    installCustom(payload: {
      url: string
      kind: 'rvc' | 'live2d'
    }): Promise<{ ok: boolean; install_id: string }>
    onInstallProgress(cb: (p: OnlineInstallProgress) => void): () => void
    onInstallDone(cb: (p: OnlineInstallDone) => void): () => void
  }
  /** v0.17 ComfyUI Phase 2「创作工坊」：文生图 / 图生图 / 文生视频 / 图生视频 */
  comfyui: {
    status(): Promise<{ ok: boolean; endpoint?: string; detail?: unknown; error?: string }>

    // 动态资源列表
    listCheckpoints(): Promise<{ ok: boolean; items: string[]; error?: string }>
    listLoras(): Promise<{ ok: boolean; items: string[]; error?: string }>
    listSamplers(): Promise<{ ok: boolean; samplers: string[]; schedulers: string[]; error?: string }>
    listVideoModels(): Promise<{ ok: boolean; items: string[]; error?: string }>

    // 图片上传
    uploadImage(payload: { srcPath: string }): Promise<{
      ok: boolean
      localCachePath?: string
      comfyName?: string
      subfolder?: string
      type?: string
      error?: string
    }>

    // 通用 T2I
    generateImage(payload: {
      prompt: string
      negative?: string
      checkpoint: string
      width?: number
      height?: number
      steps?: number
      cfg?: number
      sampler?: string
      scheduler?: string
      seed?: number
      loras?: Array<{ name: string; strength_model?: number; strength_clip?: number }>
      filenamePrefix?: string
    }): Promise<{ ok: boolean; prompt_id?: string; files?: string[]; error?: string }>

    // 图生图
    generateI2I(payload: {
      prompt: string
      negative?: string
      checkpoint: string
      inputImage: string
      denoise?: number
      width?: number
      height?: number
      steps?: number
      cfg?: number
      sampler?: string
      scheduler?: string
      seed?: number
      loras?: Array<{ name: string; strength_model?: number; strength_clip?: number }>
      filenamePrefix?: string
    }): Promise<{ ok: boolean; prompt_id?: string; files?: string[]; error?: string }>

    // 文生视频
    generateVideoT2V(payload: {
      prompt: string
      model: string
      seed?: number
      promptExtend?: boolean
      watermark?: boolean
      filenamePrefix?: string
    }): Promise<{ ok: boolean; prompt_id?: string; files?: string[]; error?: string }>

    // 图生视频
    generateVideoI2V(payload: {
      prompt?: string
      negative?: string
      inputImage: string
      length?: number
      width?: number
      height?: number
      checkpoint: string
      steps?: number
      cfg?: number
      sampler?: string
      scheduler?: string
      seed?: number
      filenamePrefix?: string
    }): Promise<{ ok: boolean; prompt_id?: string; files?: string[]; error?: string }>

    // 旧 Phase 1（保留）
    generateSticker(payload: {
      emotion: 'happy' | 'sad' | 'angry' | 'shy' | 'surprise' | 'tease' | 'sleepy' | 'neutral'
      extraPrompt?: string
      checkpoint?: string
      seed?: number
      steps?: number
      cfg?: number
    }): Promise<{ ok: boolean; prompt_id?: string; files?: string[]; error?: string }>
    generateBackground(payload: {
      theme: string
      checkpoint?: string
      seed?: number
      steps?: number
      cfg?: number
      width?: number
      height?: number
    }): Promise<{ ok: boolean; prompt_id?: string; files?: string[]; error?: string }>

    listRecent(kind?: 'sticker' | 'background' | 'image' | 'video' | 'all'): Promise<Array<{
      kind: string
      path: string
      mtime: number
      size: number
    }>>
    cancel(): Promise<{ ok: boolean; error?: string }>
    onProgress(cb: (p: {
      kind: string
      state: 'queued' | 'running' | 'done'
      [k: string]: unknown
    }) => void): () => void
  }
  /** v0.17 M2：长期向量记忆 — 跨会话陪伴的核心数据层 */
  memory: {
    list(opts?: { kind?: 'fact' | 'preference' | 'event' | 'reflection'; limit?: number }): Promise<Array<{
      id: string
      kind: 'fact' | 'preference' | 'event' | 'reflection'
      text: string
      embedding: number[]
      importance: number
      source: string
      ts: number
    }>>
    count(): Promise<number>
    add(payload: {
      kind: 'fact' | 'preference' | 'event' | 'reflection'
      text: string
      importance: number
      embedding?: number[]
    }): Promise<{ ok: boolean; reason?: string; memory?: unknown }>
    delete(id: string): Promise<{ ok: boolean; reason?: string }>
    search(payload: { query_embedding: number[]; k?: number }): Promise<Array<{
      id: string
      text: string
      kind: string
      importance: number
      score: number
      ts: number
    }>>
    /** dialog reply-end 后异步抽取记忆 — main 实际返回 Memory[] (fire-and-forget) */
    extractFromTurn(payload: {
      user_text: string
      assistant_text: string
      turn_id: string
    }): Promise<Array<{
      id: string
      kind: 'fact' | 'preference' | 'event' | 'reflection'
      text: string
      embedding: number[]
      importance: number
      source: string
      ts: number
    }>>
    /** chat 前 prepend RAG context */
    ragContext(payload: { query_text: string; k?: number }): Promise<{
      ok: boolean
      context?: string
      matches?: number
      reason?: string
    }>
    /** 每日 reflection — 角色总结今天发生了什么 */
    dailyReflection(): Promise<{ ok: boolean; text?: string; reason?: string }>
    /**
     * v0.21 Round U:M8 灵魂社会 inspector 入口 — 列指定 character 的 cross-character
     * event memory(Round N 写入)。renderer UI 用来展示"哪个灵魂记得听过哪些话"。
     * limit 默认 20,主进程上限 100。character 不存在 / 空 id 返 []。
     */
    listCrossCharacter(payload: { characterId: string; limit?: number }): Promise<Array<{
      id: string
      kind: 'fact' | 'preference' | 'event' | 'reflection'
      text: string
      embedding: number[]
      importance: number
      source: string
      ts: number
    }>>
  }

  /** v0.17 P：外部 MCP server 客户端 */
  mcp: {
    /** 列已注册的外部 MCP server */
    listServers(): Promise<Array<{ id: string; name: string; command: string; status: 'running' | 'stopped' | 'error'; toolCount: number }>>
    /** 注册并启动一个 stdio MCP server */
    register(payload: {
      id: string
      name: string
      command: string
      args?: string[]
      env?: Record<string, string>
    }): Promise<{ ok: boolean; toolCount?: number; reason?: string }>
    /** 关停并移除 */
    unregister(id: string): Promise<{ ok: boolean }>
    /** 列某个 server 的工具清单 */
    listTools(serverId: string): Promise<Array<{ name: string; description: string; inputSchema?: unknown }>>
    /** 调用一个外部 MCP 工具 */
    callTool(payload: {
      serverId: string
      toolName: string
      args: Record<string, unknown>
    }): Promise<{ ok: boolean; result?: unknown; reason?: string }>
  }

  /** Phase 1 K: 角色一致性测试框架 — settings 面板触发跑 50 题 */
  eval: {
    run(payload?: { limit?: number }): Promise<{
      ok: boolean
      report?: import('./channels/eval').EvalReportShape
      reason?: string
    }>
    abort(): Promise<{ ok: boolean }>
    history(): Promise<import('./channels/eval').EvalHistoryEntryShape[]>
    clearHistory(): Promise<{ ok: boolean }>
    onProgress(
      cb: (p: {
        done: number
        total: number
        current?: { question_id: string; category: string; score: number }
      }) => void,
    ): () => void
  }

  /** P5: soul auto-learner — 把 topic_imprints 写回 learned_traits.yaml */
  soulLearner: {
    sync(payload?: {
      character_id?: string
    }): Promise<import('./channels/soul-learner').SoulLearnerSyncResult>
  }

  /** P5: soul yaml 改动历史 — SoulEditor 每次保存自动 diff + audit log */
  soulChangeLog: {
    list(payload?: {
      character_id?: string
    }): Promise<import('./channels/soul-change-log').SoulChangeLogEntryShape[]>
    clear(payload?: { character_id?: string }): Promise<{ ok: boolean }>
  }

  /** P5: character pack export/import — 打包 character soul+emotional+thumb 成 zip 分享 */
  characterPack: {
    export(payload?: {
      characterId?: string
      includeEmotional?: boolean
      includeThumb?: boolean
      includeMemory?: boolean
    }): Promise<import('./channels/character-pack').CharacterPackExportResult>
    import(payload?: {
      newName?: string
      includeEmotional?: boolean
      includeMemory?: boolean
    }): Promise<import('./channels/character-pack').CharacterPackImportResult>
  }

  /** Phase 1 J: 情感状态轨迹 — 每轮对话 dialog.ts fire-and-forget onReply */
  emotional: {
    onReply(payload: {
      user_text: string
      assistant_text: string
      emotion?: string
      intensity?: number
    }): Promise<{ ok: boolean }>
    getState(): Promise<import('./emotional').EmotionalState | null>
    tick(): Promise<import('./emotional').EmotionalState | null>
    setMood(payload: {
      mood: import('./emotional').Mood
      intensity: number
      trigger?: string
    }): Promise<import('./emotional').EmotionalState | null>
  }

  /** v0.17 E：Agent 自动化 — LUVU 操控鼠标 / 键盘 / 截屏 */
  agent: {
    halt(on: boolean): Promise<{ halted: boolean } | { ok: false; error: string }>
    isHalted(): Promise<{ halted: boolean } | { ok: false; error: string }>
    cursorPos(): Promise<{ x: number; y: number } | { ok: false; error: string }>
    screenSize(): Promise<{ width: number; height: number } | { ok: false; error: string }>
    move(p: { x: number; y: number; duration_ms?: number }): Promise<{ ok: boolean; error?: string }>
    click(p: { x: number; y: number; button?: 'left' | 'right' | 'middle' }): Promise<{ ok: boolean; error?: string }>
    doubleClick(p: { x: number; y: number }): Promise<{ ok: boolean; error?: string }>
    scroll(p: { dy: number; dx?: number }): Promise<{ ok: boolean; error?: string }>
    drag(p: { from_x: number; from_y: number; to_x: number; to_y: number }): Promise<{ ok: boolean; error?: string }>
    type(p: { text: string }): Promise<{ ok: boolean; error?: string }>
    key(p: { combo: string[] }): Promise<{ ok: boolean; error?: string }>
    clickAndType(p: { x: number; y: number; text: string }): Promise<{ ok: boolean; error?: string }>
    screenshot(region?: { x: number; y: number; w: number; h: number }): Promise<{
      ok: boolean
      base64?: string
      width?: number
      height?: number
      error?: string
    }>
    /** E-2: vision LLM 看屏找东西的位置 */
    find(p: { description: string }): Promise<{
      ok: boolean
      x?: number
      y?: number
      confidence?: number
      raw?: string
      error?: string
    }>
    /** find + 立即点击 */
    findAndClick(p: { description: string }): Promise<{
      ok: boolean
      x?: number
      y?: number
      confidence?: number
      raw?: string
      error?: string
    }>
    /** E-3: 给一个目标，agent 自己循环（截屏→LLM→执行）直到完成或失败 */
    runTask(p: { goal: string; max_steps?: number }): Promise<{
      ok: boolean
      goal: string
      steps: Array<{
        step: number
        ts: number
        thought?: string
        action: string
        params?: Record<string, unknown>
        result?: { ok: boolean; error?: string; coord?: { x: number; y: number } }
      }>
      final_message?: string
      reason?: string
    }>
    onStep(cb: (step: {
      step: number
      ts: number
      thought?: string
      action: string
      params?: Record<string, unknown>
      result?: { ok: boolean; error?: string; coord?: { x: number; y: number } }
    }) => void): () => void
  }
}
