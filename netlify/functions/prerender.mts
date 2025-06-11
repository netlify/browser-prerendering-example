import type { Context, Config } from "@netlify/functions";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";

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

    // Set a reasonable viewport
    await page.setViewport({ width: 1200, height: 800 });

    // Navigate to the URL and wait for network to be idle
    await page.goto(targetUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // Get the rendered HTML
    const html = await page.content();
    
    await page.close();

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Netlify-CDN-Cache-Control': 'public, max-age=86400, durable',
      }
    });
  } catch (error) {
    console.error('Prerender error:', error);
    return new Response('Prerender failed', { status: 500 });
  }
};

export const config: Config = {
  path: "/api/prerender"
};