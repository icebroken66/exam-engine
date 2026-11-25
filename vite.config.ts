import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', reader: 'reader-lab.html', workbench: 'reader-workbench.html', assistantReview:'assistant-review.html', workspaceReview:'workspace-review.html' } } },
  preview: { proxy: { '/api': process.env.EXAM_ENGINE_API_URL || 'http://127.0.0.1:8010' } },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': process.env.EXAM_ENGINE_API_URL || 'http://127.0.0.1:8010',
    },
  },
})
