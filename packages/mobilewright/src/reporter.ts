/**
 * Custom HTML reporter that wraps Playwright's built-in HTML reporter
 * and post-processes the output to rebrand it as Mobilewright.
 *
 * - Replaces "Playwright Test Report" with "Mobilewright"
 * - Adds mobilewright favicon
 * - Adds header link to the GitHub repo
 * - Adds click-to-fullscreen for screenshot thumbnails
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const GITHUB_REPO_URL = 'https://github.com/mobile-next/mobilewright';

function getFaviconDataUrl(): string {
  const iconPath = resolve(__dirname, '..', 'assets', 'mobilewright-icon.png');
  const iconData = readFileSync(iconPath);
  return `data:image/png;base64,${iconData.toString('base64')}`;
}

/**
 * Post-processes a Playwright HTML report to apply Mobilewright branding.
 */
export function brandReport(reportPath: string): void {
  const indexPath = resolve(reportPath, 'index.html');
  let html = readFileSync(indexPath, 'utf-8');

  const faviconDataUrl = getFaviconDataUrl();

  html = html.replaceAll("Playwright", "Mobilewright");
  html = html.replaceAll("playwright", "mobilewright");

  // Add favicon link and custom styles/scripts in <head>
  const headInjection = `
    <link rel="icon" type="image/png" href="${faviconDataUrl}">
    <style>
      /* Mobilewright branding header */
      .mobilewright-brand {
        display: flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        color: inherit;
      }
      .mobilewright-brand:hover {
        opacity: 0.8;
      }
      .mobilewright-brand img {
        height: 24px;
        width: auto;
      }
      .mobilewright-brand span {
        font-weight: 600;
        font-size: 14px;
      }

      /* Screenshot thumbnails */
      .screenshot {
        max-width: 250px !important;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .screenshot:hover {
        opacity: 0.85;
      }

      /* Fullscreen overlay */
      .mw-fullscreen-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        cursor: pointer;
      }
      .mw-fullscreen-overlay img {
        max-width: 95vw;
        max-height: 95vh;
        object-fit: contain;
        border-radius: 4px;
        box-shadow: 0 4px 32px rgba(0, 0, 0, 0.5);
      }
    </style>
  `;
  html = html.replace('</head>', headInjection + '\n  </head>');

  // Add script for branding injection and screenshot fullscreen
  const bodyScript = `
    <script>
    (function() {
      var REPO_URL = '${GITHUB_REPO_URL}';
      var FAVICON_URL = '${faviconDataUrl}';

      // Inject mobilewright brand into header
      function injectBrand() {
        var superHeader = document.querySelector('.header-superheader');
        if (!superHeader) return false;
        if (superHeader.querySelector('.mobilewright-brand')) return true;

        var link = document.createElement('a');
        link.href = REPO_URL;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'mobilewright-brand';

        var img = document.createElement('img');
        img.src = FAVICON_URL;
        img.alt = 'Mobilewright';
        link.appendChild(img);

        var span = document.createElement('span');
        span.textContent = 'Mobilewright';
        link.appendChild(span);

        superHeader.prepend(link);
        return true;
      }

      // Fullscreen overlay for screenshots
      function setupScreenshotFullscreen() {
        document.addEventListener('click', function(e) {
          var target = e.target;
          if (target.tagName !== 'IMG' || !target.classList.contains('screenshot')) return;

          e.preventDefault();
          e.stopPropagation();

          var overlay = document.createElement('div');
          overlay.className = 'mw-fullscreen-overlay';

          var fullImg = document.createElement('img');
          fullImg.src = target.src;
          fullImg.alt = target.alt || 'Screenshot';
          overlay.appendChild(fullImg);

          overlay.addEventListener('click', function() {
            overlay.remove();
          });

          document.addEventListener('keydown', function handler(ke) {
            if (ke.key === 'Escape') {
              overlay.remove();
              document.removeEventListener('keydown', handler);
            }
          });

          document.body.appendChild(overlay);
        }, true);
      }

      // Observe DOM for SPA navigation
      var observer = new MutationObserver(function() { injectBrand(); });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

      // Initial setup
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          injectBrand();
          setupScreenshotFullscreen();
        });
      } else {
        injectBrand();
        setupScreenshotFullscreen();
      }
    })();
    </script>
  `;

  html = html.replace('</body>', bodyScript + '\n  </body>');
  writeFileSync(indexPath, html, 'utf-8');
}
