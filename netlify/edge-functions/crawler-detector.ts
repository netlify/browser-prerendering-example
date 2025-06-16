import type { Context, Config } from "@netlify/edge-functions";

// Comprehensive crawler user agents (matching Go implementation)
const CRAWLER_USER_AGENTS = [
  'baiduspider',
  'twitterbot',
  'facebookexternalhit',
  'facebot',
  'rogerbot',
  'linkedinbot',
  'embedly',
  'quora link preview',
  'showyoubot',
  'socialflow',
  'net::curl::simple',
  'snipcart',
  'googlebot',
  'outbrain',
  'pinterestbot',
  'pinterest/0',
  'slackbot',
  'vkshare',
  'w3c_validator',
  'redditbot',
  'mediapartners-google',
  'adsbot-google',
  'parsely',
  'duckduckbot',
  'whatsapp',
  'hatena',
  'screaming frog seo spider',
  'bingbot',
  'sajaribot',
  'dashlinkpreviews',
  'discordbot',
  'ranksonicbot',
  'lyticsbot',
  'yandexbot/',
  'yandexwebmaster/',
  'naytev-url-scraper',
  'newspicksbot/',
  'swiftbot/',
  'mattermost',
  'applebot/',
  'snapchat',
  'viber',
  'proximic',
  'iframely/',
  'upday',
  'google web preview',
  'ahrefsbot/',
  'ahrefssiteaudit/',
  'googlesites',
  'petalbot',
  'taboolabot/',
  'google-inspectiontool/',
  'trueanthem/',
  'mattermost-bot/',
  'microsoftpreview/',
  'zoombot',
  'zendesk/external-content',
  'discourse forum onebox v',
  'mastodon/',
  'siteauditbot/',
  'semrushbot-ba',
  'semrushbot-si/',
  'semrushbot-swa/',
  'semrushbot-ocob/',
  'gptbot',
  'chatgpt-user',
  'oai-searchbot',
  'perplexitybot',
  'claudebot',
  'dotbot'
];

const isHTMLRequest = (path: string): boolean => {
  const lastDot = path.lastIndexOf('.');
  
  if (lastDot === -1) {
    // No extension - assume HTML
    return true;
  }
  
  const ext = path.substring(lastDot);
  
  // Avoid pre-rendering font assets
  if (ext === '.woff2') {
    return false;
  }
  
  // HTML extensions
  if (ext === '.html' || ext === '.htm') {
    return true;
  }
  
  // Any extension longer than 4 characters is assumed to be HTML (query params, etc.)
  return ext.length > 5;
};

const acceptsHTML = (acceptHeader: string): boolean => {
  if (!acceptHeader) {
    return true;
  }
  
  return acceptHeader.includes('text/html') ||
         acceptHeader.includes('text/*') ||
         acceptHeader.includes('*/*');
};

const isCrawlerRequest = (req: Request): boolean => {
  // Only GET requests
  if (req.method !== 'GET') {
    return false;
  }
  
  const url = new URL(req.url);
  
  // Check for _escaped_fragment_ parameter
  if (url.searchParams.has('_escaped_fragment_')) {
    return true;
  }
  
  const userAgent = req.headers.get('user-agent') || '';
  
  // Exclude empty, "Prerender", or excessively long user agents
  if (!userAgent || userAgent === 'Prerender' || userAgent.length > 4096) {
    return false;
  }
  
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some(bot => ua.includes(bot));
};

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  
  // Enhanced HTML request detection (matching Go logic)
  if (!isHTMLRequest(url.pathname)) {
    return context.next();
  }
  
  // Enhanced Accept header validation
  const acceptHeader = req.headers.get('accept') || '';
  if (!acceptsHTML(acceptHeader)) {
    return context.next();
  }
  
  // Skip for API routes and specific patterns
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/_next/') ||
      url.pathname.startsWith('/static/')) {
    return context.next();
  }
  
  // Check if this is a crawler request (comprehensive logic)
  const shouldPrerender = isCrawlerRequest(req) || url.searchParams.has('prerender');
  
  if (shouldPrerender) {
    // Construct the prerender URL
    const prerenderUrl = new URL('/api/prerender', req.url);
    const currentUrl = new URL(req.url);
    currentUrl.searchParams.delete('_escaped_fragment_')
    currentUrl.searchParams.delete('prerender')
    prerenderUrl.searchParams.set('url', currentUrl.toString());

    try {
      // Get the original user agent for logging/debugging
      const originalUserAgent = req.headers.get('user-agent') || '';
      
      // Fetch the prerendered content
      return context.next(new Request(prerenderUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Netlify-Edge-Function',
          'X-Original-User-Agent': originalUserAgent,
          'X-Forwarded-For': req.headers.get('x-forwarded-for') || '',
        }
      }));
    } catch (error) {
      console.error('Error calling prerender service:', error);
      // Fall back to normal response if prerender fails
      return context.next();
    }
  }
  
  // For regular users, serve the normal page
  return context.next();
};

export const config: Config = {
  path: "/*"
};