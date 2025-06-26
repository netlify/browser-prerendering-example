# Netlify Servereless Browser Prerendering

An example of using **Netlify Primitives** (Edge Functions, Serverless Functions, and Durable Caching) to implement serverless browser prerendering for web crawlers and bots.

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

### 1. Edge Function: Enhanced Crawler Detection (`netlify/edge-functions/crawler-detector.ts`)

**Purpose:** Comprehensive bot and crawler detection at the edge with production-grade filtering.

**Features:**
- **70+ User agents** including AI bots (GPTBot, ClaudeBot, PerplexityBot)
- **Smart HTML request detection** based on file extensions and patterns
- **Accept header validation** ensures requests want HTML content
- **GET method filtering** - only processes GET requests
- **Anti-abuse measures** - user agent length limits and "Prerender" exclusion
- **Legacy crawler support** via `_escaped_fragment_` parameter
- **Font asset filtering** - prevents unnecessary `.woff2` prerendering

**Enhanced Detection Logic:**
```typescript
const isCrawlerRequest = (req: Request): boolean => {
  if (req.method !== 'GET') return false;
  
  const url = new URL(req.url);
  if (url.searchParams.has('_escaped_fragment_')) return true;
  
  const userAgent = req.headers.get('user-agent') || '';
  if (!userAgent || userAgent === 'Prerender' || userAgent.length > 4096) {
    return false;
  }
  
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some(bot => ua.includes(bot));
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
- **DOM cleanup** removes cookie banners and modals
- **Network request monitoring** waits for content to fully load
- **Intelligent timing** balances completeness with performance

**SPA Readiness Detection:**
- **`window.prerenderReady`** - Apps can signal when content is ready
- **Request tracking fallback** - Monitors network activity when prerenderReady not used
- **Smart timeouts** - 9-second maximum wait prevents indefinite hanging
- **Dual strategy** - Handles both modern SPAs and static content

**Prerender.io Compatibility:**
- **Status code handling** via `<meta name="prerender-status-code" content="404">`
- **Redirect support** via `<meta name="prerender-header" content="Location: /new-url">`
- **Legacy crawler support** via `_escaped_fragment_` parameter
- **Content-based caching** strategies

### 3. Durable Caching Strategy

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
- `?_escaped_fragment_=` - Legacy crawler parameter (also forces prerendering)

### Example Requests

```bash
# Force prerender
curl "https://your-site.netlify.app/?prerender=true"

# Legacy crawler format
curl "https://your-site.netlify.app/?_escaped_fragment_="

# Test specific page
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/about"
```

## Monitoring and Debugging

### Success Logs
```
PRERENDER SUCCESS: https://site.com/page | 1234ms total (567ms nav, 890ms wait) | 200 status | 45678B HTML | prerenderReady=true | requests=15/18 (0 pending) | domCleanup=3 | IP=1.2.3.4
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
- Smart timeouts prevent runaway functions

## 🧪 Testing Suite

This demo includes a comprehensive testing suite to demonstrate different prerendering scenarios:

### Test Pages

1. **`/test-crawler-detection.html`** - Tests enhanced crawler detection with 70+ user agents and edge cases
2. **`/test-prerender-ready-fast.html`** - Tests `window.prerenderReady` with quick (1s) completion
3. **`/test-prerender-ready-timeout.html`** - Tests timeout behavior when `prerenderReady` never triggers
4. **`/test-request-tracking.html`** - Tests fallback request monitoring without `prerenderReady`
5. **`/test-status-code-404.html`** - Tests custom HTTP status codes via meta tags
6. **`/test-redirect.html`** - Tests HTTP redirects via meta tags

### Test Suite Dashboard

Visit `/test-index.html` for an interactive test dashboard with:
- **Visual test cards** for each scenario
- **Browser testing links** - Click "🤖 Test Prerender" to trigger prerendering in your browser
- **Copy-paste curl commands** for command-line testing
- **Expected timing and behavior** for each test

### How to Test

**Browser Testing:**
- **Normal view**: See the regular browser experience
- **Prerender view**: Add `?_escaped_fragment_=` to trigger prerendering

**Command Line Testing:**
```bash
# Test enhanced crawler detection
curl -H "User-Agent: GPTBot/1.0" "https://your-site.netlify.app/test-crawler-detection.html"
curl -H "User-Agent: ClaudeBot/1.0" "https://your-site.netlify.app/test-crawler-detection.html"

# Test as Googlebot (triggers prerendering)
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-prerender-ready-fast.html"

# Test timing scenarios
time curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-prerender-ready-timeout.html"

# Test status codes
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-status-code-404.html"

# Test redirects  
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-redirect.html"

# Test edge cases (should NOT prerender)
curl -X POST -H "User-Agent: Googlebot" "https://your-site.netlify.app/"  # POST method
curl -H "User-Agent: Prerender" "https://your-site.netlify.app/"  # Excluded UA
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/font.woff2"  # Font file
```

### window.prerenderReady Explained

**How it works:**
```javascript
// In your SPA, signal when content is ready
window.prerenderReady = false; // Initial state

// After your app finishes loading/rendering
setTimeout(() => {
  window.prerenderReady = true; // Signals prerender completion
}, 1000);
```

**Behavior:**
- **When used**: Prerender function waits for `prerenderReady = true` (up to 9s timeout)
- **When not used**: Falls back to monitoring network requests (waits 500ms after last request)
- **Best practice**: Set to `true` when your SPA content is fully rendered and ready for crawlers

### Testing Documentation

See `/TESTING.md` for comprehensive testing instructions, including:
- Detailed test scenarios and expected results
- Performance benchmarks and timing expectations
- Troubleshooting guides for common issues
- Advanced testing techniques and automation scripts

## Troubleshooting

### Common Issues

**Chrome not found:**
- Ensure `@sparticuz/chromium` is installed
- Check environment detection logs
- Verify production environment variables

**Timeout errors:**
- Check if `window.prerenderReady` is being set properly
- Verify network requests are completing
- Monitor function logs for timing details

**Abuse prevention:**
- Host validation will block external URLs
- Monitor IP addresses in logs
- Add rate limiting if needed

## Contributing

This is an example project showcasing Netlify's prerendering capabilities. Feel free to:

1. Fork and adapt for your use case
2. Submit issues for bugs or improvements
3. Share your own prerendering strategies

## License

MIT License - feel free to use this code in your own projects.
