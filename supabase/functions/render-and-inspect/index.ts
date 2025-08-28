import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = crypto.randomUUID();
  const startTime = Date.now();
  let requestData = null;
  
  // Parse request body once at the start
  try {
    requestData = await req.json();
  } catch (parseError) {
    console.error(`❌ Failed to parse request body [${traceId}]:`, parseError.message);
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid request format',
      trace_id: traceId,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 400
    });
  }

  const { url } = requestData;
  if (!url) {
    return new Response(JSON.stringify({
      success: false,
      error: 'URL is required',
      trace_id: traceId,
      timestamp: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      status: 400
    });
  }

  // Initialize Supabase client
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Helper function to log to database
  const logToDatabase = async (level: string, message: string, data?: any) => {
    try {
      await supabase.from('audit_logs').insert({
        trace_id: traceId,
        level,
        message,
        source: 'render-and-inspect',
        data: data || null
      });
    } catch (logError) {
      console.error('Failed to log to database:', logError.message);
    }
  };

  try {
    console.log(`🚀 Starting render-and-inspect function [${traceId}]`);
    await logToDatabase('info', '🚀 Starting render-and-inspect function', { url });
    
    console.log(`📝 Analyzing URL: ${url}`);

    const browserlessApiKey = Deno.env.get('BROWSERLESS_API_KEY');
    if (!browserlessApiKey) {
      throw new Error('BROWSERLESS_API_KEY not configured');
    }

    // Log masked token for verification
    const maskedToken = `${browserlessApiKey.substring(0, 8)}...${browserlessApiKey.substring(browserlessApiKey.length - 4)}`;
    console.log(`🔑 Using Browserless token: ${maskedToken}`);
    await logToDatabase('info', '🔑 Token verification', { masked_token: maskedToken });

    // Health check Browserless first
    console.log('🏥 Checking Browserless health...');
    let healthStatus = 'unknown';
    let healthDetails = {};
    
    try {
      const healthResponse = await fetch(`https://chrome.browserless.io/json/version?token=${browserlessApiKey}`, {
        method: 'GET',
        timeout: 10000
      });
      
      healthStatus = healthResponse.ok ? 'healthy' : 'unhealthy';
      healthDetails = {
        status_code: healthResponse.status,
        headers: Object.fromEntries(healthResponse.headers.entries())
      };
      
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        healthDetails.version_info = healthData;
        console.log('✅ Browserless health check passed');
      } else {
        const errorText = await healthResponse.text();
        healthDetails.error_response = errorText;
        console.log(`⚠️ Browserless health check failed: ${healthResponse.status}`);
      }
    } catch (healthError) {
      healthStatus = 'error';
      healthDetails.error = healthError.message;
      console.log(`❌ Browserless health check error: ${healthError.message}`);
    }
    
    await logToDatabase('info', '🏥 Browserless health check', { status: healthStatus, details: healthDetails });

    // Multi-scenario function to be executed in Browserless
    const browserlessFunction = `
export default async ({ page, context }) => {
  console.log('🔍 Starting multi-scenario analysis for:', context.url);
  
  // Initialize three scenario results
  const scenarios = {
    baseline: null,
    accept: null,
    reject: null
  };

  // Stealth setup - realistic browser fingerprint
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
    'DNT': '1',
    'Sec-GPC': '1'
  });
  
  // Set timezone to Slovakia
  await page.emulateTimezone('Europe/Bratislava');
  
  // Remove webdriver detection
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['sk-SK', 'sk', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });

  // Helper: Create isolated context for each scenario
  const createIsolatedContext = async () => {
    const context = await page.browser().createIncognitoBrowserContext();
    const newPage = await context.newPage();
    
    // Apply same stealth settings
    await newPage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await newPage.setExtraHTTPHeaders({
      'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
      'DNT': '1',
      'Sec-GPC': '1'
    });
    await newPage.emulateTimezone('Europe/Bratislava');
    await newPage.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['sk-SK', 'sk', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });
    
    // Bypass service workers to prevent caching issues
    await newPage.setBypassServiceWorker(true);
    
    return { context, page: newPage };
  };

  // Helper: Run single scenario
  const runScenario = async (scenarioName, cmpAction = 'none') => {
    console.log(\`📋 Running scenario: \${scenarioName}\`);
    
    const { context: isolatedContext, page: scenarioPage } = await createIsolatedContext();
    
    try {
      // Set up CDP session
      const client = await scenarioPage.target().createCDPSession();
      
      // Enable CDP domains with increased buffer sizes
      await client.send('Network.enable', { 
        maxTotalBufferSize: 20000000, 
        maxResourceBufferSize: 10000000 
      });
      await client.send('Page.enable');
      await client.send('Runtime.enable');
      await client.send('Storage.enable');
      await client.send('DOMStorage.enable');
      
      // Initialize data collection for scenario
      const data = {
        scenario: scenarioName,
        finalUrl: context.url,
        cookies_phase1: [], // after load
        cookies_phase2: [], // after network idle
        cookies_phase3: [], // after extra idle + action
        requests_pre: [],
        requests_post: [],
        responses_pre: [],
        responses_post: [],
        storage_phase1: {},
        storage_phase2: {},
        storage_phase3: {},
        renderedHTML_pre: '',
        renderedHTML_post: '',
        console_logs: [],
        cmp_detected: false,
        cmp_cookie_name: '',
        cmp_cookie_value: '',
        consent_clicked: false,
        cmp_action: cmpAction
      };

      let requestIndex = 0;
      let isPreConsent = true;
      const origin = new URL(context.url).origin;

      // Network request logging with enhanced query/POST parsing
      client.on('Network.requestWillBeSent', (params) => {
        const request = {
          id: params.requestId,
          url: params.request.url,
          method: params.request.method,
          headers: params.request.headers,
          timestamp: params.timestamp,
          index: requestIndex++,
          isPreConsent,
          scenario: scenarioName,
          query: {},
          postDataRaw: null,
          postDataParsed: null,
          trackingParams: {}
        };

        // Parse query parameters and identify tracking params
        try {
          const urlObj = new URL(params.request.url);
          const query = {};
          const trackingKeys = ['id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 'ip', 'geo', 'pid', 'aid', 'k'];
          
          urlObj.searchParams.forEach((value, key) => {
            query[key] = value;
            if (trackingKeys.some(tk => key.toLowerCase().includes(tk))) {
              request.trackingParams[key] = value;
            }
          });
          request.query = query;
        } catch (e) {
          console.log('Error parsing URL:', e.message);
        }

        // Enhanced POST data parsing
        if (params.request.postData) {
          request.postDataRaw = params.request.postData;
          
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
          isPreConsent,
          scenario: scenarioName
        };

        if (isPreConsent) {
          data.responses_pre.push(response);
        } else {
          data.responses_post.push(response);
        }
      });

      // Console logging
      scenarioPage.on('console', msg => {
        data.console_logs.push({
          type: msg.type(),
          text: msg.text(),
          timestamp: Date.now(),
          isPreConsent,
          scenario: scenarioName
        });
      });

      // Enhanced cookie collection (three phases)
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
          const pageCookies = await scenarioPage.cookies();
          cookies.push(...pageCookies);
        } catch (e) {
          console.log('Page cookies failed:', e.message);
        }
        
        // Method 3: document.cookie via evaluation
        try {
          const docCookies = await scenarioPage.evaluate(() => {
            const cookies = [];
            if (document.cookie) {
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
            }
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

      // Enhanced storage collection
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
          const evalStorage = await scenarioPage.evaluate(() => {
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

      console.log(\`🌐 [\${scenarioName}] Navigating to page...\`);
      
      // Navigate to the page
      await scenarioPage.goto(context.url, { 
        waitUntil: 'networkidle2', 
        timeout: 90000 
      });

      console.log(\`📄 [\${scenarioName}] Page loaded\`);
      
      // PHASE 1: After load
      data.cookies_phase1 = await getAllCookies();
      data.storage_phase1 = await getStorage();
      data.renderedHTML_pre = await scenarioPage.content();

      console.log(\`📊 [\${scenarioName}] Phase 1: \${data.cookies_phase1.length} cookies\`);
      
      // Wait for network idle
      await scenarioPage.waitForTimeout(3000);
      
      // PHASE 2: After network idle
      data.cookies_phase2 = await getAllCookies();
      data.storage_phase2 = await getStorage();

      console.log(\`📊 [\${scenarioName}] Phase 2: \${data.cookies_phase2.length} cookies\`);
      
      // CMP Detection with enhanced cookie detection
      const cmpCookies = data.cookies_phase2.filter(cookie => 
        /CookieScriptConsent|OptanonConsent|euconsent-v2|CookieConsent|tarteaucitron|cookieyes-consent|CookieYes-consent|cookielaw|gdpr/i.test(cookie.name)
      );
      
      if (cmpCookies.length > 0) {
        data.cmp_detected = true;
        data.cmp_cookie_name = cmpCookies[0].name;
        data.cmp_cookie_value = cmpCookies[0].value.substring(0, 100);
        console.log(\`🍪 [\${scenarioName}] CMP cookie detected: \${data.cmp_cookie_name}\`);
      }

      // CMP Action based on scenario
      if (cmpAction === 'accept') {
        console.log(\`🍪 [\${scenarioName}] Looking for ACCEPT buttons...\`);
        
        const acceptSelectors = [
          // XPath-style text matching 
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "accept")]',
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "prijať")]',
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "súhlas")]',
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "allow")]',
          // Traditional selectors
          '[data-testid*="accept"]', '[id*="accept"]', '[class*="accept"]',
          '.cc-allow', '.cookie-accept', '#onetrust-accept-btn-handler',
          '.optanon-allow-all', '.cookiescript_accept'
        ];

        for (const selector of acceptSelectors) {
          try {
            let element;
            if (selector.startsWith('//')) {
              // XPath selector
              const elements = await scenarioPage.\$x(selector);
              element = elements[0];
            } else {
              element = await scenarioPage.\$(selector);
            }
            
            if (element) {
              await element.click();
              console.log(\`✅ [\${scenarioName}] Clicked ACCEPT: \${selector}\`);
              data.consent_clicked = true;
              isPreConsent = false;
              break;
            }
          } catch (e) {
            // Continue trying other selectors
          }
        }
      } else if (cmpAction === 'reject') {
        console.log(\`🍪 [\${scenarioName}] Looking for REJECT buttons...\`);
        
        const rejectSelectors = [
          // XPath-style text matching
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "reject")]',
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "decline")]',
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "odmietnuť")]',
          '//button[contains(translate(text(), "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "zamietnuť")]',
          // Traditional selectors
          '[data-testid*="reject"]', '[id*="reject"]', '[class*="reject"]',
          '.cc-deny', '.cookie-reject', '#onetrust-reject-all-handler',
          '.optanon-reject-all', '.cookiescript_reject'
        ];

        for (const selector of rejectSelectors) {
          try {
            let element;
            if (selector.startsWith('//')) {
              const elements = await scenarioPage.\$x(selector);
              element = elements[0];
            } else {
              element = await scenarioPage.\$(selector);
            }
            
            if (element) {
              await element.click();
              console.log(\`✅ [\${scenarioName}] Clicked REJECT: \${selector}\`);
              data.consent_clicked = true;
              isPreConsent = false;
              break;
            }
          } catch (e) {
            // Continue trying other selectors
          }
        }
      }

      // Extra idle wait (especially important after consent action)
      await scenarioPage.waitForTimeout(cmpAction !== 'none' ? 8000 : 5000);
      
      // PHASE 3: After extra idle + action
      data.cookies_phase3 = await getAllCookies();
      data.storage_phase3 = await getStorage();
      data.renderedHTML_post = await scenarioPage.content();

      console.log(\`📊 [\${scenarioName}] Phase 3: \${data.cookies_phase3.length} cookies\`);

      // Use phase 3 as final cookies/storage
      data.cookies_pre = data.cookies_phase2; // pre-consent = phase 2
      data.cookies_post = data.cookies_phase3; // post-consent = phase 3
      data.storage_pre = data.storage_phase2;
      data.storage_post = data.storage_phase3;
      
      data.finalUrl = scenarioPage.url();

      console.log(\`✅ [\${scenarioName}] Complete - Pre: \${data.requests_pre.length} req, \${data.cookies_pre.length} cookies; Post: \${data.requests_post.length} req, \${data.cookies_post.length} cookies\`);

      return data;
      
    } finally {
      // Clean up isolated context
      await isolatedContext.close();
    }
  };

  // Run all three scenarios
  try {
    scenarios.baseline = await runScenario('baseline', 'none');
    scenarios.accept = await runScenario('accept', 'accept');
    scenarios.reject = await runScenario('reject', 'reject');
  } catch (error) {
    console.error('Error running scenarios:', error);
    throw error;
  }

  console.log('🎯 All scenarios completed');
  
  // Return multi-scenario data with backward compatibility
  return {
    // Backward compatibility - use baseline data as default
    ...scenarios.baseline,
    
    // Multi-scenario results
    scenarios: scenarios,
    
    // Summary comparison
    comparison: {
      baseline_cookies: scenarios.baseline?.cookies_post?.length || 0,
      accept_cookies: scenarios.accept?.cookies_post?.length || 0,
      reject_cookies: scenarios.reject?.cookies_post?.length || 0,
      baseline_requests: (scenarios.baseline?.requests_pre?.length || 0) + (scenarios.baseline?.requests_post?.length || 0),
      accept_requests: (scenarios.accept?.requests_pre?.length || 0) + (scenarios.accept?.requests_post?.length || 0),
      reject_requests: (scenarios.reject?.requests_pre?.length || 0) + (scenarios.reject?.requests_post?.length || 0)
    }
  };
};`;

    console.log('🌐 Calling Browserless API...');
    await logToDatabase('info', '🌐 Calling Browserless API', { url });

    // Call Browserless API with token in query string for better compatibility
    const browserlessResponse = await fetch(`https://chrome.browserless.io/function?token=${browserlessApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: browserlessFunction,
        context: { url },
        timeout: 180000, // 3 minutes timeout for multi-scenario
      }),
    });

    const responseHeaders = Object.fromEntries(browserlessResponse.headers.entries());
    
    if (!browserlessResponse.ok) {
      const errorText = await browserlessResponse.text();
      console.error('❌ Browserless API error:', errorText);
      
      await logToDatabase('error', '❌ Browserless API failed', {
        status_code: browserlessResponse.status,
        response_headers: responseHeaders,
        error_response: errorText.substring(0, 1000) // Truncate long responses
      });
      
      throw new Error(`Browserless API failed: ${browserlessResponse.status} - ${errorText}`);
    }

    const renderData = await browserlessResponse.json();
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log('✅ Browserless data received');
    console.log(`Final URL: ${renderData.finalUrl}`);
    console.log(`Cookies: pre=${renderData.cookies_pre?.length || 0}, post=${renderData.cookies_post?.length || 0}`);
    console.log(`Requests: pre=${renderData.requests_pre?.length || 0}, post=${renderData.requests_post?.length || 0}`);
    console.log(`Storage items: pre=${Object.keys(renderData.storage_pre?.localStorage || {}).length + Object.keys(renderData.storage_pre?.sessionStorage || {}).length}, post=${Object.keys(renderData.storage_post?.localStorage || {}).length + Object.keys(renderData.storage_post?.sessionStorage || {}).length}`);
    
    // Enhanced logging for scenarios
    if (renderData.scenarios) {
      console.log('📊 Scenario comparison:');
      console.log(`Baseline: ${renderData.scenarios.baseline?.cookies_post?.length || 0} cookies`);
      console.log(`Accept: ${renderData.scenarios.accept?.cookies_post?.length || 0} cookies`);
      console.log(`Reject: ${renderData.scenarios.reject?.cookies_post?.length || 0} cookies`);
    }

    // Log successful completion to database
    await supabase.from('audit_runs').insert({
      trace_id: traceId,
      input_url: url,
      normalized_url: renderData.finalUrl,
      status: 'completed',
      data_source: 'live',
      duration_ms: duration,
      bl_status_code: browserlessResponse.status,
      bl_health_status: healthStatus,
      requests_total: (renderData.requests_pre?.length || 0) + (renderData.requests_post?.length || 0),
      requests_pre_consent: renderData.requests_pre?.length || 0,
      third_parties_count: new Set([...(renderData.requests_pre || []), ...(renderData.requests_post || [])].map(r => new URL(r.url).hostname)).size,
      beacons_count: [...(renderData.requests_pre || []), ...(renderData.requests_post || [])].filter(r => 
        r.url.includes('analytics') || r.url.includes('track') || r.url.includes('beacon')).length,
      cookies_pre_count: renderData.cookies_pre?.length || 0,
      cookies_post_count: renderData.cookies_post?.length || 0,
      meta: {
        health_check: healthDetails,
        response_headers: responseHeaders,
        consent_clicked: renderData.consent_clicked,
        cmp_detected: renderData.cmp_detected,
        scenarios: renderData.scenarios ? {
          baseline_cookies: renderData.scenarios.baseline?.cookies_post?.length || 0,
          accept_cookies: renderData.scenarios.accept?.cookies_post?.length || 0,
          reject_cookies: renderData.scenarios.reject?.cookies_post?.length || 0
        } : null
      }
    });

    await logToDatabase('info', '✅ Analysis completed successfully', {
      duration_ms: duration,
      final_url: renderData.finalUrl,
      cookies_pre: renderData.cookies_pre?.length || 0,
      cookies_post: renderData.cookies_post?.length || 0,
      requests_total: (renderData.requests_pre?.length || 0) + (renderData.requests_post?.length || 0),
      scenarios: renderData.scenarios ? Object.keys(renderData.scenarios) : ['single']
    });

    return new Response(JSON.stringify({
      success: true,
      data: renderData,
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      bl_status_code: browserlessResponse.status,
      bl_health_status: healthStatus
    }), {
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders 
      },
    });

  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const timestamp = new Date().toISOString();
    
    console.error(`❌ Error in render-and-inspect [${traceId}]:`, error.message);
    console.error(`❌ Stack trace [${traceId}]:`, error.stack);
    
    // Log error to database
    await logToDatabase('error', '❌ Function failed', {
      error: error.message,
      stack: error.stack,
      duration_ms: duration
    });

    // Log failed run to database
    await supabase.from('audit_runs').insert({
      trace_id: traceId,
      input_url: url,
      status: 'failed',
      error_message: error.message,
      duration_ms: duration,
      bl_status_code: healthDetails?.status_code || null,
      bl_health_status: healthStatus,
      meta: {
        error_details: error.stack,
        health_check: healthDetails
      }
    });
    
    const requestUrl = url || 'unknown';
    
    // Return a basic fallback response instead of failing completely
    const fallbackData = {
      finalUrl: requestUrl,
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
      _error: error.message,
      _trace_id: traceId,
      _timestamp: timestamp
    };

    return new Response(JSON.stringify({
      success: false,
      data: fallbackData,
      error: error.message,
      trace_id: traceId,
      timestamp: timestamp,
      bl_status_code: healthDetails?.status_code || null,
      bl_health_status: healthStatus
    }), {
      headers: { 
        'Content-Type': 'application/json',
        ...corsHeaders 
      },
      status: 200 // Return 200 so frontend can handle gracefully
    });
  }
});