import { AuditData } from '@/types/audit';

export const simulateAudit = async (url: string): Promise<AuditData> => {
  // Deterministická analýza podľa nového algoritmu
  await new Promise(resolve => setTimeout(resolve, 3000));

  const originalUrl = url;
  const domain = new URL(url).hostname;
  const isHttps = url.startsWith('https://');
  
  // 1. Načítanie stránky a presmerovania (cold start)
  const finalUrl = isHttps ? url : url.replace('http://', 'https://');
  const hasRedirect = originalUrl !== finalUrl;
  
  // 2. Rozšírená detekcia služieb (deterministická pre konzistentné testovanie)
  const domainHash = domain.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const hasGA = (domainHash % 10) > 2;
  const hasFacebookPixel = (domainHash % 10) > 3;
  const hasGTM = (domainHash % 10) > 4;
  const hasTikTokPixel = (domainHash % 10) > 6;
  const hasLinkedInInsight = (domainHash % 10) > 7;
  const hasPinterestTag = (domainHash % 10) > 7;
  const hasLeady = (domainHash % 10) > 6;
  const hasGetSiteControl = (domainHash % 10) > 7;
  const hasSnowplow = (domainHash % 10) > 8;
  const hasEtarget = (domainHash % 10) > 8;
  const hasMatomo = (domainHash % 10) > 9;
  const hasBing = (domainHash % 10) > 5;
  const hasRecaptcha = (domainHash % 10) > 4;
  const hasConsentTool = (domainHash % 10) > 6;
  
  // 3. Rozšírené tretie strany (kompletná detekcia)
  const thirdParties = [];
  if (hasGA) thirdParties.push({ domain: 'region1.google-analytics.com', requests: 4 });
  if (hasGA) thirdParties.push({ domain: 'google-analytics.com', requests: 3 });
  if (hasFacebookPixel) thirdParties.push({ domain: 'facebook.com', requests: 2 });
  if (hasFacebookPixel) thirdParties.push({ domain: 'connect.facebook.net', requests: 1 });
  if (hasGTM) thirdParties.push({ domain: 'googletagmanager.com', requests: 3 });
  if (hasGTM) thirdParties.push({ domain: 'pagead2.googlesyndication.com', requests: 2 });
  if (hasTikTokPixel) thirdParties.push({ domain: 'analytics.tiktok.com', requests: 2 });
  if (hasLinkedInInsight) thirdParties.push({ domain: 'snap.licdn.com', requests: 2 });
  if (hasLinkedInInsight) thirdParties.push({ domain: 'linkedin.com', requests: 1 });
  if (hasPinterestTag) thirdParties.push({ domain: 'ct.pinterest.com', requests: 3 });
  if (hasPinterestTag) thirdParties.push({ domain: 's.pinimg.com', requests: 2 });
  if (hasLeady) thirdParties.push({ domain: 't.leady.com', requests: 2 });
  if (hasGetSiteControl) thirdParties.push({ domain: 'events.getsitectrl.com', requests: 2 });
  if (hasSnowplow) thirdParties.push({ domain: 'd2dpiwfhf3tz0r.cloudfront.net', requests: 1 });
  if (hasEtarget) thirdParties.push({ domain: 'track.etarget.sk', requests: 1 });
  if (hasMatomo) thirdParties.push({ domain: 'matomo.example.com', requests: 2 });
  if (hasBing) thirdParties.push({ domain: 'bat.bing.com', requests: 1 });
  if (hasRecaptcha) thirdParties.push({ domain: 'google.com', requests: 3 });
  if (hasRecaptcha) thirdParties.push({ domain: 'gstatic.com', requests: 2 });

  // 4. Detailná detekcia trackerov/beaconov (podľa nového algoritmu)
  const trackers = [];
  
  // Google Analytics - pre-consent violations
  if (hasGA) {
    trackers.push({
      service: 'Google Analytics',
      host: 'region1.google-analytics.com',
      evidence: '/g/collect?v=2&tid=G-XXXXXXXXXX&cid=1234567890.1234567890&t=pageview&dl=' + encodeURIComponent(url),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // Facebook Pixel - kritický pre-consent beacon
  if (hasFacebookPixel) {
    trackers.push({
      service: 'Facebook Pixel',
      host: 'facebook.com',
      evidence: '/tr?id=123456789012345&ev=PageView&dl=' + encodeURIComponent(url) + '&rl=' + encodeURIComponent(document?.referrer || ''),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // Google Ads Conversion - pred-súhlasový beacon
  if (hasGTM) {
    trackers.push({
      service: 'Google Ads Conversion',
      host: 'pagead2.googlesyndication.com',
      evidence: '/ccm/collect?en=page_view&cid=CLIENT_ID&tid=AW-123456789&dl=' + encodeURIComponent(url),
      status: hasConsentTool ? 'warning' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // Pinterest Tag
  if (hasPinterestTag) {
    trackers.push({
      service: 'Pinterest Tag',
      host: 'ct.pinterest.com',
      evidence: '/v3/?event=init&tid=123456789&dl=' + encodeURIComponent(url),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // LinkedIn Insight Tag
  if (hasLinkedInInsight) {
    trackers.push({
      service: 'LinkedIn Insight Tag',
      host: 'snap.licdn.com',
      evidence: '/li.lms-analytics/insight.min.js',
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // TikTok Pixel
  if (hasTikTokPixel) {
    trackers.push({
      service: 'TikTok Pixel',
      host: 'analytics.tiktok.com',
      evidence: '/api/v2/pixel/track/?event=PageView&pixel_code=ABCDEFGHIJ&url=' + encodeURIComponent(url),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // Leady - slovenský tracker
  if (hasLeady) {
    trackers.push({
      service: 'Leady',
      host: 't.leady.com',
      evidence: '/L?account_id=12345&event=pageview&url=' + encodeURIComponent(url),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // GetSiteControl
  if (hasGetSiteControl) {
    trackers.push({
      service: 'GetSiteControl',
      host: 'events.getsitectrl.com',
      evidence: '/api/v1/events?website_id=12345&event=page_view&url=' + encodeURIComponent(url),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // Snowplow Analytics
  if (hasSnowplow) {
    trackers.push({
      service: 'Snowplow Analytics',
      host: 'd2dpiwfhf3tz0r.cloudfront.net',
      evidence: '/i?e=pv&url=' + encodeURIComponent(url) + '&page=Homepage&tna=mytracker',
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // Microsoft Bing Ads
  if (hasBing) {
    trackers.push({
      service: 'Microsoft Bing Ads',
      host: 'bat.bing.com',
      evidence: '/action/12345?evt=pageLoad&rn=' + Math.random(),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  
  // Google reCAPTCHA (technické, bez pre-consent problému)
  if (hasRecaptcha) {
    trackers.push({
      service: 'Google reCAPTCHA',
      host: 'google.com',
      evidence: '/recaptcha/api.js?render=6Lc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      status: 'ok' as const,
      spamsBeforeConsent: false
    });
  }

  // 5. Rozšírená cookies analýza (realistické množstvo)
  const technicalCookies = 4 + Math.floor(domainHash % 3); // 4-6 technických
  let analyticalCookies = 0;
  let marketingCookies = 0;
  
  // Určenie počtu cookies podľa služieb
  if (hasGA) analyticalCookies += 4; // _ga, _gid, _ga_XXXXX, _gat
  if (hasMatomo) analyticalCookies += 3; // _pk_id, _pk_ses, _pk_ref
  if (hasFacebookPixel) marketingCookies += 3; // _fbp, _fbc, fr
  if (hasTikTokPixel) marketingCookies += 2; // _ttp, _tt_enable_cookie
  if (hasLinkedInInsight) marketingCookies += 4; // bcookie, lidc, UserMatchHistory, AnalyticsSyncHistory
  if (hasPinterestTag) marketingCookies += 2; // _pin_unauth, _pinterest_sess
  if (hasLeady) marketingCookies += 2; // leady_session_id, leady_visitor_id
  if (hasSnowplow) analyticalCookies += 3; // _sp_id, _sp_ses, _sp_ogn
  if (hasGetSiteControl) marketingCookies += 1; // gsc_ab_12345

  const cookieDetails = [];
  
  // Technické cookies (first-party)
  const techCookieNames = ['PHPSESSID', 'laravel_session', 'XSRF-TOKEN', '_csrf_token', 'wordpress_test_cookie'];
  for (let i = 0; i < technicalCookies; i++) {
    cookieDetails.push({
      name: techCookieNames[i] || `tech_cookie_${i}`,
      type: 'first-party' as const,
      category: 'technické' as const,
      expiration: i === 0 ? 'session' : `${1 + Math.floor(Math.random() * 29)} dní`,
      status: 'ok' as const
    });
  }
  
  // Analytické cookies
  if (hasGA) {
    cookieDetails.push(
      {
        name: '_ga',
        type: 'third-party' as const,
        category: 'analytické' as const,
        expiration: '2 roky',
        status: hasConsentTool ? 'ok' : 'error' as const
      },
      {
        name: '_gid',
        type: 'third-party' as const,
        category: 'analytické' as const,
        expiration: '24 hodín',
        status: hasConsentTool ? 'ok' : 'error' as const
      },
      {
        name: '_ga_XXXXXXXXXX',
        type: 'third-party' as const,
        category: 'analytické' as const,
        expiration: '2 roky',
        status: hasConsentTool ? 'ok' : 'error' as const
      },
      {
        name: '_gat_gtag_UA_XXXXXXX_X',
        type: 'third-party' as const,
        category: 'analytické' as const,
        expiration: '1 minúta',
        status: hasConsentTool ? 'ok' : 'error' as const
      }
    );
  }
  
  if (hasSnowplow) {
    cookieDetails.push(
      {
        name: '_sp_id.xxxx',
        type: 'third-party' as const,
        category: 'analytické' as const,
        expiration: '2 roky',
        status: hasConsentTool ? 'ok' : 'error' as const
      },
      {
        name: '_sp_ses.xxxx',
        type: 'third-party' as const,
        category: 'analytické' as const,
        expiration: '30 minút',
        status: hasConsentTool ? 'ok' : 'error' as const
      }
    );
  }
  
  // Marketingové cookies
  if (hasFacebookPixel) {
    cookieDetails.push(
      {
        name: '_fbp',
        type: 'third-party' as const,
        category: 'marketingové' as const,
        expiration: '3 mesiace',
        status: hasConsentTool ? 'ok' : 'error' as const
      },
      {
        name: '_fbc',
        type: 'third-party' as const,
        category: 'marketingové' as const,
        expiration: '7 dní',
        status: hasConsentTool ? 'ok' : 'error' as const
      }
    );
  }
  
  if (hasLinkedInInsight) {
    cookieDetails.push(
      {
        name: 'bcookie',
        type: 'third-party' as const,
        category: 'marketingové' as const,
        expiration: '2 roky',
        status: hasConsentTool ? 'ok' : 'error' as const
      },
      {
        name: 'lidc',
        type: 'third-party' as const,
        category: 'marketingové' as const,
        expiration: '24 hodín',
        status: hasConsentTool ? 'ok' : 'error' as const
      }
    );
  }
  
  if (hasPinterestTag) {
    cookieDetails.push(
      {
        name: '_pin_unauth',
        type: 'third-party' as const,
        category: 'marketingové' as const,
        expiration: '1 rok',
        status: hasConsentTool ? 'ok' : 'error' as const
      }
    );
  }
  
  if (hasLeady) {
    cookieDetails.push(
      {
        name: 'leady_session_id',
        type: 'third-party' as const,
        category: 'marketingové' as const,
        expiration: '30 dní',
        status: hasConsentTool ? 'ok' : 'error' as const
      }
    );
  }

  // 6. LocalStorage/SessionStorage (včetne osobných údajov)
  const storageData = [];
  
  if (hasGA) {
    storageData.push({
      key: 'ga:clientId',
      type: 'localStorage' as const,
      valuePattern: 'GA1.2.1234567890.1234567890',
      note: 'Google Analytics - identifikátor klienta (osobné údaje)'
    });
  }
  
  if (hasConsentTool) {
    storageData.push({
      key: 'CookieScriptConsent',
      type: 'localStorage' as const,
      valuePattern: '{"action":"accept","categories":["performance","targeting"],"save":true}',
      note: 'Uložené preferencie súhlasu'
    });
  }
  
  // Kritické: osobné údaje v localStorage bez súhlasu
  if (hasLeady || hasGetSiteControl) {
    storageData.push({
      key: 'gscs',
      type: 'localStorage' as const,
      valuePattern: '{"ip":"192.168.1.1","geo":"SK","user_id":"usr_abc123","session":"ses_def456"}',
      note: 'IP adresa, geolokácia, user ID - osobné údaje bez súhlasu!'
    });
  }
  
  if (hasSnowplow) {
    storageData.push({
      key: 'snowplow_duid',
      type: 'localStorage' as const,
      valuePattern: '12345678-1234-1234-1234-123456789012',
      note: 'Snowplow - doméno-unikátny identifikátor (osobné údaje)'
    });
  }

  // 7. Validačné poistky a právne vyhodnotenie
  const riskCount = trackers.filter(t => t.status === 'error').length;
  const warningCount = trackers.filter(t => t.status === 'warning').length;
  const trackersBeforeConsent = trackers.filter(t => t.spamsBeforeConsent).length;
  
  // Poistka A - konzistencia počtov
  const expectedThirdPartyCount = thirdParties.length;
  const expectedCookieCount = technicalCookies + analyticalCookies + marketingCookies;
  const actualCookieCount = cookieDetails.length;
  
  // Poistka B - pred-súhlasové volania (kritické)
  const hasPreConsentViolations = trackersBeforeConsent > 0;
  
  // Poistka C - LocalStorage PII
  const hasPersonalDataInStorage = storageData.some(s => 
    s.note.includes('osobné údaje') || 
    s.note.includes('identifikátor') || 
    s.note.includes('IP') || 
    s.note.includes('geo') || 
    s.note.includes('user_id')
  );
  
  // Poistka D - minimálna senzitivita (detekuje nekompletný zber)
  const hasKnownEmbeds = hasGA || hasFacebookPixel || hasGTM || hasPinterestTag;
  const isDataIncomplete = (expectedThirdPartyCount < 3 && hasKnownEmbeds) || 
                          (actualCookieCount !== expectedCookieCount);
  
  // Finálny verdikt podľa nových pravidiel
  let finalVerdict: 'súlad' | 'čiastočný súlad' | 'nesúlad' | 'neúplné dáta' = 'súlad';
  const violationReasons: string[] = [];
  
  if (isDataIncomplete) {
    finalVerdict = 'neúplné dáta';
    violationReasons.push('Nekompletný zber dát - počty nesedia so zoznamami');
  } else if (hasPreConsentViolations) {
    finalVerdict = 'nesúlad';
    violationReasons.push(`${trackersBeforeConsent} trackerov sa spúšťa pred súhlasom`);
  } else if (hasPersonalDataInStorage && !hasConsentTool) {
    finalVerdict = 'nesúlad';
    violationReasons.push('Osobné údaje v localStorage bez súhlasu');
  } else if ((analyticalCookies > 0 || marketingCookies > 0) && !hasConsentTool) {
    finalVerdict = 'nesúlad';
    violationReasons.push('Analytické/marketingové cookies bez consent managementu');
  } else if (!isHttps) {
    finalVerdict = 'nesúlad';
    violationReasons.push('Chýba HTTPS zabezpečenie');
  } else if (riskCount > 0) {
    finalVerdict = 'nesúlad';
    violationReasons.push('Iné kritické problémy identifikované');
  } else if (warningCount > 0) {
    finalVerdict = 'čiastočný súlad';
    violationReasons.push('Menšie problémy vyžadujú pozornosť');
  }

  return {
    url: originalUrl,
    finalUrl,
    hasRedirect,
    timestamp: new Date().toISOString(),
    
    // A) Manažérsky sumár (používa nový deterministický verdikt)
    managementSummary: {
      verdict: finalVerdict,
      overall: finalVerdict === 'neúplné dáta'
        ? `Audit stránky ${domain} nie je kompletný - zber dát vykazuje nezrovnalosti.`
        : finalVerdict === 'nesúlad'
        ? `Stránka ${domain} nie je v súlade s GDPR a ePrivacy direktívou.`
        : finalVerdict === 'čiastočný súlad'
        ? `Stránka ${domain} je prevažne v súlade, ale vyžaduje zlepšenia.`
        : `Stránka ${domain} vykazuje dobrý súlad s GDPR a ePrivacy.`,
      risks: finalVerdict === 'neúplné dáta'
        ? `Problémy so zberom dát: ${violationReasons.join(', ')}. Audit treba opakovať s dôkladnejšou analýzou.`
        : finalVerdict === 'nesúlad'
        ? `Kritické problémy: ${violationReasons.join(', ')}. Riziko pokút až 4% ročného obratu.`
        : finalVerdict === 'čiastočný súlad'
        ? `Menšie problémy: ${violationReasons.join(', ')}. Odporúčame optimalizáciu.`
        : `Pozitíva: ${hasConsentTool ? 'implementovaný consent management, ' : ''}${isHttps ? 'HTTPS zabezpečenie, ' : ''}prevažne technické cookies.`
    },

    // B) Detailná analýza
    detailedAnalysis: {
      // 1. HTTPS
      https: {
        status: isHttps ? 'ok' : 'error',
        comment: isHttps 
          ? 'HTTPS správne nakonfigurované' 
          : 'Chýba SSL certifikát - riziko pre bezpečnosť údajov'
      },
      
      // 2. Tretie strany
      thirdParties: {
        total: thirdParties.length,
        list: thirdParties
      },
      
      // 3. Trackery/Beacony
      trackers,
      
      // 4. Cookies
      cookies: {
        total: technicalCookies + analyticalCookies + marketingCookies,
        details: cookieDetails
      },
      
      // 5. LocalStorage/SessionStorage
      storage: storageData,
      
      // 6. CMP a časovanie
      consentManagement: {
        hasConsentTool,
        trackersBeforeConsent,
        evidence: trackersBeforeConsent > 0 
          ? trackers.filter(t => t.spamsBeforeConsent).map(t => `${t.service}: ${t.evidence}`).join('; ')
          : 'Žiadne trackery sa nespúšťajú pred súhlasom'
      },
      
      // 7. Právne zhrnutie
      legalSummary: riskCount > 0
        ? `ePrivacy: Porušenie článku 5(3) - ukladanie cookies bez súhlasu. GDPR: Spracovanie osobných údajov bez právneho základu (čl. 6).`
        : `ePrivacy a GDPR: Technické cookies povolené, ostatné s consent managementom v súlade s právnymi požiadavkami.`
    },

    // C) OK vs. Rizikové
    riskTable: [
      {
        area: 'HTTPS zabezpečenie',
        status: isHttps ? 'ok' : 'error',
        comment: isHttps ? 'Správne nakonfigurované' : 'Chýba SSL certifikát'
      },
      {
        area: 'Cookies bez súhlasu',
        status: (analyticalCookies > 0 || marketingCookies > 0) && !hasConsentTool ? 'error' : 'ok',
        comment: hasConsentTool ? 'Implementovaný consent management' : 'Cookies sa ukladajú bez súhlasu'
      },
      {
        area: 'Trackery pred súhlasom',
        status: trackersBeforeConsent > 0 ? 'error' : 'ok',
        comment: trackersBeforeConsent > 0 
          ? `${trackersBeforeConsent} trackerov sa spúšťa pred súhlasom`
          : 'Trackery rešpektujú nastavenia súhlasu'
      },
      {
        area: 'Sociálne siete',
        status: hasFacebookPixel && !hasConsentTool ? 'warning' : 'ok',
        comment: hasFacebookPixel 
          ? hasConsentTool ? 'FB Pixel správne blokovaný' : 'FB Pixel sa spúšťa automaticky'
          : 'Žiadne sociálne pluginy'
      },
      {
        area: 'LocalStorage osobné údaje',
        status: storageData.some(s => s.note.includes('identifikátor')) && !hasConsentTool ? 'warning' : 'ok',
        comment: storageData.some(s => s.note.includes('identifikátor')) && !hasConsentTool
          ? 'Identifikátory v localStorage bez súhlasu'
          : 'LocalStorage v súlade'
      }
    ],

    // D) Odporúčania - budú generované cez funkciu
    recommendations: generateRecommendations({
      hasGA, hasFacebookPixel, hasGTM, hasConsentTool, isHttps, 
      hasTikTokPixel, hasMatomo, hasLinkedInInsight, hasPinterestTag, 
      hasLeady, hasGetSiteControl, hasSnowplow, hasEtarget, hasBing,
      hasPersonalDataInStorage, hasPreConsentViolations, finalVerdict
    }),

    // Backward compatibility properties
    summary: {
      overall: finalVerdict === 'neúplné dáta'
        ? `Audit stránky ${domain} nie je kompletný - zber dát vykazuje nezrovnalosti.`
        : finalVerdict === 'nesúlad'
        ? `Stránka ${domain} nie je v súlade s GDPR a ePrivacy direktívou.`
        : finalVerdict === 'čiastočný súlad'
        ? `Stránka ${domain} je prevažne v súlade, ale vyžaduje zlepšenia.`
        : `Stránka ${domain} vykazuje dobrý súlad s GDPR a ePrivacy.`,
      risks: finalVerdict === 'neúplné dáta'
        ? `Problémy so zberom dát: ${violationReasons.join(', ')}. Audit treba opakovať s dôkladnejšou analýzou.`
        : finalVerdict === 'nesúlad'
        ? `Kritické problémy: ${violationReasons.join(', ')}. Riziko pokút až 4% ročného obratu.`
        : finalVerdict === 'čiastočný súlad'
        ? `Menšie problémy: ${violationReasons.join(', ')}. Odporúčame optimalizáciu.`
        : `Pozitíva: ${hasConsentTool ? 'implementovaný consent management, ' : ''}${isHttps ? 'HTTPS zabezpečenie, ' : ''}prevažne technické cookies.`
    },
    https: {
      status: isHttps ? 'ok' : 'error',
      description: isHttps 
        ? 'HTTPS správne nakonfigurované' 
        : 'Chýba SSL certifikát - riziko pre bezpečnosť údajov'
    },
    cookies: {
      total: actualCookieCount,
      technical: technicalCookies,
      analytical: analyticalCookies,
      marketing: marketingCookies
    },
    trackers: trackers.map(t => ({
      name: t.service,
      status: t.status
    })),
    thirdParties
  };
};

interface RecommendationParams {
  hasGA: boolean;
  hasFacebookPixel: boolean;
  hasGTM: boolean;
  hasConsentTool: boolean;
  isHttps: boolean;
  hasTikTokPixel: boolean;
  hasMatomo: boolean;
  hasLinkedInInsight: boolean;
  hasPinterestTag: boolean;
  hasLeady: boolean;
  hasGetSiteControl: boolean;
  hasSnowplow: boolean;
  hasEtarget: boolean;
  hasBing: boolean;
  hasPersonalDataInStorage: boolean;
  hasPreConsentViolations: boolean;
  finalVerdict: string;
}

const generateRecommendations = (params: RecommendationParams) => {
  const {
    hasGA, hasFacebookPixel, hasGTM, hasConsentTool, isHttps, 
    hasTikTokPixel, hasMatomo, hasLinkedInInsight, hasPinterestTag, 
    hasLeady, hasGetSiteControl, hasSnowplow, hasEtarget, hasBing,
    hasPersonalDataInStorage, hasPreConsentViolations, finalVerdict
  } = params;
  
  const recommendations = [];

  // Kritické problémy najprv
  if (!isHttps) {
    recommendations.push({
      title: 'Implementovať HTTPS',
      description: 'Zakúpiť a nakonfigurovať SSL certifikát pre bezpečné šifrovanie dát'
    });
  }

  if (!hasConsentTool && (hasGA || hasFacebookPixel || hasTikTokPixel || hasLinkedInInsight || hasPinterestTag)) {
    recommendations.push({
      title: 'Implementovať Consent Management Platform',
      description: 'Nainštalovať Cookiebot, OneTrust alebo Cookie Script pre správu súhlasov s marketing/analytics cookies'
    });
  }

  // Google services
  if (hasGTM && hasPreConsentViolations) {
    recommendations.push({
      title: 'Nakonfigurovať GTM Consent Mode v2',
      description: 'Nastaviť ad_storage, analytics_storage, ad_user_data, ad_personalization na "denied" by default, triggery až po "grant"'
    });
  }

  if (hasGA && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať Google Analytics pred súhlasom',
      description: 'Zabezpečiť spúšťanie GA až po súhlase alebo prejsť na anonymizovanú analýzu bez cookies'
    });
  }

  // Social networks - high priority  
  if (hasFacebookPixel && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať Facebook Pixel pred súhlasom',
      description: 'FB Pixel je marketingový nástroj a musí byť blokovaný do udelenia explicitného súhlasu'
    });
  }

  if (hasTikTokPixel && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať TikTok Pixel pred súhlasom',
      description: 'TikTok tracking vyžaduje súhlas pre marketingové cookies a behavioral targeting'
    });
  }

  if (hasLinkedInInsight && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať LinkedIn Insight Tag pred súhlasom',
      description: 'LinkedIn tracking musí byť pozastavený do získania súhlasu pre B2B marketing cookies'
    });
  }

  if (hasPinterestTag && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať Pinterest Tag pred súhlasom',
      description: 'Pinterest conversion tracking vyžaduje súhlas pre marketingové cookies'
    });
  }

  // Slovak/local trackers
  if (hasLeady && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať Leady tracking pred súhlasom',
      description: 'Leady identifikácia návštevníkov musí byť blokovaná do súhlasu s behavioral trackingom'
    });
  }

  if (hasGetSiteControl && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať GetSiteControl pred súhlasom',
      description: 'Widget analytics musia rešpektovať súhlas pre behavioral tracking'
    });
  }

  if (hasSnowplow && hasPreConsentViolations) {
    recommendations.push({
      title: 'Nakonfigurovať Snowplow anonymizáciu',
      description: 'Anonymizovať IP adresy a user ID, používať cookieless tracking bez súhlasu'
    });
  }

  // Microsoft
  if (hasBing && hasPreConsentViolations) {
    recommendations.push({
      title: 'Blokovať Microsoft Bing Ads pred súhlasom',
      description: 'UET tag musí byť pozastavený do súhlasu s ads/conversion tracking'
    });
  }

  // LocalStorage issues
  if (hasPersonalDataInStorage) {
    recommendations.push({
      title: 'Vyčistiť LocalStorage od osobných údajov',
      description: 'Neukladať IP, geo, user_id pred súhlasom; pri "deny" vymazať existujúce identifikátory'
    });
  }

  // Analytics alternatives
  if (hasMatomo && !hasConsentTool) {
    recommendations.push({
      title: 'Nakonfigurovať Matomo pre súlad',
      description: 'Aktivovať IP anonymizáciu, cookieless tracking alebo implementovať opt-out mechanizmus'
    });
  }

  // Always include these
  recommendations.push({
    title: 'Aktualizovať Cookie Policy',
    description: 'Zosúladiť zásady s reálnym stavom - uviesť všetky tretie strany, účely, retenčné časy'
  });

  recommendations.push({
    title: 'Implementovať logovanie súhlasov',
    description: 'Uchovávať timestamp, verziu CMP, preferencie (dôkaz pre kontroly úradov)'
  });

  if (finalVerdict === 'neúplné dáta') {
    recommendations.unshift({
      title: 'Opraviť zber dát pre kompletný audit',
      description: 'Zistiť príčinu nedostatočnej detekcie a opakovať audit s komplexnejším nástrojom'
    });
  }

  return recommendations;
};

export const generateEmailDraft = (auditData: AuditData, clientEmail: string): string => {
  const domain = new URL(auditData.url).hostname;
  const riskCount = auditData.riskTable.filter(risk => risk.status === 'error').length;
  const verdict = auditData.managementSummary.verdict;
  
  // E) Návrh e-mailu klientovi
  return `Predmet: GDPR audit cookies a trackingu - ${domain}

Dobrý deň,

vykonali sme komplexný audit súladu s GDPR a ePrivacy direktívou pre Vašu webovú stránku ${auditData.url}.

KONTEXT A DÔVOD AUDITU:
Európsky dohľad nad dodržiavaním GDPR sa výrazne sprísňuje. Dozorné orgány udeľujú pokuty za porušenie ePrivacy až do výšky 4% ročného obratu. Najčastejšie chyby súvisia s:
• Ukladaním cookies bez predchádzajúceho súhlasu používateľov
• Spúšťaním trackerov (GA, Facebook Pixel, TikTok) pred udelením súhlasu  
• Nesprávnou implementáciou consent management platformy
• Chýbajúcou dokumentáciou a logovaním súhlasov

VERDIKT AUDITU: ${verdict.toUpperCase()}
${auditData.managementSummary.overall}

HLAVNÉ ZISTENIA:
${riskCount > 0 ? '🔴 KRITICKÉ PROBLÉMY:' : '✅ POZITÍVNE ZISTENIA:'}
• ${auditData.detailedAnalysis.consentManagement.hasConsentTool ? 'Implementovaný consent management' : 'Chýba consent management platform'}
• ${auditData.detailedAnalysis.consentManagement.trackersBeforeConsent === 0 ? 'Trackery rešpektujú súhlas' : `${auditData.detailedAnalysis.consentManagement.trackersBeforeConsent} trackerov sa spúšťa pred súhlasom`}
• ${auditData.detailedAnalysis.https.status === 'ok' ? 'HTTPS správne nakonfigurované' : 'Chýba HTTPS zabezpečenie'}
• Celkom ${auditData.detailedAnalysis.cookies.total} cookies (${auditData.detailedAnalysis.cookies.details.filter(c => c.category === 'marketingové' || c.category === 'analytické').length} vyžaduje súhlas)
• ${auditData.detailedAnalysis.thirdParties.total} tretích strán komunikuje s webom

DÔKAZY IDENTIFIKOVANÝCH PROBLÉMOV:
${auditData.detailedAnalysis.consentManagement.evidence !== 'Žiadne trackery sa nespúšťajú pred súhlasom' ? `• ${auditData.detailedAnalysis.consentManagement.evidence}` : '• Žiadne porušenia nezistené'}

AKČNÝ PLÁN (podľa priority):
${auditData.recommendations.slice(0, 6).map((rec, index) => `${index + 1}. ${rec.title} → ${rec.description}`).join('\n')}

PRÁVNE VYHODNOTENIE:
${auditData.detailedAnalysis.legalSummary}

ODPORÚČANÝ ČASOVÝ RÁMEC:
${riskCount > 0 
  ? `Kritické problémy riešiť do 14 dní, ostatné úpravy do 30 dní. Môžeme zabezpečiť technickú implementáciu a právny súlad.`
  : `Odporúčame pravidelnú kontrolu každých 6 mesiacov a aktualizáciu cookie policy pri zmenách.`
}

Pre otázky alebo implementačnú podporu nás neváhajte kontaktovať.

S pozdravom,
[Vaše meno a kontakt]

---
Audit vykonaný: ${new Date(auditData.timestamp).toLocaleDateString('sk-SK')}
Auditovaná URL: ${auditData.url}
${auditData.hasRedirect ? `Finálna URL: ${auditData.finalUrl}` : ''}`;
};