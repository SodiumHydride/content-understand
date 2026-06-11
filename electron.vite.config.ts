import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const isProduction = process.env.NODE_ENV === 'production'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    esbuild: {
      drop: isProduction ? ['console', 'debugger'] : [],
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    esbuild: {
      drop: isProduction ? ['console', 'debugger'] : [],
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [react(), tailwindcss()],
    esbuild: {
      drop: isProduction ? ['console', 'debugger'] : [],
    },
  },
})
