import { defineConfig } from '@umijs/max'

export default defineConfig({
  npmClient: 'npm',
  outputPath: 'dist',
  esbuildMinifyIIFE: true,
  antd: {},
  access: {},
  model: {},
  initialState: {},
  request: {},
  routes: [
    { path: '/', component: '@/pages/index' },
    { path: '/buckets', component: '@/pages/buckets' },
    { path: '/files', component: '@/pages/files' },
    { path: '/build', component: '@/pages/build' },
    { path: '/tasks', component: '@/pages/tasks' },
    { path: '/tasks/:taskId', component: '@/pages/tasks/[taskId]' },
  ],
  history: { type: 'browser' },
  proxy: {
    '/api': {
      target: 'http://localhost:8080',
      changeOrigin: true,
    },
    '/ws': {
      target: 'ws://localhost:8080',
      ws: true,
      changeOrigin: true,
    },
  },
})
