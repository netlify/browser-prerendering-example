import type { Context, Config } from "@netlify/edge-functions";

// Common crawler user agents
const CRAWLER_USER_AGENTS = [
  'googlebot',
  'bingbot',
  'slurp', // Yahoo
  'duckduckbot',
  'baiduspider',
  'yandexbot',
  'facebookexternalhit',
  'twitterbot',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  'skypeuripreview',
  'slackbot',
  'applebot',
  'discordbot',
  'redditbot',
  'pinterestbot',
  'tumblr',
  'bitlybot',
  'embedly',
  'quora link preview',
  'showyoubot',
  'outbrain',
  'pinterest/0.',
  'developers.google.com/+/web/snippet',
  'www.google.com/webmasters/tools/richsnippets',
  'chrome-lighthouse',
  'lighthouse'
];

const isCrawler = (userAgent: string): boolean => {
  if (!userAgent) return false;
  
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some(bot => ua.includes(bot));
};

const isPrerenderRequest = (url: URL): boolean => {
  // Check for common prerender query parameters
  return url.searchParams.has('_escaped_fragment_') || 
         url.searchParams.has('prerender') ||
         url.hash === '#!';
};

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const userAgent = req.headers.get('user-agent') || '';
  
  // Skip processing for non-HTML requests
  const acceptHeader = req.headers.get('accept') || '';
  if (!acceptHeader.includes('text/html')) {
    return context.next();
  }
  
  // Skip for API routes, assets, and static files
  if (url.pathname.startsWith('/api/') || 
      url.pathname.startsWith('/_next/') ||
      url.pathname.startsWith('/static/') ||
      url.pathname.includes('.') && !url.pathname.endsWith('.html')) {
    return context.next();
  }
  
  // Check if this is a crawler or prerender request
  const shouldPrerender = isCrawler(userAgent) || isPrerenderRequest(url);
  
  console.log("shouldPrerender", shouldPrerender, isCrawler(userAgent), isPrerenderRequest(url), url)
  if (shouldPrerender) {
    // Construct the prerender URL
    const prerenderUrl = new URL('/api/prerender', req.url);
    const currentUrl = new URL(req.url);
    currentUrl.searchParams.delete('_escaped_fragment_')
    currentUrl.searchParams.delete('prerender')
    prerenderUrl.searchParams.set('url', currentUrl.toString());

    try {
      // Fetch the prerendered content
      return context.next(new Request(prerenderUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Netlify-Edge-Function',
          'X-Original-User-Agent': userAgent,
          'X-Forwarded-For': req.headers.get('x-forwarded-for') || '',
        }
      }));
    } catch (error) {
      console.error('Error calling prerender service:', error);
      // Fall back to normal response if prerender fails
      return context.next();
    }
  }
  
  console.log("route to next request")
  // For regular users, serve the normal page
  return context.next();
};

export const config: Config = {
  path: "/*"
};