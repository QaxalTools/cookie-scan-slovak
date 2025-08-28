import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RenderRequest {
  url: string;
  delay?: number;
  viewport?: { width: number; height: number };
}

interface RenderResponse {
  success: boolean;
  renderedHTML_pre?: string;
  renderedHTML_post?: string;
  cookies_pre?: any[];
  cookies_post?: any[];
  requests_pre?: any[];
  requests_post?: any[];
  finalUrl?: string;
  mode?: 'live' | 'html' | 'simulation';
  error?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
  if (!browserlessApiKey) {
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'BROWSERLESS_API_KEY not configured' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { url, delay = 3000, viewport = { width: 1920, height: 1080 } }: RenderRequest = await req.json();

    if (!url) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'URL is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Starting render and inspect for: ${url}`);

    // Browserless script for two-phase capture
    const browserlessScript = `
      module.exports = async ({ page, context }) => {
        const results = {
          renderedHTML_pre: '',
          renderedHTML_post: '',
          cookies_pre: [],
          cookies_post: [],
          requests_pre: [],
          requests_post: [],
          finalUrl: ''
        };

        const requests_pre = [];
        const requests_post = [];

        // Set viewport from context
        await page.setViewport({
          width: context?.viewport?.width || 1920,
          height: context?.viewport?.height || 1080,
        });

        // Set browser locale and user agent for Slovak websites
        await page.setExtraHTTPHeaders({ 
          'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8,cs;q=0.7' 
        });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.emulateTimezone('Europe/Bratislava');

        // Set up request interception for pre-consent
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          requests_pre.push({
            url: request.url(),
            method: request.method(),
            headers: request.headers(),
            resourceType: request.resourceType()
          });
          request.continue();
        });

        // Navigate to the page with increased timeout using context URL
        console.log('Navigating to:', context.url);
        await page.goto(context.url, { waitUntil: 'networkidle2', timeout: 45000 });
        
        // Wait for initial load with extended time
        await page.waitForTimeout(5000);

        // Capture pre-consent state
        console.log('Capturing pre-consent state');
        results.finalUrl = page.url();
        results.renderedHTML_pre = await page.content();
        results.cookies_pre = await page.cookies();
        results.requests_pre = [...requests_pre];

        // Try to find and click consent button in main page and iframes
        console.log('Looking for consent accept button');
        const consentSelectors = [
          'button[data-testid*="accept"]',
          'button[id*="accept"]',
          'button[class*="accept"]',
          'button:contains("Accept all")',
          'button:contains("Prijať všetko")',
          'button:contains("Súhlas")',
          'button:contains("Accept")',
          'button:contains("Agree")',
          'button:contains("Súhlasiť")',
          'button:contains("Akceptovať")',
          '[data-cookiefirst-action="accept"]',
          '.accept-all',
          '#accept-all',
          '.cookie-accept',
          '#cookie-accept',
          '[class*="consent"][class*="accept"]',
          '[id*="consent"][id*="accept"]'
        ];

        async function findAndClickInFrame(frameOrPage, frameName = 'main') {
          console.log(\`Searching for consent buttons in \${frameName}\`);
          
          for (const selector of consentSelectors) {
            try {
              if (selector.includes(':contains')) {
                // Handle text-based selectors
                const textToFind = selector.match(/contains\\("([^"]+)"\\)/)[1];
                const buttons = await frameOrPage.$$('button');
                for (const button of buttons) {
                  const text = await button.evaluate(el => el.textContent?.trim().toLowerCase());
                  if (text && text.includes(textToFind.toLowerCase())) {
                    console.log(\`Found consent button in \${frameName} with text: \${text}\`);
                    await button.click();
                    return true;
                  }
                }
              } else {
                const element = await frameOrPage.$(selector);
                if (element) {
                  console.log(\`Found consent button in \${frameName} with selector: \${selector}\`);
                  await element.click();
                  return true;
                }
              }
            } catch (error) {
              // Continue to next selector
            }
          }
          return false;
        }

        let clicked = false;
        
        // First try main page
        clicked = await findAndClickInFrame(page, 'main page');
        
        // If not found, try all iframes
        if (!clicked) {
          const frames = page.frames();
          for (const frame of frames) {
            if (frame !== page.mainFrame()) {
              try {
                const frameUrl = frame.url();
                clicked = await findAndClickInFrame(frame, \`iframe: \${frameUrl}\`);
                if (clicked) break;
              } catch (error) {
                console.log('Error checking frame:', error.message);
              }
            }
          }
        }

        if (clicked) {
          console.log('Consent button clicked, waiting for changes');
          
          // Clear previous requests and set up new interception for post-consent
          await page.setRequestInterception(false);
          await page.setRequestInterception(true);
          page.removeAllListeners('request');
          page.on('request', (request) => {
            requests_post.push({
              url: request.url(),
              method: request.method(),
              headers: request.headers(),
              resourceType: request.resourceType()
            });
            request.continue();
          });

          // Wait for post-consent changes with extended time
          await page.waitForTimeout(5000);
          
          // Capture post-consent state
          console.log('Capturing post-consent state');
          results.renderedHTML_post = await page.content();
          results.cookies_post = await page.cookies();
          results.requests_post = [...requests_post];
        } else {
          console.log('No consent button found, using pre-consent state for both');
          results.renderedHTML_post = results.renderedHTML_pre;
          results.cookies_post = results.cookies_pre;
          results.requests_post = results.requests_pre;
        }

        console.log('Render and inspect completed');
        return results;
      };
    `;

    // Call Browserless API with token parameter
    const browserlessResponse = await fetch(`https://production-sfo.browserless.io/function?token=${browserlessApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: browserlessScript,
        context: {
          url: url,
          delay: delay,
          viewport: viewport
        }
      }),
    });

    if (!browserlessResponse.ok) {
      const errorText = await browserlessResponse.text();
      console.error(`Browserless API error - Status: ${browserlessResponse.status}, Response: ${errorText}`);
      throw new Error(`Browserless API error: ${browserlessResponse.status} - ${errorText}`);
    }

    const result = await browserlessResponse.json();
    console.log('Browserless result received');

    const response: RenderResponse = {
      success: true,
      mode: 'live',
      renderedHTML_pre: result.renderedHTML_pre,
      renderedHTML_post: result.renderedHTML_post,
      cookies_pre: result.cookies_pre || [],
      cookies_post: result.cookies_post || [],
      requests_pre: result.requests_pre || [],
      requests_post: result.requests_post || [],
      finalUrl: result.finalUrl
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in render-and-inspect function:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});