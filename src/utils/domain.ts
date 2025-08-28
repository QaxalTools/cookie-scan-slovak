// Domain utilities using tldts for proper eTLD+1 parsing
import { getDomain as getTldtsDomain } from 'tldts';

/**
 * Extract eTLD+1 (effective top-level domain + 1) from hostname
 * Examples:
 * - "www.example.com" → "example.com"
 * - "sub.example.co.uk" → "example.co.uk"
 * - "localhost" → "localhost"
 */
export function getETldPlusOne(host: string): string {
  const cleanHost = host.toLowerCase().replace(/^www\./, '');
  const domain = getTldtsDomain(cleanHost);
  return domain || cleanHost;
}

/**
 * Check if two hosts belong to the same first party (same eTLD+1)
 */
export function isFirstParty(hostA: string, hostB: string): boolean {
  return getETldPlusOne(hostA) === getETldPlusOne(hostB);
}

/**
 * Extract hostname from URL and normalize it
 */
export function getHostFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
}

/**
 * Normalize domain (remove leading dot, lowercase)
 */
export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^\./, '');
}