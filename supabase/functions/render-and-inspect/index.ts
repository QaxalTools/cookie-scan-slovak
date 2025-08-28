Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🚀 Starting render-and-inspect function');
    
    const { url } = await req.json();
    if (!url) {
      throw new Error('URL is required');
    }

    console.log(`📝 Analyzing URL: ${url}`);

    const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    if (!browserlessApiKey) {
      throw new Error('BROWSERLESS_API_KEY not configured');
    }

    // Function to be executed in Browserless
    const browserlessFunction = `
export default async ({ page, context }) => {
  console.log('🔍 Starting page analysis for:', context.url);
  
  // Initialize data collection
  const data = {
    finalUrl: context.url,
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
    cmp_detected: false,
    cmp_cookie_name: '',
    cmp_cookie_value: '',
    consent_clicked: false
  };

  // Set up CDP session
  const client = await page.target().createCDPSession();
  
  // Enable CDP domains
  await client.send('Network.enable', { maxTotalBufferSize: 10000000, maxResourceBufferSize: 5000000 });
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Storage.enable');
  await client.send('DOMStorage.enable');
  
  // Clear existing data (cold start)
  await client.send('Network.clearBrowserCookies');
  const origin = new URL(context.url).origin;
  await client.send('Storage.clearDataForOrigin', { 
    origin, 
    storageTypes: 'all' 
  });

  let requestIndex = 0;
  let isPreConsent = true;

  // Network request logging
  client.on('Network.requestWillBeSent', (params) => {
    const request = {
      id: params.requestId,
      url: params.request.url,
      method: params.request.method,
      headers: params.request.headers,
      timestamp: params.timestamp,
      index: requestIndex++,
      isPreConsent,
      query: {},
      postDataRaw: null,
      postDataParsed: null
    };

    // Parse query parameters
    try {
      const urlObj = new URL(params.request.url);
      const query = {};
      urlObj.searchParams.forEach((value, key) => {
        query[key] = value;
      });
      request.query = query;
    } catch (e) {
      console.log('Error parsing URL:', e.message);
    }

    // Store POST data if available
    if (params.request.postData) {
      request.postDataRaw = params.request.postData;
      
      // Parse POST data based on content type
      const contentType = params.request.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try {
          request.postDataParsed = JSON.parse(params.request.postData);
        } catch (e) {
          console.log('Error parsing JSON POST data:', e.message);
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        try {
          const parsed = {};
          const pairs = params.request.postData.split('&');
          pairs.forEach(pair => {
            const [key, value] = pair.split('=');
            if (key && value !== undefined) {
              parsed[decodeURIComponent(key)] = decodeURIComponent(value);
            }
          });
          request.postDataParsed = parsed;
        } catch (e) {
          console.log('Error parsing form POST data:', e.message);
        }
      }
    }

    if (isPreConsent) {
      data.requests_pre.push(request);
    } else {
      data.requests_post.push(request);
    }
  });

  // Response logging
  client.on('Network.responseReceived', (params) => {
    const response = {
      requestId: params.requestId,
      url: params.response.url,
      status: params.response.status,
      headers: params.response.headers,
      mimeType: params.response.mimeType,
      timestamp: params.timestamp,
      isPreConsent
    };

    if (isPreConsent) {
      data.responses_pre.push(response);
    } else {
      data.responses_post.push(response);
    }
  });

  // Console logging
  page.on('console', msg => {
    data.console_logs.push({
      type: msg.type(),
      text: msg.text(),
      timestamp: Date.now(),
      isPreConsent
    });
  });

  // Helper function to collect all cookies
  const getAllCookies = async () => {
    const cookies = [];
    
    // Method 1: CDP Network.getAllCookies
    try {
      const { cookies: cdpCookies } = await client.send('Network.getAllCookies');
      cookies.push(...cdpCookies);
    } catch (e) {
      console.log('CDP cookies failed:', e.message);
    }
    
    // Method 2: Puppeteer page.cookies()
    try {
      const pageCookies = await page.cookies();
      cookies.push(...pageCookies);
    } catch (e) {
      console.log('Page cookies failed:', e.message);
    }
    
    // Method 3: document.cookie via evaluation
    try {
      const docCookies = await page.evaluate(() => {
        const cookies = [];
        document.cookie.split(';').forEach(cookie => {
          const [name, value] = cookie.trim().split('=');
          if (name && value) {
            cookies.push({
              name: name.trim(),
              value: value.trim(),
              domain: window.location.hostname,
              path: '/',
              secure: false,
              httpOnly: false,
              sameSite: 'Lax'
            });
          }
        });
        return cookies;
      });
      cookies.push(...docCookies);
    } catch (e) {
      console.log('Document cookies failed:', e.message);
    }

    // Deduplicate cookies
    const uniqueCookies = [];
    const seen = new Set();
    cookies.forEach(cookie => {
      const key = \`\${cookie.name}|\${cookie.domain}|\${cookie.path || '/'}\`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueCookies.push(cookie);
      }
    });

    return uniqueCookies;
  };

  // Helper function to collect storage
  const getStorage = async () => {
    const storage = { localStorage: {}, sessionStorage: {} };
    
    try {
      // Get localStorage via CDP
      const localStorageId = await client.send('DOMStorage.getDOMStorageItems', {
        storageId: { securityOrigin: origin, isLocalStorage: true }
      });
      if (localStorageId.entries) {
        localStorageId.entries.forEach(([key, value]) => {
          storage.localStorage[key] = value;
        });
      }
    } catch (e) {
      console.log('CDP localStorage failed:', e.message);
    }

    try {
      // Get sessionStorage via CDP  
      const sessionStorageId = await client.send('DOMStorage.getDOMStorageItems', {
        storageId: { securityOrigin: origin, isLocalStorage: false }
      });
      if (sessionStorageId.entries) {
        sessionStorageId.entries.forEach(([key, value]) => {
          storage.sessionStorage[key] = value;
        });
      }
    } catch (e) {
      console.log('CDP sessionStorage failed:', e.message);
    }

    // Fallback: evaluate storage directly
    try {
      const evalStorage = await page.evaluate(() => {
        const ls = {};
        const ss = {};
        
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) ls[key] = localStorage.getItem(key);
        }
        
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) ss[key] = sessionStorage.getItem(key);
        }
        
        return { localStorage: ls, sessionStorage: ss };
      });
      
      Object.assign(storage.localStorage, evalStorage.localStorage);
      Object.assign(storage.sessionStorage, evalStorage.sessionStorage);
    } catch (e) {
      console.log('Evaluate storage failed:', e.message);
    }

    return storage;
  };

  console.log('🌐 Navigating to page...');
  
  // Navigate to the page
  await page.goto(context.url, { 
    waitUntil: 'networkidle2', 
    timeout: 60000 
  });

  console.log('📄 Page loaded, waiting for additional scripts...');
  
  // Wait additional time for async scripts
  await page.waitForTimeout(5000);

  // First data collection (pre-consent)
  console.log('📊 Collecting pre-consent data...');
  data.cookies_pre = await getAllCookies();
  data.storage_pre = await getStorage();
  data.renderedHTML_pre = await page.content();

  console.log(\`Pre-consent: \${data.cookies_pre.length} cookies, \${Object.keys(data.storage_pre.localStorage).length + Object.keys(data.storage_pre.sessionStorage).length} storage items\`);

  // Try to detect and click consent management
  console.log('🍪 Looking for consent management...');
  
  // Check for CMP cookies first
  const cmpCookies = data.cookies_pre.filter(cookie => 
    /CookieScriptConsent|OptanonConsent|euconsent-v2|CookieConsent|tarteaucitron|cookieyes-consent|CookieYes-consent/i.test(cookie.name)
  );
  
  if (cmpCookies.length > 0) {
    data.cmp_detected = true;
    data.cmp_cookie_name = cmpCookies[0].name;
    data.cmp_cookie_value = cmpCookies[0].value.substring(0, 100);
    console.log(\`CMP cookie detected: \${data.cmp_cookie_name}\`);
  }

  // Try to click consent buttons
  const consentSelectors = [
    '[data-testid*="accept"]',
    '[id*="accept"]',
    '[class*="accept"]',
    'button:has-text("Accept")',
    'button:has-text("Súhlas")',
    'button:has-text("Prijať")',
    'button:has-text("Allow")',
    '.cc-allow',
    '.cookie-accept',
    '#onetrust-accept-btn-handler',
    '.optanon-allow-all',
    '.cookiescript_accept'
  ];

  let consentClicked = false;
  for (const selector of consentSelectors) {
    try {
      const element = await page.\$(selector);
      if (element) {
        await element.click();
        console.log(\`Clicked consent button: \${selector}\`);
        consentClicked = true;
        data.consent_clicked = true;
        break;
      }
    } catch (e) {
      // Continue trying other selectors
    }
  }

  if (consentClicked) {
    console.log('⏳ Waiting after consent click...');
    isPreConsent = false;
    await page.waitForTimeout(8000); // Wait longer after consent

    // Second data collection (post-consent)
    console.log('📊 Collecting post-consent data...');
    data.cookies_post = await getAllCookies();
    data.storage_post = await getStorage();
    data.renderedHTML_post = await page.content();

    console.log(\`Post-consent: \${data.cookies_post.length} cookies, \${Object.keys(data.storage_post.localStorage).length + Object.keys(data.storage_post.sessionStorage).length} storage items\`);
  } else {
    console.log('🔍 No consent button found or clicked');
    // Use pre-consent data as post-consent
    data.cookies_post = [...data.cookies_pre];
    data.storage_post = { ...data.storage_pre };
    data.renderedHTML_post = data.renderedHTML_pre;
  }

  // Final URL after redirects
  data.finalUrl = page.url();

  console.log('✅ Analysis complete');
  console.log(\`Final stats: Pre(\${data.requests_pre.length} requests, \${data.cookies_pre.length} cookies) Post(\${data.requests_post.length} requests, \${data.cookies_post.length} cookies)\`);

  return data;
};`;

    console.log('🌐 Calling Browserless API...');

    // Call Browserless API
    const browserlessResponse = await fetch('https://chrome.browserless.io/function', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${browserlessApiKey}`,
      },
      body: JSON.stringify({
        code: browserlessFunction,
        context: { url },
        timeout: 120000, // 2 minutes timeout
      }),
    });

    if (!browserlessResponse.ok) {
      const errorText = await browserlessResponse.text();
      console.error('❌ Browserless API error:', errorText);
      throw new Error(`Browserless API failed: ${browserlessResponse.status} - ${errorText}`);
    }

    const renderData = await browserlessResponse.json();
    console.log('✅ Browserless data received');
    console.log(`Final URL: ${renderData.finalUrl}`);
    console.log(`Cookies: pre=${renderData.cookies_pre?.length || 0}, post=${renderData.cookies_post?.length || 0}`);
    console.log(`Requests: pre=${renderData.requests_pre?.length || 0}, post=${renderData.requests_post?.length || 0}`);
    console.log(`Storage items: pre=${Object.keys(renderData.storage_pre?.localStorage || {}).length + Object.keys(renderData.storage_pre?.sessionStorage || {}).length}, post=${Object.keys(renderData.storage_post?.localStorage || {}).length + Object.keys(renderData.storage_post?.sessionStorage || {}).length}`);

    return new Response(JSON.stringify({
      success: true,
      data: renderData
    }), {
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders 
      },
    });

  } catch (error) {
    console.error('❌ Error in render-and-inspect:', error.message);
    
    // Return a basic fallback response instead of failing completely
    const fallbackData = {
      finalUrl: url || 'unknown',
      cookies_pre: [],
      cookies_post: [],
      requests_pre: [],
      requests_post: [],
      responses_pre: [],
      responses_post: [],
      storage_pre: { localStorage: {}, sessionStorage: {} },
      storage_post: { localStorage: {}, sessionStorage: {} },
      renderedHTML_pre: `<html><body><h1>Fallback mode</h1><p>Real analysis failed: ${error.message}</p></body></html>`,
      renderedHTML_post: `<html><body><h1>Fallback mode</h1><p>Real analysis failed: ${error.message}</p></body></html>`,
      console_logs: [],
      cmp_detected: false,
      cmp_cookie_name: '',
      cmp_cookie_value: '',
      consent_clicked: false,
      _error: error.message
    };

    return new Response(JSON.stringify({
      success: false,
      data: fallbackData,
      error: error.message
    }), {
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders 
      },
      status: 200 // Return 200 so frontend can handle gracefully
    });
  }
});