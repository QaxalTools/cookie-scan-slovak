// OCR analysis utility for consent banner text recognition and UX evaluation

import { createWorker, Worker } from 'tesseract.js';

export interface OCRResult {
  success: boolean;
  text?: string;
  confidence?: number;
  analysis?: ConsentAnalysis;
  error?: string;
}

export interface ConsentAnalysis {
  hasConsentBanner: boolean;
  buttons: {
    accept: string[];
    reject: string[];
    settings: string[];
  };
  evaluation: {
    hasBalancedButtons: boolean;
    hasDetailedSettings: boolean;
    uxAssessment: 'transparent' | 'unbalanced' | 'missing';
  };
}

// Button text patterns for Slovak, Czech, and English
const BUTTON_PATTERNS = {
  accept: [
    // Slovak
    'prijať', 'prijať všetko', 'súhlasím', 'povoliť všetko', 'akceptovať', 'súhlas',
    // Czech  
    'přijmout', 'přijmout vše', 'souhlasím', 'povolit vše', 'akceptovat', 'souhlas',
    // English
    'accept', 'accept all', 'agree', 'allow all', 'ok', 'consent', 'enable all'
  ],
  reject: [
    // Slovak
    'odmietnuť', 'zamietnuť', 'iba nevyhnutné', 'len nevyhnutné', 'nesúhlasím', 'odmietnuť všetko',
    // Czech
    'odmítnout', 'zamítnout', 'pouze nezbytné', 'jen nezbytné', 'nesouhlasím', 'odmítnout vše', 
    // English
    'reject', 'decline', 'necessary only', 'essential only', 'disagree', 'reject all'
  ],
  settings: [
    // Slovak
    'nastavenia', 'prispôsobiť', 'upraviť', 'spravovať', 'preferencie', 'možnosti',
    // Czech
    'nastavení', 'přizpůsobit', 'upravit', 'spravovat', 'preference', 'možnosti',
    // English
    'settings', 'customize', 'manage', 'preferences', 'options', 'configure'
  ]
};

export class ConsentOCR {
  private worker: Worker | null = null;

  async initialize(): Promise<void> {
    if (this.worker) return;

    try {
      this.worker = await createWorker(['slk', 'ces', 'eng'], 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log(`OCR Progress: ${(m.progress * 100).toFixed(1)}%`);
          }
        }
      });
    } catch (error) {
      console.error('Failed to initialize OCR worker:', error);
      throw new Error('OCR initialization failed');
    }
  }

  async analyzeConsentBanner(imageData: string): Promise<OCRResult> {
    try {
      await this.initialize();
      
      if (!this.worker) {
        throw new Error('OCR worker not initialized');
      }

      // Perform OCR on the image
      const { data } = await this.worker.recognize(imageData);
      
      if (!data.text || data.confidence < 30) {
        return {
          success: false,
          error: 'OCR confidence too low or no text detected'
        };
      }

      // Analyze the extracted text
      const analysis = this.analyzeText(data.text);

      return {
        success: true,
        text: data.text,
        confidence: data.confidence,
        analysis
      };

    } catch (error) {
      console.error('OCR analysis failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown OCR error'
      };
    }
  }

  private analyzeText(text: string): ConsentAnalysis {
    const normalizedText = text.toLowerCase();
    
    // Find button types
    const foundButtons = {
      accept: this.findButtons(normalizedText, BUTTON_PATTERNS.accept),
      reject: this.findButtons(normalizedText, BUTTON_PATTERNS.reject),
      settings: this.findButtons(normalizedText, BUTTON_PATTERNS.settings)
    };

    // Evaluate UX characteristics
    const hasAcceptButton = foundButtons.accept.length > 0;
    const hasRejectButton = foundButtons.reject.length > 0;
    const hasSettingsButton = foundButtons.settings.length > 0;
    
    const hasBalancedButtons = hasAcceptButton && hasRejectButton;
    const hasConsentBanner = hasAcceptButton || hasRejectButton || hasSettingsButton ||
                            this.containsConsentKeywords(normalizedText);

    let uxAssessment: 'transparent' | 'unbalanced' | 'missing' = 'missing';
    if (hasConsentBanner) {
      uxAssessment = hasBalancedButtons ? 'transparent' : 'unbalanced';
    }

    return {
      hasConsentBanner,
      buttons: foundButtons,
      evaluation: {
        hasBalancedButtons,
        hasDetailedSettings: hasSettingsButton,
        uxAssessment
      }
    };
  }

  private findButtons(text: string, patterns: string[]): string[] {
    const found: string[] = [];
    
    for (const pattern of patterns) {
      if (text.includes(pattern)) {
        found.push(pattern);
      }
    }
    
    return [...new Set(found)]; // Remove duplicates
  }

  private containsConsentKeywords(text: string): boolean {
    const consentKeywords = [
      'cookie', 'súhlas', 'souhlas', 'consent', 'gdpr', 'ochrana údajov', 
      'ochrana dat', 'privacy', 'súkromie', 'soukromí', 'sledovanie', 
      'sledování', 'tracking', 'analytics', 'analytika'
    ];
    
    return consentKeywords.some(keyword => text.includes(keyword));
  }

  async cleanup(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

// Singleton instance for app-wide use
let ocrInstance: ConsentOCR | null = null;

export function getConsentOCR(): ConsentOCR {
  if (!ocrInstance) {
    ocrInstance = new ConsentOCR();
  }
  return ocrInstance;
}

// Helper function for easy analysis
export async function analyzeConsentScreenshot(imageData: string): Promise<OCRResult> {
  const ocr = getConsentOCR();
  return await ocr.analyzeConsentBanner(imageData);
}