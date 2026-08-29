import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  base: process.env.VITE_BASE_PATH ?? '/',
  // During development the Cloudflare plugin runs the Worker and the React
  // client together. Production builds keep their existing dist layout and
  // continue to be deployed with the root wrangler.jsonc configuration.
  plugins: [react(), ...(command === 'serve' && mode !== 'test' ? [cloudflare()] : [])],
  server: {
    watch: {
      ignored: ['**/public/cv/opencv.js'],
    },
  },
}))
