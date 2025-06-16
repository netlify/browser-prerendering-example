# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Development**: `npm run dev` - Start Vite development server with HMR
- **Build**: `npm run build` - TypeScript compilation followed by Vite build
- **Lint**: `npm run lint` - Run ESLint on the codebase
- **Preview**: `npm run preview` - Preview the production build locally
- **Deploy**: `netlify deploy --prod` - Deploy to Netlify production

## Architecture

This is a **Netlify prerendering demonstration** that combines a React + TypeScript + Vite frontend with serverless functions for intelligent crawler detection and HTML prerendering.

### Core Components

- **Frontend**: React datetime app (`src/App.tsx`) that serves as the demo content
- **Edge Function**: `netlify/edge-functions/crawler-detector.ts` - Detects crawlers/bots at CDN edge and routes them to prerendering
- **Serverless Function**: `netlify/functions/prerender.mts` - Uses Puppeteer + Chrome to generate SEO-optimized HTML for crawlers
- **Caching Strategy**: Durable caching with different TTLs for static/dynamic content

### Prerendering Flow

1. Request hits Edge Function (`crawler-detector.ts`)
2. If crawler detected (via user-agent) → route to `prerender.mts` function
3. If regular user → serve static React app
4. Prerender function uses Puppeteer to generate HTML with Chrome headless browser
5. Response cached with appropriate headers

### Key Technologies

- **Puppeteer**: Browser automation for HTML generation
- **@sparticuz/chromium**: AWS Lambda/Netlify-compatible Chrome binary
- **Netlify Edge Functions**: Fast crawler detection at CDN edge
- **Netlify Functions**: Serverless prerendering with Node.js

### Security & Performance Features

- Same-host validation prevents open proxy abuse
- Request interception blocks tracking scripts and ads
- DOM cleanup removes cookie banners and modals
- Support for `window.prerenderReady` detection for SPAs
- Fast mode (`?fast=true`) and image skipping (`?skipImages=true`) options

### Testing Prerendering

```bash
# Test regular user (gets React app)
curl https://your-site.netlify.app/

# Test crawler (gets prerendered HTML)
curl -H "User-Agent: Googlebot" https://your-site.netlify.app/

# Force prerendering for testing
curl "https://your-site.netlify.app/?prerender=true"
```