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
  try {
    const targetUrl = new URL(req.url).searchParams.get('url');
    
    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    // Set prerender user agent for consistent behavior
    await page.setUserAgent('Mozilla/5.0 (compatible; Prerender)');
    
    // Block cookie consent banners and tracking scripts for cleaner prerendering
    await page.setRequestInterception(true);
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
      
      // Block tracking pixels and cookie consent scripts
      if (blockedDomains.some(domain => url.includes(domain)) ||
          (resourceType === 'image' && (url.includes('track') || url.includes('pixel'))) ||
          (resourceType === 'script' && (url.includes('cookie') || url.includes('consent')))) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Set a reasonable viewport
    await page.setViewport({ width: 1200, height: 800 });

    // Disable images and CSS for faster rendering (can be toggled based on needs)
    const skipImages = new URL(req.url).searchParams.get('skipImages') === 'true';
    if (skipImages) {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (request.resourceType() === 'image' || request.resourceType() === 'stylesheet') {
          request.abort();
        } else {
          request.continue();
        }
      });
    }

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
      timeout: 30000 
    });

    // Wait for window.prerenderReady or timeout after 5 seconds
    try {
      await page.waitForFunction(
        () => window.prerenderReady === true,
        { timeout: 5000 }
      );
    } catch (timeoutError) {
      // Continue if prerenderReady is not set within timeout
      console.log('prerenderReady not detected, proceeding with render');
    }

    // Additional wait for network to be mostly idle (wait for 2 seconds of no network activity)
    try {
      await page.waitForFunction(() => true, { timeout: 2000 });
    } catch {
      console.log('Additional wait completed, proceeding with render');
    }

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

    // Clean up any open dialogs or alerts that might interfere
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

    // Get the rendered HTML
    const html = await page.content();
    
    // Clean up page resources
    await page.close();

    // Handle different status codes and enhanced caching
    let statusCode = 200;
    let headers: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
      'Vary': 'User-Agent',
      'X-Prerendered': 'true',
      'X-Prerender-Timestamp': new Date().toISOString(),
    };

    // Set default caching based on content analysis
    const isStaticContent = !html.includes('prerenderReady') && !html.includes('window.prerenderReady');
    const hasUserSpecificContent = html.includes('user') || html.includes('login') || html.includes('auth');
    
    if (hasUserSpecificContent) {
      // Short cache for user-specific content
      headers['Netlify-CDN-Cache-Control'] = 'public, max-age=300, stale-while-revalidate=600';
      headers['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=300';
    } else if (isStaticContent) {
      // Long cache for static content
      headers['Netlify-CDN-Cache-Control'] = 'public, max-age=604800, stale-while-revalidate=86400, durable';
      headers['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800';
    } else {
      // Medium cache for dynamic content
      headers['Netlify-CDN-Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=604800, durable';
      headers['Cache-Control'] = 'public, max-age=3600, stale-while-revalidate=86400';
    }

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
  path: "/api/prerender"
};