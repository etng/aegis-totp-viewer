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

interface SessionCache {
  db: AegisDb;
  selectedId: string | null;
  selectedGroup: string | null;
  showAll: boolean;
  savedAt: number;
}

interface ExtensionStorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

const RENDER_DEBOUNCE_MS = 120;
const SESSION_CACHE_KEY = 'aegisTotpViewer.session';

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

function getExtensionSessionStorage(config: AppConfig): ExtensionStorageArea | null {
  if (config.variant !== 'extension') {
    return null;
  }

  const scope = globalThis as {
    chrome?: { storage?: { session?: ExtensionStorageArea } };
    browser?: { storage?: { session?: ExtensionStorageArea } };
  };

  return scope.chrome?.storage?.session || scope.browser?.storage?.session || null;
}

async function readSessionCache(config: AppConfig): Promise<SessionCache | null> {
  const storage = getExtensionSessionStorage(config);
  if (!storage) {
    return null;
  }

  try {
    const result = await storage.get([SESSION_CACHE_KEY]);
    const value = result[SESSION_CACHE_KEY] as Partial<SessionCache> | undefined;
    if (!value || !value.db || !Array.isArray(value.db.entries)) {
      return null;
    }

    return {
      db: value.db,
      selectedId: typeof value.selectedId === 'string' ? value.selectedId : null,
      selectedGroup: typeof value.selectedGroup === 'string' ? value.selectedGroup : null,
      showAll: Boolean(value.showAll),
      savedAt: typeof value.savedAt === 'number' ? value.savedAt : Date.now()
    };
  } catch {
    return null;
  }
}

async function writeSessionCache(config: AppConfig, cache: SessionCache): Promise<void> {
  const storage = getExtensionSessionStorage(config);
  if (!storage) {
    return;
  }

  try {
    await storage.set({ [SESSION_CACHE_KEY]: cache });
  } catch {
    // Session cache is a convenience. The unlocked in-page state still works if storage fails.
  }
}

async function clearSessionCache(config: AppConfig): Promise<void> {
  const storage = getExtensionSessionStorage(config);
  if (!storage) {
    return;
  }

  try {
    await storage.remove(SESSION_CACHE_KEY);
  } catch {
    // The lock action still clears the current page state even if storage cleanup fails.
  }
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
    ? '也可以收藏在线版；觉得有用的话，欢迎点 Star。'
    : '经常使用的话，安装浏览器插件会更顺手；如果这个工具帮到了你，欢迎给项目点 Star。';
  const footnoteText = isExtension
    ? '<b>安全提示</b> 本次浏览器会话内会保留解锁状态；点击「锁定」会立即清空。'
    : '<b>安全提示</b><br>验证码与密钥只存在于当前页面内存中，刷新页面或点击「锁定」即抹除。<br>建议使用加密导出，并妥善保存你的备份文件。';

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
        <div class="group-tabs" id="groupTabs" aria-label="按分组筛选"></div>
        <div class="grid" id="grid"></div>
        <div class="footnote">
          ${footnoteText}
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
  const groupTabs = requireElement<HTMLElement>(root, '#groupTabs');
  const grid = requireElement<HTMLElement>(root, '#grid');

  let entries: VaultEntry[] = [];
  let currentDb: AegisDb | null = null;
  const view: CardState[] = [];
  let pendingText: string | null = null;
  let selectedId: string | null = null;
  let selectedGroup: string | null = null;
  let showAll = false;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
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

  function scheduleBuildCards(): void {
    if (renderTimer) {
      clearTimeout(renderTimer);
    }

    renderTimer = setTimeout(() => {
      renderTimer = null;
      buildCards();
    }, RENDER_DEBOUNCE_MS);
  }

  function selectEntry(id: string): void {
    selectedId = id;
    void persistSession();
    scheduleBuildCards();
  }

  function getGroupNames(): string[] {
    return [...new Set(entries.flatMap((entry) => entry.groupNames))].sort((left, right) =>
      left.localeCompare(right)
    );
  }

  function getVisibleEntries(query: string): VaultEntry[] {
    return entries.filter((entry) => {
      const matchesSearch = !query || entry.searchable.includes(query);
      const matchesGroup = !selectedGroup || entry.groupNames.includes(selectedGroup);
      return matchesSearch && matchesGroup;
    });
  }

  function renderGroupTabs(query: string): void {
    const groups = getGroupNames();
    const currentGroupStillExists = selectedGroup ? groups.includes(selectedGroup) : true;
    if (!currentGroupStillExists) {
      selectedGroup = null;
    }

    const allCount = entries.filter((entry) => !query || entry.searchable.includes(query)).length;
    const tabs = [
      {
        label: '所有',
        group: null,
        count: allCount,
        active: selectedGroup === null
      },
      ...groups.map((group) => ({
        label: group,
        group,
        count: entries.filter(
          (entry) => entry.groupNames.includes(group) && (!query || entry.searchable.includes(query))
        ).length,
        active: selectedGroup === group
      }))
    ];

    groupTabs.innerHTML = tabs
      .map((tab, index) => {
        return `
          <button class="group-tab${tab.active ? ' active' : ''}" type="button" data-group-index="${index}" aria-pressed="${tab.active}">
            <span>${escapeHtml(tab.label)}</span>
            <span class="tab-count">${tab.count}</span>
          </button>
        `;
      })
      .join('');

    groupTabs.querySelectorAll<HTMLButtonElement>('.group-tab').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number.parseInt(button.dataset.groupIndex || '0', 10);
        selectedGroup = tabs[index]?.group || null;
        void persistSession();
        scheduleBuildCards();
      });
    });
  }

  function buildCards(): void {
    grid.innerHTML = '';
    view.length = 0;
    clearEmptyState();

    const query = search.value.toLowerCase().trim();
    renderGroupTabs(query);
    const filtered = getVisibleEntries(query);

    if (filtered.length > 0 && (!selectedId || !filtered.some((entry) => entry.id === selectedId))) {
      selectedId = filtered[0].id;
    }

    const ordered = selectedId
      ? [
          ...filtered.filter((entry) => entry.id === selectedId),
          ...filtered.filter((entry) => entry.id !== selectedId)
        ]
      : filtered;

    ordered.forEach((entry) => {
      const selected = entry.id === selectedId;
      const active = showAll || selected;
      const initial = (entry.displayIssuer || entry.displayAccount || '?').trim().charAt(0).toUpperCase() || '?';
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `card${active ? ' active' : ''}${selected ? ' selected' : ''}`;
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
        void persistSession();
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
      empty.textContent = entries.length === 0 ? '备份为空' : '没有匹配的条目';
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
    currentDb = db;
    entries = normalizeEntries(db);
    selectedId = entries[0]?.id || null;
    selectedGroup = null;
    showAll = false;
    gate.classList.add('hidden');
    vault.classList.remove('hidden');
    setStatus(`unlocked · ${entries.length}`, true);
    buildCards();
    startTicker();
    void persistSession(db);
  }

  function restoreVault(cache: SessionCache): void {
    currentDb = cache.db;
    entries = normalizeEntries(cache.db);
    selectedId =
      cache.selectedId && entries.some((entry) => entry.id === cache.selectedId)
        ? cache.selectedId
        : entries[0]?.id || null;
    selectedGroup = cache.selectedGroup;
    showAll = cache.showAll;
    gate.classList.add('hidden');
    vault.classList.remove('hidden');
    setStatus(`unlocked · ${entries.length}`, true);
    buildCards();
    startTicker();
  }

  async function persistSession(db?: AegisDb): Promise<void> {
    const dbToPersist = db || currentDb;
    if (!dbToPersist || entries.length === 0) {
      return;
    }

    await writeSessionCache(config, {
      db: dbToPersist,
      selectedId,
      selectedGroup,
      showAll,
      savedAt: Date.now()
    });
  }

  function lock(): void {
    stopTicker();
    entries = [];
    currentDb = null;
    view.length = 0;
    selectedId = null;
    selectedGroup = null;
    showAll = false;
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
    grid.innerHTML = '';
    groupTabs.innerHTML = '';
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
    void clearSessionCache(config);
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

  search.addEventListener('input', scheduleBuildCards);
  lockButton.addEventListener('click', lock);
  modeButton.addEventListener('click', () => {
    showAll = !showAll;
    void persistSession();
    scheduleBuildCards();
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

  void readSessionCache(config).then((cache) => {
    if (cache) {
      restoreVault(cache);
    }
  });
}
