import { jsPDF } from 'jspdf';
import { AuditData } from '@/types/audit';

export const generatePDFReport = (data: AuditData): jsPDF => {
  const pdf = new jsPDF('p', 'mm', 'a4');
  let currentY = 20;
  const leftMargin = 20;
  const rightMargin = 190;
  const lineHeight = 7;
  
  // Helper functions
  const addPageIfNeeded = (neededSpace: number) => {
    if (currentY + neededSpace > 280) {
      pdf.addPage();
      currentY = 20;
      return true;
    }
    return false;
  };

  const addText = (text: string, fontSize: number = 12, style: 'normal' | 'bold' = 'normal', color: string = '#000000') => {
    pdf.setFontSize(fontSize);
    pdf.setFont('helvetica', style);
    pdf.setTextColor(color);
    
    const lines = pdf.splitTextToSize(text, rightMargin - leftMargin);
    const neededSpace = lines.length * lineHeight;
    
    addPageIfNeeded(neededSpace);
    
    lines.forEach((line: string) => {
      pdf.text(line, leftMargin, currentY);
      currentY += lineHeight;
    });
    
    currentY += 3; // Extra spacing after text block
  };

  const addTitle = (text: string, level: number = 1) => {
    const fontSize = level === 1 ? 18 : level === 2 ? 16 : 14;
    const spacing = level === 1 ? 10 : 7;
    
    currentY += spacing;
    addText(text, fontSize, 'bold');
    currentY += spacing / 2;
  };

  const addTable = (headers: string[], rows: string[][]) => {
    const colWidth = (rightMargin - leftMargin) / headers.length;
    
    // Check if table fits on page
    const tableHeight = (rows.length + 1) * 8;
    addPageIfNeeded(tableHeight);
    
    // Draw headers
    pdf.setFillColor(240, 240, 240);
    pdf.rect(leftMargin, currentY - 5, rightMargin - leftMargin, 8, 'F');
    
    headers.forEach((header, i) => {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
      pdf.text(header, leftMargin + (i * colWidth) + 2, currentY);
    });
    currentY += 8;
    
    // Draw rows
    rows.forEach((row, rowIndex) => {
      if (rowIndex % 2 === 0) {
        pdf.setFillColor(250, 250, 250);
        pdf.rect(leftMargin, currentY - 5, rightMargin - leftMargin, 8, 'F');
      }
      
      row.forEach((cell, i) => {
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        const cellText = cell.length > 40 ? cell.substring(0, 37) + '...' : cell;
        pdf.text(cellText, leftMargin + (i * colWidth) + 2, currentY);
      });
      currentY += 8;
    });
    
    currentY += 5;
  };

  // Generate PDF content
  try {
    // Header
    addTitle('GDPR Cookie Audit Report', 1);
    addText(`Dátum: ${new Date().toLocaleDateString('sk-SK')}`);
    addText(`Analyzovaná URL: ${data.url}`);
    
    // A) Management Summary
    addTitle('A) Manažérsky sumár', 2);
    addText(`Verdikt: ${data.managementSummary.verdict}`, 12, 'bold');
    addText(`Celkové hodnotenie: ${data.managementSummary.overall}`);
    addText(`Riziká: ${data.managementSummary.risks}`);
    
    if (data.managementSummary.data_source) {
      addText(`Zdroj dát: ${data.managementSummary.data_source}`);
    }

    // B) Detailed Analysis
    addTitle('B) Detailná analýza', 2);
    
    // 1. HTTPS
    addTitle('1. HTTPS zabezpečenie', 3);
    addText(`Status: ${data.detailedAnalysis.https.status}`);
    addText(`Komentár: ${data.detailedAnalysis.https.comment}`);
    
    // 2. Third Parties
    addTitle('2. Tretie strany', 3);
    addText(`Celkový počet: ${data.detailedAnalysis.thirdParties.total}`);
    
    if (data.detailedAnalysis.thirdParties.list.length > 0) {
      const thirdPartyHeaders = ['Doména', 'Počet požiadaviek'];
      const thirdPartyRows = data.detailedAnalysis.thirdParties.list.map(party => [
        party.domain,
        party.requests.toString()
      ]);
      addTable(thirdPartyHeaders, thirdPartyRows);
    }
    
    // 3. Trackers
    addTitle('3. Trackery a web-beacony', 3);
    if (data.detailedAnalysis.trackers.length > 0) {
      const trackerHeaders = ['Služba', 'Host', 'Pred súhlasom', 'Status'];
      const trackerRows = data.detailedAnalysis.trackers.map(tracker => [
        tracker.service,
        tracker.host,
        tracker.spamsBeforeConsent ? 'ÁNO' : 'NIE',
        tracker.status
      ]);
      addTable(trackerHeaders, trackerRows);
    } else {
      addText('Žiadne trackery neboli detegované.');
    }
    
    // 4. Cookies
    addTitle('4. Cookies', 3);
    addText(`Celkový počet: ${data.detailedAnalysis.cookies.total}`);
    addText(`First-party: ${data.detailedAnalysis.cookies.firstParty}`);
    addText(`Third-party: ${data.detailedAnalysis.cookies.thirdParty}`);
    
    if (data.detailedAnalysis.cookies.details && data.detailedAnalysis.cookies.details.length > 0) {
      const cookieHeaders = ['Názov', 'Typ', 'Kategória', 'Expirácia'];
      const cookieRows = data.detailedAnalysis.cookies.details.slice(0, 20).map(cookie => [
        cookie.name,
        cookie.type,
        cookie.category,
        cookie.expiration || 'N/A'
      ]);
      addTable(cookieHeaders, cookieRows);
      
      if (data.detailedAnalysis.cookies.details.length > 20) {
        addText(`... a ďalších ${data.detailedAnalysis.cookies.details.length - 20} cookies`);
      }
    }
    
    // 5. Storage
    if (data.detailedAnalysis.storage && data.detailedAnalysis.storage.length > 0) {
      addTitle('5. Local/Session Storage', 3);
      const storageHeaders = ['Kľúč', 'Typ', 'Pred súhlasom'];
      const storageRows = data.detailedAnalysis.storage.slice(0, 15).map(item => [
        item.key,
        item.type,
        item.createdPreConsent ? 'ÁNO' : 'NIE'
      ]);
      addTable(storageHeaders, storageRows);
    }
    
    // 6. Consent Management
    addTitle('6. Consent Management', 3);
    addText(`Consent tool: ${data.detailedAnalysis.consentManagement.hasConsentTool ? 'ÁNO' : 'NIE'}`);
    addText(`Trackery pred súhlasom: ${data.detailedAnalysis.consentManagement.trackersBeforeConsent}`);
    addText(`Cookie meno: ${data.detailedAnalysis.consentManagement.consentCookieName}`);
    
    // C) Risk Table
    if (data.riskTable && data.riskTable.length > 0) {
      addTitle('C) Tabuľka rizík', 2);
      const riskHeaders = ['Oblasť', 'Status', 'Komentár'];
      const riskRows = data.riskTable.map(risk => [
        risk.area,
        risk.status,
        risk.comment
      ]);
      addTable(riskHeaders, riskRows);
    }
    
    // D) Recommendations
    if (data.recommendations && data.recommendations.length > 0) {
      addTitle('D) Odporúčania', 2);
      data.recommendations.forEach((rec, index) => {
        addText(`${index + 1}. ${rec.title}: ${rec.description}`, 11);
      });
    }
    
    return pdf;
    
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};