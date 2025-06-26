import type { Context, Config } from "@netlify/functions";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";

// Extend Window interface for prerenderReady
declare global {
  interface Window {
    prerenderReady?: boolean;
  }
}

// Check if running in Netlify/AWS Lambda environment
const isProduction = !process.env.NETLIFY_DEV;

const localAllowRemoteHosts = !isProduction && process.env.LOCAL_ALLOW_REMOTE_HOSTS?.toLowerCase() === "true";
const localShowBrowser = !isProduction && process.env.LOCAL_SHOW_BROWSER?.toLowerCase() === "true";

// Block common cookie consent and tracking domains
const customBlockedDomains = process.env.CUSTOM_BLOCKED_DOMAINS?.split(",") || [];
const blockedDomains = [
  'cookiebot.com',
  'onetrust.com',
  'quantcast.com',
  'cookiepro.com',
  'trustarc.com',
  'cookielaw.org',
  'google-analytics.com',
  'googletagmanager.com',
  'facebook.com/tr',
  'hotjar.com',
].concat(customBlockedDomains)

let browser: any = null;

async function getBrowser() {
  if (!browser) {
    
    if (isProduction) {
      // Production - use sparticuz/chromium for Netlify/Lambda
      const executablePath = await chromium.executablePath();
      
      browser = await puppeteer.launch({
        args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
        defaultViewport: chromium.defaultViewport,
        executablePath: executablePath,
        headless: chromium.headless,
      });
    } else {
      // Local development - use bundled Chromium
      console.log('Local development environment detected, using bundled Chromium');
      browser = await puppeteer.launch({
        headless: !localShowBrowser,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    }
  }
  
  return browser;
}

export default async (req: Request, context: Context) => {
  const startTime = Date.now();
  const clientIP = context.ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  let targetUrl = 'unknown'; // Declare outside try block for error logging
  
  try {
    const targetUrlParam = new URL(req.url).searchParams.get('url');
    
    if (!targetUrlParam) {
      console.error('PRERENDER ERROR: Missing url parameter');
      return new Response('Missing url parameter', { status: 400 });
    }

    // Security: Prevent open proxy usage by ensuring same host
    const requestHost = new URL(req.url).host;
    
    try {
      const parsedTargetUrl = new URL(targetUrlParam);
      
      // Security checks to prevent abuse
      
      // 1. Only allow same-host requests to prevent open proxy abuse
      if (parsedTargetUrl.host !== requestHost && !localAllowRemoteHosts) {
        console.error(`PRERENDER ERROR: Host mismatch - request from ${requestHost}, target ${parsedTargetUrl.host}`);
        return new Response('Invalid target URL: must be same host', { status: 403 });
      }

      // 2. Only allow HTTP/HTTPS protocols
      if (!['http:', 'https:'].includes(parsedTargetUrl.protocol)) {
        console.error(`PRERENDER ERROR: Invalid protocol ${parsedTargetUrl.protocol} for ${targetUrlParam}`);
        return new Response('Invalid protocol: only HTTP/HTTPS allowed', { status: 403 });
      }
      
      // 3. Prevent localhost and private IP access if not in development
      const hostname = parsedTargetUrl.hostname;
      const isPrivateNetwork = 
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') ||
        hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') ||
        hostname.startsWith('172.19.') ||
        hostname.startsWith('172.2') ||
        hostname.startsWith('172.30.') ||
        hostname.startsWith('172.31.') ||
        hostname === '::1';
      
      if (isPrivateNetwork && process.env.NETLIFY) {
        console.error(`PRERENDER ERROR: Private network access denied for ${hostname}`);
        return new Response('Private network access not allowed', { status: 403 });
      }
      
      targetUrl = targetUrlParam;
    } catch (urlError) {
      console.error(`PRERENDER ERROR: Invalid URL format: ${targetUrlParam}`);
      return new Response('Invalid URL format', { status: 400 });
    }

    console.log(`Getting browser instance...`);
    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    // Set prerender user agent for consistent behavior
    await page.setUserAgent('Mozilla/5.0 (compatible; Netlify Prerender Example)');
    await page.setRequestInterception(true);
    
    let blockedCount = 0;
    let numRequestsInFlight = 0;
    let lastRequestReceivedAt = Date.now();
    const requests: { [requestId: string]: string } = {}; // Track requests by ID
    
    page.on('request', (request) => {
      const url = request.url();
      const resourceType = request.resourceType();
         
      // Block tracking pixels and cookie consent scripts
      if (blockedDomains.some(domain => url.includes(domain)) ||
          (resourceType === 'image' && (url.includes('track') || url.includes('pixel')  || url.includes('beacon'))) ||
          (resourceType === 'script' && (url.includes('cookie') || url.includes('consent')))) {
        blockedCount++;
        request.abort();
      } else {
        // In some cases, an event for the same request ID is received twice, don't double-count it.
        if (!requests[request.id]) {
          // Increment on request start (Prerender.io pattern)
          numRequestsInFlight++;
          requests[request.id] = url;
        }
        request.continue();
      }
    });

    // Track request completion for network activity monitoring (Prerender.io pattern)
    page.on('requestfinished', (request) => {
      const id = request.id;
      if (requests[id]) {
        numRequestsInFlight = Math.max(0, numRequestsInFlight - 1);
        lastRequestReceivedAt = Date.now();
        delete requests[id];
      }
    });

    page.on('requestfailed', (request) => {
      const id = request.id;
      if (requests[id]) {
        numRequestsInFlight = Math.max(0, numRequestsInFlight - 1);
        lastRequestReceivedAt = Date.now();
        delete requests[id];
      }
    });

    // Set a reasonable viewport
    await page.setViewport({ width: 1200, height: 800 });

    // Performance optimization: disable unnecessary features
    await page.evaluateOnNewDocument(() => {
      // Disable notifications
      if ('Notification' in window) {
        Object.defineProperty(window, 'Notification', {
          value: undefined,
          writable: false
        });
      }
      
      // Set prerender flag for applications to detect
      (window as any).__PRERENDER__ = true;
    });

    // Navigate to the URL with optimized settings
    console.log(`Navigating to ${targetUrl}...`);
    const navigationStart = Date.now();
    try {
      await page.goto(targetUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });
    } catch (navigationError) {
      console.error(`PRERENDER ERROR: Navigation failed for ${targetUrl}: ${navigationError.message}`);
      throw navigationError;
    }
    const navigationTime = Date.now() - navigationStart;

    // Enhanced prerenderReady flow with simplified logic
    const waitAfterLastRequest = 500; // 500ms wait after last request completes
    const pageDoneCheckInterval = 100; // Check every 100ms
    const maxWaitTime = 10000; // Maximum wait time (10 seconds)
    
    console.log("Waiting for window.prerenderReady or requests to settle...");
    const waitStart = Date.now();
    
    // Core logic: checkIfDone evaluates prerenderReady and request tracking
    const checkIfDone = async (): Promise<boolean> => {
      const now = Date.now();
      const totalWaitTime = now - waitStart;
      
      // Always respect maximum timeout
      if (totalWaitTime >= maxWaitTime) {
        return true;
      }
      
      // Evaluate window.prerenderReady in page context
      const currentPrerenderReady = await page.evaluate(() => {
        return typeof window.prerenderReady === 'boolean' ? window.prerenderReady : null;
      });
      
      // If prerenderReady is being used by the page, it's authoritative
      if (currentPrerenderReady !== null) {
        // If prerenderReady is true, we're done immediately
        if (currentPrerenderReady === true) {
          return true;
        }
        // If prerenderReady is false, wait for it to become true (ignore requests)
        return false;
      }
      
      // If prerenderReady is not used (null), fall back to request tracking
      const timeSinceLastRequest = now - lastRequestReceivedAt;
      const requestsSettled = numRequestsInFlight <= 0 && timeSinceLastRequest >= waitAfterLastRequest;

      return requestsSettled;
    };

    // Polling system: check every pageDoneCheckInterval until done
    while (!(await checkIfDone())) {
      await new Promise(resolve => setTimeout(resolve, pageDoneCheckInterval));
    }

    const totalWaitTime = Date.now() - waitStart;

    // Check for prerender status code meta tag
    const statusCodeMeta = await page.$eval(
      'meta[name="prerender-status-code"]',
      (el) => el?.getAttribute('content')
    ).catch(() => null);

    // Check for prerender redirect header meta tag
    const redirectMeta = await page.$eval(
      'meta[name="prerender-header"]',
      (el) => el?.getAttribute('content')
    ).catch(() => null);

    // Clean up any open dialogs or alerts that might interfere (skip in fast mode)
    let removedElements = 0;
    removedElements = await page.evaluate(() => {
      // Remove cookie consent banners and modals
      const selectors = [
        '[id*="cookie"]', '[class*="cookie"]', '[id*="consent"]', '[class*="consent"]',
        '[id*="gdpr"]', '[class*="gdpr"]', '.modal', '.popup', '.overlay',
        '[data-testid*="cookie"]', '[data-cy*="cookie"]'
      ];
      
      let removedCount = 0;
      selectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (el instanceof HTMLElement && el.offsetHeight > 0) {
            el.remove();
            removedCount++;
          }
        });
      });
      return removedCount;
    });

    // Get the rendered HTML
    const html = await page.content();
    const htmlSize = Buffer.byteLength(html, 'utf8');
    
    // Clean up page resources
    await page.close();
    
    const renderTime = Date.now() - startTime;

    // Handle different status codes and enhanced caching
    let statusCode = 200;
    let headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Vary': 'User-Agent',
      'X-Prerendered': 'true',
      'X-Prerender-Timestamp': new Date().toISOString(),
    };

    headers['Netlify-CDN-Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=604800, durable';
    headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
    headers['Cache-Tags'] = 'nf-prerender';

    if (statusCodeMeta) {
      const code = parseInt(statusCodeMeta, 10);
      if (code >= 100 && code < 600) {
        statusCode = code;

        if (code >= 500) {
          headers['Netlify-CDN-Cache-Control'] = 'no-cache';
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        }
      }
    }

    // Single success log line with all important details
    const finalPrerenderReady = await page.evaluate(() => {
      return typeof window.prerenderReady === 'boolean' ? window.prerenderReady : null;
    }).catch(() => null);
    
    console.log(`PRERENDER SUCCESS: ${targetUrl} | ${renderTime}ms total (${navigationTime}ms nav, ${totalWaitTime}ms wait) | ${statusCode} status | ${htmlSize}B HTML | prerenderReady=${finalPrerenderReady} | ${blockedCount} requests blocked | domCleanup=${removedElements} | IP=${clientIP}`);
    
    return new Response(html, {
      status: statusCode,
      headers
    });
  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.error(`PRERENDER ERROR: ${targetUrl} | ${errorTime}ms | ${error.message} | IP=${clientIP}`);
    console.error(`PRERENDER ERROR STACK: ${error.stack}`);
    return new Response('Prerender failed', { status: 500 });
  }
};

export const config: Config = {
  path: "/api/prerender"
};
