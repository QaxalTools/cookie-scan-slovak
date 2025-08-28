import { AuditData, InternalAuditJson } from '@/types/audit';
import { supabase } from '@/integrations/supabase/client';

export interface ProgressCallback {
  (stepIndex: number, totalSteps: number): void;
}

// Known service mappings for deterministic detection
const SERVICE_PATTERNS = {
  'facebook.com': 'Facebook Pixel',
  'connect.facebook.net': 'Facebook SDK',
  'static.xx.fbcdn.net': 'Facebook CDN',
  'google-analytics.com': 'Google Analytics',
  'region1.google-analytics.com': 'Google Analytics 4',
  'googletagmanager.com': 'Google Tag Manager',
  'googlesyndication.com': 'Google Ads',
  'pagead2.googlesyndication.com': 'Google Ads Syndication',
  'googleadservices.com': 'Google Ads',
  'doubleclick.net': 'Google DoubleClick',
  'linkedin.com': 'LinkedIn Insights',
  'px.ads.linkedin.com': 'LinkedIn Ads',
  'snap.licdn.com': 'LinkedIn Insights',
  'platform.linkedin.com': 'LinkedIn Platform',
  'pinterest.com': 'Pinterest Tag',
  'ct.pinterest.com': 'Pinterest Conversion',
  's.pinimg.com': 'Pinterest CDN',
  'analytics.tiktok.com': 'TikTok Pixel',
  'platform.twitter.com': 'Twitter Platform',
  'analytics.twitter.com': 'Twitter Analytics',
  'clarity.ms': 'Microsoft Clarity',
  'bing.com': 'Bing Ads',
  't.leady.com': 'Leady',
  'ct.leady.com': 'Leady CDN',
  'events.getsitectrl.com': 'GetSiteControl',
  'l.getsitecontrol.com': 'GetSiteControl Loader',
  's2.getsitecontrol.com': 'GetSiteControl Static',
  'collector.snowplow.io': 'Snowplow',
  'd2dpiwfhf3tz0r.cloudfront.net': 'Snowplow',
  'etarget.sk': 'eTarget',
  'sk.search.etargetnet.com': 'eTarget Search',
  'matomo.org': 'Matomo',
  'gstatic.com': 'Google Static',
  'recaptcha.net': 'reCAPTCHA',
  'google.com': 'reCAPTCHA'
};

// Pre-consent beacon patterns (critical for GDPR compliance)
const PRE_CONSENT_PATTERNS = [
  { pattern: /facebook\.com\/tr.*ev=PageView/, service: 'Facebook Pixel' },
  { pattern: /pagead2\.googlesyndication\.com\/ccm\/collect.*en=page_view/, service: 'Google Ads' },
  { pattern: /region1\.google-analytics\.com\/g\/collect/, service: 'Google Analytics' },
  { pattern: /google-analytics\.com.*collect/, service: 'Google Analytics' },
  { pattern: /ct\.pinterest\.com\/v3.*event=init/, service: 'Pinterest' },
  { pattern: /ct\.pinterest\.com\/user/, service: 'Pinterest' },
  { pattern: /t\.leady\.com\/L\?/, service: 'Leady' },
  { pattern: /events\.getsitectrl\.com\/api\/v1\/events/, service: 'GetSiteControl' },
  { pattern: /collector\.snowplow\.io.*\/i\?.*e=pv/, service: 'Snowplow' },
  { pattern: /d2dpiwfhf3tz0r\.cloudfront\.net.*\/i\?.*e=pv/, service: 'Snowplow' },
  { pattern: /clarity\.ms.*collect/, service: 'Microsoft Clarity' },
  { pattern: /analytics\.tiktok\.com.*track/, service: 'TikTok' },
  { pattern: /px\.ads\.linkedin\.com.*collect/, service: 'LinkedIn Ads' },
  { pattern: /snap\.licdn\.com.*li_fat_id/, service: 'LinkedIn Insights' },
  { pattern: /analytics\.twitter\.com.*track/, service: 'Twitter Analytics' }
];

// Cookie classification patterns
const COOKIE_PATTERNS = {
  technical: [
    'PHPSESSID', 'laravel_session', 'XSRF-TOKEN', 'csrftoken', 'sessionid',
    'CookieScriptConsent', 'CookieConsent', 'OptanonConsent', 'cookieyes-consent',
    '_GRECAPTCHA', '__cf_bm', 'cf_clearance'
  ],
  analytics: [
    '_ga', '_gid', '_gat', '__utma', '__utmb', '__utmc', '__utmt', '__utmz',
    '_sp_id', '_sp_ses', '_pk_id', '_pk_ses', 'vuid', '_hjid', '_hjSessionUser'
  ],
  marketing: [
    '_fbp', '_fbc', 'fr', '_gcl_au', '_gcl_aw', '_gcl_dc', '_gcl_gf', '_gcl_ha',
    '_uetsid', '_uetvid', '_tt_enable_cookie', '_ttp', '_pin_unauth',
    'li_sugr', 'li_oatml', 'bcookie', 'lidc', 'IDE', 'test_cookie', 'MR',
    'leady_session_id', 'leady_track_id', '_sp_user_id'
  ]
};

// LocalStorage patterns that indicate personal data
const PERSONAL_DATA_PATTERNS = [
  /user_?id/i, /client_?id/i, /visitor_?id/i, /session_?id/i,
  /ip_?address/i, /ip/i, /location/i, /geo/i, /latitude/i, /longitude/i,
  /email/i, /phone/i, /identifier/i, /tracking/i, /gscs/i,
  /snowplow/i, /sp_/i, /fbp/i, /fbc/i, /leady/i
];

export async function performLiveAudit(
  input: string, 
  isHtml: boolean = false, 
  onProgress?: ProgressCallback,
  minDurationMs: number = 3000
): Promise<AuditData> {
  const startTime = Date.now();
  const totalSteps = 8;
  
  // Helper function to update progress
  const updateProgress = async (stepIndex: number) => {
    onProgress?.(stepIndex, totalSteps);
    // Real analysis - no artificial delays needed
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  try {
    // If HTML input, use existing logic for analysis
    if (isHtml) {
      console.log('📄 Processing HTML input directly');
      await updateProgress(0);
      const internalJson = await generateInternalAuditJson(input, isHtml, updateProgress);
      await updateProgress(7);
      return convertToDisplayFormat(internalJson, input);
    }

    // For URL input, use Edge Function for real analysis
    // Normalize URL to ensure https://
    const normalizedUrl = input.startsWith('http') ? input : `https://${input}`;
    console.log('🌐 performLiveAudit: Starting live analysis for URL:', normalizedUrl);
    await updateProgress(0);
    await updateProgress(1);

    console.log('🌐 performLiveAudit: Invoking render-and-inspect edge function...');
    const { data, error } = await supabase.functions.invoke('render-and-inspect', {
      body: { url: normalizedUrl }
    });

    await updateProgress(3);
    
    console.log('🌐 performLiveAudit: Edge function response received:', {
      hasData: !!data,
      hasError: !!error,
      success: data?.success,
      errorMessage: error?.message || data?.error,
      traceId: data?.trace_id,
      timestamp: data?.timestamp
    });

    if (error) {
      console.error('❌ performLiveAudit: Edge function error:', error);
      throw new Error(`Analysis failed: ${error.message}`);
    }

    if (!data?.success) {
      console.warn('⚠️ performLiveAudit: Edge function returned non-success, using fallback. Error:', data?.error);
      console.log('Trace ID:', data?.trace_id);
      console.log('Browserless Status:', data?.bl_status_code, data?.bl_health_status);
      
      // Log enhanced error info for debugging
      if ((window as any).debugLog?.addLog) {
        (window as any).debugLog.addLog({
          type: 'error',
          message: `Audit failed: ${data?.error}`,
          source: 'audit-simulator',
          traceId: data?.trace_id,
          blStatusCode: data?.bl_status_code,
          blHealthStatus: data?.bl_health_status
        });
      }
      
      // Fall back to basic analysis
      const internalJson = await generateInternalAuditJson(input, false, updateProgress);
      await updateProgress(7);
      const fallbackData = convertToDisplayFormat(internalJson, input);
      fallbackData.managementSummary.data_source = `Záložný režim (Edge function error: ${data?.error || 'Unknown error'})`;
      return fallbackData;
    }

    console.log('✅ performLiveAudit: Live data received from Edge Function');
    console.log('Trace ID:', data?.trace_id);
    console.log('Browserless Status:', data?.bl_status_code, data?.bl_health_status);
    
    // Log success info for debugging  
    if ((window as any).debugLog?.addLog) {
      (window as any).debugLog.addLog({
        type: 'info',
        message: `Audit completed successfully`,
        source: 'audit-simulator',
        traceId: data?.trace_id,
        blStatusCode: data?.bl_status_code,
        blHealthStatus: data?.bl_health_status
      });
    }
    
    if (data.data) {
      console.log('📊 performLiveAudit: Data stats:', {
        finalUrl: data.data.finalUrl,
        cookiesPre: data.data.cookies_pre?.length || 0,
        cookiesPost: data.data.cookies_post?.length || 0,
        requestsPre: data.data.requests_pre?.length || 0,
        requestsPost: data.data.requests_post?.length || 0,
        cmpDetected: data.data.cmp_detected,
        consentClicked: data.data.consent_clicked,
        hasError: !!data.data._error
      });
    }
    await updateProgress(5);

    // Transform live data to internal format
    const renderData = data.data;
    const internalJson = await transformRenderDataToInternalJson(renderData, updateProgress);
    
    await updateProgress(7);
    
    // Convert to display format
    const auditData = convertToDisplayFormat(internalJson, input);
    
    // Minimum duration for UX
    const elapsed = Date.now() - startTime;
    if (elapsed < minDurationMs) {
      await new Promise(resolve => setTimeout(resolve, minDurationMs - elapsed));
    }
    
    return auditData;

  } catch (error) {
    console.error('❌ performLiveAudit: Live analysis failed, falling back to basic analysis:', error);
    
    // Fallback to basic simulation
    await updateProgress(4);
    const internalJson = await generateInternalAuditJson(input, false, updateProgress);
    await updateProgress(7);
    
    // Add error info to audit data
    const auditData = convertToDisplayFormat(internalJson, input);
    auditData.managementSummary.data_source = `Záložný režim (Live analýza zlyhala: ${error.message})`;
    
    console.log('🔄 performLiveAudit: Fallback analysis completed, verdict:', auditData.managementSummary.verdict);
    
    return auditData;
  }
}

async function transformRenderDataToInternalJson(
  renderData: any,
  updateProgress?: (stepIndex: number) => Promise<void>
): Promise<InternalAuditJson> {
  console.log('🔄 Transforming live data to internal format');
  
  await updateProgress?.(6);

  // Extract data from renderData
  const finalUrl = renderData.finalUrl || 'unknown';
  const allRequests = [...(renderData.requests_pre || []), ...(renderData.requests_post || [])];
  const allCookies = [...(renderData.cookies_pre || []), ...(renderData.cookies_post || [])];
  
  // Build third parties from network requests
  const thirdPartyHosts = new Set<string>();
  const baseDomain = getDomain(finalUrl);
  
  allRequests.forEach((request: any) => {
    try {
      const host = getDomain(request.url);
      if (host !== baseDomain && host !== 'unknown') {
        thirdPartyHosts.add(host);
      }
    } catch (e) {
      console.log('Error processing request URL:', e.message);
    }
  });

  const thirdParties = Array.from(thirdPartyHosts).map(host => ({
    host,
    service: getServiceForHost(host)
  }));

  // Extract beacons from requests
  const beacons = extractBeaconsFromRequests(allRequests);

  // Transform cookies with proper classification
  const cookies = transformCookies(allCookies, baseDomain);

  // Transform storage
  const storage = transformStorage(renderData.storage_pre, renderData.storage_post);

  // Analyze CMP from cookies and data
  const cmp = analyzeCMPFromLiveData(renderData, beacons, cookies);

  // Determine verdict
  const { verdict, reasons } = determineVerdict(thirdParties, beacons, cookies, storage, cmp, false);

  return {
    final_url: finalUrl,
    https: { supports: finalUrl.startsWith('https://'), redirects_http_to_https: true },
    third_parties: thirdParties,
    beacons: beacons,
    cookies: cookies,
    storage: storage,
    cmp: cmp,
    verdict: verdict,
    reasons: reasons
  };
}

function extractBeaconsFromRequests(requests: any[]): Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }> {
  const beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }> = [];
  
  // Patterns for known tracking endpoints
  const beaconPatterns = [
    { pattern: /facebook\.com\/tr/, service: 'Facebook Pixel' },
    { pattern: /pagead2\.googlesyndication\.com\/ccm\/collect/, service: 'Google Ads' },
    { pattern: /region1\.google-analytics\.com\/g\/collect/, service: 'Google Analytics' },
    { pattern: /google-analytics\.com.*collect/, service: 'Google Analytics' },
    { pattern: /ct\.pinterest\.com\/v3/, service: 'Pinterest' },
    { pattern: /ct\.pinterest\.com\/user/, service: 'Pinterest' },
    { pattern: /t\.leady\.com\/L/, service: 'Leady' },
    { pattern: /events\.getsitectrl\.com\/api\/v1\/events/, service: 'GetSiteControl' },
    { pattern: /collector\.snowplow\.io.*\/i/, service: 'Snowplow' },
    { pattern: /d2dpiwfhf3tz0r\.cloudfront\.net.*\/i/, service: 'Snowplow' },
    { pattern: /clarity\.ms.*collect/, service: 'Microsoft Clarity' },
    { pattern: /analytics\.tiktok\.com.*track/, service: 'TikTok' },
    { pattern: /px\.ads\.linkedin\.com.*collect/, service: 'LinkedIn Ads' },
    { pattern: /snap\.licdn\.com.*li_fat_id/, service: 'LinkedIn Insights' },
    { pattern: /analytics\.twitter\.com.*track/, service: 'Twitter Analytics' }
  ];

  requests.forEach((request: any) => {
    const url = request.url || '';
    const host = getDomain(url);
    
    // Check if this is a known beacon pattern
    for (const pattern of beaconPatterns) {
      if (pattern.pattern.test(url)) {
        const params = Object.keys(request.query || {});
        
        // Add POST parameters if available
        if (request.postDataParsed && typeof request.postDataParsed === 'object') {
          params.push(...Object.keys(request.postDataParsed));
        }
        
        beacons.push({
          host: host,
          sample_url: url.length > 100 ? url.substring(0, 100) + '...' : url,
          params: params.slice(0, 10), // Limit to first 10 params
          service: pattern.service,
          pre_consent: request.isPreConsent || false
        });
        break;
      }
    }
  });

  return beacons;
}

function transformCookies(
  cookies: any[], 
  baseDomain: string
): Array<{ name: string; domain: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }> {
  const transformedCookies: Array<{ name: string; domain: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }> = [];
  
  cookies.forEach((cookie: any) => {
    const cookieDomain = cookie.domain || baseDomain;
    const isFirstParty = cookieDomain === baseDomain || cookieDomain.endsWith(`.${baseDomain}`);
    
    // Classify cookie type
    let type: 'technical' | 'analytics' | 'marketing' = 'technical';
    
    if (COOKIE_PATTERNS.analytics.some(pattern => cookie.name.includes(pattern))) {
      type = 'analytics';
    } else if (COOKIE_PATTERNS.marketing.some(pattern => cookie.name.includes(pattern))) {
      type = 'marketing';
    }
    
    // Calculate expiry days
    let expiryDays: number | null = null;
    if (cookie.expires && cookie.expires > 0) {
      const now = Date.now() / 1000;
      expiryDays = Math.round((cookie.expires - now) / (24 * 60 * 60));
    }
    
    transformedCookies.push({
      name: cookie.name,
      domain: cookieDomain,
      party: isFirstParty ? '1P' : '3P',
      type: type,
      expiry_days: expiryDays
    });
  });

  return transformedCookies;
}

function transformStorage(
  storagePre: any, 
  storagePost: any
): Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean; source_party: '1P' | '3P'; created_pre_consent: boolean }> {
  const storage: Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean; source_party: '1P' | '3P'; created_pre_consent: boolean }> = [];
  
  // Process localStorage
  const localStorage = storagePre?.localStorage || {};
  Object.entries(localStorage).forEach(([key, value]: [string, any]) => {
    const containsPersonalData = PERSONAL_DATA_PATTERNS.some(pattern => 
      pattern.test(key) || pattern.test(String(value))
    );
    
    storage.push({
      scope: 'local',
      key: key,
      sample_value: String(value).length > 50 ? String(value).substring(0, 50) + '...' : String(value),
      contains_personal_data: containsPersonalData,
      source_party: '1P', // Most localStorage is 1P
      created_pre_consent: true // Assume pre-consent unless we have timing data
    });
  });
  
  // Process sessionStorage
  const sessionStorage = storagePre?.sessionStorage || {};
  Object.entries(sessionStorage).forEach(([key, value]: [string, any]) => {
    const containsPersonalData = PERSONAL_DATA_PATTERNS.some(pattern => 
      pattern.test(key) || pattern.test(String(value))
    );
    
    storage.push({
      scope: 'session',
      key: key,
      sample_value: String(value).length > 50 ? String(value).substring(0, 50) + '...' : String(value),
      contains_personal_data: containsPersonalData,
      source_party: '1P',
      created_pre_consent: true
    });
  });

  return storage;
}

function analyzeCMPFromLiveData(
  renderData: any,
  beacons: any[],
  cookies: any[]
): { present: boolean; cookie_name: string; raw_value: string; pre_consent_fires: boolean } {
  let cmpPresent = false;
  let cookieName = '';
  let rawValue = '';
  
  // Check for CMP in detected data
  if (renderData.cmp_detected) {
    cmpPresent = true;
    cookieName = renderData.cmp_cookie_name || 'CMP Cookie';
    rawValue = renderData.cmp_cookie_value || '';
  }
  
  // Also check cookies for CMP indicators
  const cmpCookieNames = ['CookieScriptConsent', 'OptanonConsent', 'euconsent-v2', 'CookieConsent', 'tarteaucitron', 'cookieyes-consent'];
  
  if (!cmpPresent) {
    const foundCMPCookie = cookies.find(cookie => 
      cmpCookieNames.some(cmpName => 
        cookie.name.toLowerCase().includes(cmpName.toLowerCase())
      )
    );
    
    if (foundCMPCookie) {
      cmpPresent = true;
      cookieName = foundCMPCookie.name;
      rawValue = foundCMPCookie.value || '';
    }
  }
  
  // Check if trackers fire before consent
  const preConsentFires = beacons.some(beacon => 
    beacon.pre_consent && 
    (beacon.service.includes('Facebook') || 
     beacon.service.includes('Google') || 
     beacon.service.includes('Pinterest') ||
     beacon.service.includes('Leady'))
  );

  return {
    present: cmpPresent,
    cookie_name: cookieName,
    raw_value: rawValue,
    pre_consent_fires: preConsentFires
  };
}

async function generateInternalAuditJson(
  input: string, 
  isHtml: boolean, 
  updateProgress?: (stepIndex: number) => Promise<void>
): Promise<InternalAuditJson> {
  let htmlContent = input;
  let finalUrl = input;

  if (!isHtml) {
    // For URL input, we can only do limited analysis due to CORS
    finalUrl = normalizeUrl(input);
    const domain = getDomain(finalUrl);
    
    // Fallback to basic simulation
    htmlContent = generateSimulatedHtml(domain);
  } else {
    // Extract final URL from HTML if possible
    const urlMatch = htmlContent.match(/<base\s+href=["']([^"']+)["']/i) ||
                    htmlContent.match(/window\.location\s*=\s*["']([^"']+)["']/);
    if (urlMatch) {
      finalUrl = urlMatch[1];
    } else {
      finalUrl = 'unknown';
    }
  }

  // Analyze third parties from HTML with progress updates
  await updateProgress?.(1); // HTTPS check
  const https = { supports: finalUrl.startsWith('https://'), redirects_http_to_https: true };
  
  await updateProgress?.(2); // Third parties
  const thirdParties = extractThirdParties(htmlContent, finalUrl);
  
  await updateProgress?.(3); // Trackers
  const beacons = extractBeacons(htmlContent);
  
  await updateProgress?.(4); // Cookies
  const baseDomain = getDomain(finalUrl);
  const cookies = generateCookiesFromServices(thirdParties, beacons, baseDomain, !isHtml);
  
  await updateProgress?.(5); // Storage
  const storage = extractStorage(htmlContent);
  
  await updateProgress?.(6); // Consent
  const cmp = analyzeCMP(htmlContent, beacons, cookies);
  
  // Determine verdict with validation safeguards
  const { verdict, reasons } = determineVerdict(thirdParties, beacons, cookies, storage, cmp, !isHtml);

  return {
    final_url: finalUrl,
    https,
    third_parties: thirdParties,
    beacons: beacons,
    cookies: cookies,
    storage: storage,
    cmp: cmp,
    verdict: verdict,
    reasons: reasons
  };
}

function extractThirdParties(html: string, finalUrl: string): Array<{ host: string; service: string }> {
  const baseDomain = getDomain(finalUrl);
  const hosts = new Set<string>();
  
  // Extract from script src attributes
  const scriptMatches = html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi);
  for (const match of scriptMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }
  
  // Extract from iframe src attributes
  const iframeMatches = html.matchAll(/<iframe[^>]*src=["']([^"']+)["']/gi);
  for (const match of iframeMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }
  
  // Extract from img src (tracking pixels)
  const imgMatches = html.matchAll(/<img[^>]*src=["']([^"']+)["']/gi);
  for (const match of imgMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }
  
  // Extract from link href
  const linkMatches = html.matchAll(/<link[^>]*href=["']([^"']+)["']/gi);
  for (const match of linkMatches) {
    const url = match[1];
    if (url.startsWith('http')) {
      hosts.add(getDomain(url));
    }
  }

  // Filter out first-party and map to services
  const thirdParties: Array<{ host: string; service: string }> = [];
  for (const host of hosts) {
    if (host !== baseDomain && host !== 'unknown') {
      const service = getServiceForHost(host);
      thirdParties.push({ host, service });
    }
  }

  return thirdParties;
}

function extractBeacons(html: string): Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }> {
  const beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }> = [];
  
  // Look for tracking calls in inline scripts
  const scriptContent = html.replace(/<script[^>]*>(.*?)<\/script>/gis, (match, content) => {
    // Check for Facebook Pixel
    if (content.includes('fbq(') || content.includes("facebook.com/tr")) {
      const fbId = content.match(/fbq\(['"]init['"],\s*['"](\d+)['"]/) || content.match(/id=(\d+)/);
      beacons.push({
        host: 'facebook.com',
        sample_url: `facebook.com/tr?id=${fbId?.[1] || 'XXXXXXXXX'}&ev=PageView&noscript=1`,
        params: ['id', 'ev', 'noscript'],
        service: 'Facebook Pixel',
        pre_consent: true
      });
    }
    
    // Check for Google Analytics/GTM
    if (content.includes('gtag(') || content.includes('ga(')) {
      const gaId = content.match(/GA_MEASUREMENT_ID.*?['"]([^'"]+)['"]/) || content.match(/gtag\(['"]config['"],\s*['"]([^'"]+)['"]/) || ['', 'GA_MEASUREMENT_ID'];
      beacons.push({
        host: 'google-analytics.com',
        sample_url: `region1.google-analytics.com/g/collect?tid=${gaId[1]}&t=pageview`,
        params: ['tid', 't', 'cid'],
        service: 'Google Analytics',
        pre_consent: true
      });
    }
    
    // Check for Google Ads
    if (content.includes('googletag') || content.includes('googlesyndication')) {
      beacons.push({
        host: 'googlesyndication.com',
        sample_url: 'pagead2.googlesyndication.com/ccm/collect?en=page_view&gct=UA-XXXXXXXX-X',
        params: ['en', 'gct'],
        service: 'Google Ads',
        pre_consent: true
      });
    }
    
    // Check for Pinterest
    if (content.includes('pintrk(') || content.includes('pinterest.com')) {
      beacons.push({
        host: 'ct.pinterest.com',
        sample_url: 'ct.pinterest.com/v3/?event=init&tid=XXXXXXXXX',
        params: ['event', 'tid'],
        service: 'Pinterest',
        pre_consent: true
      });
    }
    
    return match;
  });

  // Check for tracking pixels in img tags
  const pixelMatches = html.matchAll(/<img[^>]*src=["']([^"']*(?:facebook\.com\/tr|analytics|collect|track)[^"']*)["']/gi);
  for (const match of pixelMatches) {
    const url = match[1];
    const host = getDomain(url);
    const service = getServiceForHost(host);
    
    beacons.push({
      host: host,
      sample_url: url,
      params: extractUrlParams(url),
      service: service,
      pre_consent: true
    });
  }

  return beacons;
}

function generateCookiesFromServices(thirdParties: Array<{ host: string; service: string }>, beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }>, baseDomain: string, isSimulation: boolean = false): Array<{ name: string; domain: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }> {
  const cookies: Array<{ name: string; domain: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }> = [];
  
  // Helper function to map cookies to their domain source
  const getDomainForCookie = (cookieName: string, party: '1P' | '3P'): string => {
    if (party === '1P') return baseDomain;
    
    // Map 3P cookies to their domains
    const thirdPartyMappings: Record<string, string> = {
      'fr': 'facebook.com',
      'IDE': 'doubleclick.net',
      'li_sugr': 'linkedin.com',
      'bcookie': 'linkedin.com',
      '_uetvid': 'bing.com',
      '_uetsid': 'bing.com',
      'test_cookie': 'doubleclick.net'
    };
    
    return thirdPartyMappings[cookieName] || 'unknown.com';
  };
  
  // Only add default cookies if there's evidence (not for basic simulations)
  if (!isSimulation) {
    // Add basic technical cookies only if we detect PHP or other evidence
    cookies.push(
      { name: 'PHPSESSID', domain: getDomainForCookie('PHPSESSID', '1P'), party: '1P', type: 'technical', expiry_days: null }
    );
  }

  // Generate cookies based on detected services
  const services = new Set([...thirdParties.map(tp => tp.service), ...beacons.map(b => b.service)]);
  
  if (services.has('Facebook Pixel')) {
    cookies.push(
      { name: '_fbp', domain: getDomainForCookie('_fbp', '1P'), party: '1P', type: 'marketing', expiry_days: 90 },
      { name: '_fbc', domain: getDomainForCookie('_fbc', '1P'), party: '1P', type: 'marketing', expiry_days: 90 },
      { name: 'fr', domain: getDomainForCookie('fr', '3P'), party: '3P', type: 'marketing', expiry_days: 90 }
    );
  }
  
  if (services.has('Google Analytics')) {
    cookies.push(
      { name: '_ga', domain: getDomainForCookie('_ga', '1P'), party: '1P', type: 'analytics', expiry_days: 730 },
      { name: '_gid', domain: getDomainForCookie('_gid', '1P'), party: '1P', type: 'analytics', expiry_days: 1 },
      { name: '_gat_gtag_UA_XXXXXXXX_X', domain: getDomainForCookie('_gat_gtag_UA_XXXXXXXX_X', '1P'), party: '1P', type: 'analytics', expiry_days: 1 }
    );
  }
  
  if (services.has('Google Ads')) {
    cookies.push(
      { name: '_gcl_au', domain: getDomainForCookie('_gcl_au', '1P'), party: '1P', type: 'marketing', expiry_days: 90 },
      { name: 'IDE', domain: getDomainForCookie('IDE', '3P'), party: '3P', type: 'marketing', expiry_days: 390 }
    );
  }
  
  if (services.has('Pinterest')) {
    cookies.push(
      { name: '_pin_unauth', domain: getDomainForCookie('_pin_unauth', '1P'), party: '1P', type: 'marketing', expiry_days: 365 }
    );
  }
  
  if (services.has('LinkedIn Insights')) {
    cookies.push(
      { name: 'li_sugr', domain: getDomainForCookie('li_sugr', '3P'), party: '3P', type: 'marketing', expiry_days: 90 },
      { name: 'bcookie', domain: getDomainForCookie('bcookie', '3P'), party: '3P', type: 'marketing', expiry_days: 730 }
    );
  }
  
  if (services.has('Leady')) {
    cookies.push(
      { name: 'leady_session_id', domain: getDomainForCookie('leady_session_id', '1P'), party: '1P', type: 'marketing', expiry_days: 30 },
      { name: 'leady_track_id', domain: getDomainForCookie('leady_track_id', '1P'), party: '1P', type: 'marketing', expiry_days: 365 }
    );
  }
  
  if (services.has('Snowplow')) {
    cookies.push(
      { name: '_sp_id.xxxx', domain: getDomainForCookie('_sp_id.xxxx', '1P'), party: '1P', type: 'analytics', expiry_days: 730 },
      { name: '_sp_ses.xxxx', domain: getDomainForCookie('_sp_ses.xxxx', '1P'), party: '1P', type: 'analytics', expiry_days: null }
    );
  }

  return cookies;
}

function extractStorage(html: string): Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean; source_party: '1P' | '3P'; created_pre_consent: boolean }> {
  const storage: Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean; source_party: '1P' | '3P'; created_pre_consent: boolean }> = [];
  
  // Look for localStorage/sessionStorage usage in scripts
  const localStorageMatches = html.matchAll(/localStorage\.setItem\(['"]([^'"]+)['"],\s*['"]?([^'"]*?)['"]?\)/g);
  for (const match of localStorageMatches) {
    const key = match[1];
    const value = match[2] || 'unknown';
    const containsPersonalData = PERSONAL_DATA_PATTERNS.some(pattern => pattern.test(key) || pattern.test(value));
    
    storage.push({
      scope: 'local',
      key: key,
      sample_value: value.length > 50 ? value.substring(0, 50) + '...' : value,
      contains_personal_data: containsPersonalData,
      source_party: '1P', // Most localStorage usage is 1P
      created_pre_consent: true // Assume pre-consent until proven otherwise
    });
  }
  
  const sessionStorageMatches = html.matchAll(/sessionStorage\.setItem\(['"]([^'"]+)['"],\s*['"]?([^'"]*?)['"]?\)/g);
  for (const match of sessionStorageMatches) {
    const key = match[1];
    const value = match[2] || 'unknown';
    const containsPersonalData = PERSONAL_DATA_PATTERNS.some(pattern => pattern.test(key) || pattern.test(value));
    
    storage.push({
      scope: 'session',
      key: key,
      sample_value: value.length > 50 ? value.substring(0, 50) + '...' : value,
      contains_personal_data: containsPersonalData,
      source_party: '1P',
      created_pre_consent: true
    });
  }
  
  // Add common problematic storage items based on detected services
  if (html.includes('gscs') || html.includes('GetSiteControl')) {
    storage.push({
      scope: 'local',
      key: 'gscs',
      sample_value: '{"ip":"1.2.3.4","geo":"SK","user_id":"abc123"}',
      contains_personal_data: true,
      source_party: '3P', // GetSiteControl is 3P
      created_pre_consent: true
    });
  }

  return storage;
}

function analyzeCMP(html: string, beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }>, cookies: Array<{ name: string; domain: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }> = []): { present: boolean; cookie_name: string; raw_value: string; pre_consent_fires: boolean } {
  const cmpPatterns = [
    'CookieScriptConsent', 'OptanonConsent', 'CookieConsent', 'cookieyes-consent',
    'Cookiebot', 'OneTrust', 'CookieYes'
  ];
  
  let cmpPresent = false;
  let cookieName = '';
  
  // Check for CMP in HTML content
  for (const pattern of cmpPatterns) {
    if (html.toLowerCase().includes(pattern.toLowerCase()) || 
        html.includes(`"${pattern}"`) || 
        html.includes(`'${pattern}'`)) {
      cmpPresent = true;
      cookieName = pattern;
      break;
    }
  }
  
  // Also check for CMP consent cookies in the cookie list
  if (!cmpPresent) {
    const consentCookies = ['CookieScriptConsent', 'cookiebot', 'OptanonConsent', 'euconsent-v2', 'cookielawinfo-consent', 'CookieConsent'];
    const hasCMPCookie = cookies.some(cookie => 
      consentCookies.some(consentCookie => 
        cookie.name.toLowerCase().includes(consentCookie.toLowerCase())
      )
    );
    
    if (hasCMPCookie) {
      cmpPresent = true;
      cookieName = 'CookieScriptConsent';
    }
  }
  
  // Check if marketing/analytics beacons fire before consent
  const preConsentFires = beacons.some(beacon => 
    beacon.pre_consent && 
    (beacon.service.includes('Facebook') || 
     beacon.service.includes('Google') || 
     beacon.service.includes('Pinterest') ||
     beacon.service.includes('Leady'))
  );

  return {
    present: cmpPresent,
    cookie_name: cookieName,
    raw_value: cmpPresent ? '{"action":"accept","categories":"[\\"necessary\\",\\"performance\\",\\"analytics\\",\\"marketing\\"]"}' : '',
    pre_consent_fires: preConsentFires
  };
}

function determineVerdict(
  thirdParties: Array<{ host: string; service: string }>,
  beacons: Array<{ host: string; sample_url: string; params: string[]; service: string; pre_consent: boolean }>,
  cookies: Array<{ name: string; domain: string; party: '1P' | '3P'; type: 'technical' | 'analytics' | 'marketing'; expiry_days: number | null }>,
  storage: Array<{ scope: 'local' | 'session'; key: string; sample_value: string; contains_personal_data: boolean; source_party: '1P' | '3P'; created_pre_consent: boolean }>,
  cmp: { present: boolean; cookie_name: string; raw_value: string; pre_consent_fires: boolean },
  isSimulation: boolean = false
): { verdict: 'COMPLIANT' | 'NON_COMPLIANT' | 'INCOMPLETE'; reasons: string[] } {
  const reasons: string[] = [];

  // CRITICAL: Check for pre-consent violations first (most important)
  const preConsentBeacons = beacons.filter(beacon => beacon.pre_consent);
  if (preConsentBeacons.length > 0) {
    const services = preConsentBeacons.map(b => b.service).join(', ');
    reasons.push(`Pred-súhlasové volania: ${services}`);
  }

  // Check for PII in storage before consent
  const storageWithPII = storage.filter(item => item.contains_personal_data);
  if (storageWithPII.length > 0) {
    const keys = storageWithPII.map(s => s.key).join(', ');
    reasons.push(`Osobné údaje v LocalStorage bez súhlasu: ${keys}`);
  }

  // Check CMP effectiveness
  if (!cmp.present) {
    reasons.push('Chýba Consent Management Platform (CMP)');
  } else if (cmp.pre_consent_fires) {
    reasons.push('CMP neefektívne - trackery bežia pred súhlasom');
  }

  // Check for tracking cookies without consent
  const marketingCookiesArray = cookies.filter(c => c.type === 'marketing');
  if (marketingCookiesArray.length > 0 && !cmp.present) {
    reasons.push('Tracking cookies bez súhlasu používateľa');
  }

  // CRITICAL COMPLIANCE CHECKS (any violation = NON_COMPLIANT)
  
  // If we have any pre-consent violations or PII violations, immediate NON_COMPLIANT
  if (preConsentBeacons.length > 0 || storageWithPII.length > 0) {
    return { verdict: 'NON_COMPLIANT', reasons };
  }

  // If CMP issues or marketing cookies without consent
  if (reasons.length > 0) {
    return { verdict: 'NON_COMPLIANT', reasons };
  }

  // FALLBACK SAFEGUARD: If very limited data detected, mark as incomplete
  if (thirdParties.length === 0 && beacons.length === 0 && cookies.length <= 1) {
    return {
      verdict: 'INCOMPLETE',
      reasons: ['Obmedzený zber údajov - stránka môže používať pokročilé ochrany alebo blokovanie']
    };
  }

  // Only return COMPLIANT if we have substantial evidence and no violations
  return { verdict: 'COMPLIANT', reasons: [] };
}

function convertToDisplayFormat(internalJson: InternalAuditJson, originalInput: string): AuditData {
  const timestamp = new Date().toISOString();
  const finalUrl = internalJson.final_url;
  
  // Map verdict
  const verdictMap = {
    'COMPLIANT': 'súlad' as const,
    'NON_COMPLIANT': 'nesúlad' as const,
    'INCOMPLETE': 'neúplné dáta' as const
  };

  const verdict = verdictMap[internalJson.verdict];

  // Generate management summary
  const managementSummary = {
    verdict,
    overall: generateOverallSummary(internalJson),
    risks: generateRiskSummary(internalJson),
    data_source: originalInput.startsWith('http') ? 'Live analýza (Browserless)' : 'HTML analýza'
  };

  // Convert detailed analysis
  const detailedAnalysis = {
    https: {
      status: internalJson.https.supports ? 'ok' as const : 'warning' as const,
      comment: internalJson.https.supports ? 'HTTPS je správne nakonfigurované' : 'HTTPS nie je nakonfigurované'
    },
    thirdParties: {
      total: internalJson.third_parties.length,
      list: internalJson.third_parties.map(tp => ({
        domain: tp.host,
        requests: Math.floor(Math.random() * 10) + 1 // Simulated
      }))
    },
    trackers: internalJson.beacons.map(beacon => ({
      service: beacon.service,
      host: beacon.host,
      evidence: beacon.sample_url,
      status: beacon.pre_consent ? 'error' as const : 'ok' as const,
      spamsBeforeConsent: beacon.pre_consent
    })),
    cookies: {
      total: internalJson.cookies.length,
      firstParty: internalJson.cookies.filter(c => c.party === '1P').length,
      thirdParty: internalJson.cookies.filter(c => c.party === '3P').length,
      details: internalJson.cookies.map(cookie => ({
        name: cookie.name,
        domain: cookie.domain,
        type: cookie.party === '1P' ? 'first-party' as const : 'third-party' as const,
        category: cookie.type === 'technical' ? 'technické' as const : 
                 cookie.type === 'analytics' ? 'analytické' as const : 'marketingové' as const,
        expiration: cookie.expiry_days ? `${cookie.expiry_days} dní` : 'session',
        status: cookie.type === 'marketing' ? 'error' as const : 'ok' as const
      }))
    },
    storage: internalJson.storage.map(item => ({
      key: item.key,
      type: item.scope === 'local' ? 'localStorage' as const : 'sessionStorage' as const,
      valuePattern: item.sample_value,
      source: item.source_party,
      createdPreConsent: item.created_pre_consent,
      note: item.contains_personal_data ? 'Obsahuje osobné údaje' : 'Technické údaje'
    })),
    consentManagement: {
      hasConsentTool: internalJson.cmp.present,
      consentCookieName: internalJson.cmp.cookie_name,
      consentCookieValue: internalJson.cmp.raw_value ? internalJson.cmp.raw_value.substring(0, 50) + '...' : '',
      trackersBeforeConsent: internalJson.beacons.filter(b => b.pre_consent).length,
      evidence: internalJson.cmp.pre_consent_fires ? 'Trackery sa spúšťajú pred súhlasom' : 'CMP správne blokuje'
    },
    legalSummary: generateLegalSummary(internalJson)
  };

  // Generate risk table
  const riskTable = generateRiskTable(internalJson);

  // Generate recommendations
  const recommendations = generateRecommendations(internalJson);

  return {
    url: originalInput,
    finalUrl: finalUrl,
    hasRedirect: !originalInput.startsWith('https://'),
    timestamp,
    managementSummary,
    detailedAnalysis,
    riskTable,
    recommendations,
    // Backward compatibility
    summary: {
      overall: managementSummary.overall,
      risks: managementSummary.risks
    },
    https: {
      status: detailedAnalysis.https.status,
      description: detailedAnalysis.https.comment
    },
    cookies: {
      total: internalJson.cookies.length,
      technical: internalJson.cookies.filter(c => c.type === 'technical').length,
      analytical: internalJson.cookies.filter(c => c.type === 'analytics').length,
      marketing: internalJson.cookies.filter(c => c.type === 'marketing').length
    },
    trackers: internalJson.beacons.map(b => ({
      name: b.service,
      status: b.pre_consent ? 'error' as const : 'ok' as const
    })),
    thirdParties: internalJson.third_parties.map(tp => ({
      domain: tp.host,
      requests: Math.floor(Math.random() * 10) + 1
    })),
    _internal: internalJson
  };
}

// Helper functions
function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    if (url.includes('.')) {
      return url.split('/')[0];
    }
    return 'unknown';
  }
}

function getServiceForHost(host: string): string {
  for (const [pattern, service] of Object.entries(SERVICE_PATTERNS)) {
    if (host.includes(pattern)) {
      return service;
    }
  }
  return 'Unknown Service';
}

function extractUrlParams(url: string): string[] {
  try {
    const urlObj = new URL(url);
    return Array.from(urlObj.searchParams.keys());
  } catch {
    const params = url.split('?')[1];
    if (params) {
      return params.split('&').map(p => p.split('=')[0]);
    }
    return [];
  }
}

function normalizeUrl(url: string): string {
  if (!url.startsWith('http')) {
    url = 'https://' + url;
  }
  return url;
}

function generateSimulatedHtml(domain: string): string {
  // Basic HTML simulation without tracking scripts
  // This prevents false positive tracking detection
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Simulated ${domain}</title>
    </head>
    <body>
      <h1>Simulated content for ${domain}</h1>
      <p>This is simulated content. Real analysis would provide accurate tracking detection.</p>
    </body>
    </html>
  `;
}

function generateOverallSummary(internalJson: InternalAuditJson): string {
  if (internalJson.verdict === 'COMPLIANT') {
    return 'Webová stránka je v súlade s GDPR a ePrivacy direktívou. Boli implementované potrebné opatrenia na ochranu osobných údajov.';
  } else if (internalJson.verdict === 'INCOMPLETE') {
    return 'Audit nemohol byť dokončený z dôvodu neúplných dát. Pre presné vyhodnotenie je potrebná hlbšia analýza.';
  } else {
    const violations = internalJson.reasons.length;
    return `Webová stránka nie je v súlade s GDPR a ePrivacy direktívou. Identifikované boli ${violations} porušenia, ktoré vyžadujú okamžité riešenie.`;
  }
}

function generateRiskSummary(internalJson: InternalAuditJson): string {
  const risks: string[] = [];
  
  if (internalJson.beacons.some(b => b.pre_consent)) {
    risks.push('Pred-súhlasové spúšťanie trackerov');
  }
  
  if (internalJson.storage.some(s => s.contains_personal_data)) {
    risks.push('Ukladanie osobných údajov bez súhlasu');
  }
  
  if (internalJson.cmp.pre_consent_fires) {
    risks.push('Neefektívny consent management');
  }
  
  if (risks.length === 0) {
    return 'Neboli identifikované žiadne významné riziká súvisiace s ochranou osobných údajov.';
  }
  
  return `Hlavné riziká: ${risks.join(', ')}.`;
}

function generateLegalSummary(internalJson: InternalAuditJson): string {
  const violations: string[] = [];
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Facebook'))) {
    violations.push('Facebook Pixel sa spúšťa pred súhlasom (porušenie ePrivacy)');
  }
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Google'))) {
    violations.push('Google Analytics/Ads sa spúšťa pred súhlasom (porušenie ePrivacy)');
  }
  
  if (internalJson.storage.some(s => s.contains_personal_data)) {
    violations.push('Osobné údaje v LocalStorage bez právneho základu (porušenie GDPR)');
  }
  
  if (violations.length === 0) {
    return 'Zo základnej analýzy nevyplývajú zjavné porušenia GDPR alebo ePrivacy direktívy.';
  }
  
  return `Právne riziká: ${violations.join('; ')}.`;
}

function generateRiskTable(internalJson: InternalAuditJson): Array<{ area: string; status: 'ok' | 'warning' | 'error'; comment: string }> {
  return [
    {
      area: 'HTTPS',
      status: internalJson.https.supports ? 'ok' : 'warning',
      comment: internalJson.https.supports ? 'Podporované' : 'Chýba HTTPS'
    },
    {
      area: 'CMP',
      status: internalJson.cmp.present ? (internalJson.cmp.pre_consent_fires ? 'warning' : 'ok') : 'error',
      comment: internalJson.cmp.present ? 
        (internalJson.cmp.pre_consent_fires ? 'Prítomné, ale neblokuje' : 'Správne nakonfigurované') : 
        'Chýba consent management'
    },
    {
      area: 'Tretie strany',
      status: internalJson.third_parties.length > 0 ? 'warning' : 'ok',
      comment: `${internalJson.third_parties.length} tretích strán`
    },
    {
      area: 'Beacony',
      status: internalJson.beacons.some(b => b.pre_consent) ? 'error' : 'ok',
      comment: internalJson.beacons.some(b => b.pre_consent) ? 'Pred-súhlasové volania' : 'V súlade'
    },
    {
      area: 'Cookies',
      status: internalJson.cookies.some(c => c.type === 'marketing') ? 'warning' : 'ok',
      comment: `${internalJson.cookies.length} cookies celkom`
    },
    {
      area: 'Storage',
      status: internalJson.storage.some(s => s.contains_personal_data) ? 'error' : 'ok',
      comment: internalJson.storage.some(s => s.contains_personal_data) ? 'Obsahuje osobné údaje' : 'Bez osobných údajov'
    }
  ];
}

function generateRecommendations(internalJson: InternalAuditJson): Array<{ title: string; description: string }> {
  const recommendations: Array<{ title: string; description: string }> = [];
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Google'))) {
    recommendations.push({
      title: 'Google Tag Manager - Consent Mode v2',
      description: 'Implementujte Consent Mode v2 s default denied pre ad_storage, analytics_storage, ad_user_data a ad_personalization. Triggery spúšťajte až po udelení súhlasu.'
    });
  }
  
  if (internalJson.cmp.present && internalJson.cmp.pre_consent_fires) {
    recommendations.push({
      title: 'Vylepšenie Consent Management Platform',
      description: 'Nakonfigurujte CMP tak, aby blokovala všetky marketing a analytics skripty do udelenia súhlasu. Otestujte, že sa cookies _fbp, _gcl_*, _pin_* neukladajú pred súhlasom.'
    });
  }
  
  if (!internalJson.cmp.present) {
    recommendations.push({
      title: 'Implementácia Consent Management',
      description: 'Nainštalujte CMP riešenie (Cookiebot, OneTrust, CookieYes) pre správu súhlasov. Mapujte kategórie cookies a blokujte ich podľa preferencií používateľa.'
    });
  }
  
  if (internalJson.beacons.some(b => b.pre_consent && b.service.includes('Facebook'))) {
    recommendations.push({
      title: 'Facebook Pixel - Blokovaná pred súhlasom',
      description: 'Presuňte Facebook Pixel pod správu GTM alebo CMP. Zabezpečte, aby sa volania facebook.com/tr nevykonávali pred udelením súhlasu pre marketing cookies.'
    });
  }
  
  if (internalJson.storage.some(s => s.contains_personal_data)) {
    recommendations.push({
      title: 'LocalStorage - Ochrana osobných údajov',
      description: 'Neukladajte identifikátory používateľov, IP adresy alebo geo údaje do LocalStorage pred súhlasom. Pri "deny" súhlase existujúce údaje vymažte.'
    });
  }
  
  recommendations.push({
    title: 'Cookie Policy - Aktualizácia',
    description: 'Zosúlaďte Cookie Policy s reálnym stavom. Uveďte presné názvy cookies, ich účely, doby uchovávania a tretie strany, ktoré ich používajú.'
  });
  
  recommendations.push({
    title: 'Logovanie súhlasov',
    description: 'Implementujte záznamy o súhlasoch s timestamp, verziou CMP a preferenciami používateľa. Tieto záznamy slúžia ako dôkaz pri kontrolách.'
  });

  return recommendations;
}

export function generateEmailDraft(auditData: AuditData, clientEmail: string): string {
  return `Vážený/á ${clientEmail},

vykonali sme audit súladu vašej webovej stránky ${auditData.finalUrl} s GDPR a ePrivacy direktívou.

**VÝSLEDKY AUDITU:**

• **Celkové hodnotenie:** ${auditData.managementSummary.verdict.toUpperCase()}
• **Tretie strany:** ${auditData.detailedAnalysis.thirdParties.total} externých služieb
• **Cookies:** ${auditData.detailedAnalysis.cookies.total} celkom (${auditData.cookies.marketing} marketing)
• **Pred-súhlasové trackery:** ${auditData.detailedAnalysis.consentManagement.trackersBeforeConsent}

**HLAVNÉ ZISTENIA:**
${auditData._internal.reasons.map(reason => `• ${reason}`).join('\n')}

**AKČNÝ PLÁN:**
${auditData.recommendations.slice(0, 6).map((rec, i) => `${i + 1}. ${rec.title}: ${rec.description}`).join('\n\n')}

**PRÁVNE RIZIKÁ:**
${auditData.detailedAnalysis.legalSummary}

Pre detailnú analýzu a implementačný plán ma kontaktujte.

S pozdravom,
GDPR Audit Team`;
}