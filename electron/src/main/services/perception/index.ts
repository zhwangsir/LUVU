/**
 * 感知系统主控 — 启动所有 sensors，管理 config 热更新。
 */
import type { BrowserWindow } from 'electron'
import type { PerceptionConfig } from '@shared/perception'
import { DEFAULT_PERCEPTION_CONFIG } from '@shared/perception'
import { perception } from './bus'
import { MouseSensor } from './sensors/mouse-sensor'
import { IdleSensor } from './sensors/idle-sensor'
import { WindowSensor } from './sensors/window-sensor'
import { TimeSensor } from './sensors/time-sensor'
import { ScreenSensor } from './sensors/screen-sensor'

let mouseSensor: MouseSensor | null = null
let idleSensor: IdleSensor | null = null
let windowSensor: WindowSensor | null = null
let timeSensor: TimeSensor | null = null
let screenSensor: ScreenSensor | null = null
let currentConfig: PerceptionConfig = { ...DEFAULT_PERCEPTION_CONFIG }

export function startPerception(getWindow: () => BrowserWindow | null, config: Partial<PerceptionConfig> = {}): void {
  currentConfig = { ...DEFAULT_PERCEPTION_CONFIG, ...config }
  perception.attachWindow(getWindow)

  mouseSensor = new MouseSensor(getWindow, currentConfig)
  idleSensor = new IdleSensor(currentConfig)
  windowSensor = new WindowSensor(currentConfig)
  timeSensor = new TimeSensor()
  screenSensor = new ScreenSensor(currentConfig)

  mouseSensor.start()
  idleSensor.start()
  windowSensor.start()
  timeSensor.start()
  screenSensor.start()
}

/** 外部主动触发截屏 (鼠标聚焦/用户唤起) */
export async function triggerScreenSnapshot(
  reason: 'mouse_focus' | 'app_changed' | 'user_request' | 'idle_concern',
): Promise<void> {
  if (!screenSensor) return
  await screenSensor.triggerSnapshot(reason)
}

export function updatePerceptionConfig(patch: Partial<PerceptionConfig>): PerceptionConfig {
  currentConfig = { ...currentConfig, ...patch }
  mouseSensor?.updateConfig(currentConfig)
  idleSensor?.updateConfig(currentConfig)
  windowSensor?.updateConfig(currentConfig)
  screenSensor?.updateConfig(currentConfig)
  return currentConfig
}

export function getPerceptionConfig(): PerceptionConfig {
  return { ...currentConfig }
}

export function stopPerception(): void {
  mouseSensor?.stop()
  idleSensor?.stop()
  windowSensor?.stop()
  timeSensor?.stop()
  screenSensor?.stop()
  mouseSensor = null
  idleSensor = null
  windowSensor = null
  timeSensor = null
  screenSensor = null
}

export { perception }
