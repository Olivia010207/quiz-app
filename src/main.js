import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { syncNow } from './store.js'

createApp(App).mount('#app')

// 页面隐藏时自动同步：切 tab、最小化、锁屏、关闭页面
// visibilitychange 在这些场景都会触发，给 fetch 留出时间发请求
function syncOnHide() {
  if (document.visibilityState === 'hidden') {
    syncNow()
  }
}

document.addEventListener('visibilitychange', syncOnHide)
window.addEventListener('pagehide', syncOnHide)
window.addEventListener('beforeunload', syncOnHide)
