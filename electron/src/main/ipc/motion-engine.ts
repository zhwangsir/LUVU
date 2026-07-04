/**
 * MotionEngine IPC handlers — type-safe channels (Phase 1 G).
 */
import {
  engineByContext,
  engineByEmotion,
  engineCreate,
  engineDelete,
  engineGet,
  engineGetVersion,
  engineList,
  engineListVersions,
  engineRecordPlay,
  engineSaveVersion,
  engineSetRating,
  engineSync,
  engineTopRated,
  engineUpdate,
} from '@shared/channels/motion-engine'
import * as storage from '../services/motion-engine/storage'
import { syncModel } from '../services/motion-engine/sync'
import { handleInvoke } from './channel-helpers'

export function registerMotionEngineIpc(): void {
  // CRUD
  handleInvoke(engineList, (filter) => storage.list(filter ?? {}))
  handleInvoke(engineGet, (id) => storage.get(id))
  handleInvoke(engineCreate, (input) => storage.create(input))
  handleInvoke(engineUpdate, (payload) => storage.update(payload.id, payload.patch))
  handleInvoke(engineDelete, (id) => {
    storage.deleteEntry(id)
    return { ok: true }
  })

  // 版本
  handleInvoke(engineSaveVersion, (payload) =>
    storage.saveVersion(payload.entry_id, payload.snapshot_json, payload.edited_by),
  )
  handleInvoke(engineListVersions, (entryId) => storage.listVersions(entryId))
  handleInvoke(engineGetVersion, (payload) =>
    storage.getVersion(payload.entry_id, payload.version_no),
  )

  // 行为
  handleInvoke(engineRecordPlay, (id) => storage.recordPlay(id))
  handleInvoke(engineSetRating, (payload) => storage.setRating(payload.id, payload.rating))

  // 查询
  handleInvoke(engineByEmotion, (payload) =>
    storage.findByEmotion(payload.model_dir, payload.emotion, payload.limit),
  )
  handleInvoke(engineByContext, (payload) =>
    storage.findByContext(payload.model_dir, payload.context, payload.limit),
  )
  handleInvoke(engineTopRated, (payload) => storage.topRated(payload.model_dir, payload.n))

  // 同步
  handleInvoke(engineSync, (modelDir) => syncModel(modelDir))
}
