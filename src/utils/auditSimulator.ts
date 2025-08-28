import { AuditData } from '@/types/audit';

export const simulateAudit = async (url: string): Promise<AuditData> => {
  // Simulácia analýzy podľa Website Evidence Collector metodológie
  await new Promise(resolve => setTimeout(resolve, 3000));

  const originalUrl = url;
  const domain = new URL(url).hostname;
  const isHttps = url.startsWith('https://');
  
  // 1. Načítanie stránky a presmerovania
  const finalUrl = isHttps ? url : url.replace('http://', 'https://');
  const hasRedirect = originalUrl !== finalUrl;
  
  // 2. Simulácia detekcie trackerov a služieb
  const hasGA = Math.random() > 0.3;
  const hasFacebookPixel = Math.random() > 0.4;
  const hasGTM = Math.random() > 0.5;
  const hasTikTokPixel = Math.random() > 0.7;
  const hasLinkedInInsight = Math.random() > 0.8;
  const hasPinterestTag = Math.random() > 0.85;
  const hasMatomo = Math.random() > 0.9;
  const hasRecaptcha = Math.random() > 0.6;
  const hasConsentTool = Math.random() > 0.4;
  
  // 3. Trackery a web-beacony
  const trackers = [];
  if (hasGA) {
    trackers.push({
      service: 'Google Analytics',
      host: 'google-analytics.com',
      evidence: '/collect?v=1&_v=j98&t=pageview&_s=1&dl=' + encodeURIComponent(url),
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  if (hasFacebookPixel) {
    trackers.push({
      service: 'Facebook Pixel',
      host: 'facebook.com',
      evidence: '/tr?id=123456789&ev=PageView&noscript=1',
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  if (hasGTM) {
    trackers.push({
      service: 'Google Tag Manager',
      host: 'googletagmanager.com',
      evidence: '/gtm.js?id=GTM-XXXXX&l=dataLayer',
      status: hasConsentTool ? 'warning' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  if (hasTikTokPixel) {
    trackers.push({
      service: 'TikTok Pixel',
      host: 'analytics.tiktok.com',
      evidence: '/api/v2/pixel/track/?event=PageView&pixel_code=XXXXX',
      status: hasConsentTool ? 'ok' : 'error' as const,
      spamsBeforeConsent: !hasConsentTool
    });
  }
  if (hasRecaptcha) {
    trackers.push({
      service: 'Google reCAPTCHA',
      host: 'google.com',
      evidence: '/recaptcha/api.js',
      status: 'ok' as const,
      spamsBeforeConsent: false
    });
  }

  // 4. Tretie strany
  const thirdParties = [];
  if (hasGA) thirdParties.push({ domain: 'google-analytics.com', requests: Math.floor(Math.random() * 5) + 2 });
  if (hasFacebookPixel) thirdParties.push({ domain: 'facebook.com', requests: Math.floor(Math.random() * 3) + 1 });
  if (hasGTM) thirdParties.push({ domain: 'googletagmanager.com', requests: Math.floor(Math.random() * 4) + 1 });
  if (hasTikTokPixel) thirdParties.push({ domain: 'analytics.tiktok.com', requests: 2 });
  if (hasRecaptcha) thirdParties.push({ domain: 'google.com', requests: 3 });

  // 5. Cookies analýza
  const technicalCookies = Math.floor(Math.random() * 3) + 1;
  const analyticalCookies = hasGA ? Math.floor(Math.random() * 4) + 2 : 0;
  const marketingCookies = (hasFacebookPixel ? 2 : 0) + (hasTikTokPixel ? 1 : 0);

  const cookieDetails = [];
  // Technické cookies
  for (let i = 0; i < technicalCookies; i++) {
    cookieDetails.push({
      name: ['PHPSESSID', 'JSESSIONID', '_csrf_token'][i] || `tech_${i}`,
      type: 'first-party' as const,
      category: 'technické' as const,
      expiration: 'session',
      status: 'ok' as const
    });
  }
  // Analytické cookies
  if (hasGA) {
    cookieDetails.push({
      name: '_ga',
      type: 'third-party' as const,
      category: 'analytické' as const,
      expiration: '2 roky',
      status: hasConsentTool ? 'ok' : 'error' as const
    });
    cookieDetails.push({
      name: '_gid',
      type: 'third-party' as const,
      category: 'analytické' as const,
      expiration: '24 hodín',
      status: hasConsentTool ? 'ok' : 'error' as const
    });
  }
  // Marketingové cookies
  if (hasFacebookPixel) {
    cookieDetails.push({
      name: '_fbp',
      type: 'third-party' as const,
      category: 'marketingové' as const,
      expiration: '3 mesiace',
      status: hasConsentTool ? 'ok' : 'error' as const
    });
  }

  // 6. LocalStorage/SessionStorage
  const storageData = [];
  if (hasGA) {
    storageData.push({
      key: 'ga:clientId',
      type: 'localStorage' as const,
      valuePattern: 'GA1.2.xxxxxxxxx.xxxxxxxxx',
      note: 'Google Analytics identifikátor klienta'
    });
  }
  if (hasConsentTool) {
    storageData.push({
      key: 'CookieScriptConsent',
      type: 'localStorage' as const,
      valuePattern: '{"action":"accept","categories":["performance","targeting"]}',
      note: 'Uložené preferencie súhlasu'
    });
  }

  // 7. Právne vyhodnotenie
  const riskCount = trackers.filter(t => t.status === 'error').length;
  const warningCount = trackers.filter(t => t.status === 'warning').length;
  const trackersBeforeConsent = trackers.filter(t => t.spamsBeforeConsent).length;

  return {
    url: originalUrl,
    finalUrl,
    hasRedirect,
    timestamp: new Date().toISOString(),
    
    // A) Manažérsky sumár
    managementSummary: {
      verdict: riskCount > 0 ? 'nesúlad' : warningCount > 0 ? 'čiastočný súlad' : 'súlad',
      overall: riskCount > 0 
        ? `Stránka ${domain} nie je v súlade s GDPR a ePrivacy direktívou.`
        : warningCount > 0
        ? `Stránka ${domain} je prevažne v súlade, ale vyžaduje zlepšenia.`
        : `Stránka ${domain} vykazuje dobrý súlad s GDPR a ePrivacy.`,
      risks: riskCount > 0
        ? `Hlavné riziká: ${trackersBeforeConsent > 0 ? `${trackersBeforeConsent} trackerov sa spúšťa pred súhlasom, ` : ''}${(analyticalCookies > 0 || marketingCookies > 0) && !hasConsentTool ? 'cookies sa ukladajú bez súhlasu, ' : ''}${!isHttps ? 'chýba HTTPS zabezpečenie' : ''}. Riziko pokút až 4% ročného obratu.`
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
    recommendations: generateRecommendations(hasGA, hasFacebookPixel, hasGTM, hasConsentTool, isHttps, hasTikTokPixel, hasMatomo),

    // Backward compatibility properties
    summary: {
      overall: riskCount > 0 
        ? `Stránka ${domain} nie je v súlade s GDPR a ePrivacy direktívou.`
        : warningCount > 0
        ? `Stránka ${domain} je prevažne v súlade, ale vyžaduje zlepšenia.`
        : `Stránka ${domain} vykazuje dobrý súlad s GDPR a ePrivacy.`,
      risks: riskCount > 0
        ? `Hlavné riziká: ${trackersBeforeConsent > 0 ? `${trackersBeforeConsent} trackerov sa spúšťa pred súhlasom, ` : ''}${(analyticalCookies > 0 || marketingCookies > 0) && !hasConsentTool ? 'cookies sa ukladajú bez súhlasu, ' : ''}${!isHttps ? 'chýba HTTPS zabezpečenie' : ''}. Riziko pokút až 4% ročného obratu.`
        : `Pozitíva: ${hasConsentTool ? 'implementovaný consent management, ' : ''}${isHttps ? 'HTTPS zabezpečenie, ' : ''}prevažne technické cookies.`
    },
    https: {
      status: isHttps ? 'ok' : 'error',
      description: isHttps 
        ? 'HTTPS správne nakonfigurované' 
        : 'Chýba SSL certifikát - riziko pre bezpečnosť údajov'
    },
    cookies: {
      total: technicalCookies + analyticalCookies + marketingCookies,
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

const generateRecommendations = (
  hasGA: boolean,
  hasFacebookPixel: boolean,
  hasGTM: boolean,
  hasConsentTool: boolean,
  isHttps: boolean,
  hasTikTokPixel: boolean = false,
  hasMatomo: boolean = false
) => {
  const recommendations = [];

  if (!isHttps) {
    recommendations.push({
      title: 'Implementovať HTTPS',
      description: 'Zakúpiť a nakonfigurovať SSL certifikát pre bezpečné šifrovanie dát'
    });
  }

  if (!hasConsentTool) {
    recommendations.push({
      title: 'Implementovať Consent Management Platform',
      description: 'Nainštalovať nástroj ako Cookiebot, OneTrust alebo Cookie Script pre správu súhlasov'
    });
  }

  if (hasGTM && !hasConsentTool) {
    recommendations.push({
      title: 'Nakonfigurovať GTM triggery',
      description: 'Nastaviť spúšťanie tagov až po udelení súhlasu používateľom'
    });
  }

  if (hasGA && !hasConsentTool) {
    recommendations.push({
      title: 'Blokovať Google Analytics',
      description: 'Zabezpečiť spúšťanie GA až po súhlase alebo prejsť na anonymizovanú analýzu'
    });
  }

  if (hasFacebookPixel && !hasConsentTool) {
    recommendations.push({
      title: 'Blokovať Facebook Pixel',
      description: 'Facebook Pixel je marketingový nástroj a vyžaduje explicitný súhlas pred spustením'
    });
  }

  recommendations.push({
    title: 'Aktualizovať Cookie Policy',
    description: 'Upraviť zásady cookies podľa aktuálnych zistení a právnych požiadaviek'
  });

  recommendations.push({
    title: 'Implementovať logovania súhlasov',
    description: 'Uchovávať záznamy o udelených súhlasoch pre potreby dôkazov pri kontrole'
  });

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