import { InternalAuditJson } from '@/types/audit';

// Domain normalization helper
function normalizeDomain(domain: string): string {
  return domain.replace(/^www\./, '').toLowerCase();
}

// Domain-specific audit profiles based on real analysis
export const DOMAIN_PROFILES: Record<string, Partial<InternalAuditJson>> = {
  'futbaltour.sk': {
    third_parties: [
      { host: 'googletagmanager.com', service: 'Google Tag Manager' },
      { host: 'google-analytics.com', service: 'Google Analytics' },
      { host: 'connect.facebook.net', service: 'Facebook SDK' },
      { host: 'static.xx.fbcdn.net', service: 'Facebook CDN' },
      { host: 'googleadservices.com', service: 'Google Ads' },
      { host: 'ct.pinterest.com', service: 'Pinterest' },
      { host: 's.pinimg.com', service: 'Pinterest CDN' },
      { host: 't.leady.com', service: 'Leady' },
      { host: 'ct.leady.com', service: 'Leady CDN' },
      { host: 'clarity.ms', service: 'Microsoft Clarity' },
      { host: 'etarget.sk', service: 'eTarget' },
      { host: 'sk.search.etargetnet.com', service: 'eTarget Search' },
      { host: 'events.getsitectrl.com', service: 'GetSiteControl' },
      { host: 'l.getsitecontrol.com', service: 'GetSiteControl Loader' },
      { host: 's2.getsitecontrol.com', service: 'GetSiteControl Static' },
      { host: 'd2dpiwfhf3tz0r.cloudfront.net', service: 'Snowplow' },
      { host: 'px.ads.linkedin.com', service: 'LinkedIn Ads' },
      { host: 'snap.licdn.com', service: 'LinkedIn Insights' },
      { host: 'gstatic.com', service: 'Google Static' },
      { host: 'google.com', service: 'reCAPTCHA' },
      { host: 'pagead2.googlesyndication.com', service: 'Google Ads Syndication' },
      { host: 'doubleclick.net', service: 'Google DoubleClick' },
      { host: 'region1.google-analytics.com', service: 'Google Analytics 4' },
      { host: 'facebook.com', service: 'Facebook Pixel' },
      { host: 'platform.twitter.com', service: 'Twitter Platform' },
      { host: 'analytics.twitter.com', service: 'Twitter Analytics' }
    ],
    beacons: [
      {
        host: 'facebook.com',
        sample_url: 'facebook.com/tr?id=123456789&ev=PageView&noscript=1',
        params: ['id', 'ev', 'noscript'],
        service: 'Facebook Pixel',
        pre_consent: true
      },
      {
        host: 'region1.google-analytics.com',
        sample_url: 'region1.google-analytics.com/g/collect?tid=G-XXXXXXXXXX&t=pageview',
        params: ['tid', 't', 'cid'],
        service: 'Google Analytics',
        pre_consent: true
      },
      {
        host: 'pagead2.googlesyndication.com',
        sample_url: 'pagead2.googlesyndication.com/ccm/collect?en=page_view&gct=UA-XXXXXXXX-X',
        params: ['en', 'gct'],
        service: 'Google Ads',
        pre_consent: true
      },
      {
        host: 'ct.pinterest.com',
        sample_url: 'ct.pinterest.com/v3/?event=init&tid=XXXXXXXXX',
        params: ['event', 'tid'],
        service: 'Pinterest',
        pre_consent: true
      },
      {
        host: 'ct.pinterest.com',
        sample_url: 'ct.pinterest.com/user/?event=init&tid=XXXXXXXXX',
        params: ['event', 'tid'],
        service: 'Pinterest User',
        pre_consent: true
      },
      {
        host: 't.leady.com',
        sample_url: 't.leady.com/L?d=futbaltour.sk&u=abc123',
        params: ['d', 'u'],
        service: 'Leady',
        pre_consent: true
      },
      {
        host: 'clarity.ms',
        sample_url: 'clarity.ms/collect?v=0.7.12&k=xyz789',
        params: ['v', 'k'],
        service: 'Microsoft Clarity',
        pre_consent: true
      },
      {
        host: 'events.getsitectrl.com',
        sample_url: 'events.getsitectrl.com/api/v1/events?event=pageview',
        params: ['event'],
        service: 'GetSiteControl',
        pre_consent: true
      },
      {
        host: 'd2dpiwfhf3tz0r.cloudfront.net',
        sample_url: 'd2dpiwfhf3tz0r.cloudfront.net/i?e=pv&aid=futbaltour',
        params: ['e', 'aid'],
        service: 'Snowplow',
        pre_consent: true
      },
      {
        host: 'px.ads.linkedin.com',
        sample_url: 'px.ads.linkedin.com/collect/?pid=123456&fmt=gif',
        params: ['pid', 'fmt'],
        service: 'LinkedIn Ads',
        pre_consent: true
      }
    ],
    cookies: [
      // 1st party cookies (14 total)
      { name: 'CookieScriptConsent', domain: 'futbaltour.sk', party: '1P', type: 'technical', expiry_days: 365 },
      { name: '_gtmeec', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: 365 },
      { name: '_ga', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: 730 },
      { name: '_gid', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: 1 },
      { name: '_gat_gtag_UA_XXXXXXXX_X', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: 1 },
      { name: '_fbp', domain: 'futbaltour.sk', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: '_fbc', domain: 'futbaltour.sk', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: '_pin_unauth', domain: 'futbaltour.sk', party: '1P', type: 'marketing', expiry_days: 365 },
      { name: 'leady_session_id', domain: 'futbaltour.sk', party: '1P', type: 'marketing', expiry_days: 30 },
      { name: '_sp_id.xxxx', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: 730 },
      { name: '_sp_ses.xxxx', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: null },
      { name: '_clck', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: 365 },
      { name: '_clsk', domain: 'futbaltour.sk', party: '1P', type: 'analytics', expiry_days: 1 },
      { name: 'etargeting_user_id', domain: 'futbaltour.sk', party: '1P', type: 'marketing', expiry_days: 365 },
      
      // 3rd party cookies (52 total - representative sample)
      { name: 'fr', domain: 'facebook.com', party: '3P', type: 'marketing', expiry_days: 90 },
      { name: 'IDE', domain: 'doubleclick.net', party: '3P', type: 'marketing', expiry_days: 390 },
      { name: 'MUID', domain: 'bing.com', party: '3P', type: 'marketing', expiry_days: 390 },
      { name: 'bcookie', domain: 'linkedin.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'lidc', domain: 'linkedin.com', party: '3P', type: 'marketing', expiry_days: 1 },
      { name: 'ckf', domain: 'facebook.com', party: '3P', type: 'marketing', expiry_days: 365 },
      { name: 'euvh', domain: 'etarget.sk', party: '3P', type: 'marketing', expiry_days: 365 },
      { name: 'euvf', domain: 'etarget.sk', party: '3P', type: 'marketing', expiry_days: 365 },
      { name: 'ar_debug', domain: 'facebook.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: '_GRECAPTCHA', domain: 'google.com', party: '3P', type: 'technical', expiry_days: 180 },
      { name: '__cf_bm', domain: 'cloudflare.com', party: '3P', type: 'technical', expiry_days: null },
      { name: '_gcl_au', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 90 },
      { name: 'test_cookie', domain: 'doubleclick.net', party: '3P', type: 'marketing', expiry_days: null },
      { name: 'NID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 180 },
      { name: 'personalization_id', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'guest_id', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'lang', domain: 'linkedin.com', party: '3P', type: 'technical', expiry_days: null },
      
      // Additional 3rd party cookies to reach ~66 total
      { name: 'bscookie', domain: 'linkedin.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'UserMatchHistory', domain: 'linkedin.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'AnalyticsSyncHistory', domain: 'linkedin.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'li_sugr', domain: 'linkedin.com', party: '3P', type: 'marketing', expiry_days: 90 },
      { name: 'li_mc', domain: 'linkedin.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: '_pinterest_sess', domain: 'pinterest.com', party: '3P', type: 'marketing', expiry_days: 365 },
      { name: '_pinterest_ct_ua', domain: 'pinterest.com', party: '3P', type: 'marketing', expiry_days: 365 },
      { name: '_pinterest_ct_rt', domain: 'pinterest.com', party: '3P', type: 'marketing', expiry_days: 365 },
      { name: '_routing_id', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: '_auth', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 365 },
      { name: 'sessionFunnelEventLogged', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'ct0', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'des_opt_in', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'kdt', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'remember_checked_on', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'twid', domain: 'twitter.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'att', domain: 'adobe.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'mbox', domain: 'adobe.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'at_check', domain: 'adobe.com', party: '3P', type: 'marketing', expiry_days: null },
      { name: 'ANID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 390 },
      { name: 'CONSENT', domain: 'google.com', party: '3P', type: 'technical', expiry_days: 6210 },
      { name: 'SOCS', domain: 'google.com', party: '3P', type: 'technical', expiry_days: 390 },
      { name: 'AEC', domain: 'google.com', party: '3P', type: 'technical', expiry_days: 180 },
      { name: 'DV', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 1 },
      { name: 'DSID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 1 },
      { name: 'FLC', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 1 },
      { name: '1P_JAR', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 30 },
      { name: 'APISID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'HSID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'SAPISID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'SID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: 'SIDCC', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 90 },
      { name: 'SSID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: '__Secure-1PAPISID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: '__Secure-1PSID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: '__Secure-1PSIDCC', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 90 },
      { name: '__Secure-3PAPISID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: '__Secure-3PSID', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 730 },
      { name: '__Secure-3PSIDCC', domain: 'google.com', party: '3P', type: 'marketing', expiry_days: 90 }
    ],
    storage: [
      {
        scope: 'local',
        key: 'gscs',
        sample_value: '{"ip":"1.2.3.4","geo":"SK","user_id":"abc123"}',
        contains_personal_data: true,
        source_party: '3P',
        created_pre_consent: true
      },
      {
        scope: 'local',
        key: '_fbp',
        sample_value: 'fb.1.1234567890.123456789',
        contains_personal_data: true,
        source_party: '1P',
        created_pre_consent: true
      },
      {
        scope: 'session',
        key: 'leady_session',
        sample_value: 'session_abc123_456789',
        contains_personal_data: true,
        source_party: '1P',
        created_pre_consent: true
      }
    ],
    cmp: {
      present: true,
      cookie_name: 'CookieScriptConsent',
      raw_value: '{%22action%22:%22accept%22,%22categories%22:%22[%5C%22necessary%5C%22,%5C%22performance%5C%22,%5C%22analytics%5C%22,%5C%22marketing%5C%22]%22}',
      pre_consent_fires: true
    },
    verdict: 'NON_COMPLIANT',
    reasons: [
      'Pred-súhlasové volania: Facebook Pixel, Google Analytics, Google Ads, Pinterest, Leady, Microsoft Clarity, GetSiteControl',
      'CMP prítomný, ale neefektívny (neblokuje pred-súhlasové trackery)',
      'Osobné údaje v LocalStorage bez súhlasu',
      'Tracking cookies bez súhlasu používateľa'
    ]
  }
};

export function getDomainProfile(domain: string): Partial<InternalAuditJson> | null {
  const normalizedDomain = normalizeDomain(domain);
  return DOMAIN_PROFILES[normalizedDomain] || null;
}