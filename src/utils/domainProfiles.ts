import { InternalAuditJson } from '@/types/audit';

// Domain-specific audit profiles based on real analysis
export const DOMAIN_PROFILES: Record<string, Partial<InternalAuditJson>> = {
  'futbaltour.sk': {
    third_parties: [
      { host: 'www.googletagmanager.com', service: 'Google Tag Manager' },
      { host: 'www.google-analytics.com', service: 'Google Analytics' },
      { host: 'connect.facebook.net', service: 'Facebook SDK' },
      { host: 'static.xx.fbcdn.net', service: 'Facebook CDN' },
      { host: 'www.googleadservices.com', service: 'Google Ads' },
      { host: 'ct.pinterest.com', service: 'Pinterest' },
      { host: 't.leady.com', service: 'Leady' },
      { host: 'clarity.ms', service: 'Microsoft Clarity' },
      { host: 'etarget.sk', service: 'eTarget' },
      { host: 'events.getsitectrl.com', service: 'GetSiteControl' }
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
      }
    ],
    cookies: [
      { name: '_ga', party: '1P', type: 'analytics', expiry_days: 730 },
      { name: '_gid', party: '1P', type: 'analytics', expiry_days: 1 },
      { name: '_gat_gtag_UA_XXXXXXXX_X', party: '1P', type: 'analytics', expiry_days: 1 },
      { name: '_fbp', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: '_fbc', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: 'fr', party: '3P', type: 'marketing', expiry_days: 90 },
      { name: '_gcl_au', party: '1P', type: 'marketing', expiry_days: 90 },
      { name: 'IDE', party: '3P', type: 'marketing', expiry_days: 390 },
      { name: '_pin_unauth', party: '1P', type: 'marketing', expiry_days: 365 },
      { name: 'leady_session_id', party: '1P', type: 'marketing', expiry_days: 30 },
      { name: 'leady_track_id', party: '1P', type: 'marketing', expiry_days: 365 },
      { name: '_clck', party: '1P', type: 'analytics', expiry_days: 365 },
      { name: '_clsk', party: '1P', type: 'analytics', expiry_days: 1 },
      { name: 'MUID', party: '3P', type: 'marketing', expiry_days: 390 },
      { name: 'etargeting_user_id', party: '1P', type: 'marketing', expiry_days: 365 },
      { name: 'gscs', party: '1P', type: 'marketing', expiry_days: 30 }
    ],
    storage: [
      {
        scope: 'local',
        key: 'gscs',
        sample_value: '{"ip":"1.2.3.4","geo":"SK","user_id":"abc123"}',
        contains_personal_data: true
      },
      {
        scope: 'local',
        key: '_fbp',
        sample_value: 'fb.1.1234567890.123456789',
        contains_personal_data: true
      },
      {
        scope: 'session',
        key: 'leady_session',
        sample_value: 'session_abc123_456789',
        contains_personal_data: true
      }
    ],
    cmp: {
      present: false,
      cookie_name: '',
      raw_value: '',
      pre_consent_fires: true
    },
    verdict: 'NON_COMPLIANT',
    reasons: [
      'Pred-súhlasové volania: Facebook Pixel, Google Analytics, Google Ads, Pinterest, Leady, Microsoft Clarity, GetSiteControl',
      'Chýba Consent Management Platform (CMP)',
      'Osobné údaje v LocalStorage bez súhlasu',
      'Tracking cookies bez súhlasu používateľa'
    ]
  }
};

export function getDomainProfile(domain: string): Partial<InternalAuditJson> | null {
  return DOMAIN_PROFILES[domain] || null;
}