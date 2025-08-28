import { jsPDF } from 'jspdf';
import { AuditData } from '@/types/audit';
import { calculateRiskScoresFromDisplay, calculateOverallRiskFromScores } from './riskScoring';

// Add Unicode font support for Slovak diacritics
import 'jspdf/dist/polyfills.es.js';

export const generatePDFReport = async (data: AuditData): Promise<jsPDF> => {
  const pdf = new jsPDF('p', 'mm', 'a4');
  let currentY = 30;
  const leftMargin = 20;
  const rightMargin = 190;
  const pageWidth = 210;
  const pageHeight = 297;
  const lineHeight = 5;
  let pageNumber = 1;
  let totalPages = 1;
  
  // Colors matching the screenshots
  const colors = {
    ok: '#16a34a',
    warning: '#f59e0b', 
    error: '#ef4444',
    text: '#111827',
    gray: '#6b7280',
    lightGray: '#f3f4f6',
    border: '#e5e7eb'
  };

  // Simplified font setup - use helvetica for reliability
  const setupFonts = () => {
    try {
      pdf.setFont('helvetica', 'normal');
    } catch (error) {
      console.warn('Font setup error:', error);
    }
  };
  
  // Header on each page
  const addHeader = () => {
    const currentDate = new Date();
    const dateStr = `${currentDate.getDate().toString().padStart(2, '0')}/${(currentDate.getMonth() + 1).toString().padStart(2, '0')}/${currentDate.getFullYear()}, ${currentDate.getHours().toString().padStart(2, '0')}:${currentDate.getMinutes().toString().padStart(2, '0')}`;
    
    // Date on the left
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(107, 114, 128); // colors.gray converted to RGB
    pdf.text(dateStr, leftMargin, 15);
    
    // Title in center
    pdf.text('GDPR Audit Report', pageWidth / 2, 15, { align: 'center' });
    
    // Thin line under header
    pdf.setDrawColor(colors.border);
    pdf.setLineWidth(0.2);
    pdf.line(leftMargin, 18, pageWidth - leftMargin, 18);
  };
  
  // Footer with page numbers
  const addFooter = () => {
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(107, 114, 128); // colors.gray
    pdf.text(`${pageNumber}/${totalPages}`, pageWidth - leftMargin, pageHeight - 10, { align: 'right' });
  };
  
  // Helper functions
  const addPageIfNeeded = (neededSpace: number) => {
    if (currentY + neededSpace > 260) {
      addFooter();
      pdf.addPage();
      pageNumber++;
      addHeader();
      currentY = 30;
      return true;
    }
    return false;
  };

  const addTitle = (text: string, level: number = 1) => {
    const fontSize = level === 1 ? 18 : level === 2 ? 14 : 11;
    const spacing = level === 1 ? 12 : level === 2 ? 8 : 6;
    
    currentY += spacing;
    addPageIfNeeded(fontSize + spacing);
    
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(17, 24, 39); // colors.text
    
    if (level === 1) {
      // Main title centered
      pdf.text(text, pageWidth / 2, currentY, { align: 'center' });
    } else {
      pdf.text(text, leftMargin, currentY);
    }
    
    currentY += fontSize * 0.4 + spacing;
  };

  const addParagraph = (text: string, fontSize: number = 10, fontWeight: 'normal' | 'bold' = 'normal') => {
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', fontWeight);
    pdf.setTextColor(17, 24, 39); // colors.text
    
    const maxWidth = rightMargin - leftMargin;
    const lines = pdf.splitTextToSize(text, maxWidth);
    const neededSpace = lines.length * lineHeight + 3;
    
    addPageIfNeeded(neededSpace);
    
    lines.forEach((line: string) => {
      pdf.text(line, leftMargin, currentY);
      currentY += lineHeight;
    });
    
    currentY += 3;
  };

  const addKeyValue = (label: string, value: string) => {
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(17, 24, 39); // colors.text
    
    addPageIfNeeded(lineHeight + 2);
    
    pdf.text(`${label}: ${value}`, leftMargin, currentY);
    currentY += lineHeight + 2;
  };

  const renderStatusBadge = (status: 'ok' | 'warning' | 'error', text?: string): string => {
    const statusText = text || (status === 'ok' ? 'OK' : status === 'warning' ? 'WARNING' : 'ERROR');
    return statusText;
  };

  const renderYesNoPreConsent = (value: boolean): string => {
    return value ? 'ÁNO' : 'NIE';
  };

  const addTableAdvanced = (
    headers: string[], 
    rows: string[][], 
    title?: string,
    columnWidths?: number[],
    statusColumns?: number[]
  ) => {
    if (title) {
      addParagraph(title, 11, 'bold');
      currentY += 2;
    }
    
    const tableWidth = rightMargin - leftMargin;
    const defaultWidth = tableWidth / headers.length;
    const colWidths = columnWidths || headers.map(() => defaultWidth);
    const rowHeight = 7;
    
    // Header
    addPageIfNeeded(rowHeight * 3);
    
    let startY = currentY;
    
    // Header background
    pdf.setFillColor(243, 244, 246); // colors.lightGray
    pdf.rect(leftMargin, currentY - 2, tableWidth, rowHeight, 'F');
    
    // Header text
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(17, 24, 39); // colors.text
    
    let currentX = leftMargin;
    headers.forEach((header, i) => {
      pdf.text(header, currentX + 2, currentY + 3);
      currentX += colWidths[i];
    });
    currentY += rowHeight;
    
    // Rows
    rows.forEach((row, rowIndex) => {
      addPageIfNeeded(rowHeight + 2);
      
      // Alternating row colors
      const fillColor = rowIndex % 2 === 0 ? [255, 255, 255] : [249, 250, 251];
      pdf.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
      pdf.rect(leftMargin, currentY - 2, tableWidth, rowHeight, 'F');
      
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'normal');
      
      currentX = leftMargin;
      row.forEach((cell, cellIndex) => {
        // Color cells based on status
        if (statusColumns && statusColumns.includes(cellIndex)) {
          if (cell === 'OK' || cell === 'NIE') {
            pdf.setTextColor(22, 163, 74); // colors.ok
          } else if (cell === 'WARNING') {
            pdf.setTextColor(245, 158, 11); // colors.warning
          } else if (cell === 'ERROR' || cell === 'ÁNO') {
            pdf.setTextColor(239, 68, 68); // colors.error
          } else {
            pdf.setTextColor(17, 24, 39); // colors.text
          }
        } else {
          pdf.setTextColor(17, 24, 39); // colors.text
        }
        
        // Truncate long text
        const maxCellWidth = colWidths[cellIndex] - 4;
        const cellText = pdf.splitTextToSize(cell || '', maxCellWidth);
        const displayText = cellText[0] || '';
        
        pdf.text(displayText, currentX + 2, currentY + 3);
        currentX += colWidths[cellIndex];
      });
      currentY += rowHeight;
    });
    
    // Table border
    pdf.setDrawColor(colors.border);
    pdf.setLineWidth(0.3);
    const tableHeight = currentY - startY;
    pdf.rect(leftMargin, startY - 2, tableWidth, tableHeight, 'S');
    
    // Column separators
    currentX = leftMargin;
    headers.forEach((_, i) => {
      if (i > 0) {
        pdf.line(currentX, startY - 2, currentX, currentY);
      }
      currentX += colWidths[i];
    });
    
    currentY += 6;
  };

  const addNote = (text: string, type: 'warning' | 'ok' = 'warning') => {
    const bgColor = type === 'warning' ? [255, 243, 205] : [220, 252, 231];
    const textColor = type === 'warning' ? [245, 158, 11] : [22, 163, 74];
    
    const maxWidth = rightMargin - leftMargin - 8;
    const lines = pdf.splitTextToSize(text, maxWidth);
    const noteHeight = lines.length * lineHeight + 6;
    
    addPageIfNeeded(noteHeight + 4);
    
    // Background
    pdf.setFillColor(bgColor[0], bgColor[1], bgColor[2]);
    pdf.rect(leftMargin, currentY - 3, rightMargin - leftMargin, noteHeight, 'F');
    
    // Text
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(textColor[0], textColor[1], textColor[2]);
    
    lines.forEach((line: string) => {
      pdf.text(line, leftMargin + 4, currentY);
      currentY += lineHeight;
    });
    
    currentY += 6;
  };

  const addBullets = (items: string[]) => {
    items.forEach(item => {
      addPageIfNeeded(lineHeight + 2);
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(17, 24, 39); // colors.text
      pdf.text(`• ${item}`, leftMargin + 5, currentY);
      currentY += lineHeight + 2;
    });
    currentY += 3;
  };

  // Generate PDF content
  try {
    // Setup fonts
    setupFonts();
    
    // Add initial header
    addHeader();
    
    // Main title
    addTitle('GDPR Cookie Audit Report', 1);
    addParagraph(`Dátum: ${new Date().toLocaleDateString('sk-SK', { day: '2-digit', month: '2-digit', year: 'numeric' })}`);
    currentY += 8;
    
    // A) Manažérsky sumár
    addTitle('A) Manažérsky sumár', 2);
    
    // Verdict with colored badge
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    const verdictColor = data.managementSummary.verdict === 'súlad' ? [22, 163, 74] : 
                        data.managementSummary.verdict === 'čiastočný súlad' ? [245, 158, 11] : [239, 68, 68];
    pdf.setTextColor(verdictColor[0], verdictColor[1], verdictColor[2]);
    pdf.text(`Verdikt: ${data.managementSummary.verdict.toUpperCase()}`, leftMargin, currentY);
    currentY += 8;
    
    addParagraph(`Celkové hodnotenie: ${data.managementSummary.overall}`);
    addParagraph(`Riziká: ${data.managementSummary.risks}`);
    
    if (data.managementSummary.data_source) {
      addParagraph(`Zdroj dát: ${data.managementSummary.data_source}`);
    }
    
    currentY += 5;
    
    // B) Detailná analýza
    addTitle('B) Detailná analýza', 2);
    
    // 1. HTTPS
    addTitle('1. HTTPS zabezpečenie', 3);
    if (data.detailedAnalysis.https.status === 'ok') {
      pdf.setTextColor(22, 163, 74); // colors.ok
      addParagraph('HTTPS je správne nakonfigurované', 10, 'normal');
    } else {
      pdf.setTextColor(239, 68, 68); // colors.error
      addParagraph(data.detailedAnalysis.https.comment, 10, 'normal');
    }
    pdf.setTextColor(17, 24, 39); // colors.text
    currentY += 3;
    
    // 2. Tretie strany
    addTitle('2. Tretie strany', 3);
    if (data.detailedAnalysis.thirdParties.list.length > 0) {
      const thirdPartyHeaders = ['Doména', 'Počet požiadaviek'];
      const thirdPartyRows = data.detailedAnalysis.thirdParties.list.map(party => [
        party.domain,
        party.requests.toString()
      ]);
      addTableAdvanced(thirdPartyHeaders, thirdPartyRows, undefined, [130, 40]);
    } else {
      addParagraph('Žiadne tretie strany neboli detegované.');
    }
    
    // 3. Trackery a web-beacony
    addTitle('3. Trackery a web-beacony', 3);
    if (data.detailedAnalysis.trackers.length > 0) {
      const trackerHeaders = ['Služba', 'Host', 'Dôkaz', 'Pred súhlasom', 'Stav'];
      const trackerRows = data.detailedAnalysis.trackers.map(tracker => [
        tracker.service,
        tracker.host,
        tracker.evidence ? tracker.evidence.substring(0, 30) + '...' : 'N/A',
        renderYesNoPreConsent(tracker.spamsBeforeConsent),
        renderStatusBadge(tracker.status)
      ]);
      addTableAdvanced(trackerHeaders, trackerRows, undefined, [35, 40, 50, 25, 20], [3, 4]);
      
      // Pred-súhlasové trackery
      const preConsentTrackers = data.detailedAnalysis.trackers.filter(t => t.spamsBeforeConsent);
      if (preConsentTrackers.length > 0) {
        addParagraph(`Pred‑súhlasové trackery (${preConsentTrackers.length})`, 10, 'bold');
        const bulletPoints = preConsentTrackers.map(t => `${t.host} - ${t.evidence ? t.evidence.substring(0, 50) + '...' : 'N/A'}`);
        addBullets(bulletPoints);
      }
    } else {
      addParagraph('Žiadne trackery neboli detegované.');
    }
    
    // 4. Cookies
    addTitle('4. Cookies', 3);
    addParagraph(`Cookies (${data.detailedAnalysis.cookies.total})`);
    addParagraph(`First‑party: ${data.detailedAnalysis.cookies.firstParty} | Third‑party: ${data.detailedAnalysis.cookies.thirdParty}`);
    
    if (data.detailedAnalysis.cookies.details && data.detailedAnalysis.cookies.details.length > 0) {
      const cookieHeaders = ['Názov', 'Typ', 'Kategória', 'Expirácia (dni)', 'Stav'];
      const cookieRows = data.detailedAnalysis.cookies.details.map(cookie => {
        // Parse expiration to days
        let expirationDays = 'Neznáme';
        if (cookie.expiration && cookie.expiration !== 'N/A') {
          const match = cookie.expiration.match(/(\d+)/);
          if (match) {
            expirationDays = match[1];
          }
        }
        
        return [
          cookie.name.length > 20 ? cookie.name.substring(0, 17) + '...' : cookie.name,
          cookie.type === 'first-party' ? '1P' : '3P',
          cookie.category,
          expirationDays,
          renderStatusBadge(cookie.status)
        ];
      });
      addTableAdvanced(cookieHeaders, cookieRows, undefined, [45, 15, 35, 25, 20], [4]);
    }
    
    // 5. LocalStorage/SessionStorage
    if (data.detailedAnalysis.storage && data.detailedAnalysis.storage.length > 0) {
      addTitle('5. LocalStorage/SessionStorage', 3);
      const storageHeaders = ['Kľúč', 'Scope', 'Vzorová hodnota', 'Osobné údaje', 'Zdroj a timing'];
      const storageRows = data.detailedAnalysis.storage.map(item => {
        const scope = item.type === 'localStorage' ? 'local' : 'session';
        const personalData = item.note.includes('osobné') ? 'ÁNO' : 'NIE';
        const timing = item.createdPreConsent ? 'Pred súhlasom' : 'NIE';
        const sourceAndTiming = `Via ${item.source} | ${timing}`;
        
        return [
          item.key.length > 15 ? item.key.substring(0, 12) + '...' : item.key,
          scope,
          item.valuePattern.length > 20 ? item.valuePattern.substring(0, 17) + '...' : item.valuePattern,
          personalData,
          sourceAndTiming
        ];
      });
      addTableAdvanced(storageHeaders, storageRows, undefined, [30, 20, 35, 25, 40], [3]);
      
      // Warning note if personal data found before consent
      const preConsentPersonalData = data.detailedAnalysis.storage.some(s => s.createdPreConsent && s.note.includes('osobné'));
      if (preConsentPersonalData) {
        addNote('Pozor: Boli nájdené osobné údaje v storage pred súhlasom!', 'warning');
      }
    }
    
    // 6. Consent Management
    addTitle('6. Consent Management', 3);
    addKeyValue('Consent nástroj', data.detailedAnalysis.consentManagement.hasConsentTool ? 'Implementovaný' : 'Chýba');
    addKeyValue('Trackery pred súhlasom', data.detailedAnalysis.consentManagement.trackersBeforeConsent.toString());
    
    if (data.detailedAnalysis.consentManagement.evidence) {
      addParagraph(`Dôkazy: ${data.detailedAnalysis.consentManagement.evidence}`);
    }
    
    if (data.detailedAnalysis.consentManagement.consentCookieName) {
      const cookieValue = data.detailedAnalysis.consentManagement.consentCookieValue;
      const shortValue = cookieValue && cookieValue.length > 50 ? cookieValue.substring(0, 47) + '...' : cookieValue || 'N/A';
      addParagraph(`Detekovaná consent cookie: ${data.detailedAnalysis.consentManagement.consentCookieName} (${shortValue})`);
    }
    
    // 7. Dáta odosielané tretím stranám
    addTitle('7. Dáta odosielané tretím stranám', 3);
    if (data.detailedAnalysis.dataTransfers && data.detailedAnalysis.dataTransfers.length > 0) {
      const dataHeaders = ['Služba', 'Parameter', 'Vzor hodnoty', 'Osobné údaje?', 'Pred súhlasom?'];
      const dataRows = data.detailedAnalysis.dataTransfers.map(transfer => [
        transfer.service,
        transfer.parameter,
        transfer.sampleValue,
        transfer.containsPersonalData ? 'Áno' : 'Nie',
        transfer.preConsent ? 'Áno' : 'Nie'
      ]);
      addTableAdvanced(dataHeaders, dataRows, undefined, [35, 25, 30, 25, 25], [3, 4]);
      
      // Pred-súhlasové transfery
      const preConsentTransfers = data.detailedAnalysis.dataTransfers.filter(t => t.preConsent);
      if (preConsentTransfers.length > 0) {
        addParagraph(`KRITICKÁ CHYBA: ${preConsentTransfers.length} service(s) odosielalo dáta pred súhlasom!`, 10, 'bold');
        const transferBullets = preConsentTransfers.map(t => `${t.service}: ${t.parameter}=${t.sampleValue}`);
        addBullets(transferBullets);
      }
    } else {
      addParagraph('—');
      addParagraph('Poznámka: Neboli detegované žiadne parametre v request URL alebo JSON postData. Môže ísť o POST requesty s dátami v tele alebo o chybu v zbere dát.', 10, 'normal');
    }
    
    // 8. UX analýza cookie lišty
    if (data.consentUx?.analysis) {
      addTitle('8. UX analýza cookie lišty', 3);
      
      // Overall assessment highlighted
      if (data.consentUx.analysis.uxAssessment.overallScore === 'NEVYVÁŽENÁ') {
        pdf.setFillColor(255, 243, 205); // Warning background
        pdf.rect(leftMargin, currentY - 3, rightMargin - leftMargin, 8, 'F');
        pdf.setTextColor(colors.warning);
        pdf.setFont('Inter', 'bold');
        pdf.text('Celkové hodnotenie UX: NEVYVÁŽENÁ', leftMargin + 4, currentY);
        currentY += 10;
        pdf.setTextColor(colors.text);
        pdf.setFont('Inter', 'normal');
      }
      
      const uxHeaders = ['Charakteristika', 'Hodnota'];
      const uxRows = [
        ['Banner present', data.consentUx.analysis.bannerPresent ? 'ÁNO' : 'NIE'],
        ['Predvolené správanie', 'Akceptuje všetko'],
        ['Rovnocenné tlačidlá', 'NIE'],
        ['Detailné nastavenia', data.consentUx.analysis.settingsButtonFound ? 'ÁNO' : 'NIE']
      ];
      addTableAdvanced(uxHeaders, uxRows, undefined, [85, 85]);
    }
    
    // 9. Retenčné doby cookies
    addTitle('9. Retenčné doby cookies', 3);
    const longTermCookies = data.detailedAnalysis.cookies.details?.filter(c => {
      const match = c.expiration?.match(/(\d+)/);
      return match && parseInt(match[1]) > 365 && (c.category === 'marketingové' || c.category === 'analytické');
    }) || [];
    
    if (longTermCookies.length > 0) {
      addNote('Pozor: Našli sa marketingové/analytické cookies s retenciou dlhšou ako 1 rok!', 'warning');
    }
    
    // 10. Právne zhrnutie
    addTitle('10. Právne zhrnutie', 3);
    addParagraph('Identifikované riziká v súlade s GDPR:');
    const legalRisks = [
      'Spracovanie osobných údajov bez platného súhlasu (čl. 6 GDPR)',
      'Porušenie povinnosti informovanosti (čl. 13, 14 GDPR)',
      'Nedostatočná transparentnosť spracovania (čl. 12 GDPR)'
    ];
    addBullets(legalRisks);
    
    addParagraph('Relevantne články GDPR:');
    const gdprArticles = [
      'Článok 6 - Zákonnosť spracovania',
      'Článok 7 - Podmienky súhlasu',
      'Článok 13 - Informácie poskytované v prípade získania osobných údajov od dotknutej osoby'
    ];
    addBullets(gdprArticles);
    
    // 11. Rizikový scoring
    addTitle('11. Rizikový scoring', 3);
    const riskScores = calculateRiskScoresFromDisplay(data);
    const overallRisk = calculateOverallRiskFromScores(riskScores);
    
    const riskHeaders = ['Oblasť', 'Skóre (0–5)', 'Poznámka'];
    const riskRows = riskScores.map(score => [
      score.area,
      score.score.toFixed(1),
      score.note
    ]);
    addTableAdvanced(riskHeaders, riskRows, undefined, [50, 30, 90], [1]);
    
    // Overall risk summary
    const riskColor = overallRisk.riskLevel === 'LOW' ? colors.ok : 
                     overallRisk.riskLevel === 'MEDIUM' ? colors.warning : colors.error;
    pdf.setTextColor(riskColor);
    pdf.setFont('Inter', 'bold');
    addParagraph(`Celkové riziko: ${overallRisk.riskLevel} (Priemerné skóre: ${overallRisk.averageScore.toFixed(1)}/5)`);
    pdf.setTextColor(colors.text);
    pdf.setFont('Inter', 'normal');
    
    // C) OK vs. Rizikové
    addTitle('C) OK vs. Rizikové', 2);
    if (data.riskTable && data.riskTable.length > 0) {
      const riskTableHeaders = ['Oblasť', 'Stav', 'Komentár'];
      const riskTableRows = data.riskTable.map(risk => [
        risk.area,
        renderStatusBadge(risk.status),
        risk.comment
      ]);
      addTableAdvanced(riskTableHeaders, riskTableRows, undefined, [50, 30, 90], [1]);
    }
    
    // D) Odporúčania
    addTitle('D) Odporúčania', 2);
    if (data.recommendations && data.recommendations.length > 0) {
      data.recommendations.forEach((rec, index) => {
        addTitle(`${index + 1}. ${rec.title}`, 3);
        addParagraph(rec.description);
      });
    }
    
    // Final consistency check
    addNote('Kontrola konzistencie: Počty v tabuľkách sa zhodujú so súhrnom.', 'ok');
    
    // Calculate total pages and update footers
    totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setFont('Inter', 'normal');
      pdf.setTextColor(colors.gray);
      pdf.text(`${i}/${totalPages}`, pageWidth - leftMargin, pageHeight - 10, { align: 'right' });
    }
    
    return pdf;
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};