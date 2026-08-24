import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/admin/V2/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200
  }
})
