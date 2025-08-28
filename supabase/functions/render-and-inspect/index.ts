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
      const puppeteer = require('puppeteer');
      
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

        // Navigate to the page
        console.log('Navigating to:', '${url}');
        await page.goto('${url}', { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Wait for initial load
        await page.waitForTimeout(${delay});

        // Capture pre-consent state
        console.log('Capturing pre-consent state');
        results.finalUrl = page.url();
        results.renderedHTML_pre = await page.content();
        results.cookies_pre = await page.cookies();
        results.requests_pre = [...requests_pre];

        // Try to find and click consent button
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
          '[data-cookiefirst-action="accept"]',
          '.accept-all',
          '#accept-all',
          '.cookie-accept',
          '#cookie-accept'
        ];

        let clicked = false;
        for (const selector of consentSelectors) {
          try {
            if (selector.includes(':contains')) {
              // Handle text-based selectors
              const textToFind = selector.match(/contains\\("([^"]+)"\\)/)[1];
              const buttons = await page.$$('button');
              for (const button of buttons) {
                const text = await button.evaluate(el => el.textContent?.trim().toLowerCase());
                if (text && text.includes(textToFind.toLowerCase())) {
                  console.log('Found consent button with text:', text);
                  await button.click();
                  clicked = true;
                  break;
                }
              }
            } else {
              const element = await page.$(selector);
              if (element) {
                console.log('Found consent button with selector:', selector);
                await element.click();
                clicked = true;
                break;
              }
            }
            if (clicked) break;
          } catch (error) {
            // Continue to next selector
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

          // Wait for post-consent changes
          await page.waitForTimeout(3000);
          
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

    // Call Browserless API
    const browserlessResponse = await fetch('https://chrome.browserless.io/function', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${browserlessApiKey}`,
      },
      body: JSON.stringify({
        code: browserlessScript,
        context: {},
        viewport: {
          width: viewport.width,
          height: viewport.height,
        },
        options: {
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
      }),
    });

    if (!browserlessResponse.ok) {
      const errorText = await browserlessResponse.text();
      console.error('Browserless API error:', errorText);
      throw new Error(`Browserless API error: ${browserlessResponse.status} - ${errorText}`);
    }

    const result = await browserlessResponse.json();
    console.log('Browserless result received');

    const response: RenderResponse = {
      success: true,
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