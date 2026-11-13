/**
 * What every crawler stops on: a 403, a 429 or a bot challenge. Such an answer is never retried
 * or worked around; the crawl stops and writes nothing. Shared by the NISRA publications crawler
 * and the CKAN catalogue harvest (packages/intake/src/ckan-harvest.mjs).
 */

/** A response the crawl must stop on: refused, rate-limited or challenged. */
export class CrawlRefused extends Error {
  /** @param {string} message @param {number} status @param {string} url */
  constructor(message, status, url) {
    super(message);
    this.name = 'CrawlRefused';
    this.status = status;
    this.url = url;
  }
}

const CHALLENGE_RE = /cf-chl|challenge-platform|g-recaptcha|h-captcha|hcaptcha|<title>\s*(?:just a moment|attention required)/i;

/** A bot challenge or CAPTCHA page. @param {string} body */
export function looksLikeChallenge(body) {
  return CHALLENGE_RE.test(body);
}

/** The HTTP statuses a crawl stops on at once. @param {number} status */
export function isRefusal(status) {
  return status === 403 || status === 429;
}
