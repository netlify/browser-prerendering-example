# 🧪 Prerender Testing Guide

This document provides comprehensive testing instructions for the Netlify prerendering demo.

## 🎯 Test Overview

The test suite includes 5 different scenarios that demonstrate various aspects of the prerendering system:

1. **prerenderReady Fast** - Quick signal completion
2. **prerenderReady Timeout** - Never signals completion  
3. **Request Tracking** - Fallback behavior without prerenderReady
4. **Status Code 404** - Custom HTTP status via meta tags
5. **Redirect 301** - HTTP redirects via meta tags

## 🚀 Quick Start

```bash
# Build and deploy (URLs are automatically updated at build time)
npm run build
netlify deploy --prod

# Test main app
curl -H "User-Agent: Googlebot" "https://your-actual-site.netlify.app/"

# View test suite
open https://your-actual-site.netlify.app/test-index.html
```

## 🌐 URL Replacement

**Build-time URL replacement:** The build process automatically replaces `your-site.netlify.app` with your actual site URL using `process.env.URL` (set by Netlify).

**Browser testing:** Each test page now has two links:
- **View Normal** - Regular browser experience
- **🤖 Test Prerender** - Adds `?_escaped_fragment_=` to trigger prerendering in browser

## 📝 Individual Test Cases

### 1. prerenderReady Fast Trigger

**Test Page:** `/test-prerender-ready-fast.html`
**Purpose:** Verify fast prerenderReady completion

**Browser Testing:**
- Normal: `https://your-site.netlify.app/test-prerender-ready-fast.html`
- Prerender: `https://your-site.netlify.app/test-prerender-ready-fast.html?_escaped_fragment_=`

**Command Line Testing:**
```bash
# Test as crawler (should prerender)
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-prerender-ready-fast.html"

# Test as regular user (should get React app)
curl "https://your-site.netlify.app/test-prerender-ready-fast.html"

# Force prerender for testing
curl "https://your-site.netlify.app/test-prerender-ready-fast.html?prerender=true"
curl "https://your-site.netlify.app/test-prerender-ready-fast.html?_escaped_fragment_="

# Measure timing
time curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-prerender-ready-fast.html"
```

**Expected Results:**
- Prerender completes in ~1-2 seconds
- HTML contains "prerenderReady = true" status
- Response includes `X-Prerendered: true` header

### 2. prerenderReady Timeout

**Test Page:** `/test-prerender-ready-timeout.html`
**Purpose:** Verify timeout handling when prerenderReady never triggers

```bash
# Test timeout behavior (will take ~9 seconds)
time curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-prerender-ready-timeout.html"

# Check response headers
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-prerender-ready-timeout.html"
```

**Expected Results:**
- Request takes ~9 seconds (timeout duration)
- HTML contains timeout warning content
- Response includes `X-Prerendered: true` header
- Function logs show timeout in Netlify dashboard

### 3. Request Tracking Fallback

**Test Page:** `/test-request-tracking.html`
**Purpose:** Test network request monitoring when prerenderReady is not used

```bash
# Test request tracking (should wait ~4 seconds)
time curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-request-tracking.html"

# Compare with regular user
curl "https://your-site.netlify.app/test-request-tracking.html"
```

**Expected Results:**
- Request completes in ~4 seconds (3.5s loading + 0.5s settle time)
- HTML shows all 4 content sections loaded
- Network activity log shows request progression

### 4. Custom Status Code (404)

**Test Page:** `/test-status-code-404.html`
**Purpose:** Verify custom HTTP status codes via meta tags

```bash
# Test 404 status code
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-status-code-404.html"

# Get full response
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-status-code-404.html"

# Test caching headers for error pages
curl -v -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-status-code-404.html"
```

**Expected Results:**
- HTTP response status: `404 Not Found`
- HTML content still delivered (for SEO)
- Special cache headers for error pages
- Response includes `X-Prerendered: true` header

### 5. Meta Tag Redirects

**Test Page:** `/test-redirect.html`
**Purpose:** Test HTTP redirects controlled by meta tags

```bash
# Test redirect behavior
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-redirect.html"

# Follow redirects
curl -L -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-redirect.html"

# Test with regular browser user agent
curl -I "https://your-site.netlify.app/test-redirect.html"
```

**Expected Results:**
- HTTP response status: `301 Moved Permanently`
- `Location: /test-prerender-ready-fast.html` header
- Following redirect leads to fast prerender test page

## 🔍 Advanced Testing

### Edge Function Testing

Test crawler detection at the edge:

```bash
# Test various user agents
curl -H "User-Agent: Mozilla/5.0" "https://your-site.netlify.app/"  # Regular user
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/"    # Crawler
curl -H "User-Agent: facebookexternalhit" "https://your-site.netlify.app/"  # Social bot

# Test override parameters
curl "https://your-site.netlify.app/?prerender=true"  # Force prerender
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/?fast=true"  # Fast mode
```

### Performance Testing

```bash
# Test multiple concurrent requests
for i in {1..5}; do
  (time curl -s -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-prerender-ready-fast.html" > /dev/null) &
done
wait

# Test different page sizes
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/" | wc -c
curl -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-request-tracking.html" | wc -c
```

### Cache Testing

```bash
# Test cache headers
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/"

# Test cache behavior with multiple requests
curl -w "@curl-format.txt" -H "User-Agent: Googlebot" "https://your-site.netlify.app/"
curl -w "@curl-format.txt" -H "User-Agent: Googlebot" "https://your-site.netlify.app/"  # Should be faster (cached)
```

### Error Testing

```bash
# Test invalid URLs
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/api/prerender?url=http://external-site.com"

# Test malformed requests
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/api/prerender"
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/api/prerender?url=invalid-url"
```

## 📊 Monitoring & Debugging

### Function Logs

Monitor function execution in real-time:

```bash
# Follow function logs (if using Netlify CLI)
netlify functions:logs prerender --follow

# Test specific function invocation
netlify functions:invoke prerender --payload='{"url": "https://your-site.netlify.app/test-prerender-ready-fast.html"}'
```

### Expected Log Patterns

**Success Log:**
```
PRERENDER SUCCESS: https://site.com/test-prerender-ready-fast.html | 1234ms total (567ms nav, 890ms wait) | 200 status | 45678B HTML | prerenderReady=true | requests=12/15 (0 pending) | domCleanup=2 | IP=1.2.3.4
```

**Timeout Log:**
```
PRERENDER SUCCESS: https://site.com/test-prerender-ready-timeout.html | 9123ms total (567ms nav, 8556ms wait) | 200 status | 45678B HTML | prerenderReady=false | requests=8/10 (0 pending) | domCleanup=1 | IP=1.2.3.4
```

**Error Log:**
```
PRERENDER ERROR: https://site.com/bad-url | 1234ms | Navigation timeout | IP=1.2.3.4
PRERENDER ERROR STACK: [stack trace]
```

## 🎨 Visual Testing

For visual verification, open test pages directly in browser:

- https://your-site.netlify.app/test-index.html (Test suite overview)
- https://your-site.netlify.app/test-prerender-ready-fast.html
- https://your-site.netlify.app/test-prerender-ready-timeout.html  
- https://your-site.netlify.app/test-request-tracking.html
- https://your-site.netlify.app/test-status-code-404.html
- https://your-site.netlify.app/test-redirect.html

## 🔧 Troubleshooting

### Common Issues

**Prerender not triggering:**
- Check User-Agent header in request
- Verify edge function is deployed
- Test with `?prerender=true` override

**Timeout issues:**
- Check if prerenderReady is being set correctly
- Verify network requests are completing
- Increase timeout if needed for heavy pages

**Status codes not working:**
- Verify meta tag syntax in HTML head
- Check prerender function logs for parsing errors
- Ensure status code is valid (100-599)

**Redirects not working:**
- Check meta tag format: `<meta name="prerender-header" content="Location: /path">`
- Verify both status code and header meta tags are present
- Test redirect target URL validity

### Debug Commands

```bash
# Check if site is properly deployed
curl -I "https://your-site.netlify.app/"

# Verify edge function is working
curl -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/" | grep -i "x-"

# Test function directly
curl -I "https://your-site.netlify.app/api/prerender?url=https://your-site.netlify.app/"

# Check for CORS issues
curl -H "Origin: https://example.com" -H "User-Agent: Googlebot" "https://your-site.netlify.app/"
```

## 📈 Performance Benchmarks

Expected performance targets:

- **Fast prerenderReady:** < 2 seconds
- **Request tracking:** < 5 seconds  
- **Timeout scenario:** ~9 seconds
- **Status codes:** < 2 seconds
- **Redirects:** < 1 second
- **Cold start:** < 3 seconds additional time
- **Cache hit ratio:** > 80%

## 🎯 Test Automation

For CI/CD integration:

```bash
#!/bin/bash
# test-prerender.sh

echo "Testing prerender functionality..."

# Test basic prerendering
RESPONSE=$(curl -s -H "User-Agent: Googlebot" "https://your-site.netlify.app/")
if [[ $RESPONSE == *"X-Prerendered"* ]]; then
  echo "✅ Basic prerendering working"
else
  echo "❌ Basic prerendering failed"
  exit 1
fi

# Test status codes
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-status-code-404.html")
if [[ $STATUS == "404" ]]; then
  echo "✅ Status code override working"
else
  echo "❌ Status code override failed (got $STATUS)"
  exit 1
fi

# Test redirects
LOCATION=$(curl -s -I -H "User-Agent: Googlebot" "https://your-site.netlify.app/test-redirect.html" | grep -i "location:" | cut -d' ' -f2)
if [[ $LOCATION == *"test-prerender-ready-fast.html"* ]]; then
  echo "✅ Redirect working"
else
  echo "❌ Redirect failed"
  exit 1
fi

echo "All tests passed! 🎉"
```

---

*For more information, see the main README.md and function source code.*