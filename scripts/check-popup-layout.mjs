#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

const extensionRoot = path.resolve('.output/chrome-mv3');
const width = Number.parseInt(process.env.POPUP_WIDTH || '780', 10);
const height = Number.parseInt(process.env.POPUP_HEIGHT || '720', 10);
const screenshotPath = process.env.POPUP_LAYOUT_SCREENSHOT || path.join(tmpdir(), 'aegis-popup-unlocked.png');
const chromeBinary =
  process.env.CHROME_BIN ||
  (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : 'google-chrome');

const fixture = {
  version: 1,
  db: {
    groups: [
      { uuid: 'grp-work', name: 'Work' },
      { uuid: 'grp-personal', name: 'Personal' },
      { uuid: 'grp-finance', name: 'Finance' }
    ],
    entries: [
      {
        type: 'totp',
        issuer: 'GitHub',
        name: 'alice@example.com',
        note: 'Primary account with a deliberately long note to exercise the selected card layout.',
        favorite: true,
        groups: ['grp-work'],
        info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 }
      },
      {
        type: 'totp',
        issuer: 'Email',
        name: 'alice@example.com',
        note: 'Backup mailbox.',
        groups: ['grp-personal'],
        info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 }
      },
      {
        type: 'totp',
        issuer: 'Bank',
        name: 'checking',
        note: 'Finance login.',
        groups: ['grp-finance'],
        info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 }
      },
      {
        type: 'totp',
        issuer: 'Cloud',
        name: 'ops',
        groups: ['grp-work'],
        info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 }
      },
      {
        type: 'totp',
        issuer: 'Shop',
        name: 'buyer',
        groups: ['grp-personal'],
        info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 }
      },
      {
        type: 'totp',
        issuer: 'VPN',
        name: 'device',
        groups: ['grp-work'],
        info: { secret: 'JBSWY3DPEHPK3PXP', algo: 'SHA1', digits: 6, period: 30 }
      }
    ]
  }
};

if (!existsSync(path.join(extensionRoot, 'popup.html'))) {
  throw new Error('Missing .output/chrome-mv3/popup.html. Run npm run build:chrome first.');
}

if (!Number.isFinite(width) || !Number.isFinite(height)) {
  throw new Error('POPUP_WIDTH and POPUP_HEIGHT must be numbers.');
}

const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json'
};

function serveExtension() {
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.resolve(extensionRoot, `.${urlPath === '/' ? '/popup.html' : urlPath}`);

    if (!file.startsWith(extensionRoot)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    try {
      const stat = statSync(file);
      if (stat.isDirectory()) {
        file = path.join(file, 'popup.html');
      }
      res.writeHead(200, { 'content-type': contentTypes[path.extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to start local popup server.');
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/popup.html` });
    });
  });
}

function waitForDevToolsUrl(chrome) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Chrome DevTools endpoint.')), 15000);

    chrome.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });

    chrome.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before DevTools was ready, code ${code}.`));
    });
  });
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error('Failed to connect to Chrome DevTools.')), { once: true });
  });
}

function createCdp(ws) {
  let id = 0;
  const pending = new Map();
  const waiters = [];

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(`${message.error.message}: ${message.error.data || ''}`));
      } else {
        resolve(message.result || {});
      }
      return;
    }

    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.method === message.method && (!waiter.sessionId || waiter.sessionId === message.sessionId)) {
        waiters.splice(index, 1);
        waiter.resolve(message.params || {});
      }
    }
  });

  function send(method, params = {}, sessionId) {
    id += 1;
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  function waitForEvent(method, sessionId, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) {
          waiters.splice(index, 1);
          reject(new Error(`Timed out waiting for ${method}.`));
        }
      }, timeoutMs);
    });
  }

  return { send, waitForEvent };
}

async function waitFor(condition, label, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function assertLayout(layout) {
  const failures = [];

  if (layout.cardCount < fixture.db.entries.length) {
    failures.push(`expected ${fixture.db.entries.length} cards, got ${layout.cardCount}`);
  }
  if (!layout.codeText || layout.codeText.includes('·') || layout.codeText.includes('点按')) {
    failures.push(`selected code was not generated: "${layout.codeText}"`);
  }
  if (!layout.selectedInGrid) {
    failures.push('selected card is not fully visible inside the grid viewport');
  }
  if (!layout.codeInViewport) {
    failures.push('selected code is outside the visible viewport');
  }
  if (!layout.codeInSelected) {
    failures.push('selected code is clipped by its card');
  }
  if (!layout.codelineInSelected) {
    failures.push('selected code row is clipped by its card');
  }
  if (layout.gridClientHeight < 320) {
    failures.push(`grid is too short: ${layout.gridClientHeight}px`);
  }
  if (layout.selectedHeight < 150) {
    failures.push(`selected card is too short: ${layout.selectedHeight}px`);
  }
  if (layout.bodyOverflowX || layout.bodyOverflowY) {
    failures.push(`body has viewport overflow: x=${layout.bodyOverflowX}, y=${layout.bodyOverflowY}`);
  }

  if (failures.length) {
    throw new Error(`Popup layout check failed:\n- ${failures.join('\n- ')}`);
  }
}

async function main() {
  const { server, url } = await serveExtension();
  const profileDir = path.join(tmpdir(), `aegis-popup-check-${process.pid}`);
  mkdirSync(profileDir, { recursive: true });

  const chrome = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profileDir}`,
    '--remote-debugging-port=0',
    `--window-size=${width},${height}`,
    'about:blank'
  ]);

  try {
    const browserWs = await waitForDevToolsUrl(chrome);
    const ws = await connect(browserWs);
    const cdp = createCdp(ws);
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    }, sessionId);
    const loaded = cdp.waitForEvent('Page.loadEventFired', sessionId);
    await cdp.send('Page.navigate', { url }, sessionId);
    await loaded;

    async function evaluate(expression, awaitPromise = false) {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true
      }, sessionId);

      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
      }
      return result.result?.value;
    }

    await waitFor(() => evaluate('Boolean(document.querySelector("#paste") && document.querySelector("#unlock"))'), 'popup form');

    await evaluate(`(async () => {
      const paste = document.querySelector('#paste');
      paste.value = ${JSON.stringify(JSON.stringify(fixture))};
      paste.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#unlock').click();
      await new Promise((resolve) => setTimeout(resolve, 800));
    })()`, true);

    await waitFor(
      () => evaluate(`(() => {
        const text = document.querySelector('.card.selected .code')?.textContent?.trim() || '';
        return Boolean(text && !text.includes('·') && !text.includes('点按'));
      })()`),
      'generated selected TOTP code'
    );

    const layout = await evaluate(`(() => {
      const rect = (element) => {
        const value = element.getBoundingClientRect();
        return {
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          left: value.left,
          width: value.width,
          height: value.height
        };
      };
      const grid = document.querySelector('#grid');
      const selected = document.querySelector('.card.selected');
      const code = document.querySelector('.card.selected .code');
      const codeline = document.querySelector('.card.selected .codeline');
      const gridRect = rect(grid);
      const selectedRect = rect(selected);
      const codeRect = rect(code);
      const codelineRect = rect(codeline);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1,
        bodyOverflowY: document.documentElement.scrollHeight > window.innerHeight + 1 || document.body.scrollHeight > window.innerHeight + 1,
        cardCount: document.querySelectorAll('.card').length,
        codeText: code.textContent.trim(),
        gridClientHeight: grid.clientHeight,
        gridScrollHeight: grid.scrollHeight,
        selectedHeight: selectedRect.height,
        selectedInGrid: selectedRect.top >= gridRect.top - 1 && selectedRect.bottom <= gridRect.bottom + 1,
        codeInViewport: codeRect.top >= 0 && codeRect.bottom <= window.innerHeight && codeRect.left >= 0 && codeRect.right <= window.innerWidth,
        codeInSelected: codeRect.top >= selectedRect.top && codeRect.bottom <= selectedRect.bottom,
        codelineInSelected: codelineRect.top >= selectedRect.top && codelineRect.bottom <= selectedRect.bottom,
        selectedRect,
        codeRect,
        gridRect
      };
    })()`);

    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    assertLayout(layout);

    console.log(JSON.stringify({ ok: true, screenshotPath, layout }, null, 2));
    ws.close();
  } finally {
    server.close();
    chrome.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
