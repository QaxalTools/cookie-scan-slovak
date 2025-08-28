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
  cookies_pre?: any[];
  cookies_post?: any[];
  requests_pre?: any[];
  requests_post?: any[];
  responses_pre?: any[];
  responses_post?: any[];
  storage_pre?: any;
  storage_post?: any;
  renderedHTML_pre?: string;
  renderedHTML_post?: string;
  console_logs?: any[];
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

    // Browserless script for comprehensive CDP-based capture
    const browserlessScript = `
      module.exports = async ({ page, context }) => {
        console.log('Starting comprehensive CDP-based data collection');
        
        const results = {
          cookies_pre: [],
          cookies_post: [],
          requests_pre: [],
          requests_post: [],
          responses_pre: [],
          responses_post: [],
          storage_pre: {},
          storage_post: {},
          renderedHTML_pre: '',
          renderedHTML_post: '',
          console_logs: [],
          finalUrl: ''
        };

        const requests_pre = [];
        const requests_post = [];
        const responses_pre = [];
        const responses_post = [];
        const console_logs = [];
        let isPreConsent = true;

          // Capture console logs
          page.on('console', (msg) => {
            console_logs.push({
              type: msg.type(),
              text: msg.text(),
              timestamp: Date.now()
            });
          });

          // Bypass CSP and configure page
          await page.setBypassCSP(true);
          
          // Set up CDP session for comprehensive data collection
          const client = await page.target().createCDPSession();
          
          // Enable CDP domains
          await client.send('Network.enable', { 
            maxTotalBufferSize: 10000000, 
            maxResourceBufferSize: 5000000 
          });
          await client.send('Page.enable');
          await client.send('Runtime.enable');
          await client.send('Storage.enable');
          await client.send('DOMStorage.enable');
          
          // Clear existing data for cold start
          await client.send('Network.clearBrowserCookies');
          const origin = new URL(context.url).origin;
          await client.send('Storage.clearDataForOrigin', { 
            origin: origin, 
            storageTypes: 'all' 
          });
          
          console.log('CDP initialized and data cleared');

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

          // Enhanced three-phase cookie capture function
          async function getAllCookies() {
            const cookies = [];
            
            // Method 1: Standard Puppeteer cookies
            try {
              const pageCookies = await page.cookies();
              cookies.push(...pageCookies);
            } catch (e) {
              console.log('Error getting page cookies:', e.message);
            }
            
            // Method 2: CDP Network.getAllCookies (includes all domains)
            try {
              const { cookies: cdpCookies } = await client.send('Network.getAllCookies');
              cookies.push(...cdpCookies);
            } catch (e) {
              console.log('Error getting CDP cookies:', e.message);
            }

            // Method 3: Evaluate document.cookie
            try {
              const docCookies = await page.evaluate(() => {
                return document.cookie.split(';').map(cookie => {
                  const [name, ...valueParts] = cookie.trim().split('=');
                  return {
                    name: name,
                    value: valueParts.join('='),
                    domain: window.location.hostname,
                    path: '/',
                    source: 'document.cookie'
                  };
                }).filter(c => c.name);
              });
              cookies.push(...docCookies);
            } catch (e) {
              console.log('Error getting document.cookie:', e.message);
            }
            
            // Deduplicate by name+domain+path
            const uniqueCookies = cookies.reduce((acc, cookie) => {
              const key = \`\${cookie.name}|\${cookie.domain}|\${cookie.path || '/'}\`;
              if (!acc.has(key)) {
                acc.set(key, cookie);
              }
              return acc;
            }, new Map());
            
            return Array.from(uniqueCookies.values());
          }

          // Set up comprehensive CDP network monitoring
          client.on('Network.requestWillBeSent', async (params) => {
            const url = new URL(params.request.url);
            const queryParams = Object.fromEntries(url.searchParams.entries());
            
            const requestData = {
              url: params.request.url,
              method: params.request.method,
              headers: params.request.headers,
              resourceType: params.type,
              timestamp: params.timestamp * 1000,
              requestId: params.requestId,
              queryParams: queryParams,
              postDataRaw: null,
              postDataParsed: null,
              isPreConsent: isPreConsent
            };
            
            // Collect POST data if available
            if (params.request.method === 'POST' && params.request.hasPostData) {
              try {
                const postDataResponse = await client.send('Network.getRequestPostData', { 
                  requestId: params.requestId 
                });
                requestData.postDataRaw = postDataResponse.postData ? 
                  postDataResponse.postData.substring(0, 2000) : null;
                
                // Parse POST data based on content type
                const contentType = params.request.headers['content-type'] || '';
                if (requestData.postDataRaw) {
                  if (contentType.includes('application/json')) {
                    try {
                      requestData.postDataParsed = JSON.parse(requestData.postDataRaw);
                    } catch (e) {
                      console.log('Failed to parse JSON post data');
                    }
                  } else if (contentType.includes('application/x-www-form-urlencoded')) {
                    try {
                      const urlParams = new URLSearchParams(requestData.postDataRaw);
                      requestData.postDataParsed = Object.fromEntries(urlParams.entries());
                    } catch (e) {
                      console.log('Failed to parse URL-encoded post data');
                    }
                  }
                }
              } catch (e) {
                console.log('Error getting post data:', e.message);
              }
            }
            
            if (isPreConsent) {
              requests_pre.push(requestData);
            } else {
              requests_post.push(requestData);
            }
          });

          client.on('Network.responseReceived', async (params) => {
            const responseData = {
              url: params.response.url,
              status: params.response.status,
              headers: params.response.headers,
              mimeType: params.response.mimeType,
              requestId: params.requestId,
              timestamp: params.timestamp * 1000,
              responseBodySample: null
            };
            
            // Try to get response body for text/JSON responses
            if (params.response.mimeType && 
                (params.response.mimeType.includes('text/') || 
                 params.response.mimeType.includes('application/json'))) {
              try {
                const bodyResponse = await client.send('Network.getResponseBody', { 
                  requestId: params.requestId 
                });
                if (bodyResponse.body) {
                  responseData.responseBodySample = bodyResponse.body.substring(0, 1000);
                }
              } catch (e) {
                // Response body not available or binary
              }
            }
            
            if (isPreConsent) {
              responses_pre.push(responseData);
            } else {
              responses_post.push(responseData);
            }
          });

          // Navigate to the page with comprehensive waiting
          console.log('Navigating to:', context.url);
          await page.goto(context.url, { waitUntil: 'networkidle2', timeout: 60000 });
          
          // Wait for network idle + extra 5s for async scripts
          console.log('Waiting for network idle and async scripts');
          await page.waitForTimeout(5000);

          // Enhanced storage capture using CDP + fallback
          async function captureStorage() {
            try {
              const allStorage = {
                localStorage: {},
                sessionStorage: {}
              };
              
              // Method 1: CDP DOMStorage (more reliable)
              try {
                const origin = new URL(page.url()).origin;
                
                // Get localStorage
                const localStorageId = { securityOrigin: origin, isLocalStorage: true };
                const localStorageItems = await client.send('DOMStorage.getDOMStorageItems', { 
                  storageId: localStorageId 
                });
                localStorageItems.entries.forEach(([key, value]) => {
                  allStorage.localStorage[key] = {
                    value: value,
                    origin: origin,
                    scope: 'main'
                  };
                });
                
                // Get sessionStorage
                const sessionStorageId = { securityOrigin: origin, isLocalStorage: false };
                const sessionStorageItems = await client.send('DOMStorage.getDOMStorageItems', { 
                  storageId: sessionStorageId 
                });
                sessionStorageItems.entries.forEach(([key, value]) => {
                  allStorage.sessionStorage[key] = {
                    value: value,
                    origin: origin,
                    scope: 'main'
                  };
                });
                
                console.log(\`CDP storage: \${Object.keys(allStorage.localStorage).length} localStorage, \${Object.keys(allStorage.sessionStorage).length} sessionStorage\`);
              } catch (cdpError) {
                console.log('CDP storage error:', cdpError.message);
              }
              
              // Method 2: Fallback to page.evaluate
              const mainStorage = await page.evaluate(() => {
                const localStorage = {};
                const sessionStorage = {};
                
                try {
                  for (let i = 0; i < window.localStorage.length; i++) {
                    const key = window.localStorage.key(i);
                    if (key) {
                      localStorage[key] = {
                        value: window.localStorage.getItem(key),
                        origin: window.location.origin,
                        scope: 'main'
                      };
                    }
                  }
                } catch (e) {
                  console.log('Error reading localStorage:', e.message);
                }
                
                try {
                  for (let i = 0; i < window.sessionStorage.length; i++) {
                    const key = window.sessionStorage.key(i);
                    if (key) {
                      sessionStorage[key] = {
                        value: window.sessionStorage.getItem(key),
                        origin: window.location.origin,
                        scope: 'main'
                      };
                    }
                  }
                } catch (e) {
                  console.log('Error reading sessionStorage:', e.message);
                }
                
                return { localStorage, sessionStorage };
              });
              
              // Merge fallback data (CDP takes priority)
              Object.keys(mainStorage.localStorage).forEach(key => {
                if (!allStorage.localStorage[key]) {
                  allStorage.localStorage[key] = mainStorage.localStorage[key];
                }
              });
              Object.keys(mainStorage.sessionStorage).forEach(key => {
                if (!allStorage.sessionStorage[key]) {
                  allStorage.sessionStorage[key] = mainStorage.sessionStorage[key];
                }
              });
              
              // Try iframes for additional data
              const frames = page.frames();
              for (const frame of frames) {
                if (frame !== page.mainFrame()) {
                  try {
                    const frameStorage = await frame.evaluate(() => {
                      const localStorage = {};
                      const sessionStorage = {};
                      
                      try {
                        for (let i = 0; i < window.localStorage.length; i++) {
                          const key = window.localStorage.key(i);
                          if (key) {
                            localStorage[key] = {
                              value: window.localStorage.getItem(key),
                              origin: window.location.origin,
                              scope: 'iframe'
                            };
                          }
                        }
                      } catch (e) {
                        // Cross-origin iframe, skip
                      }
                      
                      try {
                        for (let i = 0; i < window.sessionStorage.length; i++) {
                          const key = window.sessionStorage.key(i);
                          if (key) {
                            sessionStorage[key] = {
                              value: window.sessionStorage.getItem(key),
                              origin: window.location.origin,
                              scope: 'iframe'
                            };
                          }
                        }
                      } catch (e) {
                        // Cross-origin iframe, skip
                      }
                      
                      return { localStorage, sessionStorage };
                    });
                    
                    Object.assign(allStorage.localStorage, frameStorage.localStorage);
                    Object.assign(allStorage.sessionStorage, frameStorage.sessionStorage);
                  } catch (e) {
                    // Cross-origin or other errors, skip this frame
                  }
                }
              }
              
              console.log(\`Total storage captured: \${Object.keys(allStorage.localStorage).length + Object.keys(allStorage.sessionStorage).length} items\`);
              return allStorage;
            } catch (e) {
              console.log('Error capturing storage:', e.message);
              return { localStorage: {}, sessionStorage: {} };
            }
          }

          // Three-phase cookie collection
          console.log('Phase 1: Immediate cookie capture');
          const cookies_phase1 = await getAllCookies();
          
          // Phase 2: After network idle
          console.log('Phase 2: Post-network-idle capture');
          const cookies_phase2 = await getAllCookies();
          
          // Phase 3: After extra idle
          await page.waitForTimeout(2000);
          console.log('Phase 3: Final capture');
          const cookies_phase3 = await getAllCookies();
          
          // Capture pre-consent state (merge all cookie phases)
          console.log('Capturing pre-consent state');
          results.finalUrl = page.url();
          
          // Merge cookies from all phases
          const allCookies = [...cookies_phase1, ...cookies_phase2, ...cookies_phase3];
          const cookieMap = new Map();
          allCookies.forEach(cookie => {
            const key = \`\${cookie.name}|\${cookie.domain}|\${cookie.path || '/'}\`;
            cookieMap.set(key, cookie);
          });
          results.cookies_pre = Array.from(cookieMap.values());
          
          results.requests_pre = [...requests_pre];
          results.responses_pre = [...responses_pre];
          results.storage_pre = await captureStorage();
          results.renderedHTML_pre = await page.content();
          
          console.log(\`Pre-consent summary: \${results.cookies_pre.length} cookies, \${results.requests_pre.length} requests, \${Object.keys(results.storage_pre.localStorage).length + Object.keys(results.storage_pre.sessionStorage).length} storage items\`);

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
          console.log('Consent button clicked, switching to post-consent tracking');
          
          // Switch phase tracking
          isPreConsent = false;
          
          // Wait for post-consent changes
          await page.waitForTimeout(5000);
          
          // Three-phase post-consent cookie collection
          console.log('Post-consent Phase 1: Immediate capture');
          const postCookies_phase1 = await getAllCookies();
          
          console.log('Post-consent Phase 2: Network idle capture');
          const postCookies_phase2 = await getAllCookies();
          
          await page.waitForTimeout(2000);
          console.log('Post-consent Phase 3: Final capture');
          const postCookies_phase3 = await getAllCookies();
          
          // Capture post-consent state
          console.log('Capturing post-consent state');
          
          // Merge post-consent cookies
          const allPostCookies = [...postCookies_phase1, ...postCookies_phase2, ...postCookies_phase3];
          const postCookieMap = new Map();
          allPostCookies.forEach(cookie => {
            const key = \`\${cookie.name}|\${cookie.domain}|\${cookie.path || '/'}\`;
            postCookieMap.set(key, cookie);
          });
          results.cookies_post = Array.from(postCookieMap.values());
          
          results.requests_post = [...requests_post];
          results.responses_post = [...responses_post];
          results.storage_post = await captureStorage();
          results.renderedHTML_post = await page.content();
          
          console.log(\`Post-consent summary: \${results.cookies_post.length} cookies, \${results.requests_post.length} requests, \${Object.keys(results.storage_post.localStorage).length + Object.keys(results.storage_post.sessionStorage).length} storage items\`);
        } else {
          console.log('No consent button found, using pre-consent state for both');
          results.cookies_post = results.cookies_pre;
          results.requests_post = results.requests_pre;
          results.responses_post = results.responses_pre;
          results.storage_post = results.storage_pre;
          results.renderedHTML_post = results.renderedHTML_pre;
        }

        results.console_logs = console_logs;
        console.log(\`Render and inspect completed. Total: \${results.cookies_pre.length}+\${results.cookies_post.length} cookies, \${results.requests_pre.length}+\${results.requests_post.length} requests\`);
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
      cookies_pre: result.cookies_pre || [],
      cookies_post: result.cookies_post || [],
      requests_pre: result.requests_pre || [],
      requests_post: result.requests_post || [],
      responses_pre: result.responses_pre || [],
      responses_post: result.responses_post || [],
      storage_pre: result.storage_pre || {},
      storage_post: result.storage_post || {},
      renderedHTML_pre: result.renderedHTML_pre || '',
      renderedHTML_post: result.renderedHTML_post || '',
      console_logs: result.console_logs || [],
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