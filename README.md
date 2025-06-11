# Netlify Prerendering Demo

A demonstration of using **Netlify Primitives** (Edge Functions, Serverless Functions, and Durable Caching) to implement intelligent prerendering for web crawlers and bots.

## Overview

This project showcases how to build a production-ready prerendering solution using modern Netlify features:

- **Edge Functions** for crawler detection and routing
- **Serverless Functions** for dynamic HTML generation with Puppeteer
- **Durable Caching** for optimized performance and reduced compute costs
- **Security measures** to prevent abuse and open proxy attacks

## Architecture

```
Browser/Crawler Request
         ↓
   Edge Function (crawler-detector.ts)
    ↓ (if crawler)        ↓ (if regular user)
Serverless Function    →  Static Site
   (prerender.mts)
         ↓
   Puppeteer + Chrome
         ↓
   Cached HTML Response
```

## Key Components

### 1. Edge Function: Crawler Detection (`netlify/edge-functions/crawler-detector.ts`)

**Purpose:** Detect bots and crawlers at the edge and route them to prerendering.

**Features:**
- User-agent based crawler detection (Googlebot, Bingbot, etc.)
- Support for `?prerender=true` override
- Fast edge-based routing with minimal latency
- Handles `_escaped_fragment_` for legacy crawlers

**How it works:**
```typescript
const isCrawler = (userAgent) => {
  return /googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly|quora link preview|showyoubot|outbrain|pinterest|slackbot|vkShare|W3C_Validator/i.test(userAgent);
};
```

### 2. Serverless Function: HTML Prerendering (`netlify/functions/prerender.mts`)

**Purpose:** Generate SEO-optimized HTML using headless Chrome.

**Core Technologies:**
- **Puppeteer** for browser automation
- **@sparticuz/chromium** for AWS Lambda/Netlify compatibility
- **TypeScript** for type safety

**Security Features:**
- **Same-host validation** prevents open proxy abuse
- **Protocol restrictions** (HTTP/HTTPS only)
- **Private network blocking** in production
- **Request monitoring** with IP logging

**Performance Optimizations:**
- **Request interception** blocks tracking scripts and ads
- **Fast mode** (`?fast=true`) skips heavy processing
- **Image skipping** (`?skipImages=true`) for faster rendering
- **DOM cleanup** removes cookie banners and modals

**Prerender.io Best Practices:**
- **Status code handling** via `<meta name="prerender-status-code" content="404">`
- **Redirect support** via `<meta name="prerender-header" content="Location: /new-url">`
- **`window.prerenderReady`** detection for SPA readiness
- **Content-based caching** strategies

### 3. Durable Caching Strategy

**Cache Headers:**
- **Static content:** 7 days CDN, 1 day browser
- **Dynamic content:** 1 day CDN, 1 hour browser  
- **User-specific content:** 5 minutes CDN, 1 minute browser
- **Error pages:** 1 hour CDN, 5 minutes browser

**Cache Invalidation:**
- Automatic via `stale-while-revalidate`
- Manual via Netlify API or redeploys

## Implementation Details

### Browser Detection Logic

The system uses a two-tier approach:

1. **Edge Function** (Fast): Basic user-agent detection at CDN edge
2. **Prerender Function** (Thorough): Full HTML generation with Chrome

### Environment Handling

**Local Development:**
```typescript
// Uses bundled Chromium from Puppeteer
browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

**Production (Netlify):**
```typescript
// Uses optimized Chrome binary
browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args, '--hide-scrollbars'],
  headless: chromium.headless
});
```

### Security Implementation

**Same-Host Validation:**
```typescript
const requestHost = new URL(req.url).host;
const targetHost = new URL(targetUrl).host;

if (targetHost !== requestHost) {
  return new Response('Invalid target URL: must be same host', { status: 403 });
}
```

**Private Network Protection:**
```typescript
const isPrivateNetwork = 
  hostname === 'localhost' ||
  hostname.startsWith('192.168.') ||
  hostname.startsWith('10.') ||
  // ... other private ranges
```

## Usage

### Basic Setup

1. **Deploy to Netlify:**
   ```bash
   npm run build
   netlify deploy --prod
   ```

2. **Test crawler detection:**
   ```bash
   # Regular user - gets React app
   curl https://your-site.netlify.app/

   # Crawler - gets prerendered HTML  
   curl -H "User-Agent: Googlebot" https://your-site.netlify.app/
   ```

### URL Parameters

- `?prerender=true` - Force prerendering for testing
- `?fast=true` - Skip request interception and DOM cleanup
- `?skipImages=true` - Block images for faster rendering

### Example Requests

```bash
# Force prerender with optimization
curl "https://your-site.netlify.app/?prerender=true&fast=true&skipImages=true"

# Test specific page
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/about"
```

## Monitoring and Debugging

### Success Logs
```
PRERENDER SUCCESS: https://site.com/page | 1234ms total (567ms nav) | 200 status | 45678B HTML | prerenderReady=false | fastMode=true | skipImages=false | requests=15/23 | domCleanup=3 | IP=1.2.3.4
```

### Error Logs
```
PRERENDER ERROR: https://site.com/page | 1234ms | Navigation timeout | IP=1.2.3.4
PRERENDER ERROR STACK: [full stack trace]
```

### Key Metrics to Monitor
- **Response times** (target: <3s)
- **Success rates** (target: >95%)
- **Cache hit rates** (target: >80%)
- **Chrome memory usage**
- **Request blocking effectiveness**

## Configuration

### Environment Variables

- `NODE_ENV=production` - Enables production optimizations
- `NETLIFY=true` - Auto-set by Netlify, enables Lambda Chrome
- `AWS_LAMBDA_FUNCTION_NAME` - Auto-set, helps detect serverless environment

### Netlify Configuration (`netlify.toml`)

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## Performance Considerations

### Cold Start Optimization
- Browser instance reuse across requests
- Minimal dependencies in function bundle
- Fast environment detection

### Memory Management
- Automatic page cleanup after rendering
- Browser connection pooling
- Efficient DOM manipulation

### Cost Optimization
- Intelligent caching reduces function invocations
- Request blocking reduces network usage
- Fast mode for simple pages

## Troubleshooting

### Common Issues

**Chrome not found:**
- Ensure `@sparticuz/chromium` is installed
- Check environment detection logs
- Verify production environment variables

**Timeout errors:**
- Enable fast mode: `?fast=true`
- Reduce wait times for `window.prerenderReady`
- Check navigation performance

**Open proxy abuse:**
- Host validation should block external URLs
- Monitor IP addresses in logs
- Add rate limiting if needed

### Debug Mode

Enable detailed logging by checking function logs in Netlify dashboard or using:

```bash
netlify functions:invoke prerender --payload='{"url": "test"}'
```

## Contributing

This is a demonstration project showcasing Netlify's prerendering capabilities. Feel free to:

1. Fork and adapt for your use case
2. Submit issues for bugs or improvements
3. Share your own prerendering strategies

## License

MIT License - feel free to use this code in your own projects.