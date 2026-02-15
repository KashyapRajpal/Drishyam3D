import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  // For GitHub Pages, set base to the repo name (change if you fork/rename)
  base: '/Drishyam3D/',
  plugins: [react()],
  resolve: {
    alias: {
      '@engine': path.resolve(__dirname, '../scripts/engine'),
      '@scripts': path.resolve(__dirname, '../scripts'),
      '@assets': path.resolve(__dirname, '../assets'),
      'jszip': path.resolve(__dirname, 'node_modules/jszip/dist/jszip.min.js')
    }
  },
  server: {
    port: 5173,
    open: true,
    fs: {
      allow: [
        path.resolve(__dirname, '..')
      ]
    }
  }
})
