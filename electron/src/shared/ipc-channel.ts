/**
 * Type-safe IPC channel — eventa 风格的轻量自实现 (审计 P0)。
 *
 * 旧模式 (字符串散落 3 端，编译期不检查):
 *   main:   ipcMain.handle('llm:chat-stream', async (_e, p: {...}) => {...})
 *   preload: chatStream: (p) => invoke('llm:chat-stream', p) as ReturnType<...>
 *   shared: chatStream(p: {...}): Promise<{...}>
 *
 * 新模式 (Channel 对象 = 单一真相源):
 *   shared/channels/llm.ts:
 *     export const llmChatStream = defineChannel<RequestType, ResponseType>('llm:chat-stream')
 *
 *   main:   handleInvoke(llmChatStream, async (payload) => {...})       // payload 自动 RequestType
 *   renderer: const r = await invokeChannel(llmChatStream, {...})        // 返回值自动 ResponseType
 *
 * 改 Channel 类型 → 3 端同时 typecheck 报错。
 *
 * **不引入 @moeru/eventa 依赖** — adapter 包不稳定且锁死 airi 生态，自写更可控。
 */

/**
 * IPC 通道定义。Phantom types (__req / __res) 仅在编译期存在用于推导，
 * 运行时只是 { name: string }。
 */
export interface IpcChannel<P, R> {
  readonly name: string
  /** 仅类型推导用，runtime undefined — 不要直接读 */
  readonly __req?: P
  readonly __res?: R
}

/**
 * 声明一个 IPC 通道。第一类型参数 = request payload，第二 = response。
 *
 * @example
 *   export const llmChatStream = defineChannel<
 *     { messages: ChatMessage[]; options: ChatOptions },
 *     { ok: boolean; reason?: string }
 *   >('llm:chat-stream')
 */
export function defineChannel<P, R>(name: string): IpcChannel<P, R> {
  return { name } as IpcChannel<P, R>
}
