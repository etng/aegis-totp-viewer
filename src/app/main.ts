import { decryptVault } from '../aegis/crypto';
import { normalizeEntries, type AegisDb, type AegisExport, type VaultEntry } from '../aegis/model';
import { generateCode, groupCode } from '../aegis/otp';

export interface AppConfig {
  variant: 'web' | 'extension';
}

interface AppLinks {
  repoUrl: string;
  releasesUrl: string;
  webUrl: string;
}

interface CardState {
  active: boolean;
  entry: VaultEntry;
  period: number;
  el: HTMLElement;
  codeEl: HTMLElement;
  progressEl: HTMLElement;
  secondsEl: HTMLElement | null;
  hintEl: HTMLElement;
  lastCounter: number | 'hotp' | null;
  raw: string;
}

function getEnvValue(name: string): string | undefined {
  const value = import.meta.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function deriveGithubPagesRepoUrl(): string | undefined {
  if (!globalThis.location?.hostname.endsWith('github.io')) {
    return undefined;
  }

  const owner = globalThis.location.hostname.replace(/\.github\.io$/, '');
  const repo = globalThis.location.pathname.split('/').filter(Boolean)[0];
  if (!owner || !repo) {
    return undefined;
  }

  return `https://github.com/${owner}/${repo}`;
}

function getLinks(config: AppConfig): AppLinks {
  const repoUrl =
    getEnvValue('VITE_REPOSITORY_URL') ||
    deriveGithubPagesRepoUrl() ||
    'https://github.com/etng/aegis-totp-viewer';
  const releasesUrl = getEnvValue('VITE_RELEASES_URL') || `${repoUrl.replace(/\/$/, '')}/releases`;
  const webUrl =
    getEnvValue('VITE_WEB_URL') ||
    (config.variant === 'web' ? globalThis.location?.href || repoUrl : repoUrl);

  return {
    repoUrl,
    releasesUrl,
    webUrl
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }[char] as string;
  });
}

function renderEntryTags(entry: VaultEntry): string {
  const tags = [
    ...entry.groupNames.map((group) => `<span class="chip">${escapeHtml(group)}</span>`),
    ...(entry.favorite ? ['<span class="chip">常用</span>'] : [])
  ];

  if (tags.length === 0) {
    return '';
  }

  return `<div class="entry-tags">${tags.join('')}</div>`;
}

function renderEntryNote(entry: VaultEntry): string {
  if (!entry.displayNote) {
    return '';
  }

  return `<div class="note">${escapeHtml(entry.displayNote)}</div>`;
}

function palette(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 55% 62%)`;
}

function appTemplate(config: AppConfig, links: AppLinks): string {
  const isExtension = config.variant === 'extension';
  const primaryHref = isExtension ? links.webUrl : links.releasesUrl;
  const primaryLabel = isExtension ? '打开在线版' : '下载浏览器插件';
  const secondaryHref = links.repoUrl;
  const secondaryLabel = '给项目点 Star';
  const ctaText = isExtension
    ? '也可以把在线版加入书签；如果这个工具帮到了你，欢迎给项目点 Star。'
    : '经常使用的话，安装浏览器插件会更顺手；如果这个工具帮到了你，欢迎给项目点 Star。';

  return `
    <div class="wrap">
      <header class="top">
        <div class="brand">
          <div class="glyph">▲</div>
          <div>
            <h1>Vault</h1>
            <div class="sub">aegis · totp · offline</div>
          </div>
        </div>
        <div class="status"><span class="dot" id="statusDot"></span><span id="statusText">locked</span></div>
      </header>

      <section class="gate" id="gate">
        <h2>打开 Aegis 备份</h2>
        <p class="lead">选择你从 Aegis 导出的 JSON 文件。所有解密和验证码计算都在本地完成，不会向服务器发送数据。</p>

        <div class="drop" id="drop" role="button" tabindex="0">
          <div class="big" id="dropBig">点此选择文件，或将 .json 拖到这里</div>
          <div class="small" id="dropSmall">支持加密或明文备份</div>
        </div>
        <input type="file" id="file" accept=".json,application/json" class="hidden">
        <div class="filename hidden" id="fileName"></div>

        <div class="or">或者直接粘贴 JSON 内容</div>
        <textarea class="paste" id="paste" placeholder='{ "version": 1, "header": { ... }, "db": "..." }'></textarea>

        <div class="pwrow">
          <input type="password" class="pw" id="pw" placeholder="备份密码（明文导出可留空）" autocomplete="off">
          <button class="btn" id="unlock" type="button">解锁</button>
        </div>
        <div class="err" id="err"></div>
      </section>

      <section class="hidden" id="vault">
        <div class="toolbar">
          <input class="search" id="search" placeholder="搜索服务或账户名...">
          <span class="count" id="count"></span>
          <button class="btn ghost compact" id="mode" type="button" aria-pressed="false">显示全部</button>
          <button class="btn ghost compact" id="lock" type="button">锁定</button>
        </div>
        <div class="grid" id="grid"></div>
        <div class="footnote">
          <b>安全提示</b><br>
          验证码与密钥只存在于当前页面内存中，刷新页面或点击「锁定」即抹除。<br>
          建议使用加密导出，并妥善保存你的备份文件。
        </div>
      </section>

      <footer class="cta">
        <div class="cta-copy">${ctaText}</div>
        <div class="cta-actions">
          <a class="btn ghost compact" href="${escapeHtml(primaryHref)}" target="_blank" rel="noreferrer">${primaryLabel}</a>
          <a class="btn ghost compact" href="${escapeHtml(secondaryHref)}" target="_blank" rel="noreferrer">${secondaryLabel}</a>
        </div>
      </footer>
    </div>
  `;
}

function requireElement<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

export function mountAegisTotpApp(root: HTMLElement, config: AppConfig): void {
  document.documentElement.lang = 'zh';
  document.body.dataset.variant = config.variant;
  root.innerHTML = appTemplate(config, getLinks(config));

  const gate = requireElement<HTMLElement>(root, '#gate');
  const vault = requireElement<HTMLElement>(root, '#vault');
  const statusDot = requireElement<HTMLElement>(root, '#statusDot');
  const statusText = requireElement<HTMLElement>(root, '#statusText');
  const drop = requireElement<HTMLElement>(root, '#drop');
  const fileInput = requireElement<HTMLInputElement>(root, '#file');
  const fileName = requireElement<HTMLElement>(root, '#fileName');
  const paste = requireElement<HTMLTextAreaElement>(root, '#paste');
  const password = requireElement<HTMLInputElement>(root, '#pw');
  const unlockButton = requireElement<HTMLButtonElement>(root, '#unlock');
  const error = requireElement<HTMLElement>(root, '#err');
  const search = requireElement<HTMLInputElement>(root, '#search');
  const count = requireElement<HTMLElement>(root, '#count');
  const modeButton = requireElement<HTMLButtonElement>(root, '#mode');
  const lockButton = requireElement<HTMLButtonElement>(root, '#lock');
  const grid = requireElement<HTMLElement>(root, '#grid');

  let entries: VaultEntry[] = [];
  const view: CardState[] = [];
  let pendingText: string | null = null;
  let selectedId: string | null = null;
  let showAll = false;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let ticking = false;
  let queuedForce = false;

  function setStatus(text: string, live: boolean): void {
    statusText.textContent = text;
    statusDot.classList.toggle('live', live);
  }

  function updateModeButton(): void {
    modeButton.textContent = showAll ? '仅显示选中' : '显示全部';
    modeButton.setAttribute('aria-pressed', String(showAll));
  }

  function showFile(name: string, text: string): void {
    pendingText = text;
    fileName.textContent = `已载入: ${name}`;
    fileName.classList.remove('hidden');
    paste.value = '';
  }

  function clearEmptyState(): void {
    root.querySelector('.empty')?.remove();
  }

  function selectEntry(id: string): void {
    selectedId = id;
    buildCards();
  }

  function buildCards(): void {
    grid.innerHTML = '';
    view.length = 0;
    clearEmptyState();

    const query = search.value.toLowerCase().trim();
    const filtered = entries.filter((entry) => !query || entry.searchable.includes(query));

    if (filtered.length > 0 && (!selectedId || !filtered.some((entry) => entry.id === selectedId))) {
      selectedId = filtered[0].id;
    }

    filtered.forEach((entry) => {
      const active = showAll || entry.id === selectedId;
      const initial = (entry.displayIssuer || entry.displayAccount || '?').trim().charAt(0).toUpperCase() || '?';
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `card${active ? ' selected' : ''}`;
      element.setAttribute('aria-pressed', String(active));
      element.innerHTML = `
        <div class="progress" style="width:0%"></div>
        <div class="copyhint">已复制</div>
        <div class="meta">
          <div class="badge" style="background:${palette(entry.colorSeed)}">${escapeHtml(initial)}</div>
          <div class="identity">
            <div class="issuer">${escapeHtml(entry.displayIssuer)}</div>
            <div class="acct">${escapeHtml(entry.displayAccount)}</div>
            ${renderEntryTags(entry)}
          </div>
        </div>
        ${renderEntryNote(entry)}
        <div class="codeline">
          <div class="code">${active ? '······' : '点按查看'}</div>
          <div class="right">
            ${entry.period ? '<span class="secs"></span>' : `<span class="typetag">HOTP ${entry.info.counter || 0}</span>`}
          </div>
        </div>
      `;

      grid.appendChild(element);
      const state: CardState = {
        active,
        entry,
        period: entry.period,
        el: element,
        codeEl: requireElement<HTMLElement>(element, '.code'),
        progressEl: requireElement<HTMLElement>(element, '.progress'),
        secondsEl: element.querySelector<HTMLElement>('.secs'),
        hintEl: requireElement<HTMLElement>(element, '.copyhint'),
        lastCounter: null,
        raw: ''
      };

      element.addEventListener('click', () => {
        if (!active) {
          selectEntry(entry.id);
          return;
        }
        selectedId = entry.id;
      });

      state.codeEl.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!active) {
          selectEntry(entry.id);
          return;
        }
        copy(state);
      });

      view.push(state);
    });

    count.textContent = `${filtered.length} / ${entries.length} 项`;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = query ? '没有匹配的条目' : '备份为空';
      grid.after(empty);
    }

    updateModeButton();
    void tick(true);
  }

  async function tick(force = false): Promise<void> {
    if (document.visibilityState === 'hidden') {
      return;
    }

    if (ticking) {
      queuedForce = queuedForce || force;
      return;
    }

    ticking = true;

    try {
      const forceNow = force || queuedForce;
      queuedForce = false;
      const now = Date.now() / 1000;

      for (const state of view) {
        if (!state.active) {
          continue;
        }

        if (state.period === 0) {
          if (forceNow || state.lastCounter === null) {
            state.raw = await generateCode(state.entry, state.entry.info.counter || 0);
            state.codeEl.textContent = groupCode(state.raw);
            state.lastCounter = 'hotp';
          }
          continue;
        }

        const counterValue = Math.floor(now / state.period);
        const elapsed = now - counterValue * state.period;
        const remaining = Math.max(0, state.period - elapsed);

        if (forceNow || counterValue !== state.lastCounter) {
          state.lastCounter = counterValue;
          state.raw = await generateCode(state.entry, counterValue);
          state.codeEl.textContent = groupCode(state.raw);
        }

        state.progressEl.style.width = `${((remaining / state.period) * 100).toFixed(2)}%`;
        if (state.secondsEl) {
          state.secondsEl.textContent = String(Math.ceil(remaining));
        }
        state.el.classList.toggle('warn', remaining <= 5);
      }
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      ticking = false;
      if (queuedForce) {
        const shouldForce = queuedForce;
        queuedForce = false;
        void tick(shouldForce);
      }
    }
  }

  function startTicker(): void {
    if (ticker) {
      clearInterval(ticker);
    }
    ticker = setInterval(() => {
      void tick(false);
    }, 1000);
  }

  function stopTicker(): void {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function openVault(db: AegisDb): void {
    entries = normalizeEntries(db);
    selectedId = entries[0]?.id || null;
    gate.classList.add('hidden');
    vault.classList.remove('hidden');
    setStatus(`unlocked · ${entries.length}`, true);
    buildCards();
    startTicker();
  }

  function lock(): void {
    stopTicker();
    entries = [];
    view.length = 0;
    selectedId = null;
    showAll = false;
    grid.innerHTML = '';
    clearEmptyState();
    password.value = '';
    paste.value = '';
    fileInput.value = '';
    fileName.classList.add('hidden');
    error.textContent = '';
    vault.classList.add('hidden');
    gate.classList.remove('hidden');
    setStatus('locked', false);
    updateModeButton();
  }

  async function readFile(file: File): Promise<void> {
    showFile(file.name, await file.text());
  }

  async function doUnlock(): Promise<void> {
    error.textContent = '';
    unlockButton.disabled = true;
    unlockButton.textContent = '解锁中...';

    try {
      const raw = pendingText || paste.value.trim();
      if (!raw) {
        throw new Error('请先选择文件或粘贴 JSON。');
      }

      let json: AegisExport;
      try {
        json = JSON.parse(raw) as AegisExport;
      } catch {
        throw new Error('JSON 解析失败，请检查内容是否完整。');
      }

      const db = await decryptVault(json, password.value);
      if (!db || !Array.isArray(db.entries)) {
        throw new Error('解锁成功，但没有找到可用条目。');
      }
      openVault(db);
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      unlockButton.disabled = false;
      unlockButton.textContent = '解锁';
    }
  }

  function copy(state: CardState): void {
    if (!state.raw) {
      return;
    }

    const markCopied = (): void => {
      state.codeEl.classList.add('copied');
      state.hintEl.classList.add('show');
      setTimeout(() => {
        state.codeEl.classList.remove('copied');
        state.hintEl.classList.remove('show');
      }, 1100);
    };

    const fallbackCopy = (): void => {
        const textarea = document.createElement('textarea');
        textarea.value = state.raw;
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
        } catch {
          // The visual feedback still tells the user the click was handled.
        }
        textarea.remove();
        markCopied();
    };

    const clipboardWrite = navigator.clipboard?.writeText(state.raw);
    if (clipboardWrite) {
      clipboardWrite.then(markCopied).catch(fallbackCopy);
      return;
    }

    fallbackCopy();
  }

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      void readFile(file);
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add('over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.remove('over');
    });
  });

  drop.addEventListener('drop', (event) => {
    const dragEvent = event as DragEvent;
    const file = dragEvent.dataTransfer?.files[0];
    if (file) {
      void readFile(file);
    }
  });

  paste.addEventListener('input', () => {
    pendingText = null;
    fileName.classList.add('hidden');
  });

  unlockButton.addEventListener('click', () => {
    void doUnlock();
  });

  password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      void doUnlock();
    }
  });

  search.addEventListener('input', buildCards);
  lockButton.addEventListener('click', lock);
  modeButton.addEventListener('click', () => {
    showAll = !showAll;
    buildCards();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      stopTicker();
      return;
    }

    if (!vault.classList.contains('hidden')) {
      startTicker();
      void tick(true);
    }
  });
}
