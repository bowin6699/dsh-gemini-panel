/* dsh-gemini-panel — Gemini web app in the DSH right sidebar (desktop carrier only).
 *
 * Full-bleed <webview> inside a dedicated sidebar tab: no address bar, no chrome.
 * The webview lease comes from the DSH desktop bridge (window.dshDesktop.browser),
 * the same one the built-in browser tab uses, so the guest's storage partition and
 * navigation policy stay under the host's control.
 */
window.__ModuleLoader__.load({
  id: 'dsh-gemini-panel',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const TAB_ID = 'dsh-gemini-panel';
    const TAB_KIND = 'dsh-gemini';
    const GEMINI_URL = 'https://gemini.google.com/';
    const GEMINI_NEW_CHAT_URL = 'https://gemini.google.com/app';

    /* ------------------------------------------------------------------ *
     * styles
     * ------------------------------------------------------------------ */

    const STYLE_ID = 'dsh-gemini-panel-styles';
    const CSS = [
      '.dsh-gemini-root{position:relative;width:100%;height:100%;min-height:0;overflow:hidden;background:#0b0b0c;font-family:inherit;}',
      '.dsh-gemini-host{position:absolute;inset:0;display:flex;min-height:0;}',
      '.dsh-gemini-webview{position:absolute;inset:0;width:100%;height:100%;border:0;display:inline-flex;background:#fff;}',
      '.dsh-gemini-bar{position:absolute;top:10px;left:50%;right:auto;transform:translateX(-50%);z-index:9;display:flex;gap:6px;align-items:center;opacity:.42;transition:opacity .15s ease;pointer-events:none;}',
      '.dsh-gemini-bar:hover{opacity:1;}',
      '.dsh-gemini-btn{pointer-events:auto;min-width:26px;height:26px;padding:0 7px;border-radius:8px;border:1px solid rgba(148,163,184,.35);background:rgba(17,19,24,.62);color:#e5e7eb;font-size:13px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);}',
      '.dsh-gemini-btn:hover{background:rgba(45,50,62,.92);border-color:rgba(148,163,184,.55);}',
      '.dsh-gemini-btn:active{transform:translateY(1px);}',
      '.dsh-gemini-menu{position:absolute;top:44px;left:50%;right:auto;transform:translateX(-50%);z-index:10;display:flex;flex-direction:column;min-width:190px;padding:6px;border-radius:10px;border:1px solid rgba(148,163,184,.3);background:rgba(17,19,24,.94);backdrop-filter:blur(10px);box-shadow:0 12px 32px rgba(0,0,0,.45);}',
      '.dsh-gemini-menu-item{appearance:none;border:0;background:transparent;color:#e5e7eb;text-align:left;font-size:13px;line-height:1.5;padding:7px 10px;border-radius:7px;cursor:pointer;}',
      '.dsh-gemini-menu-item:hover{background:rgba(99,102,241,.28);}',
      '.dsh-gemini-menu-item-active{background:rgba(99,102,241,.34);}',
      '.dsh-gemini-menu-label{padding:4px 10px 6px;color:#8b93a3;font-size:11px;line-height:1.4;}',
      '.dsh-gemini-status{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;background:#0b0b0c;color:#c7cbd4;font-size:13px;text-align:center;padding:24px;}',
      '.dsh-gemini-status-detail{max-width:520px;color:#8b93a3;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;}',
      '.dsh-gemini-retry{appearance:none;border:1px solid rgba(148,163,184,.4);background:rgba(99,102,241,.22);color:#e5e7eb;font-size:12px;padding:6px 16px;border-radius:8px;cursor:pointer;}',
      '.dsh-gemini-retry:hover{background:rgba(99,102,241,.35);}',
      '.dsh-gemini-toast{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:11;max-width:80%;padding:8px 14px;border-radius:9px;background:rgba(17,19,24,.94);border:1px solid rgba(148,163,184,.3);color:#e5e7eb;font-size:12px;line-height:1.5;box-shadow:0 10px 26px rgba(0,0,0,.4);pointer-events:none;white-space:pre-wrap;text-align:center;}',
      '.dsh-gemini-tab-title{display:inline-flex;align-items:center;gap:5px;min-width:0;}',
      '.dsh-gemini-tab-title svg{flex:0 0 auto;display:block;}',
      '.dsh-gemini-tab-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    ].join('\n');

    function installStyles() {
      if (document.getElementById(STYLE_ID)) return () => {};
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
      return () => {
        try { style.remove(); } catch (error) {}
      };
    }

    /* ------------------------------------------------------------------ *
     * workspace key (mirrors the host's canonical browser workspace key)
     * ------------------------------------------------------------------ */

    const workspaceSourceRef = { current: null };

    function readSnapshot(source) {
      try {
        if (!source || typeof source.getSnapshot !== 'function') return null;
        return source.getSnapshot() || null;
      } catch (error) {
        return null;
      }
    }

    function findWorkspace(source, sessionId) {
      const snapshot = readSnapshot(source);
      if (!snapshot || snapshot.phase !== 'ready' || !Array.isArray(snapshot.items)) return null;
      for (const item of snapshot.items) {
        if (!item || !Array.isArray(item.sessionIds)) continue;
        if (item.sessionIds.indexOf(sessionId) !== -1) return item;
      }
      return null;
    }

    function resolveWorkspaceKey(sessionId, signal) {
      const fallback = 'session:' + String(sessionId || 'unknown');
      return new Promise((resolve) => {
        const source = workspaceSourceRef.current;
        if (!source) { resolve(fallback); return; }
        const ready = findWorkspace(source, sessionId);
        if (ready) { resolve('cwd:' + ready.path); return; }
        const snapshot = readSnapshot(source);
        if (snapshot && snapshot.phase === 'ready') { resolve(fallback); return; }

        let settled = false;
        let dispose = null;
        let timer = null;
        const finish = () => {
          if (settled) return;
          settled = true;
          if (dispose) { try { dispose(); } catch (error) {} dispose = null; }
          if (timer) { clearTimeout(timer); timer = null; }
          if (signal && typeof signal.removeEventListener === 'function') {
            try { signal.removeEventListener('abort', finish); } catch (error) {}
          }
          const workspace = findWorkspace(source, sessionId);
          resolve(workspace ? 'cwd:' + workspace.path : fallback);
        };
        try {
          if (typeof source.subscribe === 'function') {
            dispose = source.subscribe(() => {
              const next = readSnapshot(source);
              if (next && next.phase === 'ready') finish();
            });
          }
        } catch (error) {}
        timer = setTimeout(finish, 4000);
        if (signal && typeof signal.addEventListener === 'function') {
          try { signal.addEventListener('abort', finish, { once: true }); } catch (error) {}
        }
        const now = readSnapshot(source);
        if (now && now.phase === 'ready') finish();
      });
    }

    /* ------------------------------------------------------------------ *
     * font size: page zoom of the guest (content and UI scale together)
     * ------------------------------------------------------------------ */

    const ZOOM_STORAGE_KEY = 'dsh-gemini-panel:zoom';
    const ZOOM_STEPS = [0.85, 1, 1.1, 1.25, 1.5];
    const GEMINI_BASE_FONT_SIZE = 16;

    function readHostFontSize() {
      try {
        const body = document.body;
        if (!body) return 14;
        const value = String(getComputedStyle(body).getPropertyValue('--dsh-content-font-size') || '').trim();
        const parsed = parseFloat(value);
        return isFinite(parsed) && parsed > 0 ? parsed : 14;
      } catch (error) {
        return 14;
      }
    }

    function followZoomFactor() {
      const factor = readHostFontSize() / GEMINI_BASE_FONT_SIZE;
      return Math.min(1.6, Math.max(0.7, Math.round(factor * 100) / 100));
    }

    function loadZoomState() {
      try {
        const raw = window.localStorage && window.localStorage.getItem(ZOOM_STORAGE_KEY);
        if (!raw) return { mode: 'manual', factor: 1 };
        const parsed = JSON.parse(raw);
        if (parsed && parsed.mode === 'follow') return { mode: 'follow', factor: followZoomFactor() };
        if (parsed && parsed.mode === 'manual') {
          const factor = Number(parsed.factor);
          if (isFinite(factor) && factor >= 0.7 && factor <= 1.6) return { mode: 'manual', factor };
        }
      } catch (error) {}
      return { mode: 'manual', factor: 1 };
    }

    function saveZoomState(state) {
      try {
        if (window.localStorage) window.localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify(state));
      } catch (error) {}
    }

    /* ------------------------------------------------------------------ *
     * page scripts
     * ------------------------------------------------------------------ */

    const EXTRACT_SCRIPT = String.raw`(function () {
  var out = { title: document.title || "", url: location.href, messages: [] };
  function clean(t) {
    return String(t == null ? "" : t)
      .replace(/\u00a0/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  function push(role, text) {
    var value = clean(text);
    if (value) out.messages.push({ role: role, text: value });
  }
  var nodes = Array.prototype.slice.call(document.querySelectorAll("model-response, user-query"));
  if (nodes.length === 0) {
    nodes = Array.prototype.slice.call(document.querySelectorAll(
      "#chat-history .conversation-container, .conversation-container, [data-test-id='conversation-container']"
    ));
  }
  if (nodes.length > 0) {
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var tag = String(el.tagName || "").toLowerCase();
      var role = tag === "user-query" ? "user" : (tag === "model-response" ? "assistant" : "turn");
      push(role, el.innerText);
    }
  }
  if (out.messages.length === 0) {
    var main = document.querySelector("#chat-history") || document.querySelector("main");
    if (main) push("page", main.innerText);
  }
  return out;
})()`;

    const NEW_CHAT_SCRIPT = String.raw`(function () {
  var selectors = [
    'button[aria-label="New chat"]',
    'button[aria-label*="New chat" i]',
    'button[aria-label*="新对话"]',
    'button[aria-label*="新建对话"]',
    '[data-test-id="new-chat-button"]',
    'side-nav-action-button[data-test-id="new-chat-button"]',
    'side-nav-action-button[aria-label*="New chat" i]'
  ];
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el) { el.click(); return true; }
  }
  return false;
})()`;

    const HISTORY_SCRIPT = String.raw`(function () {
  var selectors = [
    'button[aria-label*="Main menu" i]',
    'button[aria-label*="主菜单"]',
    'button[aria-label*="菜单"]',
    '[data-test-id="side-nav-menu-button"]',
    'button[aria-label*="Recent" i]'
  ];
  for (var i = 0; i < selectors.length; i++) {
    var el = document.querySelector(selectors[i]);
    if (el) { el.click(); return true; }
  }
  return false;
})()`;

    /* ------------------------------------------------------------------ *
     * export helpers
     * ------------------------------------------------------------------ */

    function pad(value) {
      return String(value).padStart(2, '0');
    }

    function timestampName(extension) {
      const now = new Date();
      const stamp = [
        now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
        '-', pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds()),
      ].join('');
      return 'gemini-chat-' + stamp + '.' + extension;
    }

    function roleLabel(role) {
      if (role === 'user') return '用户';
      if (role === 'assistant') return 'Gemini';
      return '内容';
    }

    function buildMarkdown(data) {
      const lines = ['# Gemini 对话', ''];
      if (data && data.title) lines.push('- 标题：' + data.title);
      if (data && data.url) lines.push('- 来源：' + data.url);
      lines.push('- 导出时间：' + new Date().toISOString());
      lines.push('', '---', '');
      const messages = data && Array.isArray(data.messages) ? data.messages : [];
      for (const message of messages) {
        lines.push('## ' + roleLabel(message.role), '');
        lines.push(String(message.text || ''), '');
      }
      return lines.join('\n');
    }

    function buildJson(data) {
      return JSON.stringify({
        title: (data && data.title) || '',
        url: (data && data.url) || '',
        exportedAt: new Date().toISOString(),
        messages: (data && Array.isArray(data.messages)) ? data.messages : [],
      }, null, 2);
    }

    async function saveText(text, name, mediaType) {
      const fileActions = window.dshDesktop && window.dshDesktop.fileActions;
      if (fileActions && typeof fileActions.save === 'function') {
        const hostedBlob = new Blob([text], { type: mediaType });
        const hostedUrl = URL.createObjectURL(hostedBlob);
        try {
          return await fileActions.save({ url: hostedUrl, name, mediaType, mode: 'download' });
        } catch (error) {
          /* fall back to a plain page download below */
        } finally {
          setTimeout(() => {
            try { URL.revokeObjectURL(hostedUrl); } catch (error) {}
          }, 15000);
        }
      }
      const blob = new Blob([text], { type: mediaType });
      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return { status: 'saved' };
    }

    /* ------------------------------------------------------------------ *
     * tab definition
     * ------------------------------------------------------------------ */

    let geminiGlyphSeq = 0;

    /** Gemini-style four-point sparkle, drawn with the familiar blue→violet gradient. */
    function GeminiGlyph(props) {
      const size = (props && (props.size || props.width)) || 16;
      const idRef = React.useRef ? React.useRef(0) : null;
      if (idRef && !idRef.current) idRef.current = 'dsh-gemini-grad-' + (++geminiGlyphSeq);
      const gradientId = idRef ? idRef.current : 'dsh-gemini-grad-0';
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('defs', null,
        h('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '1', y2: '1' },
          h('stop', { offset: '0', stopColor: '#4285F4' }),
          h('stop', { offset: '0.55', stopColor: '#9B72CB' }),
          h('stop', { offset: '1', stopColor: '#D96570' }))),
      h('path', {
        d: 'M12 1.8c.42 5.02 2.76 7.36 7.78 7.78-5.02.42-7.36 2.76-7.78 7.78-.42-5.02-2.76-7.36-7.78-7.78 5.02-.42 7.36-2.76 7.78-7.78z',
        fill: 'url(#' + gradientId + ')',
      }),
      h('path', {
        d: 'M18.8 15.2c.2 2.36 1.3 3.46 3.66 3.66-2.36.2-3.46 1.3-3.66 3.66-.2-2.36-1.3-3.46-3.66-3.66 2.36-.2 3.46-1.3 3.66-3.66z',
        fill: 'url(#' + gradientId + ')',
        'fill-opacity': '0.92',
      }));
    }

    /** Tab chip: the sparkle mark plus the word Gemini. */
    function GeminiTabTitle() {
      return h('span', { className: 'dsh-gemini-tab-title' },
        h(GeminiGlyph, { size: 14 }),
        h('span', { className: 'dsh-gemini-tab-label' }, 'Gemini'));
    }

    function tabDefinition(desktop) {
      return {
        id: TAB_ID,
        kind: TAB_KIND,
        multiple: false,
        keepMounted: desktop !== undefined,
        icon: GeminiGlyph,
        title: () => 'Gemini',
        guide: [
          {
            id: 'gemini',
            order: 25,
            title: () => 'Gemini',
            description: () => '在侧栏内全幅打开 Gemini 网页版，可导出 Markdown / JSON 对话。',
            icon: GeminiGlyph,
          },
        ],
      };
    }

    /* ------------------------------------------------------------------ *
     * panel component
     * ------------------------------------------------------------------ */

    function GeminiBody(props) {
      const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null;
      const tab = info && info.tab ? info.tab : null;
      const tabId = tab ? tab.id : undefined;
      const sessionId = props.sessionId;

      const hostRef = React.useRef(null);
      const webviewRef = React.useRef(null);
      const toastTimer = React.useRef(null);

      const [phase, setPhase] = React.useState('connecting');
      const [detail, setDetail] = React.useState('');
      const [toast, setToast] = React.useState('');
      const [menuOpen, setMenuOpen] = React.useState(false);
      const [attempt, setAttempt] = React.useState(0);
      const [exporting, setExporting] = React.useState(false);

      const notify = React.useCallback((message) => {
        setToast(String(message || ''));
      }, []);

      const [zoomState, setZoomState] = React.useState(loadZoomState);
      const [zoomPanelOpen, setZoomPanelOpen] = React.useState(false);
      const zoomFactor = zoomState.mode === 'follow' ? followZoomFactor() : zoomState.factor;
      const zoomRef = React.useRef(zoomFactor);

      React.useEffect(() => {
        zoomRef.current = zoomFactor;
      }, [zoomFactor]);

      React.useEffect(() => {
        const webview = webviewRef.current;
        if (!webview || typeof webview.setZoomFactor !== 'function') return;
        try { webview.setZoomFactor(zoomFactor); } catch (error) {}
      }, [zoomFactor, phase]);

      React.useEffect(() => {
        if (zoomState.mode !== 'follow') return undefined;
        const timer = setInterval(() => {
          const next = followZoomFactor();
          setZoomState((current) => {
            if (current.mode !== 'follow' || current.factor === next) return current;
            const updated = { mode: 'follow', factor: next };
            saveZoomState(updated);
            return updated;
          });
        }, 2000);
        return () => clearInterval(timer);
      }, [zoomState.mode]);

      const chooseZoom = React.useCallback((factor) => {
        const state = { mode: 'manual', factor };
        saveZoomState(state);
        setZoomState(state);
        setZoomPanelOpen(false);
      }, []);

      const followDshFontSize = React.useCallback(() => {
        const state = { mode: 'follow', factor: followZoomFactor() };
        saveZoomState(state);
        setZoomState(state);
        setZoomPanelOpen(false);
      }, []);

      React.useEffect(() => {
        if (!toast) return undefined;
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => {
          toastTimer.current = null;
          setToast('');
        }, 3200);
        return () => {
          if (toastTimer.current) {
            clearTimeout(toastTimer.current);
            toastTimer.current = null;
          }
        };
      }, [toast]);

      React.useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;

        const carrier = window.dshDesktop;
        const bridge = carrier && carrier.protocolVersion === 1 ? carrier.browser : undefined;
        if (!bridge) {
          setPhase('no-desktop');
          return undefined;
        }

        let disposed = false;
        let lease;
        let element;
        let unsubscribePopup;
        const signal = tab ? tab.signal : undefined;

        function loadGemini() {
          if (!element) return;
          try {
            const result = element.loadURL(GEMINI_URL);
            if (result && typeof result.catch === 'function') result.catch(() => {});
          } catch (error) {}
        }

        function onDomReady() {
          if (element) element.removeEventListener('dom-ready', onDomReady);
          setPhase('loading');
          loadGemini();
          applyZoom();
        }

        function onStopLoading() {
          if (disposed || !element) return;
          let current = '';
          try { current = element.getURL() || ''; } catch (error) {}
          if (current.indexOf('http') === 0) setPhase('ready');
          applyZoom();
        }

        function onFailLoad(event) {
          if (disposed) return;
          if (!event || event.isMainFrame === false) return;
          if (event.errorCode === -3) return;
          setDetail((event && (event.errorDescription || event.validatedURL)) || '页面加载失败');
          setPhase('error');
        }

        function applyZoom() {
          if (disposed || !element || typeof element.setZoomFactor !== 'function') return;
          try { element.setZoomFactor(zoomRef.current); } catch (error) {}
        }

        const zoomTimer = setInterval(applyZoom, 2500);

        (async () => {
          try {
            setPhase('connecting');
            const workspaceKey = await resolveWorkspaceKey(sessionId, signal);
            if (disposed) return;
            const reservation = await bridge.acquire(workspaceKey);
            if (disposed) {
              try { Promise.resolve(bridge.release(reservation.lease)).catch(() => {}); } catch (error) {}
              return;
            }
            lease = reservation.lease;
            element = document.createElement('webview');
            element.className = 'dsh-gemini-webview';
            element.setAttribute('name', reservation.lease);
            element.setAttribute('partition', reservation.partition);
            element.setAttribute('allowpopups', '');
            element.setAttribute('src', 'about:blank#' + reservation.lease);
            element.addEventListener('dom-ready', onDomReady);
            element.addEventListener('did-stop-loading', onStopLoading);
            element.addEventListener('did-fail-load', onFailLoad);
            try {
              unsubscribePopup = bridge.onOpenRequested(reservation.lease, (url) => {
                if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
                notify('已拦截页面弹窗，正在系统浏览器中打开');
                try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (error) {}
              });
            } catch (error) {}
            host.appendChild(element);
            webviewRef.current = element;
          } catch (error) {
            if (disposed) return;
            setDetail(String((error && error.message) || error));
            setPhase('error');
          }
        })();

        return () => {
          disposed = true;
          clearInterval(zoomTimer);
          if (unsubscribePopup) {
            try { unsubscribePopup(); } catch (error) {}
            unsubscribePopup = undefined;
          }
          if (element) {
            try { element.removeEventListener('dom-ready', onDomReady); } catch (error) {}
            try { element.removeEventListener('did-stop-loading', onStopLoading); } catch (error) {}
            try { element.removeEventListener('did-fail-load', onFailLoad); } catch (error) {}
            try { element.remove(); } catch (error) {}
            element = undefined;
          }
          webviewRef.current = null;
          const currentLease = lease;
          lease = undefined;
          if (currentLease) {
            try { Promise.resolve(bridge.release(currentLease)).catch(() => {}); } catch (error) {}
          }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [tabId, sessionId, attempt]);

      const reload = React.useCallback(() => {
        const webview = webviewRef.current;
        if (!webview) return;
        try { webview.reload(); } catch (error) {}
      }, []);

      const openExternal = React.useCallback(() => {
        const webview = webviewRef.current;
        let url = GEMINI_URL;
        try { if (webview) url = webview.getURL() || url; } catch (error) {}
        try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (error) {}
      }, []);

      const newChat = React.useCallback(async () => {
        const webview = webviewRef.current;
        if (!webview) { notify('面板还没有加载完成'); return; }
        let clicked = false;
        try { clicked = await webview.executeJavaScript(NEW_CHAT_SCRIPT, true); } catch (error) { clicked = false; }
        if (!clicked) {
          try {
            const result = webview.loadURL(GEMINI_NEW_CHAT_URL);
            if (result && typeof result.catch === 'function') result.catch(() => {});
          } catch (error) {}
        }
      }, [notify]);

      const openHistory = React.useCallback(async () => {
        const webview = webviewRef.current;
        if (!webview) { notify('面板还没有加载完成'); return; }
        let clicked = false;
        try { clicked = await webview.executeJavaScript(HISTORY_SCRIPT, true); } catch (error) { clicked = false; }
        if (!clicked) notify('没找到历史会话入口，请用页面左上角的菜单');
      }, [notify]);

      const doExport = React.useCallback(async (mode) => {
        setMenuOpen(false);
        const webview = webviewRef.current;
        if (!webview) { notify('面板还没有加载完成'); return; }
        if (exporting) return;
        setExporting(true);
        try {
          let data = null;
          try { data = await webview.executeJavaScript(EXTRACT_SCRIPT, true); } catch (error) { data = null; }
          const messages = data && Array.isArray(data.messages) ? data.messages : [];
          if (messages.length === 0) {
            notify('没有抓到对话内容：可能还是空会话，或 Gemini 页面结构变了。');
            return;
          }
          const markdown = buildMarkdown(data);
          const json = buildJson(data);
          if (mode === 'md' || mode === 'both') {
            await saveText(markdown, timestampName('md'), 'text/markdown;charset=utf-8');
          }
          if (mode === 'json' || mode === 'both') {
            await saveText(json, timestampName('json'), 'application/json;charset=utf-8');
          }
          notify('对话已保存到系统下载文件夹。');
        } catch (error) {
          notify('保存失败：' + String((error && error.message) || error));
        } finally {
          setExporting(false);
        }
      }, [exporting, notify]);

      const overlay = (() => {
        if (phase === 'ready') return null;
        if (phase === 'no-desktop') {
          return h('div', { className: 'dsh-gemini-status' },
            h('div', null, 'Gemini 面板仅限桌面端使用'),
            h('div', { className: 'dsh-gemini-status-detail' }, '当前运行在 Web 端，没有 Electron <webview> 可用。'));
        }
        if (phase === 'error') {
          return h('div', { className: 'dsh-gemini-status' },
            h('div', null, 'Gemini 加载失败'),
            h('div', { className: 'dsh-gemini-status-detail' }, detail),
            h('button', { type: 'button', className: 'dsh-gemini-retry', onClick: () => setAttempt((value) => value + 1) }, '重试'));
        }
        return h('div', { className: 'dsh-gemini-status' },
          h('div', null, phase === 'loading' ? '正在载入 Gemini…' : '正在连接 Gemini…'),
          h('div', { className: 'dsh-gemini-status-detail' }, '首次使用需要在这个面板里登录 Google 账号。'));
      })();

      return h('div', { className: 'dsh-gemini-root' },
        h('div', { className: 'dsh-gemini-host', ref: hostRef }),
        overlay,
        h('div', { className: 'dsh-gemini-bar' },
          h('button', { type: 'button', className: 'dsh-gemini-btn', title: '新对话', onClick: newChat }, '＋'),
          h('button', { type: 'button', className: 'dsh-gemini-btn', title: '刷新', onClick: reload }, '↻'),
          h('button', { type: 'button', className: 'dsh-gemini-btn', title: '历史会话', onClick: openHistory }, '🕘'),
          h('button', {
            type: 'button',
            className: 'dsh-gemini-btn',
            title: '字号（页面缩放 ' + Math.round(zoomFactor * 100) + '%' + (zoomState.mode === 'follow' ? '，跟随 DSH' : '') + '）',
            onClick: () => setZoomPanelOpen((value) => !value),
            'aria-expanded': zoomPanelOpen ? 'true' : 'false',
          }, 'Aa'),
          h('button', {
            type: 'button',
            className: 'dsh-gemini-btn',
            title: '导出对话',
            onClick: () => setMenuOpen((value) => !value),
            'aria-expanded': menuOpen ? 'true' : 'false',
          }, exporting ? '…' : '⤓'),
          h('button', { type: 'button', className: 'dsh-gemini-btn', title: '在系统浏览器打开', onClick: openExternal }, '↗')),
        menuOpen ? h('div', { className: 'dsh-gemini-menu' },
          h('button', { type: 'button', className: 'dsh-gemini-menu-item', onClick: () => doExport('md') }, '导出 Markdown（.md）'),
          h('button', { type: 'button', className: 'dsh-gemini-menu-item', onClick: () => doExport('json') }, '导出 JSON（.json）'),
          h('button', { type: 'button', className: 'dsh-gemini-menu-item', onClick: () => doExport('both') }, '两种格式都保存')) : null,
        zoomPanelOpen ? h('div', { className: 'dsh-gemini-menu', style: { minWidth: '178px' } },
          h('div', { className: 'dsh-gemini-menu-label' }, '整页缩放（UI 与字体一起）'),
          ZOOM_STEPS.map((step) => h('button', {
            key: 'zoom-' + step,
            type: 'button',
            className: 'dsh-gemini-menu-item' + (zoomState.mode === 'manual' && Math.abs(zoomState.factor - step) < 0.001 ? ' dsh-gemini-menu-item-active' : ''),
            onClick: () => chooseZoom(step),
          }, Math.round(step * 100) + '%')),
          h('button', {
            type: 'button',
            className: 'dsh-gemini-menu-item' + (zoomState.mode === 'follow' ? ' dsh-gemini-menu-item-active' : ''),
            onClick: followDshFontSize,
          }, '跟随 DSH 字号（' + Math.round(followZoomFactor() * 100) + '%）')) : null,
        toast ? h('div', { className: 'dsh-gemini-toast' }, toast) : null);
    }

    /* ------------------------------------------------------------------ *
     * plugin
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'gemini:styles');

      ctx.inject(['workspaces'], (scope) => {
        const source = scope.workspaces && typeof scope.workspaces.list !== 'undefined' ? scope.workspaces.list : scope.workspaces;
        workspaceSourceRef.current = source;
        return () => {
          if (workspaceSourceRef.current === source) workspaceSourceRef.current = null;
        };
      });

      ctx.inject(['sidebarRightTabs'], (scope) => {
        const carrier = window.dshDesktop;
        const desktop = carrier && carrier.protocolVersion === 1 ? carrier.browser : undefined;
        const disposers = [];
        const push = (dispose) => {
          if (typeof dispose === 'function') disposers.push(dispose);
        };
        try {
          push(scope.sidebarRightTabs.register(tabDefinition(desktop)));
          push(scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            inject: (sessionId) => ({ sessionId }),
          }, GeminiBody)));
          push(scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
            name: 'sidebar.right.pane.tab.title',
            key: TAB_ID,
          }, GeminiTabTitle)));
        } catch (error) {
          console.error('[dsh-gemini-panel] registration failed', error);
        }
        return () => {
          while (disposers.length > 0) {
            const dispose = disposers.pop();
            try { dispose(); } catch (error) {}
          }
        };
      });
    }

    return {
      inject: ['slots'],
      apply,
    };
  },
});
