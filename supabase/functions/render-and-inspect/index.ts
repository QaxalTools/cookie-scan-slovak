import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// Handle CORS preflight requests
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = crypto.randomUUID();
  const startTime = Date.now();

  try {
    console.log(`🚀 Starting render-and-inspect function [${traceId}]`);

    // Parse request
    const { url } = await req.json();
    if (!url) {
      throw new Error('URL is required');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Browserless configuration
    const browserlessToken = Deno.env.get('BROWSERLESS_TOKEN');
    if (!browserlessToken) {
      throw new Error('Missing Browserless token');
    }

    const BROWSERLESS_WS_URL = 'wss://chrome.browserless.io';
    const REQUEST_TIMEOUT = 45000;

    console.log(`🔑 Using Browserless token: ${browserlessToken.slice(0, 8)}...${browserlessToken.slice(-4)}`);
    console.log(`📝 Analyzing URL: ${url}`);

    // Check Browserless health
    console.log('🏥 Checking Browserless health...');
    let healthCheckPassed = false;
    let healthStatus = 'unknown';
    let healthStatusCode = 0;
    
    try {
      const healthResponse = await fetch(`https://chrome.browserless.io/health?token=${browserlessToken}`);
      healthStatusCode = healthResponse.status;
      
      if (healthResponse.ok) {
        healthCheckPassed = true;
        healthStatus = 'ok';
        console.log('✅ Browserless health check passed');
      } else {
        healthStatus = 'failed';
        console.log(`⚠️ Browserless health check failed with status ${healthResponse.status}, but continuing to WebSocket attempt...`);
        await logToDatabase('warn', `Browserless health check failed: ${healthResponse.status}`, { status: healthResponse.status });
      }
    } catch (error) {
      healthStatus = 'error';
      console.log(`⚠️ Browserless health check error: ${error.message}, but continuing to WebSocket attempt...`);
      await logToDatabase('warn', `Browserless health check error: ${error.message}`);
    }

    // Main data collection object
    const browserlessData: any = {
      requests: [],
      cookies_pre: [],
      cookies_post_accept: [],
      cookies_post_reject: [],
      storage_pre: {},
      storage_post_accept: {},
      storage_post_reject: {},
      set_cookie_headers_pre: [],
      set_cookie_headers_post_accept: [],
      set_cookie_headers_post_reject: [],
      cmp: {},
      final_url: url,
      data_sent_to_third_parties: 0
    };

    /**
     * Helper function for database logging
     */
    async function logToDatabase(level: string, message: string, data?: any) {
      try {
        await supabase.from('audit_logs').insert({
          trace_id: traceId,
          level,
          message,
          data: data || null,
          timestamp: new Date().toISOString(),
          source: 'render-and-inspect'
        });
      } catch (e) {
        console.log('Failed to log to database:', e.message);
      }
    }

    await logToDatabase('info', 'Analysis started', { url, trace_id: traceId });

    // ============= Raw WebSocket CDP Implementation =============
    
    try {
      console.log('🌐 Starting Raw WebSocket CDP analysis...');
      console.log('🔗 Connecting to Browserless WebSocket...');
      
      const wsSocket = new WebSocket(`${BROWSERLESS_WS_URL}?token=${browserlessToken}&--no-sandbox&--disable-setuid-sandbox&--disable-dev-shm-usage&--disable-background-timer-throttling&--disable-backgrounding-occluded-windows&--disable-renderer-backgrounding&--disable-features=TranslateUI&--disable-ipc-flooding-protection&--disable-crash-reporter&--disable-breakpad&--disable-client-side-phishing-detection&--disable-background-networking&--disable-default-apps&--disable-component-extensions-with-background-pages&--disable-logging&--silent`);
      
      const sessions = new Map();
      let pageSessionId = null;
      let commandId = 0;
      let isPreConsent = true;
      let currentPhase = 'pre';

      // Maps to store network request tracking
      const requestMap = new Map();
      const responseInfo = new Map();
      const responseExtraInfo = new Map();
      const setCookieEvents_pre = [];
      const setCookieEvents_post_accept = [];
      const setCookieEvents_post_reject = [];
      let requestCounter = 0;

      // Set-Cookie parser function
      const parseSetCookie = (cookieString, requestId) => {
        try {
          const parts = cookieString.split(';').map(p => p.trim());
          const [nameValue, ...attributes] = parts;
          const [name, value] = nameValue.split('=');
          
          if (!name) return null;
          
          const cookie = {
            name: name.trim(),
            valueMasked: value ? (value.length > 12 ? value.slice(0, 12) + '…' : value) : '',
            domain: null,
            path: '/',
            expiresEpochMs: null,
            secure: false,
            httpOnly: false,
            sameSite: null,
            sourceUrl: responseInfo.get(requestId)?.url || 'unknown',
            phase: currentPhase,
            persisted: false,
            source: 'set-cookie'
          };
          
          // Parse attributes
          attributes.forEach(attr => {
            const [key, val] = attr.split('=');
            const lowerKey = key.toLowerCase();
            
            if (lowerKey === 'domain') {
              cookie.domain = val || null;
            } else if (lowerKey === 'path') {
              cookie.path = val || '/';
            } else if (lowerKey === 'expires') {
              const expDate = new Date(val);
              if (!isNaN(expDate.getTime())) {
                cookie.expiresEpochMs = expDate.getTime();
              }
            } else if (lowerKey === 'max-age') {
              const maxAge = parseInt(val);
              if (!isNaN(maxAge)) {
                cookie.expiresEpochMs = Date.now() + (maxAge * 1000);
              }
            } else if (lowerKey === 'secure') {
              cookie.secure = true;
            } else if (lowerKey === 'httponly') {
              cookie.httpOnly = true;
            } else if (lowerKey === 'samesite') {
              cookie.sameSite = val || null;
            }
          });
          
          // Set default domain if not specified
          if (!cookie.domain && responseInfo.get(requestId)?.url) {
            try {
              const url = new URL(responseInfo.get(requestId).url);
              cookie.domain = url.hostname;
            } catch (e) {
              cookie.domain = 'unknown';
            }
          }
          
          return cookie;
        } catch (e) {
          console.log('Error parsing Set-Cookie:', e.message);
          return null;
        }
      };

      // Promise for WebSocket connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000);
        
        wsSocket.onopen = () => {
          clearTimeout(timeout);
          console.log('🔗 WebSocket connected to Browserless');
          resolve(null);
        };

        wsSocket.onerror = (error) => {
          clearTimeout(timeout);
          
          // Check if this is an authentication error
          if (error.toString().includes('401') || error.toString().includes('403')) {
            reject(new Error('Invalid Browserless token - please check your BROWSERLESS_TOKEN configuration'));
          } else {
            reject(new Error(`WebSocket connection failed: ${error}`));
          }
        };
        
        wsSocket.onclose = (event) => {
          if (event.code === 1008 || event.code === 1006) {
            clearTimeout(timeout);
            reject(new Error('Invalid Browserless token - authentication failed'));
          }
        };
      });

      // CDP command helper
      const sendCDPCommand = (method: string, params: any = {}, sessionId?: string) => {
        return new Promise((resolve, reject) => {
          const id = ++commandId;
          const message = { id, method, params };
          if (sessionId) {
            message.sessionId = sessionId;
          }
          
          const timeout = setTimeout(() => {
            reject(new Error(`CDP command timeout: ${method}`));
          }, 10000);
          
          const messageHandler = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.id === id) {
                clearTimeout(timeout);
                wsSocket.removeEventListener('message', messageHandler);
                if (data.error) {
                  reject(new Error(`CDP error: ${data.error.message}`));
                } else {
                  resolve(data.result);
                }
              }
            } catch (e) {
              // Ignore parsing errors for other messages
            }
          };
          
          wsSocket.addEventListener('message', messageHandler);
          wsSocket.send(JSON.stringify(message));
        });
      };

      // Event listeners
      wsSocket.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle browser-level events
          if (data.method === 'Target.attachedToTarget') {
            const { sessionId, targetInfo } = data.params;
            sessions.set(sessionId, targetInfo);
            console.log(`📎 Target attached: ${targetInfo.type} [${targetInfo.targetId}]`);
          } else if (data.method === 'Network.requestWillBeSent' && data.sessionId === 'browser') {
            requestCounter++;
            
            const params = data.params;
            requestMap.set(params.requestId, {
              id: requestCounter,
              url: params.request.url,
              method: params.request.method,
              requestId: params.requestId,
              referrer: params.request.headers.Referer || params.referrer || '',
              timestamp: Date.now(),
              sessionId: data.sessionId
            });
          } else if (data.method === 'Network.responseReceived') {
            const params = data.params;
            responseInfo.set(params.requestId, {
              url: params.response.url,
              status: params.response.status
            });
          } else if (data.method === 'Network.responseReceivedExtraInfo') {
            const params = data.params;
            const existingExtraInfo = responseExtraInfo.get(params.requestId) || [];
            existingExtraInfo.push(params);
            responseExtraInfo.set(params.requestId, existingExtraInfo);
            
            // Process Set-Cookie headers immediately
            if (params.headers) {
              Object.entries(params.headers).forEach(([name, value]) => {
                if (name.toLowerCase() === 'set-cookie') {
                  const cookies = Array.isArray(value) ? value : [value];
                  cookies.forEach(cookieStr => {
                    if (cookieStr) {
                      const parsed = parseSetCookie(cookieStr, params.requestId);
                      if (parsed) {
                        if (currentPhase === 'pre') {
                          setCookieEvents_pre.push(parsed);
                        } else if (currentPhase === 'post_accept') {
                          setCookieEvents_post_accept.push(parsed);
                        } else if (currentPhase === 'post_reject') {
                          setCookieEvents_post_reject.push(parsed);
                        }
                      }
                    }
                  });
                }
              });
            }
          }
        } catch (e) {
          console.log('❌ CDP event error:', e.message);
        }
      });

      // A) Setup browser-level auto-attach
      console.log('🌐 Setting up browser-level auto-attach...');
      await sendCDPCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, filter: [{ type: 'page' }] });
      console.log('✅ Browser-level auto-attach enabled');

      // B) Get targets and attach to page
      console.log('🎯 Getting browser targets...');
      const targets = await sendCDPCommand('Target.getTargets');
      console.log('TARGET CHECK', targets.targetInfos?.slice(0, 1).map(t => ({ type: t.type, url: t.url })));

      const pageTarget = targets.targetInfos?.find(t => t.type === 'page');
      
      if (!pageTarget) {
        // Create a new page target
        console.log('📄 Creating new page target...');
        const createResult = await sendCDPCommand('Target.createTarget', {
          url: 'about:blank'
        });
        pageSessionId = createResult.targetId;
        console.log('✅ New page target created:', pageSessionId);
      } else {
        // Attach to existing page target
        console.log('📎 Attaching to existing page target...');
        const attachResult = await sendCDPCommand('Target.attachToTarget', {
          targetId: pageTarget.targetId,
          flatten: true
        });
        pageSessionId = attachResult.sessionId;
        sessions.set(pageSessionId, pageTarget);
        console.log('✅ Attached to page target:', pageSessionId);
      }
      
      // C) Enable CDP domains on the page session
      console.log('🔧 Enabling CDP domains on page session:', pageSessionId);
      await sendCDPCommand('Page.enable', {}, pageSessionId);
      await sendCDPCommand('Runtime.enable', {}, pageSessionId);
      await sendCDPCommand('Network.enable', {
        maxTotalBufferSize: 10_000_000,
        maxResourceBufferSize: 5_000_000
      }, pageSessionId);
      await sendCDPCommand('DOMStorage.enable', {}, pageSessionId);
      
      console.log('✅ CDP domains enabled on page session');
      console.log('📍 CDP_bound: true');
      
      // Set additional headers
      await sendCDPCommand('Network.setUserAgentOverride', {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }, pageSessionId);
      
      await sendCDPCommand('Network.setExtraHTTPHeaders', {
        headers: {
          'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
          'DNT': '1',
          'Sec-GPC': '1'
        }
      }, pageSessionId);
      
      // Helper functions for data collection
      const collectCookies = async (label) => {
        const cookies = [];
        
        try {
          const cdpCookies = await sendCDPCommand('Network.getAllCookies', {}, pageSessionId);
          if (cdpCookies.cookies) {
            cookies.push(...cdpCookies.cookies.map(c => ({
              ...c,
              expiry_days: c.expires ? Math.round((c.expires - Date.now() / 1000) / (24 * 60 * 60)) : null,
              source: 'cdp'
            })));
          }
        } catch (e) {
          console.log(`CDP cookies failed for ${label}:`, e.message);
        }
        
        // Fallback: document.cookie via Runtime.evaluate
        try {
          const docCookieResult = await sendCDPCommand('Runtime.evaluate', {
            expression: 'document.cookie'
          }, pageSessionId);
          
          const docCookie = docCookieResult.result?.value || '';
          if (docCookie) {
            const docCookies = docCookie.split('; ').filter(c => c.trim()).map(c => {
              const [name, ...rest] = c.split('=');
              return { 
                name: name?.trim(), 
                value: rest.join('='), 
                domain: 'document.cookie',
                source: 'document' 
              };
            });
            cookies.push(...docCookies);
          }
        } catch (e) {
          console.log(`Document cookie failed for ${label}:`, e.message);
        }
        
        console.log(`Cookies ${label}:`, cookies.length);
        return cookies;
      };
      
      const collectStorage = async (label) => {
        const storage = { localStorage: {}, sessionStorage: {} };
        
        try {
          // Get origin for DOMStorage
          const originResult = await sendCDPCommand('Runtime.evaluate', {
            expression: 'window.location.origin'
          }, pageSessionId);
          const origin = originResult.result?.value || new URL(url).origin;
          
          // Local storage
          try {
            const localStorage = await sendCDPCommand('DOMStorage.getDOMStorageItems', {
              storageId: { securityOrigin: origin, isLocalStorage: true }
            }, pageSessionId);
            if (localStorage.entries) {
              localStorage.entries.forEach(([key, value]) => {
                storage.localStorage[key] = value;
              });
            }
          } catch (e) {
            console.log(`Local storage failed for ${label}:`, e.message);
          }
          
          // Session storage
          try {
            const sessionStorage = await sendCDPCommand('DOMStorage.getDOMStorageItems', {
              storageId: { securityOrigin: origin, isLocalStorage: false }
            }, pageSessionId);
            if (sessionStorage.entries) {
              sessionStorage.entries.forEach(([key, value]) => {
                storage.sessionStorage[key] = value;
              });
            }
          } catch (e) {
            console.log(`Session storage failed for ${label}:`, e.message);
          }
          
          // Fallback: Runtime.evaluate for storage
          try {
            const storageResult = await sendCDPCommand('Runtime.evaluate', {
              expression: `
                (() => {
                  const res = { local: {}, session: {} };
                  try { 
                    for (let i = 0; i < localStorage.length; i++) { 
                      const k = localStorage.key(i); 
                      if (k) res.local[k] = localStorage.getItem(k); 
                    } 
                  } catch {}
                  try { 
                    for (let i = 0; i < sessionStorage.length; i++) { 
                      const k = sessionStorage.key(i); 
                      if (k) res.session[k] = sessionStorage.getItem(k); 
                    } 
                  } catch {}
                  return res;
                })()
              `
            }, pageSessionId);
            
            const runtimeStorage = storageResult.result?.value || { local: {}, session: {} };
            Object.assign(storage.localStorage, runtimeStorage.local);
            Object.assign(storage.sessionStorage, runtimeStorage.session);
          } catch (e) {
            console.log(`Runtime storage failed for ${label}:`, e.message);
          }
          
        } catch (e) {
          console.log(`Storage collection failed for ${label}:`, e.message);
        }
        
        const totalItems = Object.keys(storage.localStorage).length + Object.keys(storage.sessionStorage).length;
        console.log(`Storage ${label}:`, totalItems, 'items');
        return storage;
      };
      
      // E) NAVIGATION (now that everything is set up)
      console.log('🌐 Navigating to URL...');
      await sendCDPCommand('Page.navigate', { url }, pageSessionId);
      
      // Wait for page load event
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 10000);
        const messageHandler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.method === 'Page.loadEventFired' && data.sessionId === pageSessionId) {
              clearTimeout(timeout);
              wsSocket.removeEventListener('message', messageHandler);
              resolve(true);
            }
          } catch (e) {
            // Ignore
          }
        };
        wsSocket.addEventListener('message', messageHandler);
      });
      
      console.log('✅ Page load event fired');
      
      // Multi-timing cookie collection for pre-consent
      console.log('🍪 Collecting pre-consent cookies (M1: post-load)...');
      const cookies_pre_load = await collectCookies('pre-load');
      
      // Wait for network idle
      console.log('⏳ Waiting for network idle...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      console.log('🍪 Collecting pre-consent cookies (M2: post-idle)...');
      const cookies_pre_idle = await collectCookies('pre-idle');
      
      // Extra wait for additional resources
      console.log('⏳ Waiting for extra idle period...');
      await new Promise(resolve => setTimeout(resolve, 6000));
      console.log('🍪 Collecting pre-consent cookies (M3: extra-idle)...');
      const cookies_pre_extra = await collectCookies('pre-extra');
      
      // Get final URL and readyState
      const finalUrlResult = await sendCDPCommand('Runtime.evaluate', {
        expression: 'window.location.href'
      }, pageSessionId);
      const finalUrl = finalUrlResult.result?.value || url;
      
      const readyStateResult = await sendCDPCommand('Runtime.evaluate', {
        expression: 'document.readyState'
      }, pageSessionId);
      const readyState = readyStateResult.result?.value || 'unknown';
      
      // 🍪 Merge pre-consent cookies from multiple collections
      console.log('🍪 Merging pre-consent cookies from multiple collections...');
      console.log('CDP ok', { url: finalUrl, ready: readyState });
      
      console.log('REQUESTS PRE counts', { cdp: Array.from(requestMap.values()).length });
      
      // Merge all pre-consent cookies (deduplicate by name+domain+path)
      const cookieMap = new Map();
      [cookies_pre_load, cookies_pre_idle, cookies_pre_extra].forEach(cookieList => {
        cookieList.forEach(cookie => {
          const key = `${cookie.name}|${cookie.domain}|${cookie.path || '/'}`;
          if (!cookieMap.has(key)) {
            cookieMap.set(key, cookie);
          }
        });
      });
      const cookies_pre = Array.from(cookieMap.values());
      console.log('Cookies merged pre-consent:', cookies_pre.length);
      
      const storage_pre = await collectStorage('pre-consent');
      
      // Log Set-Cookie events collected during pre-consent
      console.log('📊 Pre-consent stats:', { 
        cookies: cookies_pre.length, 
        setCookieEvents: setCookieEvents_pre.length, 
        storage: Object.keys(storage_pre.localStorage).length + Object.keys(storage_pre.sessionStorage).length, 
        requests: Array.from(requestMap.values()).length 
      });
      console.log('✅ Pre-consent data collected');

      // F) CMP Detection
      console.log('🔍 Detecting CMP...');
      const cmpResult = await sendCDPCommand('Runtime.evaluate', {
        expression: `
          (() => {
            const result = {
              detected: undefined,
              type: undefined,
              acceptButton: false,
              rejectButton: false
            };

            // OneTrust detection
            if (window.OneTrust || document.querySelector('#onetrust-banner-sdk')) {
              result.detected = true;
              result.type = 'OneTrust';
            }
            
            // CookieScript detection
            if (window.CookieScript || document.querySelector('.cs-default')) {
              result.detected = true;
              result.type = 'CookieScript';
            }
            
            // Generic CMP detection
            if (document.querySelector('[data-testid*="consent"]') || 
                document.querySelector('[id*="cookie"]') ||
                document.querySelector('[class*="consent"]')) {
              result.detected = true;
              result.type = result.type || 'Generic';
            }

            // Check for accept/reject buttons
            const acceptSelectors = [
              'button[data-testid="accept-all"]',
              'button[aria-label*="Accept all"]',
              'button:contains("Accept all")',
              'button:contains("Prijať všetko")',
              'button:contains("Súhlasiť")',
              '.cookie-accept-all',
              '.accept-all-cookies'
            ];
            
            const rejectSelectors = [
              'button[data-testid="reject-all"]',
              'button[aria-label*="Reject all"]',
              'button:contains("Reject all")',
              'button:contains("Odmietnuť všetko")',
              'button:contains("Zamietnuť")',
              '.cookie-reject-all',
              '.reject-all-cookies'
            ];

            result.acceptButton = acceptSelectors.some(sel => {
              const btn = document.querySelector(sel);
              return btn && btn.offsetParent !== null;
            });

            result.rejectButton = rejectSelectors.some(sel => {
              const btn = document.querySelector(sel);
              return btn && btn.offsetParent !== null;
            });

            return result;
          })()
        `
      }, pageSessionId);

      console.log('🔍 CMP detection result:', JSON.stringify(cmpResult.result?.value, null, 2));

      // G) Consent scenarios
      if (cmpResult.result?.value?.acceptButton) {
        try {
          console.log('🤖 Attempting to click "Accept All" button...');
          currentPhase = 'post_accept';
          
          await sendCDPCommand('Runtime.evaluate', {
            expression: `
              (() => {
                const selectors = [
                  'button[data-testid="accept-all"]',
                  'button[aria-label*="Accept all"]',
                  'button:contains("Accept all")',
                  'button:contains("Prijať všetko")',
                  'button:contains("Súhlasiť")',
                  '.cookie-accept-all',
                  '.accept-all-cookies',
                  '[data-cy="accept-all"]'
                ];
                
                for (const selector of selectors) {
                  const btn = document.querySelector(selector);
                  if (btn && btn.offsetParent !== null) {
                    btn.click();
                    return 'clicked: ' + selector;
                  }
                }
                return 'no_button_found';
              })()
            `
          }, pageSessionId);
          
          console.log('⏳ Waiting for consent processing...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          const cookies_post_accept_1 = await collectCookies('post-accept-1');
          
          console.log('⏳ Waiting for additional consent processing...');
          await new Promise(resolve => setTimeout(resolve, 4000));
          
          const cookies_post_accept_2 = await collectCookies('post-accept-2');
          
          // Merge post-accept cookies
          const postAcceptMap = new Map();
          [cookies_post_accept_1, cookies_post_accept_2].forEach(cookieList => {
            cookieList.forEach(cookie => {
              const key = `${cookie.name}|${cookie.domain}|${cookie.path || '/'}`;
              if (!postAcceptMap.has(key)) {
                postAcceptMap.set(key, cookie);
              }
            });
          });
          const cookies_post_accept = Array.from(postAcceptMap.values());
          
          const storage_post_accept = await collectStorage('post-accept');
          
          browserlessData.cookies_post_accept = cookies_post_accept;
          browserlessData.storage_post_accept = storage_post_accept;
          
          console.log('✅ Post-accept data collected');
        } catch (e) {
          console.log('❌ Accept scenario failed:', e.message);
        }

        if (cmpResult.result?.value?.rejectButton) {
          try {
            console.log('🚫 Attempting to click "Reject All" button...');
            currentPhase = 'post_reject';
            
            await sendCDPCommand('Runtime.evaluate', {
              expression: `
                (() => {
                  const selectors = [
                    'button[data-testid="reject-all"]',
                    'button[aria-label*="Reject all"]',
                    'button:contains("Reject all")',
                    'button:contains("Odmietnuť všetko")',
                    'button:contains("Zamietnuť")',
                    '.cookie-reject-all',
                    '.reject-all-cookies',
                    '[data-cy="reject-all"]'
                  ];
                  
                  for (const selector of selectors) {
                    const btn = document.querySelector(selector);
                    if (btn && btn.offsetParent !== null) {
                      btn.click();
                      return 'clicked: ' + selector;
                    }
                  }
                  return 'no_button_found';
                })()
              `
            }, pageSessionId);
            
            console.log('⏳ Waiting for rejection processing...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const cookies_post_reject_1 = await collectCookies('post-reject-1');
            
            console.log('⏳ Waiting for additional rejection processing...');
            await new Promise(resolve => setTimeout(resolve, 4000));
            
            const cookies_post_reject_2 = await collectCookies('post-reject-2');
            
            // Merge post-reject cookies
            const postRejectMap = new Map();
            [cookies_post_reject_1, cookies_post_reject_2].forEach(cookieList => {
              cookieList.forEach(cookie => {
                const key = `${cookie.name}|${cookie.domain}|${cookie.path || '/'}`;
                if (!postRejectMap.has(key)) {
                  postRejectMap.set(key, cookie);
                }
              });
            });
            const cookies_post_reject = Array.from(postRejectMap.values());
            
            const storage_post_reject = await collectStorage('post-reject');
            
            browserlessData.cookies_post_reject = cookies_post_reject;
            browserlessData.storage_post_reject = storage_post_reject;
            
            console.log('✅ Post-reject data collected');
          } catch (e) {
            console.log('❌ Reject scenario failed:', e.message);
          }
        }
      }

      // Store network requests and basic data
      browserlessData.requests = Array.from(requestMap.values());
      browserlessData.cookies_pre = cookies_pre;
      browserlessData.storage_pre = storage_pre;
      browserlessData.cmp = cmpResult.result?.value || {};
      browserlessData.final_url = finalUrl;
      
      // Store Set-Cookie events
      browserlessData.set_cookie_headers_pre = setCookieEvents_pre;
      browserlessData.set_cookie_headers_post_accept = setCookieEvents_post_accept;
      browserlessData.set_cookie_headers_post_reject = setCookieEvents_post_reject;
      
      // Log detailed counts for debugging
      console.log('📊 Final collection summary:', {
        requests: browserlessData.requests.length,
        cookies_pre: cookies_pre.length,
        setCookie_pre: setCookieEvents_pre.length,
        setCookie_post_accept: setCookieEvents_post_accept.length,
        setCookie_post_reject: setCookieEvents_post_reject.length,
        storage_pre_items: Object.keys(storage_pre.localStorage).length + Object.keys(storage_pre.sessionStorage).length
      });

      // Data transfer analysis (simplified)
      const mainHost = new URL(finalUrl).hostname;
      const thirdPartyRequests = browserlessData.requests.filter(r => {
        try {
          const reqHost = new URL(r.url).hostname;
          return reqHost !== mainHost && !reqHost.endsWith(`.${mainHost}`);
        } catch {
          return false;
        }
      });

      browserlessData.data_sent_to_third_parties = thirdPartyRequests.length;
      console.log('📤 data_sent_to_third_parties:', browserlessData.data_sent_to_third_parties);

      console.log('✅ Analysis completed successfully');
      
      // Close WebSocket
      wsSocket.close();
      console.log('🔌 WebSocket connection closed');

    } catch (cdpError) {
      console.log('❌ CDP Analysis failed:', cdpError.message);
      await logToDatabase('error', 'CDP analysis failed', { error: cdpError.message });
      throw cdpError;
    }

    await logToDatabase('info', 'Analysis completed successfully', { 
      url: browserlessData.final_url,
      requests: browserlessData.requests?.length || 0,
      cookies_pre: browserlessData.cookies_pre?.length || 0,
      data_sent_to_third_parties: browserlessData.data_sent_to_third_parties
    });

    console.log('✅ Analysis function completed successfully');

    // Return the analysis results
    return new Response(JSON.stringify({
      success: true,
      trace_id: traceId,
      execution_time_ms: Date.now() - startTime,
      bl_status_code: healthStatusCode,
      bl_health_status: healthStatus,
      data: browserlessData
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.log('❌ Function error:', error.message, error.stack);
    
    // Log error to database
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase.from('audit_logs').insert({
          trace_id: traceId,
          level: 'error',
          message: `Function failed: ${error.message}`,
          data: { error: error.message, stack: error.stack },
          timestamp: new Date().toISOString(),
          source: 'render-and-inspect'
        });
      }
    } catch (logError) {
      console.log('Failed to log error to database:', logError.message);
    }

    // Determine if this is a Browserless token error
    const isBrowserlessTokenError = error.message.includes('Invalid Browserless token') || 
                                   error.message.includes('authentication failed') ||
                                   error.message.includes('Browserless health check failed');
    
    return new Response(JSON.stringify({
      success: false,
      trace_id: traceId,
      execution_time_ms: Date.now() - startTime,
      bl_status_code: isBrowserlessTokenError ? (healthStatusCode || 403) : 0,
      bl_health_status: isBrowserlessTokenError ? 'token_error' : 'unknown',
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});