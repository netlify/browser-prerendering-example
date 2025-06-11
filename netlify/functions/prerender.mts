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
  
  try {
    const targetUrl = new URL(req.url).searchParams.get('url');
    
    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    // Set prerender user agent for consistent behavior
    await page.setUserAgent('Mozilla/5.0 (compatible; Prerender)');
    
    // Set up request interception for performance and clean rendering
    const skipImages = new URL(req.url).searchParams.get('skipImages') === 'true';
    const fastMode = new URL(req.url).searchParams.get('fast') === 'true';
    
    if (!fastMode) {
      await page.setRequestInterception(true);
    }
    
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
          request.abort();
          return;
        }
        
        // Block tracking pixels and cookie consent scripts
        if (blockedDomains.some(domain => url.includes(domain)) ||
            (resourceType === 'image' && (url.includes('track') || url.includes('pixel'))) ||
            (resourceType === 'script' && (url.includes('cookie') || url.includes('consent')))) {
          request.abort();
        } else {
          request.continue();
        }
      });
    }

    // Set a reasonable viewport
    await page.setViewport({ width: 1200, height: 800 });

    // Performance optimization: disable unnecessary features
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
    await page.goto(targetUrl, { 
      waitUntil: 'domcontentloaded',
      timeout: 10000 
    });

    // Wait for window.prerenderReady or timeout after 1 second for faster response
    try {
      await page.waitForFunction(
        () => window.prerenderReady === true,
        { timeout: 1000 }
      );
    } catch (timeoutError) {
      // Continue if prerenderReady is not set within timeout
      console.log('prerenderReady not detected, proceeding with render');
    }

    // Brief additional wait (500ms) for any pending renders
    await new Promise(resolve => setTimeout(resolve, 500));

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
    if (!fastMode) {
      await page.evaluate(() => {
        // Remove cookie consent banners and modals
        const selectors = [
          '[id*="cookie"]', '[class*="cookie"]', '[id*="consent"]', '[class*="consent"]',
          '[id*="gdpr"]', '[class*="gdpr"]', '.modal', '.popup', '.overlay',
          '[data-testid*="cookie"]', '[data-cy*="cookie"]'
        ];
        
        selectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach(el => {
            if (el instanceof HTMLElement && el.offsetHeight > 0) {
              el.remove();
            }
          });
        });
      });
    }

    // Get the rendered HTML
    const html = await page.content();
    
    // Clean up page resources
    await page.close();
    
    const renderTime = Date.now() - startTime;
    console.log(`Prerender completed in ${renderTime}ms for ${targetUrl}`);

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

    if (statusCodeMeta) {
      const code = parseInt(statusCodeMeta, 10);
      if (code >= 100 && code < 600) {
        statusCode = code;
        
        // Handle redirects
        if (code >= 300 && code < 400 && redirectMeta) {
          const locationMatch = redirectMeta.match(/Location:\s*(.+)/i);
          if (locationMatch) {
            headers['Location'] = locationMatch[1].trim();
            // Short cache for redirects
            headers['Netlify-CDN-Cache-Control'] = 'public, max-age=3600, durable';
            headers['Cache-Control'] = 'public, max-age=300';
          }
        }
        
        // Adjust caching for error status codes
        if (code === 404) {
          headers['Netlify-CDN-Cache-Control'] = 'public, max-age=3600, durable';
          headers['Cache-Control'] = 'public, max-age=300';
        } else if (code >= 500) {
          headers['Netlify-CDN-Cache-Control'] = 'no-cache';
          headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
        }
      }
    }

    return new Response(html, {
      status: statusCode,
      headers
    });
  } catch (error) {
    console.error('Prerender error:', error);
    return new Response('Prerender failed', { status: 500 });
  }
};

export const config: Config = {
  path: "/api/prerender",
  schedule: undefined
};