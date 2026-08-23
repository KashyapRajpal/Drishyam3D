import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ command, isPreview }) => ({
  // Vite's internal /@fs/ module and worker routes must remain rooted at `/`
  // during development. Keep the repository base only for built/previewed files.
  base: command === 'serve' && !isPreview ? '/' : '/Drishyam3D/',
  plugins: [react()],
  worker: {
    format: 'es'
  },
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
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          codemirror: ['codemirror']
        }
      }
    }
  }
}))
