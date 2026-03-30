/**
 * Browser Tool - Playwright with CDP fallback
 * Fixes: Proper timeouts, real error handling, no browser globals in server code
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

let playwright = null;
let browser = null;
let page = null;

async function ensurePlaywright() {
  if (playwright) return playwright;
  
  try {
    playwright = await import('playwright');
    return playwright;
  } catch (e) {
    console.warn('[Browser] Playwright not available, falling back to curl');
    return null;
  }
}

async function launchBrowser(config) {
  if (browser) return browser;
  
  const pw = await ensurePlaywright();
  if (!pw) {
    throw new Error('Playwright not available and curl fallback not implemented for complex ops');
  }

  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
    return browser;
  } catch (e) {
    console.error('[Browser] Failed to launch:', e.message);
    throw e;
  }
}

export const BrowserTool = {
  async navigate(args, config) {
    const { url, timeout = 10000 } = args;
    
    if (!url) {
      throw new Error('URL required for browser_navigate');
    }

    try {
      const bw = await launchBrowser(config);
      page = await bw.newPage();
      
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout
      });

      const title = await page.title();
      return { success: true, url, title, timestamp: Date.now() };
    } catch (e) {
      console.error('[Browser] Navigate failed:', e.message);
      
      // Curl fallback for simple fetch
      if (e.message.includes('timeout') || e.message.includes('navigation')) {
        const { execSync } = await import('node:child_process');
        try {
          const output = execSync(`curl -sL --max-time 5 "${url}"`, { encoding: 'utf-8' });
          return { success: true, url, title: 'Fetched via curl', content: output.slice(0, 5000), fallback: true };
        } catch (curlError) {
          throw new Error(`Navigate failed and curl fallback also failed: ${curlError.message}`);
        }
      }
      throw e;
    }
  },

  async screenshot(args, config) {
    if (!page) {
      throw new Error('No page loaded. Call browser_navigate first');
    }

    try {
      const buffer = await page.screenshot({ type: 'png', fullPage: false });
      return {
        success: true,
        screenshot: buffer.toString('base64'),
        mimeType: 'image/png',
        timestamp: Date.now()
      };
    } catch (e) {
      console.error('[Browser] Screenshot failed:', e.message);
      throw e;
    }
  },

  async getLinks(args, config) {
    if (!page) {
      throw new Error('No page loaded. Call browser_navigate first');
    }

    try {
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => ({
            text: a.textContent.trim().slice(0, 100),
            href: a.href
          }))
          .filter(l => l.href && l.href.startsWith('http'));
      });

      return { success: true, count: links.length, links };
    } catch (e) {
      console.error('[Browser] GetLinks failed:', e.message);
      throw e;
    }
  },

  async close(args, config) {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
      return { success: true, message: 'Browser closed' };
    }
    return { success: true, message: 'Browser already closed' };
  }
};

// Cleanup on process exit
process.on('exit', async () => {
  if (browser) {
    await browser.close();
  }
});
