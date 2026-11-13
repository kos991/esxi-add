/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendHttp = process.env.VITE_API_TARGET || 'http://192.168.0.142:8080'
const backendWs = backendHttp.replace(/^http/, 'ws')

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
  server: {
    proxy: {
      '/api': { target: backendHttp, changeOrigin: true },
      '/ws': { target: backendWs, ws: true, changeOrigin: true },
    },
  },
})
