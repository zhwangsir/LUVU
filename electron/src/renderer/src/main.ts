import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles/global.css'
import { bus } from './infra/eventbus'

const app = createApp(App)

// 全局错误兜底：未被 ErrorBoundary 接住的 → toast + console.error
app.config.errorHandler = (err, _instance, info) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[vue] uncaught', info, err)
  bus.emit('ui:toast', { kind: 'error', message: `渲染错误：${msg}`, ttl_ms: 6000 })
}

window.addEventListener('error', (e) => {
  bus.emit('ui:toast', {
    kind: 'error',
    message: `JS 错误：${e.message}`,
    ttl_ms: 6000,
  })
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason instanceof Error ? e.reason.message : String(e.reason ?? 'unknown')
  bus.emit('ui:toast', {
    kind: 'error',
    message: `异步错误：${reason}`,
    ttl_ms: 6000,
  })
})

app.use(createPinia())
app.mount('#app')
