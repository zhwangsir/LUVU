/**
 * Channel-style IPC helpers — main process side.
 *
 * 把 ipcMain.handle('llm:chat-stream', async (_e, payload: {...}) => {...})
 * 改成 handleInvoke(llmChatStream, async (payload, evt) => {...})
 *
 * payload / 返回值类型从 Channel 自动推，写错不通过 typecheck。
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcChannel } from '@shared/ipc-channel'

/** 注册一个 type-safe channel handler。返回 unregister 函数。 */
export function handleInvoke<P, R>(
  channel: IpcChannel<P, R>,
  handler: (payload: P, evt: IpcMainInvokeEvent) => Promise<R> | R,
): () => void {
  const wrapped = async (evt: IpcMainInvokeEvent, payload: P): Promise<R> => {
    return handler(payload, evt)
  }
  ipcMain.handle(channel.name, wrapped)
  return () => ipcMain.removeHandler(channel.name)
}

/** 把未知异常标准化为 IPC 错误对象 */
export function toIpcError(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}
