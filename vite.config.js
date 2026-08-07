import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 部署时仓库名作为 base 路径
// 本地开发用 '/'，生产环境用 '/<仓库名>/'
// 仓库名通过 CI 环境变量 GITHUB_REPOSITORY 获取（格式：owner/repo）
const base = process.env.GITHUB_REPOSITORY
  ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
  : '/'

export default defineConfig({
  base,
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '刷题',
        short_name: '刷题',
        description: '本地题库刷题应用',
        theme_color: '#1677ff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: base
      }
    })
  ]
})
