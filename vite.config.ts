import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import netlify from '@netlify/vite-plugin'

// Custom plugin to replace site URLs at build time
function replaceNetlifySiteUrls() {
  return {
    name: 'replace-netlify-urls',
    transformIndexHtml: {
      order: 'post' as const,
      handler(html: string) {
        // Get site URL from environment variable (Netlify sets this automatically)
        const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://your-site.netlify.app'
        
        // Replace placeholder URLs with actual site URL
        return html
          .replace(/https:\/\/your-site\.netlify\.app/g, siteUrl)
          .replace(/your-site\.netlify\.app/g, siteUrl.replace(/https?:\/\//, ''))
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), netlify(), replaceNetlifySiteUrls()],
})
