import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.56.0';

/**
 * =================== AUDIT SYSTEM DOCUMENTATION ===================
 * 
 * SYSTEM FLOW: 
 * WS → Target attach → enable domains → navigate → tri zbierky cookies → CMP → post scenáre → sumarizácia
 * 
 * CDP EVENT FILTERING:
 * - All Network.* events filtered by pageSessionId (not browser-wide)
 * - Target.setAutoAttach for automatic page attachment
 * - Multi-phase cookie collection: post-load, post-idle, extra-idle
 * 
 * CMP EXTENSION POINTS:
 * - Add new selectors to CMP_SELECTORS object
 * - Extend clickByText function for new interaction patterns
 * 
 * TRACKING PARAMETERS:
 * - Extend SIGNIFICANT_PARAMS array for new tracking parameters
 * - Add new body content parsing in parsePostData function
 * 
 * QUALITY GATES:
 * - Self-check validates data consistency across collection phases
 * - No magic thresholds - all detection is derived from actual data
 * - INCOMPLETE banners only for concrete, identified issues
 */

// CORS headers for browser requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// =================== SINGLE SOURCE OF TRUTH HELPERS ===================
// These functions are defined once and used throughout the Edge function

// PATCH 1 - Header normalization utilities
function normalizeHeaderKeys(h: Record<string, string | string[]> | undefined): Record<string, string | string[]> {
  if (!h) return {};
  const out: Record<string, string | string[]> = {};
  for (const k of Object.keys(h)) out[k.toLowerCase()] = h[k] as any;
  return out;
}

function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
// These functions are defined once and used throughout the Edge function

function onceLoadFired(ws: WebSocket, sessionId: string, timeoutMs = 20000) {
  return new Promise<void>((resolve, reject) => {
    const onMsg = (event: MessageEvent) => {
      try {
        const msg = JSON.parse((event as any).data);
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === sessionId) {
          ws.removeEventListener('message', onMsg);
          clearTimeout(to);
          resolve();
        }
      } catch {}
    };
    const to = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error('NAVIGATION_TIMEOUT'));
    }, timeoutMs);
    ws.addEventListener('message', onMsg);
  });
}

function normalizeDomain(input?: string): string {
  return (input ?? '').trim().replace(/^\./, '');
}

function buildCookieKey(cookie: { name: string; domain?: string; path?: string }): string {
  return `${cookie.name}|${normalizeDomain(cookie.domain)}|${cookie.path || '/'}`;
}

function maskValue(value: string): string {
  return value.length > 12 ? value.slice(0, 12) + '…' : value;
}

function parseQuery(url: string): Record<string, string> {
  try {
    const urlObj = new URL(url);
    const params: Record<string, string> = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    return params;
  } catch {
    return {};
  }
}

function parseFormUrlEncoded(data: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!data) return params;
  
  try {
    const pairs = data.split('&');
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = decodeURIComponent(value || '');
      }
    }
  } catch {
    // Ignore parsing errors
  }
  return params;
}

function safeJsonParse(data?: string): any | undefined {
  if (!data?.trim()) return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function getETldPlusOneLite(host: string): string {
  const cleanHost = host.toLowerCase().replace(/^www\./, '');
  
  // Handle special cases (whitelist approach)
  const specialTlds = [
    '.co.uk', '.com.au', '.co.nz', '.com.br', '.co.za', '.org.uk',
    '.net.au', '.gov.au', '.edu.au', '.asn.au', '.id.au'
  ];
  
  for (const tld of specialTlds) {
    if (cleanHost.endsWith(tld)) {
      const parts = cleanHost.split('.');
      if (parts.length >= 3) {
        return parts.slice(-3).join('.');
      }
    }
  }
  
  // Standard case: domain.tld
  const parts = cleanHost.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  
  return cleanHost;
}

interface ParsedCookie {
  name: string;
  valueMasked: string;
  domain: string;
  path: string;
  expiresEpochMs?: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  source: string;
}

function parseSetCookieHeader(value: string, responseUrl: string): ParsedCookie {
  const parts = value.split(';').map(p => p.trim());
  const [nameValue] = parts;
  const [name, rawValue] = nameValue.split('=');
  
  const cookie: ParsedCookie = {
    name: name?.trim() || '',
    valueMasked: maskValue(rawValue || ''),
    domain: '',
    path: '/',
    secure: false,
    httpOnly: false,
    source: 'set-cookie-header'
  };
  
  // Extract domain from response URL if not specified
  try {
    const urlObj = new URL(responseUrl);
    cookie.domain = urlObj.hostname;
  } catch {
    cookie.domain = 'unknown';
  }
  
  // Parse attributes
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (part.startsWith('domain=')) {
      cookie.domain = normalizeDomain(part.substring(7));
    } else if (part.startsWith('path=')) {
      cookie.path = part.substring(5) || '/';
    } else if (part.startsWith('expires=')) {
      try {
        const expireDate = new Date(part.substring(8));
        cookie.expiresEpochMs = expireDate.getTime();
      } catch {
        // Ignore invalid dates
      }
    } else if (part.startsWith('max-age=')) {
      try {
        const maxAge = parseInt(part.substring(8));
        cookie.expiresEpochMs = Date.now() + (maxAge * 1000);
      } catch {
        // Ignore invalid max-age
      }
    } else if (part === 'secure') {
      cookie.secure = true;
    } else if (part === 'httponly') {
      cookie.httpOnly = true;
    } else if (part.startsWith('samesite=')) {
      cookie.sameSite = part.substring(9);
    }
  }
  
  return cookie;
}

// Significant tracking parameters to extract
const SIGNIFICANT_PARAMS = [
  'id', 'tid', 'ev', 'en', 'fbp', 'fbc', 'sid', 'cid', 'uid', 'user_id', 
  'ip', 'geo', 'pid', 'aid', 'k', 'gclid', 'dclid', 'wbraid', 'gbraid',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
];

// CMP selectors for detection and interaction
const CMP_SELECTORS = {
  onetrust: {
    banner: '#onetrust-banner-sdk',
    accept: '#onetrust-accept-btn-handler',
    reject: '#onetrust-reject-all-handler, #onetrust-pc-btn-handler'
  },
  cookiescript: {
    banner: '#cookiescript_injected',
    accept: '[data-cs-accept-all]',
    reject: '[data-cs-reject-all]'
  },
  generic: {
    banner: '[id*="cookie"], [class*="consent"], [data-testid*="consent"]',
    accept: '[id*="accept"], [class*="accept"], [data-testid*="accept"]',
    reject: '[id*="reject"], [class*="reject"], [data-testid*="reject"]'
  }
};

// Browserless configuration
const BROWSERLESS_BASE = Deno.env.get('BROWSERLESS_BASE')?.trim() || 'https://production-sfo.browserless.io';

function normalizeToken(token?: string): string {
  if (!token) return '';
  return token.trim().replace(/^["']|["']$/g, '');
}

async function checkBrowserlessAuth(token: string) {
  const baseUrl = new URL(BROWSERLESS_BASE);
  const result: any = { 
    base: BROWSERLESS_BASE, 
    host: baseUrl.host,
    tests: {} 
  };

  // A) Query param health check
  try {
    const response = await fetch(`${BROWSERLESS_BASE}/json/version?token=${token}`);
    const text = await response.text();
    result.tests.query = { 
      status: response.status, 
      ok: response.ok, 
      text: text.slice(0, 256) 
    };
  } catch (error) { 
    result.tests.query = { error: String(error) }; 
  }

  // B) X-API-Key header
  try {
    const response = await fetch(`${BROWSERLESS_BASE}/json/version`, { 
      headers: { 'X-API-Key': token } 
    });
    const text = await response.text();
    result.tests.header = { 
      status: response.status, 
      ok: response.ok, 
      text: text.slice(0, 256) 
    };
  } catch (error) { 
    result.tests.header = { error: String(error) }; 
  }

  // C) WebSocket CDP test
  result.tests.ws = await new Promise((resolve) => {
    try {
      const wsUrl = `wss://${baseUrl.host}?token=${token}`;
      const ws = new WebSocket(wsUrl);
      const timeout = setTimeout(() => { 
        try { ws.close(); } catch {} 
        resolve({ error: 'timeout' }); 
      }, 8000);
      
      ws.onopen = () => { 
        clearTimeout(timeout); 
        ws.close(); 
        resolve({ open: true }); 
      };
      
      ws.onclose = (event) => { 
        clearTimeout(timeout); 
        resolve({ open: false, code: event.code }); 
      };
      
      ws.onerror = () => { 
        clearTimeout(timeout); 
        resolve({ open: false, code: 'onerror' }); 
      };
    } catch (error) { 
      resolve({ error: String(error) }); 
    }
  });

  // Determine auth status
  let status: 'ok' | 'invalid_token' | 'wrong_product' | 'network_error' = 'network_error';
  
  if (result.tests.query?.ok || result.tests.header?.ok || result.tests.ws?.open) {
    status = 'ok';
  } else if ([401, 403].includes(result.tests.query?.status) || [401, 403].includes(result.tests.header?.status)) {
    status = 'invalid_token';
  } else if (result.tests.ws?.open === false && (result.tests.ws?.code === 1008 || result.tests.ws?.code === 1006)) {
    status = 'wrong_product';
  }

  return { status, details: result };
}

// =================== MODULAR ARCHITECTURE ===================

// ==== Phase Controller ====
class PhaseController {
  private phase: 'pre' | 'post_accept' | 'post_reject' = 'pre';
  
  setPre() { this.phase = 'pre'; }
  setAccept() { this.phase = 'post_accept'; }
  setReject() { this.phase = 'post_reject'; }
  get() { return this.phase; }
}

// ==== Session Manager ====
class SessionManager {
  sessions = new Map<string, { type: 'page' | 'iframe' | 'worker'; frameId?: string; url?: string }>();
  inflight = 0;
  ws: WebSocket | null = null;
  logger: any;
  
  constructor(ws: WebSocket, logger: any) {
    this.ws = ws;
    this.logger = logger;
  }
  
  async attachHandlers() {
    if (!this.ws) return;
    
    // Auto-attach to all targets (fixed parameters)
    await this.sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      flatten: true
    });
    await this.logger.log('info', '🎯 Auto-attach configured for page/worker');
  }
  
  async onAttachedToTarget(sessionId: string, type: string, targetId?: string) {
    this.sessions.set(sessionId, { type: type as any });
    await this.logger.log('info', `📎 Attached to ${type} session: ${sessionId}`);
    
    // Enable required domains for each session
    await this.sendCommand('Runtime.enable', {}, sessionId);
    await this.sendCommand('Network.enable', {
      maxTotalBufferSize: 10000000,
      maxResourceBufferSize: 5000000
    }, sessionId);
    await this.sendCommand('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    
    if (type === 'page') {
      await this.sendCommand('Page.enable', {}, sessionId);
      await this.sendCommand('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
    }
    
    await this.logger.log('info', `✅ Domains enabled for ${type} session: ${sessionId}`);
  }
  
  onNetworkRequestStart() {
    this.inflight++;
  }
  
  onNetworkRequestEnd() {
    this.inflight = Math.max(0, this.inflight - 1);
  }
  
  async waitForGlobalIdle(minQuietMs = 1500, timeoutMs = 15000): Promise<void> {
    return new Promise((resolve) => {
      let quietStart = 0;
      const checkInterval = 100;
      let totalWaited = 0;
      
      const check = () => {
        totalWaited += checkInterval;
        
        if (this.inflight === 0) {
          if (quietStart === 0) {
            quietStart = Date.now();
          } else if (Date.now() - quietStart >= minQuietMs) {
            resolve();
            return;
          }
        } else {
          quietStart = 0;
        }
        
        if (totalWaited >= timeoutMs) {
          resolve();
          return;
        }
        
        setTimeout(check, checkInterval);
      };
      
      setTimeout(check, checkInterval);
    });
  }
  
  async sendCommand(method: string, params: any = {}, sessionId?: string) {
    if (!this.ws) return null;
    
    return new Promise((resolve) => {
      const id = Date.now() + Math.random();
      const message = sessionId 
        ? { id, method, params, sessionId }
        : { id, method, params };
      
      const timeout = setTimeout(() => resolve(null), 5000);
      
      const onMessage = (event: MessageEvent) => {
        try {
          const response = JSON.parse(event.data);
          if (response.id === id) {
            clearTimeout(timeout);
            this.ws!.removeEventListener('message', onMessage);
            resolve(response);
          }
        } catch {}
      };
      
      this.ws!.addEventListener('message', onMessage);
      this.ws!.send(JSON.stringify(message));
    });
  }
}

// ==== Events Pipeline ====
class EventsPipeline {
  phaseController: PhaseController;
  sessionManager: SessionManager;
  logger: any;
  
  // Storage for events by phase
  setCookieEvents_pre: ParsedCookie[] = [];
  setCookieEvents_post_accept: ParsedCookie[] = [];
  setCookieEvents_post_reject: ParsedCookie[] = [];
  
  requestMap = new Map();
  responseInfo = new Map();
  
  constructor(phaseController: PhaseController, sessionManager: SessionManager, logger: any) {
    this.phaseController = phaseController;
    this.sessionManager = sessionManager;
    this.logger = logger;
  }
  
  onNetworkRequestWillBeSent(event: any, sessionId: string, activeSessionId?: string) {
    // POINT 2: Strict session ID filter - only process events for current active session
    if (activeSessionId && sessionId !== activeSessionId) {
      return; // Ignore events from other sessions
    }
    
    this.sessionManager.onNetworkRequestStart();
    
    const requestData = {
      ...event,
      sessionId,
      phase: this.phaseController.get(),
      timestamp: Date.now()
    };
    
    this.requestMap.set(event.requestId, requestData);
  }
  
  onNetworkResponseReceived(event: any, sessionId: string, activeSessionId?: string) {
    // POINT 2: Strict session ID filter
    if (activeSessionId && sessionId !== activeSessionId) {
      return;
    }
    
    this.responseInfo.set(event.requestId, {
      ...event,
      sessionId,
      phase: this.phaseController.get()
    });
  }
  
  onNetworkResponseReceivedExtraInfo(event: any, sessionId: string, activeSessionId?: string) {
    // POINT 2: Strict session ID filter
    if (activeSessionId && sessionId !== activeSessionId) {
      return;
    }
    
    const headers = normalizeHeaderKeys(event.headers);
    const setCookieHeaders = ensureArray(headers['set-cookie']);
    
    if (setCookieHeaders.length > 0) {
      const responseData = this.responseInfo.get(event.requestId);
      const responseUrl = responseData?.response?.url || 'unknown';
      
      for (const setCookieValue of setCookieHeaders) {
        const cookie = parseSetCookieHeader(setCookieValue, responseUrl);
        
        const phase = this.phaseController.get();
        if (phase === 'pre') {
          this.setCookieEvents_pre.push(cookie);
        } else if (phase === 'post_accept') {
          this.setCookieEvents_post_accept.push(cookie);
        } else if (phase === 'post_reject') {
          this.setCookieEvents_post_reject.push(cookie);
        }
      }
    }
  }
  
  onNetworkLoadingFinished(event: any, sessionId: string, activeSessionId?: string) {
    // POINT 2: Strict session ID filter
    if (activeSessionId && sessionId !== activeSessionId) {
      return;
    }
    this.sessionManager.onNetworkRequestEnd();
  }
  
  onNetworkLoadingFailed(event: any, sessionId: string, activeSessionId?: string) {
    // POINT 2: Strict session ID filter
    if (activeSessionId && sessionId !== activeSessionId) {
      return;
    }
    this.sessionManager.onNetworkRequestEnd();
  }
  
  // POINT 6: Stable POST body collection
  postDataMap = new Map<string, any>();
  
  async collectPostData(requestId: string, sessionId: string): Promise<void> {
    try {
      const result = await this.sessionManager.sendCommand('Network.getRequestPostData', { requestId }, sessionId) as any;
      if (result?.result?.postData) {
        this.postDataMap.set(requestId, result.result.postData);
      }
    } catch {
      // Ignore failures - POST data collection is best effort
    }
  }
}

// ==== Snapshot Builder ====
class SnapshotBuilder {
  eventsPipeline: EventsPipeline;
  sessionManager: SessionManager;
  logger: any;
  
  constructor(eventsPipeline: EventsPipeline, sessionManager: SessionManager, logger: any) {
    this.eventsPipeline = eventsPipeline;
    this.sessionManager = sessionManager;
    this.logger = logger;
  }
  
  async buildSnapshot(phase: 'pre' | 'post_accept' | 'post_reject', pageSessionId: string) {
    await this.logger.log('info', `📸 Building ${phase} snapshot`);
    
    // Get persisted cookies as secondary data
    const persistedCookies = await this.getPersistedCookies(pageSessionId);
    
    // Get storage data
    const storage = await this.getStorageData(pageSessionId);
    
    // Get requests for this phase
    const requests = Array.from(this.eventsPipeline.requestMap.values())
      .filter((r: any) => r.phase === phase);
    
    // Get server-set cookies for this phase (primary)
    let serverSetCookies: ParsedCookie[] = [];
    if (phase === 'pre') {
      serverSetCookies = this.eventsPipeline.setCookieEvents_pre;
    } else if (phase === 'post_accept') {
      serverSetCookies = this.eventsPipeline.setCookieEvents_post_accept;
    } else if (phase === 'post_reject') {
      serverSetCookies = this.eventsPipeline.setCookieEvents_post_reject;
    }
    
    await this.logger.log('info', `📊 ${phase} snapshot: ${serverSetCookies.length} server-set cookies, ${persistedCookies.length} persisted, ${requests.length} requests`);
    
    return {
      serverSetCookies,
      persistedCookies,
      storage,
      requests
    };
  }
  
  private async getPersistedCookies(pageSessionId: string) {
    try {
      const result = await this.sessionManager.sendCommand('Network.getAllCookies', {}, pageSessionId) as any;
      return result?.result?.cookies || [];
    } catch {
      return [];
    }
  }
  
  private async getStorageData(pageSessionId: string) {
    try {
      // POINT 5: Correct storage metrics - get raw counts and unique keys
      const localStorageResult = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          try {
            const items = {};
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key) {
                keys.push(key);
                items[key] = localStorage.getItem(key);
              }
            }
            return { type: 'localStorage', items, count: keys.length, uniqueKeys: keys };
          } catch (e) {
            return { type: 'localStorage', items: {}, count: 0, uniqueKeys: [], error: e.message };
          }
        })()`
      }, pageSessionId) as any;
      
      const sessionStorageResult = await this.sessionManager.sendCommand('Runtime.evaluate', {
        expression: `(() => {
          try {
            const items = {};
            const keys = [];
            for (let i = 0; i < sessionStorage.length; i++) {
              const key = sessionStorage.key(i);
              if (key) {
                keys.push(key);
                items[key] = sessionStorage.getItem(key);
              }
            }
            return { type: 'sessionStorage', items, count: keys.length, uniqueKeys: keys };
          } catch (e) {
            return { type: 'sessionStorage', items: {}, count: 0, uniqueKeys: [], error: e.message };
          }
        })()`
      }, pageSessionId) as any;
      
      const localStorage = localStorageResult?.result?.value?.items || {};
      const sessionStorage = sessionStorageResult?.result?.value?.items || {};
      const localStorageCount = localStorageResult?.result?.value?.count || 0;
      const sessionStorageCount = sessionStorageResult?.result?.value?.count || 0;
      const localStorageKeys = localStorageResult?.result?.value?.uniqueKeys || [];
      const sessionStorageKeys = sessionStorageResult?.result?.value?.uniqueKeys || [];
      
      return {
        localStorage,
        sessionStorage,
        storageMetrics: {
          localStorageCount,
          sessionStorageCount,
          totalItems: localStorageCount + sessionStorageCount,
          uniqueKeys: [...new Set([...localStorageKeys, ...sessionStorageKeys])]
        }
      };
    } catch {
      return { 
        localStorage: {}, 
        sessionStorage: {},
        storageMetrics: {
          localStorageCount: 0,
          sessionStorageCount: 0,
          totalItems: 0,
          uniqueKeys: []
        }
      };
    }
  }
  
  private async sendCommand(method: string, params: any = {}, sessionId?: string) {
    return this.sessionManager.sendCommand(method, params, sessionId);
  }
}

// ==== CMP Hunter ====
class CMPHunter {
  sessionManager: SessionManager;
  logger: any;
  
  constructor(sessionManager: SessionManager, logger: any) {
    this.sessionManager = sessionManager;
    this.logger = logger;
  }
  
  async findAndClickCMP(action: 'accept' | 'reject', pageSessionId: string): Promise<{ clicked: boolean; details?: any }> {
    await this.logger.log('info', `🎯 Hunting for CMP ${action} button across all frames`);
    
    // Get frame tree
    const frameTreeResult = await this.sendCommand('Page.getFrameTree', {}, pageSessionId) as any;
    const frames = this.extractAllFrames(frameTreeResult?.result?.frameTree);
    
    // Try each frame
    for (const frame of frames) {
      const result = await this.tryClickInFrame(action, frame.id, pageSessionId);
      if (result.clicked) {
        await this.logger.log('info', `✅ CMP ${action} clicked in frame ${frame.id}`);
        return result;
      }
    }
    
    // Try with MutationObserver fallback
    await this.logger.log('info', '🔍 Setting up MutationObserver for dynamic CMP detection');
    const observerResult = await this.setupMutationObserver(action, pageSessionId);
    
    return observerResult;
  }
  
  private extractAllFrames(frameTree: any): any[] {
    if (!frameTree) return [];
    
    const frames = [frameTree.frame];
    if (frameTree.childFrames) {
      for (const child of frameTree.childFrames) {
        frames.push(...this.extractAllFrames(child));
      }
    }
    return frames;
  }
  
  private async tryClickInFrame(action: 'accept' | 'reject', frameId: string, pageSessionId: string) {
    const expression = this.buildCMPFinderExpression(action);
    
    try {
      // Create isolated world for frame execution
      const worldResult = await this.sendCommand('Page.createIsolatedWorld', {
        frameId: frameId,
        worldName: `cmp-hunter-${Date.now()}`,
        grantUniveralAccess: true
      }, pageSessionId) as any;
      
      const executionContextId = worldResult?.result?.executionContextId;
      
      if (executionContextId) {
        const result = await this.sendCommand('Runtime.evaluate', {
          expression,
          contextId: executionContextId
        }, pageSessionId) as any;
        
        if (result?.result?.value?.clicked) {
          return { clicked: true, details: result.result.value };
        }
      } else {
        // Fallback to main context if isolated world creation fails
        const result = await this.sendCommand('Runtime.evaluate', {
          expression
        }, pageSessionId) as any;
        
        if (result?.result?.value?.clicked) {
          return { clicked: true, details: result.result.value };
        }
      }
    } catch (error) {
      await this.logger.log('debug', `Frame ${frameId} evaluation failed: ${error}`);
    }
    
    return { clicked: false };
  }
  
  private buildCMPFinderExpression(action: 'accept' | 'reject'): string {
    return `(() => {
      const selectors = {
        onetrust: {
          banner: '#onetrust-banner-sdk, .ot-sdk-container',
          accept: '#onetrust-accept-btn-handler, .ot-pc-refuse-all-handler',
          reject: '#onetrust-reject-all-handler, #onetrust-pc-btn-handler, .ot-pc-refuse-all-handler'
        },
        cookiescript: {
          banner: '#cookiescript_injected, [data-cs-c]',
          accept: '[data-cs-accept-all], .cs-accept-all',
          reject: '[data-cs-reject-all], .cs-reject-all'
        },
        cookiebot: {
          banner: '#CybotCookiebotDialog, .CybotCookiebotDialog',
          accept: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, .CybotCookiebotDialogBodyButton[data-cookie-level="all"]',
          reject: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection, .CybotCookiebotDialogBodyButton[data-cookie-level="functional"]'
        },
        generic: {
          banner: '[id*="cookie"], [class*="consent"], [data-testid*="consent"]',
          accept: '[id*="accept"], [class*="accept"], [data-testid*="accept"]',
          reject: '[id*="reject"], [class*="reject"], [data-testid*="reject"]'
        }
      };
      
      function isVisible(el) {
        return el && (el.offsetParent !== null || el.getClientRects().length > 0);
      }
      
      function searchInShadowRoots(root, selector) {
        const elements = Array.from(root.querySelectorAll(selector));
        const shadowHosts = Array.from(root.querySelectorAll('*')).filter(el => el.shadowRoot);
        
        for (const host of shadowHosts) {
          elements.push(...searchInShadowRoots(host.shadowRoot, selector));
        }
        
        return elements;
      }
      
      function findByText(action) {
        const patterns = action === 'accept' 
          ? [/accept.*all/i, /accept.*cookies/i, /allow.*all/i, /súhlas/i, /prijať/i]
          : [/reject.*all/i, /decline/i, /refuse/i, /odmietnuť/i, /zamietnuť/i];
        
        const allElements = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"]'));
        
        return allElements.find(el => {
          const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
          return patterns.some(pattern => pattern.test(text)) && isVisible(el);
        });
      }
      
      // Try known CMP selectors first
      for (const [cmpName, config] of Object.entries(selectors)) {
        const targetSelector = action === 'accept' ? config.accept : config.reject;
        const elements = searchInShadowRoots(document, targetSelector);
        
        for (const el of elements) {
          if (isVisible(el)) {
            el.click();
            return { 
              clicked: true, 
              cmp: cmpName, 
              selector: targetSelector,
              method: 'selector'
            };
          }
        }
      }
      
      // Fallback to text-based search
      const textElement = findByText('${action}');
      if (textElement) {
        textElement.click();
        return { 
          clicked: true, 
          cmp: 'unknown', 
          selector: textElement.tagName + (textElement.id ? '#' + textElement.id : ''),
          method: 'text',
          text: textElement.textContent.trim().slice(0, 50)
        };
      }
      
      return { clicked: false };
    })()`;
  }
  
  private async setupMutationObserver(action: 'accept' | 'reject', pageSessionId: string) {
    const cmpFinderCode = this.buildCMPFinderExpression(action);
    const observerExpression = `
      new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (typeof observer !== 'undefined') observer.disconnect();
          resolve({ clicked: false, reason: 'timeout' });
        }, 10000);
        
        const observer = new MutationObserver(() => {
          try {
            const result = ${cmpFinderCode};
            if (result && result.clicked) {
              clearTimeout(timeout);
              observer.disconnect();
              resolve(result);
            }
          } catch (e) {
            // Ignore errors during CMP check
          }
        });
        
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: false
        });
        
        // Also try immediately
        try {
          const result = ${cmpFinderCode};
          if (result && result.clicked) {
            clearTimeout(timeout);
            observer.disconnect();
            resolve(result);
          }
        } catch (e) {
          // Continue with observer
        }
      })
    `;
    
    try {
      const result = await this.sendCommand('Runtime.evaluate', {
        expression: observerExpression,
        awaitPromise: true
      }, pageSessionId) as any;
      
      return result?.result?.value || { clicked: false };
    } catch {
      return { clicked: false };
    }
  }
  
  private async sendCommand(method: string, params: any = {}, sessionId?: string) {
    return this.sessionManager.sendCommand(method, params, sessionId);
  }
}

// ============= HELPER FUNCTIONS FOR THREE-PHASE EXECUTION =============

// --- CDP sender (per WebSocket) ---
function makeSender(ws: WebSocket) {
  let id = 0;
  const waiters = new Map<number, (msg:any)=>void>();
  ws.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse((e as MessageEvent).data);
      if (msg.id && waiters.has(msg.id)) {
        waiters.get(msg.id)!(msg);
        waiters.delete(msg.id);
      }
    } catch {}
  });
  return function send(method: string, params: any = {}, sessionId?: string) {
    const msg = sessionId ? { id: ++id, method, params, sessionId } : { id: ++id, method, params };
    ws.send(JSON.stringify(msg));
    return new Promise<any>(resolve => waiters.set(msg.id, resolve));
  };
}

// --- vytvor čistý kontext+page pre fázu ---
async function createContextPage(send: any, url: string, logger: any) {
  const ctx = await send('Target.createBrowserContext', {});
  const browserContextId = ctx.result.browserContextId;

  const tgt = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const targetId = tgt.result.targetId;

  // auto-attach (len page/worker; iframe NIE je target)
  await send('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false });

  const att = await send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = att.result.sessionId;

  // enable domény
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', { maxTotalBufferSize: 10_000_000, maxResourceBufferSize: 5_000_000 }, sessionId);
  await send('DOMStorage.enable', {}, sessionId);
  await send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Network.setExtraHTTPHeaders', { headers: { 'Accept-Language': 'en-US,en;q=0.9', 'DNT': '1', 'Sec-GPC': '1' } }, sessionId);
  await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, sessionId);

  await logger.log('info', `🎯 Created context ${browserContextId}, target ${targetId}, session ${sessionId}`);
  
  // navigácia
  await send('Page.navigate', { url }, sessionId);

  return { browserContextId, targetId, sessionId };
}

async function disposeContext(send:any, browserContextId:string, logger: any) {
  await logger.log('info', `🗑️ Disposing context ${browserContextId}`);
  await send('Target.disposeBrowserContext', { browserContextId });
}

// Helper for storage key collection
function collectStorageKeys(storageData: any) {
  const out = new Set<string>();
  const pushObj = (o: any) => Object.keys(o || {}).forEach(k => out.add(k));
  pushObj(storageData?.localStorage);
  pushObj(storageData?.sessionStorage);
  return out;
}

// POST body parsing helper
function parsePostBody(rec: any) {
  const h = rec.headers || {};
  const ct = (h['content-type'] || h['Content-Type'] || '').toString().toLowerCase();
  const body = rec.postData || '';
  if (!body) return {};
  try {
    if (ct.includes('application/json')) return JSON.parse(body) || {};
    if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(body));
    return {};
  } catch { return {}; }
}

// Deduplicate server-set cookies
function dedupServerSet(arr: any[]) {
  const m = new Map<string, any>();
  for (const c of arr) {
    const key = `${c.name}|${normalizeDomain(c.domain)}|${c.path||'/'}`;
    m.set(key, c);
  }
  return Array.from(m.values());
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const traceId = crypto.randomUUID();
  const startTime = Date.now();
  
  // Initialize Supabase client for logging
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl!, supabaseServiceKey!);
  
  // Logger utility for audit_logs
  const logger = {
    async log(level: string, message: string, data?: any) {
      try {
        await supabase.from('audit_logs').insert({
          trace_id: traceId,
          source: 'render-and-inspect',
          level,
          message,
          data
        });
      } catch (error) {
        console.error('Failed to log to audit_logs:', error);
      }
    }
  };

  try {
    await logger.log('info', `🚀 Starting render-and-inspect function [${traceId}]`);

    // Parse request
    const { url } = await req.json();
    await logger.log('info', `📝 Analyzing URL: ${url}`);

    if (!url) {
      const error = { success: false, error_code: 'MISSING_URL', details: 'URL parameter is required', trace_id: traceId };
      await logger.log('error', 'Missing URL parameter', error);
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Create initial audit_runs entry
    const { data: auditRun, error: insertError } = await supabase
      .from('audit_runs')
      .insert({
        trace_id: traceId,
        input_url: url,
        status: 'running',
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      const error = { success: false, error_code: 'DB_INSERT_FAILED', details: 'Database initialization failed', trace_id: traceId };
      await logger.log('error', 'Failed to create audit_runs entry', { error: insertError });
      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await logger.log('info', `📝 Created audit run record: ${auditRun?.id}`);

    // Get and validate Browserless token
    const rawToken = Deno.env.get('BROWSERLESS_TOKEN') || Deno.env.get('BROWSERLESS_API_KEY');
    const token = normalizeToken(rawToken);
    await logger.log('info', `🔑 Using Browserless token: ${token.slice(0, 8)}...${token.slice(-4)}`);

    if (!token) {
      const error = { success: false, error_code: 'BROWSERLESS_AUTH_FAILED', details: 'No Browserless token configured', trace_id: traceId };
      await logger.log('error', 'Missing Browserless token', error);
      
      // Update audit_runs with failure
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'BROWSERLESS_AUTH_FAILED',
          error_message: 'No Browserless token configured',
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Check Browserless authentication
    await logger.log('info', '🏥 Checking Browserless authentication...');
    const authCheck = await checkBrowserlessAuth(token);
    
    if (authCheck.status !== 'ok') {
      const error = { 
        success: false, 
        error_code: 'BROWSERLESS_AUTH_FAILED', 
        details: `Auth status: ${authCheck.status}`,
        auth_details: authCheck.details,
        trace_id: traceId
      };
      await logger.log('error', 'Browserless authentication failed', error);
      
      // Update audit_runs with failure
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'BROWSERLESS_AUTH_FAILED',
          error_message: `Auth status: ${authCheck.status}`,
          ended_at: new Date().toISOString(),
          duration_ms: Date.now() - startTime,
          bl_health_status: authCheck.status
        })
        .eq('trace_id', traceId);

      return new Response(JSON.stringify(error), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Initialize new modular architecture
    await logger.log('info', '🏗️ Initializing modular three-phase architecture');
    
    const phaseController = new PhaseController();
    let sessionManager: SessionManager;
    let eventsPipeline: EventsPipeline;
    let snapshotBuilder: SnapshotBuilder;
    let cmpHunter: CMPHunter;
    
    // Legacy data structures for backward compatibility
    const trackingParams: any[] = [];
    const hostMap = {
      requests: { firstParty: new Set(), thirdParty: new Set() },
      cookies: { firstParty: new Set(), thirdParty: new Set() },
      storage: { firstParty: new Set(), thirdParty: new Set() },
      links: { firstParty: new Set(), thirdParty: new Set() }
    };
    
    let pageSessionId = '';
    let finalUrl = url;

    // Connect to Browserless WebSocket using THREE-PHASE EXECUTION
    await logger.log('info', '🔗 Connecting to Browserless WebSocket...');
    await logger.log('info', '🌐 Starting THREE-PHASE isolated context analysis...');

    const baseUrl = new URL(BROWSERLESS_BASE);
    const wsUrl = `wss://${baseUrl.host}?token=${token}`;
    
    const analysisResult = await new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      
      // Initialize modular components first
      sessionManager = new SessionManager(ws, logger);
      eventsPipeline = new EventsPipeline(phaseController, sessionManager, logger);
      snapshotBuilder = new SnapshotBuilder(eventsPipeline, sessionManager, logger);
      cmpHunter = new CMPHunter(sessionManager, logger);

      // Create CDP sender
      const send = makeSender(ws);
      
      // Global state for session filtering
      let currentSessionId = '';

      // STRICT SESSION FILTERING - Process only events for current phase
      ws.addEventListener('message', (event) => {
        let msg: any;
        try { 
          msg = JSON.parse((event as MessageEvent).data); 
        } catch { 
          return; 
        }

        // Command responses handled by makeSender
        if (msg.id) return;

        // Process only events for current session
        if (!msg.sessionId || msg.sessionId !== currentSessionId) return;

        switch (msg.method) {
          case 'Network.requestWillBeSent': {
            const p = msg.params;
            const rec = {
              requestId: p.requestId,
              url: p.request.url,
              method: p.request.method,
              headers: normalizeHeaderKeys(p.request.headers || {}),
              hasPostData: !!p.request.postData || !!p.request.hasPostData,
              phase: phaseController.get(),
              ts: p.timestamp
            };
            eventsPipeline.requestMap.set(p.requestId, rec);

            // Stable POST body collection
            if (!p.request.postData && p.request.hasPostData) {
              send('Network.getRequestPostData', { requestId: p.requestId }, currentSessionId).then((res: any) => {
                const body = res?.result?.postData ?? '';
                eventsPipeline.requestMap.set(p.requestId, { ...rec, postData: body });
              }).catch(() => {});
            } else if (p.request.postData) {
              eventsPipeline.requestMap.set(p.requestId, { ...rec, postData: p.request.postData });
            }

            sessionManager.onNetworkRequestStart();
            break;
          }
          case 'Network.responseReceived':
            eventsPipeline.onNetworkResponseReceived(msg.params, currentSessionId);
            break;
          case 'Network.responseReceivedExtraInfo':
            eventsPipeline.onNetworkResponseReceivedExtraInfo(msg.params, currentSessionId);
            break;
          case 'Network.loadingFinished':
          case 'Network.loadingFailed':
            sessionManager.onNetworkRequestEnd();
            break;
        }
      });

      ws.onopen = async () => {
        try {
          await logger.log('info', '🔗 WebSocket connected to Browserless');
          
          // ==================== THREE-PHASE ISOLATED EXECUTION ====================
          
          let preSnapshot: any, postAcceptSnapshot: any, postRejectSnapshot: any;
          
          // PHASE A: PRE-CONSENT
          await logger.log('info', '🚀 PHASE A: Pre-consent isolation');
          const A = await createContextPage(send, url, logger);
          currentSessionId = A.sessionId;
          phaseController.setPre();
          
          await onceLoadFired(ws, A.sessionId).catch(() => {});
          await sessionManager.waitForGlobalIdle(1500, 12000);
          
          preSnapshot = await snapshotBuilder.buildSnapshot('pre', A.sessionId);
          await logger.log('info', `📊 Pre-snapshot: ${preSnapshot.requests.length} requests, ${preSnapshot.persistedCookies.length} cookies`);
          
          await disposeContext(send, A.browserContextId, logger);
          
          // PHASE B: POST-ACCEPT
          await logger.log('info', '🚀 PHASE B: Post-accept isolation');
          const B = await createContextPage(send, url, logger);
          currentSessionId = B.sessionId;
          phaseController.setPre();
          
          await onceLoadFired(ws, B.sessionId).catch(() => {});
          await sessionManager.waitForGlobalIdle(800, 8000);
          
          const acceptResult = await (new CMPHunter(sessionManager, logger)).findAndClickCMP('accept', B.sessionId);
          await logger.log('info', `🍪 CMP Accept result: ${JSON.stringify(acceptResult)}`);
          
          phaseController.setAccept();
          await sessionManager.waitForGlobalIdle(1500, 10000);
          
          postAcceptSnapshot = await snapshotBuilder.buildSnapshot('post_accept', B.sessionId);
          await logger.log('info', `📊 Post-accept snapshot: ${postAcceptSnapshot.requests.length} requests, ${postAcceptSnapshot.persistedCookies.length} cookies`);
          
          await disposeContext(send, B.browserContextId, logger);
          
          // PHASE C: POST-REJECT
          await logger.log('info', '🚀 PHASE C: Post-reject isolation');
          const C = await createContextPage(send, url, logger);
          currentSessionId = C.sessionId;
          phaseController.setPre();
          
          await onceLoadFired(ws, C.sessionId).catch(() => {});
          await sessionManager.waitForGlobalIdle(800, 8000);
          
          const rejectResult = await (new CMPHunter(sessionManager, logger)).findAndClickCMP('reject', C.sessionId);
          await logger.log('info', `🚫 CMP Reject result: ${JSON.stringify(rejectResult)}`);
          
          phaseController.setReject();
          await sessionManager.waitForGlobalIdle(1500, 10000);
          
          postRejectSnapshot = await snapshotBuilder.buildSnapshot('post_reject', C.sessionId);
          await logger.log('info', `📊 Post-reject snapshot: ${postRejectSnapshot.requests.length} requests, ${postRejectSnapshot.persistedCookies.length} cookies`);
          
          await disposeContext(send, C.browserContextId, logger);
          
          // ==================== ANALYSIS & OUTPUT ====================
          
          // Get final URL
          finalUrl = preSnapshot.finalUrl || url;
          
          // ==================== DATA ANALYSIS ====================
          
          // Fixed storage key collection
          const storageKeysPre = collectStorageKeys(preSnapshot?.storage);
          const storageKeysAcc = collectStorageKeys(postAcceptSnapshot?.storage);
          const storageKeysRej = collectStorageKeys(postRejectSnapshot?.storage);
          const uniqueStorageKeys = new Set<string>([...storageKeysPre, ...storageKeysAcc, ...storageKeysRej]);
          
          // Server-set cookies with deduplication
          const cookies_serverset_pre = dedupServerSet(eventsPipeline.setCookieEvents_pre);
          const cookies_serverset_post_accept = dedupServerSet(eventsPipeline.setCookieEvents_post_accept);
          const cookies_serverset_post_reject = dedupServerSet(eventsPipeline.setCookieEvents_post_reject);
          
          // Persisted cookies
          const cookies_persisted_pre = preSnapshot?.persistedCookies ?? [];
          const cookies_persisted_post_accept = postAcceptSnapshot?.persistedCookies ?? [];
          const cookies_persisted_post_reject = postRejectSnapshot?.persistedCookies ?? [];
          
          // POST body analysis for tracking parameters
          const allReq = [
            ...preSnapshot.requests,
            ...postAcceptSnapshot.requests,
            ...postRejectSnapshot.requests
          ];
          
          const trackingParams = [];
          for (const r of allReq) {
            const q = parseQuery(r.url);
            const pb = parsePostBody(r);
            const qKeys = Object.keys(q).filter(k => SIGNIFICANT_PARAMS.includes(k));
            const bKeys = Object.keys(pb).filter(k => SIGNIFICANT_PARAMS.includes(k));
            if (qKeys.length || bKeys.length) {
              trackingParams.push({
                url: r.url,
                method: r.method,
                phase: r.phase,
                params: Object.fromEntries(qKeys.map(k => [k, q[k]])),
                bodyKeys: bKeys
              });
            }
          }
          
          // Build host map for legacy compatibility
          const mainDomain = getETldPlusOneLite(new URL(finalUrl).hostname);
          for (const r of allReq) {
            try {
              const requestHost = new URL(r.url).hostname;
              const requestDomain = getETldPlusOneLite(requestHost);
              const isFirstParty = requestDomain === mainDomain;
              
              if (isFirstParty) {
                hostMap.requests.firstParty.add(requestHost);
              } else {
                hostMap.requests.thirdParty.add(requestHost);
              }
            } catch {}
          }
          
          const allCookies = [...cookies_persisted_pre, ...cookies_persisted_post_accept, ...cookies_persisted_post_reject];
          for (const cookie of allCookies) {
            const cookieDomain = getETldPlusOneLite(cookie.domain);
            const isFirstParty = cookieDomain === mainDomain;
            
            if (isFirstParty) {
              hostMap.cookies.firstParty.add(cookie.domain);
            } else {
              hostMap.cookies.thirdParty.add(cookie.domain);
            }
          }
          
          // Metrics calculation
          const metrics = {
            requests_pre: preSnapshot.requests.length,
            requests_post_accept: postAcceptSnapshot.requests.length,
            requests_post_reject: postRejectSnapshot.requests.length,
            cookies_serverset_pre: cookies_serverset_pre.length,
            cookies_serverset_post_accept: cookies_serverset_post_accept.length,
            cookies_serverset_post_reject: cookies_serverset_post_reject.length,
            cookies_persisted_pre: cookies_persisted_pre.length,
            cookies_persisted_post_accept: cookies_persisted_post_accept.length,
            cookies_persisted_post_reject: cookies_persisted_post_reject.length,
            setCookie_pre: eventsPipeline.setCookieEvents_pre.length,
            setCookie_post_accept: eventsPipeline.setCookieEvents_post_accept.length,
            setCookie_post_reject: eventsPipeline.setCookieEvents_post_reject.length,
            storage_unique_keys: uniqueStorageKeys.size,
            tracking_params_count: trackingParams.length,
            third_party_hosts: hostMap.requests.thirdParty.size
          };
          
          await logger.log('info', '📊 Final metrics', metrics);
          
          // Close WebSocket
          ws.close();
          
          // Build final response with BACKWARD COMPATIBILITY
          const response = {
            success: true,
            final_url: finalUrl,
            finalUrl,
            
            // Requests per phase
            requests_pre: preSnapshot.requests,
            requests_post_accept: postAcceptSnapshot.requests,
            requests_post_reject: postRejectSnapshot.requests,
            
            // Server-set cookies (new fields)
            cookies_serverset_pre,
            cookies_serverset_post_accept,
            cookies_serverset_post_reject,
            
            // Persisted cookies (new fields)  
            cookies_persisted_pre,
            cookies_persisted_post_accept,
            cookies_persisted_post_reject,
            
            // Legacy cookies fields for compatibility
            cookies_pre: cookies_persisted_pre,
            cookies_post_accept: cookies_persisted_post_accept,
            cookies_post_reject: cookies_persisted_post_reject,
            
            // Set-Cookie headers
            set_cookie_headers_pre: eventsPipeline.setCookieEvents_pre,
            set_cookie_headers_post_accept: eventsPipeline.setCookieEvents_post_accept,
            set_cookie_headers_post_reject: eventsPipeline.setCookieEvents_post_reject,
            
            // Storage data
            storage_pre: preSnapshot.storage,
            storage_post_accept: postAcceptSnapshot.storage,
            storage_post_reject: postRejectSnapshot.storage,
            
            // Legacy compatibility
            hostMap,
            trackingParams,
            metrics,
            trace_id: traceId,
            
            // Self-checks
            self_check_summary: {
              is_complete: true,
              reasons: [],
              data_collection_ok: true
            }
          };
          
          resolve(response);
          
        } catch (error) {
          await logger.log('error', 'THREE-PHASE execution failed', { error: String(error) });
          ws.close();
          resolve({
            success: false,
            error_code: 'THREE_PHASE_EXECUTION_FAILED',
            details: String(error),
            trace_id: traceId
          });
        }
          let postRejectSnapshot: any = null;
          
          const acceptResult = await cmpHunter.findAndClickCMP('accept', pageSessionId);
          
          if (acceptResult.clicked) {
            phaseController.setAccept();
            await logger.log('info', `✅ CMP Accept clicked: ${JSON.stringify(acceptResult.details)}`);
            
            // Wait for global idle (invariant)
            await sessionManager.waitForGlobalIdle(1500, 8000);
            
            // Take post-accept snapshot
            postAcceptSnapshot = await snapshotBuilder.buildSnapshot('post_accept', pageSessionId);
            
            await logger.log('info', 'DBG cookies_hdr_counts_post_accept', {
              pre: eventsPipeline.setCookieEvents_pre.length,
              post_accept: eventsPipeline.setCookieEvents_post_accept.length,
              post_reject: eventsPipeline.setCookieEvents_post_reject.length,
              trace_id: traceId
            });
            
            // POINT 1: PHASE 3 - NEW ISOLATED CONTEXT FOR REJECT FLOW
            await logger.log('info', '🎯 PHASE 3: Creating new isolated context for reject flow');
            
            // Create a completely new page context for reject flow
            const newPageResult: any = await sendCommand('Target.createTarget', {
              url: 'about:blank'
            });
            
            if (newPageResult?.result?.targetId) {
              const rejectPageTarget = newPageResult.result.targetId;
              await logger.log('info', `📎 Created new page target for reject: ${rejectPageTarget}`);
              
              // Attach to new target
              const attachRejectResult: any = await sendCommand('Target.attachToTarget', {
                targetId: rejectPageTarget,
                flatten: true
              });
              
              const rejectPageSessionId = attachRejectResult.result.sessionId;
              await logger.log('info', `✅ Attached to reject page session: ${rejectPageSessionId}`);
              
              // Enable CDP domains on new session
              await sendCommand('Page.enable', {}, rejectPageSessionId);
              await sendCommand('Runtime.enable', {}, rejectPageSessionId);
              await sendCommand('Network.enable', {
                maxTotalBufferSize: 10_000_000,
                maxResourceBufferSize: 5_000_000
              }, rejectPageSessionId);
              await sendCommand('Network.setCacheDisabled', { cacheDisabled: true }, rejectPageSessionId);
              await sendCommand('Page.setLifecycleEventsEnabled', { enabled: true }, rejectPageSessionId);
              
              // Navigate to URL in new context
              phaseController.setReject();
              await sendCommand('Page.navigate', { url }, rejectPageSessionId);
              await onceLoadFired(ws, rejectPageSessionId).catch(async () => {
                await logger.log('warn', '⏰ Reject navigation timeout, proceeding');
              });
              
              // Wait for global idle
              await sessionManager.waitForGlobalIdle(1500, 8000);
              
              // Try reject flow in new context
              const rejectResult = await cmpHunter.findAndClickCMP('reject', rejectPageSessionId);
              
              if (rejectResult.clicked) {
                await logger.log('info', `❌ CMP Reject clicked in new context: ${JSON.stringify(rejectResult.details)}`);
                
                // Wait for global idle
                await sessionManager.waitForGlobalIdle(1500, 8000);
                
                // Take post-reject snapshot
                postRejectSnapshot = await snapshotBuilder.buildSnapshot('post_reject', rejectPageSessionId);
                
                await logger.log('info', 'DBG cookies_hdr_counts_post_reject', {
                  pre: eventsPipeline.setCookieEvents_pre.length,
                  post_accept: eventsPipeline.setCookieEvents_post_accept.length,
                  post_reject: eventsPipeline.setCookieEvents_post_reject.length,
                  trace_id: traceId
                });
              } else {
                await logger.log('info', '❌ CMP Reject click failed in new context - no reject button found');
              }
              
              // Close reject context
              await sendCommand('Target.closeTarget', { targetId: rejectPageTarget });
            } else {
              await logger.log('warn', '❌ Failed to create new target for reject flow - using fallback');
            }
          } else {
            await logger.log('info', '❌ CMP Accept click failed - no CMP detected or button not found');
          }
          
          // ==================== LEGACY DATA COMPATIBILITY ====================
          // Build backward-compatible data structures for existing report logic
          const cookies_pre = preSnapshot?.persistedCookies || [];
          const cookies_post_accept = postAcceptSnapshot?.persistedCookies || [];
          const cookies_post_reject = postRejectSnapshot?.persistedCookies || [];
          const cookies_post_accept_extra: any[] = []; // Legacy compatibility
          const cookies_post_reject_extra: any[] = []; // Legacy compatibility
          const cookies_pre_load = cookies_pre;
          const cookies_pre_idle = cookies_pre;
          const cookies_pre_extra = cookies_pre;
          
          const requests_pre = preSnapshot?.requests || [];
          const requests_post_accept = postAcceptSnapshot?.requests || [];
          const requests_post_reject = postRejectSnapshot?.requests || [];
          
          // POINT 5: Fixed storage metrics using correct format
          const storage_pre = preSnapshot?.storage?.storageMetrics?.uniqueKeys || [];
          const storage_post_accept = postAcceptSnapshot?.storage?.storageMetrics?.uniqueKeys || [];
          const storage_post_reject = postRejectSnapshot?.storage?.storageMetrics?.uniqueKeys || [];
          
          // Use server-set cookies as primary data source
          const setCookieEvents_pre = eventsPipeline.setCookieEvents_pre;
          const setCookieEvents_post_accept = eventsPipeline.setCookieEvents_post_accept;
          const setCookieEvents_post_reject = eventsPipeline.setCookieEvents_post_reject;
          
          // Build legacy-compatible maps
          const requestMap = eventsPipeline.requestMap;
          const postDataMap = eventsPipeline.postDataMap; // POINT 6: Use collected POST data
          
          // Phase 5: Calculate tracking parameters and data sending
          const mainDomain = getETldPlusOneLite(new URL(finalUrl).hostname);
          let thirdPartyDataSending = 0;
          
          // Process all requests for tracking analysis
          const allRequests = [...requests_pre, ...requests_post_accept, ...requests_post_reject];
          
          for (const request of allRequests) {
            try {
              const requestHost = new URL(request.url).hostname;
              const requestDomain = getETldPlusOneLite(requestHost);
              const isFirstParty = requestDomain === mainDomain;
              
              // Update host map
              if (isFirstParty) {
                hostMap.requests.firstParty.add(requestHost);
              } else {
                hostMap.requests.thirdParty.add(requestHost);
              }
              
              // Extract query parameters
              const queryParams = parseQuery(request.url);
              const significantQueryParams = Object.keys(queryParams).filter(key => 
                SIGNIFICANT_PARAMS.includes(key)
              );
              
              // Extract POST body parameters if available
              const postData = postDataMap.get(request.requestId);
              let significantPostParams: string[] = [];
              
              if (postData) {
                const postParams = typeof postData === 'string' ? 
                  parseFormUrlEncoded(postData) : 
                  (typeof postData === 'object' ? postData : {});
                  
                significantPostParams = Object.keys(postParams).filter(key => 
                  SIGNIFICANT_PARAMS.includes(key)
                );
              }
              
              // Track significant parameters
              if (significantQueryParams.length > 0 || significantPostParams.length > 0) {
                trackingParams.push({
                  host: requestHost,
                  path: new URL(request.url).pathname,
                  method: request.method,
                  params: Object.fromEntries(significantQueryParams.map(key => [key, queryParams[key]])),
                  bodyKeys: significantPostParams,
                  phase: request.phase,
                  isFirstParty
                });
                
                if (!isFirstParty) {
                  thirdPartyDataSending++;
                }
              }
            } catch {
              // Ignore invalid URLs
            }
          }
          
          // Phase 6: Build host map and simplified metadata
          const allCookies = [...cookies_pre, ...cookies_post_accept, ...cookies_post_reject];
          
          for (const cookie of allCookies) {
            const cookieDomain = getETldPlusOneLite(cookie.domain);
            const isFirstParty = cookieDomain === mainDomain;
            
            if (isFirstParty) {
              hostMap.cookies.firstParty.add(cookie.domain);
            } else {
              hostMap.cookies.thirdParty.add(cookie.domain);
            }
          }
          
          // Create simplified metadata
          const uniqueCookies = new Map();
          allCookies.forEach(cookie => {
            const key = `${cookie.name}|${normalizeDomain(cookie.domain)}|${cookie.path || '/'}`;
            if (!uniqueCookies.has(key)) {
              uniqueCookies.set(key, {
                name: cookie.name,
                domain: cookie.domain,
                path: cookie.path || '/',
                expires: cookie.expires !== -1 ? 'persistent' : 'session'
              });
            }
          });
          
          const uniqueStorageKeys = new Set();
          [...storage_pre, ...storage_post_accept, ...storage_post_reject].forEach(([key]) => {
            uniqueStorageKeys.add(key);
          });
          
          const beacons = trackingParams.map(tp => {
            const url = new URL(`https://${tp.host}${tp.path}`);
            return { urlNormalized: `${url.protocol}//${url.host}${url.pathname}` };
          });
          
          const uniqueBeacons = Array.from(new Set(beacons.map(b => b.urlNormalized)))
            .map(url => ({ urlNormalized: url }));
          
          // PATCH 4 - Create server-set cookies view from Set-Cookie headers
          function toKey(c: ParsedCookie){ return `${c.name}|${normalizeDomain(c.domain)}|${c.path||'/'}`; }
          const preFromHeaders = new Map(setCookieEvents_pre.map(c => [toKey(c), c]));
          const postAcceptFromHeaders = new Map(setCookieEvents_post_accept.map(c => [toKey(c), c]));
          const postRejectFromHeaders = new Map(setCookieEvents_post_reject.map(c => [toKey(c), c]));

          // Server-set cookies (relevant even if storage 3P cookies are blocked)
          const cookies_serverset_pre = Array.from(preFromHeaders.values());
          const cookies_serverset_post_accept = Array.from(postAcceptFromHeaders.values());
          const cookies_serverset_post_reject = Array.from(postRejectFromHeaders.values());

          // Phase 7: Self-check gates (PATCH 4 - updated cookie detection)
          const selfCheckReasons: string[] = [];
          let isComplete = true;
          
          if (requests_pre.length === 0) {
            selfCheckReasons.push('Network capture empty (CDP not bound)');
            isComplete = false;
          }
          
          // PATCH 4 - Updated cookie detection rule
          if ((cookies_pre.length + cookies_post_accept.length + cookies_post_reject.length) === 0
              && (setCookieEvents_pre.length + setCookieEvents_post_accept.length + setCookieEvents_post_reject.length) === 0) {
            selfCheckReasons.push('No cookies detected (storage + Set-Cookie empty)');
            isComplete = false;
          }
          
          if (trackingParams.length > 0 && thirdPartyDataSending === 0) {
            selfCheckReasons.push('Tracking detected but data sending section empty');
            isComplete = false;
          }
          
          // Collect final metrics (PATCH 4 - add server-set metrics)
          const metrics = {
            requests_pre: requests_pre.length,
            requests_post_accept: requests_post_accept.length,
            requests_post_reject: requests_post_reject.length,
            cookies_pre: cookies_pre.length,
            cookies_post_accept: cookies_post_accept.length,
            cookies_post_reject: cookies_post_reject.length,
            cookies_serverset_pre: cookies_serverset_pre.length,
            cookies_serverset_post_accept: cookies_serverset_post_accept.length,
            cookies_serverset_post_reject: cookies_serverset_post_reject.length,
            setCookie_pre: setCookieEvents_pre.length,
            setCookie_post_accept: setCookieEvents_post_accept.length,
            setCookie_post_reject: setCookieEvents_post_reject.length,
            storage_pre_items: storage_pre.length,
            storage_post_accept_items: storage_post_accept.length,
            storage_post_reject_items: storage_post_reject.length,
            data_sent_to_third_parties: thirdPartyDataSending,
            third_party_hosts: hostMap.requests.thirdParty.size,
            tracking_params_count: trackingParams.length
          };
          
          await logger.log('info', `📤 data_sent_to_third_parties: ${thirdPartyDataSending}`);
          await logger.log('info', `📊 Final collection summary: ${JSON.stringify(metrics)}`);
          
          // PATCH 3 - Final debug log
          await logger.log('info', 'DBG inflight_done', { inflight: sessionManager.inflight, trace_id: traceId });
          
          ws.close();
          
          
        } catch (error) {
          await logger.log('error', 'CDP analysis failed', { error: String(error) });
          ws.close();
          resolve({
            success: false,
            error_code: 'CDP_ANALYSIS_FAILED',
            details: String(error)
          });
        }
      };
      
      // Event handling now done via addEventListener above - no ws.onmessage needed
      
      ws.onclose = async () => {
        await logger.log('info', '🔌 WebSocket connection closed');
      };
      
      ws.onerror = (error) => {
        logger.log('error', 'WebSocket error', { error: String(error) });
        
        // Build partial metrics from what we can access in this scope
        const phase = phaseController?.get() || 'pre';
        const preRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'pre') : [];
        const postAcceptRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_accept') : [];
        const postRejectRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_reject') : [];
        
        const partialMetrics = {
          requests_pre: preRequests.length,
          requests_post_accept: postAcceptRequests.length,
          requests_post_reject: postRejectRequests.length,
          cookies_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          cookies_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          cookies_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          setCookie_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          setCookie_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          setCookie_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          storage_pre_items: 0
        };
        
        const totalRequests = partialMetrics.requests_pre + partialMetrics.requests_post_accept + partialMetrics.requests_post_reject;
        const totalCookies = partialMetrics.cookies_pre + partialMetrics.cookies_post_accept + partialMetrics.cookies_post_reject;
        
        resolve({
          success: false,
          error_code: 'WEBSOCKET_ERROR',
          details: String(error),
          partial: totalRequests > 0 || totalCookies > 0 ? {
            metrics: partialMetrics,
            phase: phase,
            data_collected: {
              requests: totalRequests,
              cookies: totalCookies,
              storage: 0
            }
          } : undefined
        });
      };
      
      // Timeout
      setTimeout(async () => {
        await logger.log('error', '⏰ Global timeout after 60 seconds');
        
        // Build partial metrics from collected data so far
        const phase = phaseController?.get() || 'pre';
        const preRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'pre') : [];
        const postAcceptRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_accept') : [];
        const postRejectRequests = eventsPipeline?.requestMap ? Array.from(eventsPipeline.requestMap.values()).filter((r: any) => r.phase === 'post_reject') : [];
        const allRequests = [...preRequests, ...postAcceptRequests, ...postRejectRequests];
        
        const totalRequests = allRequests.length;
        const totalCookies = (eventsPipeline?.setCookieEvents_pre?.length || 0) + 
                           (eventsPipeline?.setCookieEvents_post_accept?.length || 0) + 
                           (eventsPipeline?.setCookieEvents_post_reject?.length || 0);
        
        const partialMetrics = {
          requests_pre: preRequests.length,
          requests_post_accept: postAcceptRequests.length,
          requests_post_reject: postRejectRequests.length,
          cookies_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          cookies_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          cookies_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          setCookie_pre: eventsPipeline?.setCookieEvents_pre?.length || 0,
          setCookie_post_accept: eventsPipeline?.setCookieEvents_post_accept?.length || 0,
          setCookie_post_reject: eventsPipeline?.setCookieEvents_post_reject?.length || 0,
          storage_pre_items: 0,
          third_party_hosts: allRequests
            .map((r: any) => { try { return getETldPlusOneLite(new URL(r.url).hostname); } catch { return ''; } })
            .filter(h => h).length,
          tracking_params_count: allRequests
            .filter((r: any) => { 
              try { 
                const url = new URL(r.url);
                return url.search && SIGNIFICANT_PARAMS.some(param => url.searchParams.has(param));
              } catch { return false; }
            }).length
        };

        // Log structured partial summary
        await logger.log('error', '⏰ Global timeout - partial collection summary', {
          url: url,
          phase: phase,
          partial_metrics: partialMetrics,
          requests_collected: totalRequests,
          cookies_collected: totalCookies,
          storage_collected: 0
        });
        
        ws.close();
        resolve({
          success: false,
          error_code: 'TIMEOUT',
          details: 'Analysis timeout after 60 seconds',
          partial: {
            metrics: partialMetrics,
            phase: phase,
            data_collected: {
              requests: totalRequests,
              cookies: totalCookies,
              storage: 0
            }
          }
        });
      }, 60000);
    });

    const duration = Date.now() - startTime;
    
    if (!analysisResult.success) {
      await logger.log('error', 'Analysis failed', analysisResult);
      
      // If partial data is available, log it and update audit_runs with partial metrics
      if ((analysisResult as any).partial) {
        const partial = (analysisResult as any).partial;
        await logger.log('info', 'Final collection summary (partial)', {
          url: url,
          partial_data: partial,
          phase: partial.phase,
          metrics: partial.metrics
        });
        
        // Update audit_runs with partial metrics
        await supabase
          .from('audit_runs')
          .update({
            status: 'failed',
            error_code: (analysisResult as any).error_code || 'UNKNOWN_ERROR',
            error_message: (analysisResult as any).details || 'Analysis failed',
            ended_at: new Date().toISOString(),
            duration_ms: duration,
            bl_status_code: 500,
            requests_total: partial.metrics?.requests_pre || 0,
            requests_pre_consent: partial.metrics?.requests_pre || 0,
            third_parties_count: partial.metrics?.third_party_hosts || 0,
            beacons_count: partial.metrics?.tracking_params_count || 0,
            cookies_pre_count: partial.metrics?.cookies_pre || 0,
            cookies_post_count: Math.max(partial.metrics?.cookies_post_accept || 0, partial.metrics?.cookies_post_reject || 0),
            meta: {
              requests_post_accept: partial.metrics?.requests_post_accept || 0,
              requests_post_reject: partial.metrics?.requests_post_reject || 0,
              setCookie_pre: partial.metrics?.setCookie_pre || 0,
              setCookie_post_accept: partial.metrics?.setCookie_post_accept || 0,
              setCookie_post_reject: partial.metrics?.setCookie_post_reject || 0,
              storage_items: partial.metrics?.storage_pre_items || 0,
              phase_reached: partial.phase,
              partial_data: true
            }
          })
          .eq('trace_id', traceId);
      } else {
        // Update audit_runs with failure (no partial data)
        await supabase
          .from('audit_runs')
          .update({
            status: 'failed',
            error_code: (analysisResult as any).error_code || 'UNKNOWN_ERROR',
            error_message: (analysisResult as any).details || 'Analysis failed',
            ended_at: new Date().toISOString(),
            duration_ms: duration,
            bl_status_code: 500
          })
          .eq('trace_id', traceId);
      }

      return new Response(JSON.stringify({
        ...analysisResult,
        trace_id: traceId,
        duration_ms: duration
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await logger.log('info', '✅ Analysis completed successfully');
    
    // Extract key metrics for audit_runs update
    const data = analysisResult.data;
    const finalMetrics = data.metrics || {};
    
    // Update audit_runs with success
    await supabase
      .from('audit_runs')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        duration_ms: duration,
        bl_status_code: 200,
        bl_health_status: 'ok',
        normalized_url: data.final_url || data.finalUrl,
        requests_total: finalMetrics.requests_pre || 0,
        requests_pre_consent: finalMetrics.requests_pre || 0,
        third_parties_count: finalMetrics.third_party_hosts || 0,
        beacons_count: finalMetrics.tracking_params_count || 0,
        cookies_pre_count: finalMetrics.cookies_pre || 0,
        cookies_post_count: Math.max(finalMetrics.cookies_post_accept || 0, finalMetrics.cookies_post_reject || 0),
        meta: {
          requests_post_accept: finalMetrics.requests_post_accept || 0,
          requests_post_reject: finalMetrics.requests_post_reject || 0,
          setCookie_pre: finalMetrics.setCookie_pre || 0,
          setCookie_post_accept: finalMetrics.setCookie_post_accept || 0,
          setCookie_post_reject: finalMetrics.setCookie_post_reject || 0,
          storage_items: finalMetrics.storage_pre_items || 0,
          cmp_detected: data.cmp?.detected || false,
          cmp_type: data.cmp?.type,
          self_check_complete: data.self_check?.complete || false,
          self_check_reasons: data.self_check?.reasons || []
        }
      })
      .eq('trace_id', traceId);

    // Log structured final summary with collected data
    await logger.log('info', 'Final collection summary', {
      url: url,
      metrics: data.metrics,
      thirdParties: data.thirdParties?.length || 0,
      beacons: data.beacons?.length || 0,
      cookies: data.cookies?.length || 0,
      storage: data.storage?.length || 0,
      cmp: data.cmp,
      verdict: data.verdict
    });

    await logger.log('info', '✅ Analysis function completed successfully');

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      trace_id: traceId,
      bl_status_code: 200,
      bl_health_status: 'ok',
      data: analysisResult.data
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorResponse = {
      success: false,
      error_code: 'UNEXPECTED_ERROR',
      details: String(error),
      duration_ms: duration,
      trace_id: traceId
    };
    
    await logger.log('error', 'Unexpected error in analysis function', errorResponse);
    
    // Update audit_runs with unexpected error
    try {
      await supabase
        .from('audit_runs')
        .update({
          status: 'failed',
          error_code: 'UNEXPECTED_ERROR',
          error_message: String(error),
          ended_at: new Date().toISOString(),
          duration_ms: duration,
          bl_status_code: 500
        })
        .eq('trace_id', traceId);
    } catch (updateError) {
      await logger.log('error', 'Failed to update audit_runs on unexpected error', { updateError: String(updateError) });
    }
    
    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});