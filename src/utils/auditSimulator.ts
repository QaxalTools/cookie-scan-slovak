import { AuditData } from '@/types/audit';

export const simulateAudit = async (url: string): Promise<AuditData> => {
  // Simulácia analýzy - v reálnej implementácii by tu bolo volanie API
  await new Promise(resolve => setTimeout(resolve, 3000));

  const domain = new URL(url).hostname;
  const isHttps = url.startsWith('https://');
  
  // Simulované data na základe URL
  const hasGA = Math.random() > 0.3;
  const hasFacebookPixel = Math.random() > 0.5;
  const hasGTM = Math.random() > 0.4;
  const hasConsentTool = Math.random() > 0.6;

  const trackers = [];
  if (hasGA) trackers.push({ name: 'Google Analytics', status: hasConsentTool ? 'ok' : 'error' as const });
  if (hasFacebookPixel) trackers.push({ name: 'Facebook Pixel', status: hasConsentTool ? 'ok' : 'error' as const });
  if (hasGTM) trackers.push({ name: 'Google Tag Manager', status: 'warning' as const });

  const thirdParties = [];
  if (hasGA) thirdParties.push({ domain: 'google-analytics.com', requests: Math.floor(Math.random() * 5) + 1 });
  if (hasFacebookPixel) thirdParties.push({ domain: 'facebook.com', requests: Math.floor(Math.random() * 3) + 1 });
  if (hasGTM) thirdParties.push({ domain: 'googletagmanager.com', requests: Math.floor(Math.random() * 4) + 1 });

  const technicalCookies = Math.floor(Math.random() * 3) + 1;
  const analyticalCookies = hasGA ? Math.floor(Math.random() * 4) + 2 : 0;
  const marketingCookies = hasFacebookPixel ? Math.floor(Math.random() * 6) + 1 : 0;

  const riskCount = trackers.filter(t => t.status === 'error').length;
  const warningCount = trackers.filter(t => t.status === 'warning').length;

  return {
    url,
    timestamp: new Date().toISOString(),
    summary: {
      overall: riskCount > 0 
        ? `Stránka ${domain} obsahuje ${riskCount} kritických problémov s dodržaním GDPR. Trackery sa ukladajú bez súhlasu používateľov, což predstavuje vysoké riziko pokút až do výšky 4% ročného obratu.`
        : warningCount > 0
        ? `Stránka ${domain} je z pohľadu GDPR prevažne v poriadku, ale identifikovali sme ${warningCount} oblastí na zlepšenie. Odporúčame implementovať dodatočné bezpečnostné opatrenia.`
        : `Stránka ${domain} vykazuje dobrú úroveň súladu s GDPR. Všetky identifikované cookies a trackery sú správne spravované v súlade s právnymi požiadavkami.`,
      risks: riskCount > 0
        ? `Hlavné riziká zahŕňajú ukladanie analytických a marketingových cookies bez predchádzajúceho súhlasu. Toto porušenie ePrivacy direktívy a GDPR môže viesť k pokutám od dozorných orgánov.`
        : `Významné riziká neboli identifikované. Stránka používa prevažne technicky nevyhnutné cookies a má implementovaný systém správy súhlasov.`
    },
    https: {
      status: isHttps ? 'ok' : 'error',
      description: isHttps 
        ? 'Stránka používa HTTPS šifrovanie' 
        : 'Stránka nepoužíva HTTPS - riziko pre bezpečnosť údajov'
    },
    cookies: {
      total: technicalCookies + analyticalCookies + marketingCookies,
      technical: technicalCookies,
      analytical: analyticalCookies,
      marketing: marketingCookies
    },
    trackers,
    thirdParties,
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
        area: 'Trackery tretích strán',
        status: trackers.some(t => t.status === 'error') ? 'error' : trackers.length > 0 ? 'warning' : 'ok',
        comment: trackers.some(t => t.status === 'error') 
          ? 'Trackery sa spúšťajú bez súhlasu' 
          : trackers.length > 0 
          ? 'Trackery sú správne spravované'
          : 'Žiadne trackery nenájdené'
      },
      {
        area: 'Sociálne siete',
        status: hasFacebookPixel && !hasConsentTool ? 'warning' : 'ok',
        comment: hasFacebookPixel 
          ? hasConsentTool ? 'FB Pixel správne blokovaný' : 'FB Pixel sa spúšťa automaticky'
          : 'Žiadne sociálne pluginy'
      }
    ],
    recommendations: generateRecommendations(hasGA, hasFacebookPixel, hasGTM, hasConsentTool, isHttps)
  };
};

const generateRecommendations = (
  hasGA: boolean,
  hasFacebookPixel: boolean,
  hasGTM: boolean,
  hasConsentTool: boolean,
  isHttps: boolean
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
  
  return `Predmet: Audit cookies a trackingu - ${domain}

Dobrý deň,

vykonali sme audit súladu s GDPR a ePrivacy direktívou pre Vašu webovú stránku ${auditData.url}.

KONTEXT A DÔVOD AUDITU:
Európsky dohľad nad dodržiavaním GDPR sa sprísňuje a pokuty za porušenie môžu dosiahnuť až 4% ročného obratu. Najčastejšie chyby sa týkajú:
• Ukladania cookies bez súhlasu používateľov
• Spúšťania trackerov pred udelením súhlasu
• Nesprávnej implementácie consent managementu

HLAVNÉ ZISTENIA:
${auditData.summary.overall}

${riskCount > 0 ? `IDENTIFIKOVANÉ RIZIKÁ (${riskCount}):` : 'POZITÍVNE ZISTENIA:'}
${auditData.summary.risks}

KONKRÉTNE ODPORÚČANIA:
${auditData.recommendations.map((rec, index) => `${index + 1}. ${rec.title}\n   → ${rec.description}`).join('\n\n')}

DETAILNÉ VÝSLEDKY:
• Celkový počet cookies: ${auditData.cookies.total}
  - Technické (povolené): ${auditData.cookies.technical}
  - Analytické: ${auditData.cookies.analytical}
  - Marketingové: ${auditData.cookies.marketing}

• Identifikované trackery: ${auditData.trackers.length}
${auditData.trackers.map(t => `  - ${t.name}: ${t.status === 'ok' ? '✓ OK' : t.status === 'warning' ? '⚠ Upozornenie' : '✗ Problém'}`).join('\n')}

ĎALŠIE KROKY:
${riskCount > 0 
  ? `Odporúčame riešiť identifikované problémy do 30 dní. Môžeme Vám pomôcť s implementáciou consent managementu a technickou realizáciou odporúčaní.`
  : `Vaša stránka vykazuje dobrú úroveň súladu. Odporúčame pravidelné kontroly a aktualizácie cookie policy.`
}

Ak máte otázky alebo potrebujete pomoc s implementáciou, neváhajte nás kontaktovať.

S pozdravom,
[Vaše meno]
[Kontaktné údaje]

---
Audit vykonaný: ${new Date(auditData.timestamp).toLocaleDateString('sk-SK')}
URL: ${auditData.url}`;
};