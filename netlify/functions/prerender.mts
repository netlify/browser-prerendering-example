import type { Context, Config } from "@netlify/functions";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";

// Extend Window interface for prerenderReady
declare global {
  interface Window {
    prerenderReady?: boolean;
  }
}

let browser: any = null;

async function getBrowser() {
  if (!browser) {
    // Check if running locally (development) or in production
    if (process.env.NODE_ENV === 'development' || !process.env.NETLIFY) {
      // Local development - use bundled Chromium
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    } else {
      // Production - use sparticuz/chromium for Netlify
      browser = await puppeteer.launch({
        args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    }
  }
  
  return browser;
}

export default async (req: Request, context: Context) => {
  const startTime = Date.now();
  const requestUrl = req.url;
  
  try {
    const targetUrl = new URL(req.url).searchParams.get('url');
    const skipImages = new URL(req.url).searchParams.get('skipImages') === 'true';
    const fastMode = new URL(req.url).searchParams.get('fast') === 'true';
    
    console.log(`🚀 Starting prerender for: ${targetUrl}`);
    console.log(`⚙️  Options: skipImages=${skipImages}, fastMode=${fastMode}`);
    
    if (!targetUrl) {
      console.error('❌ Missing url parameter');
      return new Response('Missing url parameter', { status: 400 });
    }

    console.log('🔧 Getting browser instance...');
    const browserInstance = await getBrowser();
    console.log('📄 Creating new page...');
    const page = await browserInstance.newPage();

    // Set prerender user agent for consistent behavior
    console.log('🔄 Setting user agent...');
    await page.setUserAgent('Mozilla/5.0 (compatible; Prerender)');
    
    // Set up request interception for performance and clean rendering
    if (!fastMode) {
      console.log('🚫 Setting up request interception...');
      await page.setRequestInterception(true);
    } else {
      console.log('⚡ Fast mode enabled - skipping request interception');
    }
    
    let blockedCount = 0;
    let allowedCount = 0;
    
    if (!fastMode) {
      page.on('request', (request) => {
        const url = request.url();
        const resourceType = request.resourceType();
        
        // Block common cookie consent and tracking domains
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
          'hotjar.com'
        ];
        
        // Skip images and CSS if requested for faster rendering
        if (skipImages && (resourceType === 'image' || resourceType === 'stylesheet')) {
          blockedCount++;
          request.abort();
          return;
        }
        
        // Block tracking pixels and cookie consent scripts
        if (blockedDomains.some(domain => url.includes(domain)) ||
            (resourceType === 'image' && (url.includes('track') || url.includes('pixel'))) ||
            (resourceType === 'script' && (url.includes('cookie') || url.includes('consent')))) {
          blockedCount++;
          request.abort();
        } else {
          allowedCount++;
          request.continue();
        }
      });
    }

    // Set a reasonable viewport
    console.log('📏 Setting viewport...');
    await page.setViewport({ width: 1200, height: 800 });

    // Performance optimization: disable unnecessary features
    console.log('🔧 Disabling unnecessary browser features...');
    await page.evaluateOnNewDocument(() => {
      // Disable service workers during prerender
      if ('serviceWorker' in navigator) {
        Object.defineProperty(navigator, 'serviceWorker', {
          value: undefined,
          writable: false
        });
      }
      
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
    console.log(`🌐 Navigating to: ${targetUrl}`);
    const navigationStart = Date.now();
    
    try {
      await page.goto(targetUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });
      const navigationTime = Date.now() - navigationStart;
      console.log(`✅ Navigation completed in ${navigationTime}ms`);
    } catch (navigationError) {
      console.error(`❌ Navigation failed: ${navigationError.message}`);
      throw navigationError;
    }

    // Wait for window.prerenderReady or timeout after 1 second for faster response
    console.log('⏳ Waiting for window.prerenderReady...');
    try {
      await page.waitForFunction(
        () => window.prerenderReady === true,
        { timeout: 1000 }
      );
      console.log('✅ window.prerenderReady detected!');
    } catch (timeoutError) {
      // Continue if prerenderReady is not set within timeout
      console.log('⚠️  window.prerenderReady not detected within 1s, proceeding with render');
    }

    // Brief additional wait (500ms) for any pending renders
    console.log('⏱️  Additional 500ms wait for pending renders...');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check for prerender status code meta tag
    console.log('🔍 Checking for prerender meta tags...');
    const statusCodeMeta = await page.$eval(
      'meta[name="prerender-status-code"]',
      (el) => el?.getAttribute('content')
    ).catch(() => null);
    
    if (statusCodeMeta) {
      console.log(`📋 Found prerender-status-code: ${statusCodeMeta}`);
    }

    // Check for prerender redirect header meta tag
    const redirectMeta = await page.$eval(
      'meta[name="prerender-header"]',
      (el) => el?.getAttribute('content')
    ).catch(() => null);
    
    if (redirectMeta) {
      console.log(`📋 Found prerender-header: ${redirectMeta}`);
    }

    // Clean up any open dialogs or alerts that might interfere (skip in fast mode)
    if (!fastMode) {
      console.log('🧹 Cleaning up DOM elements (cookie banners, modals)...');
      const removedElements = await page.evaluate(() => {
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
      
      if (removedElements > 0) {
        console.log(`🗑️  Removed ${removedElements} DOM elements`);
      } else {
        console.log('✨ No DOM elements needed cleaning');
      }
    } else {
      console.log('⚡ Fast mode - skipping DOM cleanup');
    }

    // Get the rendered HTML
    console.log('📤 Extracting rendered HTML...');
    const html = await page.content();
    const htmlSize = Buffer.byteLength(html, 'utf8');
    console.log(`📄 HTML size: ${htmlSize} bytes`);
    
    // Log request statistics
    if (!fastMode) {
      console.log(`📊 Request stats: ${allowedCount} allowed, ${blockedCount} blocked`);
    }
    
    // Clean up page resources
    console.log('🧹 Closing page...');
    await page.close();
    
    const renderTime = Date.now() - startTime;
    console.log(`✅ Prerender completed in ${renderTime}ms for ${targetUrl}`);

    // Handle different status codes and enhanced caching
    console.log('📦 Processing response headers and status codes...');
    let statusCode = 200;
    let headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Vary': 'User-Agent',
      'X-Prerendered': 'true',
      'X-Prerender-Timestamp': new Date().toISOString(),
    };

    headers['Netlify-CDN-Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=604800, durable';
    headers['Cache-Control'] = 'public, max-age=0, must-revalidate';

    if (statusCodeMeta) {
      const code = parseInt(statusCodeMeta, 10);
      if (code >= 100 && code < 600) {
        statusCode = code;
        console.log(`🔢 Using custom status code: ${code}`);
        
        // Handle redirects
        if (code >= 300 && code < 400 && redirectMeta) {
          const locationMatch = redirectMeta.match(/Location:\s*(.+)/i);
          if (locationMatch) {
            headers['Location'] = locationMatch[1].trim();
            console.log(`🔀 Redirect to: ${headers['Location']}`);
            // Short cache for redirects
            headers['Netlify-CDN-Cache-Control'] = 'public, max-age=3600, durable';
            headers['Cache-Control'] = 'public, max-age=300';
          }
        }
        
        // Adjust caching for error status codes
        if (code === 404) {
          console.log('🚫 404 page - adjusting cache headers');
          headers['Netlify-CDN-Cache-Control'] = 'public, max-age=3600, durable';
          headers['Cache-Control'] = 'public, max-age=300';
        } else if (code >= 500) {
          console.log('💥 Server error - disabling cache');
          headers['Netlify-CDN-Cache-Control'] = 'no-cache';
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        }
      }
    }

    console.log(`🎯 Final response: ${statusCode} status, ${htmlSize} bytes`);
    
    return new Response(html, {
      status: statusCode,
      headers
    });
  } catch (error) {
    const errorTime = Date.now() - startTime;
    console.error(`💥 Prerender error after ${errorTime}ms:`, error);
    console.error(`📍 Error for URL: ${targetUrl || 'unknown'}`);
    console.error(`🔍 Error stack:`, error.stack);
    return new Response('Prerender failed', { status: 500 });
  }
};

export const config: Config = {
  path: "/api/prerender",
  schedule: undefined
};