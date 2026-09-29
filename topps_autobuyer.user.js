// ==UserScript==
// @name         Topps Auto Buyer
// @namespace    https://www.topps.com/
// @version      2.2
// @description  Monitor & auto-buy products on topps.com — background stock checker via Shopify API, floating UI, card vault & iframe auto-filler
// @author       Pythonic Shariful
// @match        https://www.topps.com/*
// @match        https://shop.topps.com/*
// @match        https://checkout.pci.shopifyinc.com/*
// @match        https://*.shopifyinc.com/*
// @match        https://*.shopify.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      www.topps.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Storage Keys ──────────────────────────────────────────────────────────
  const STORAGE_KEY_URL            = 'topps_product_url';
  const STORAGE_KEY_QTY            = 'topps_quantity';
  const STORAGE_KEY_ACTIVE         = 'topps_monitoring';
  const STORAGE_KEY_STATUS         = 'topps_status';
  const STORAGE_KEY_STAGE          = 'topps_stage';   // 'idle' | 'adding' | 'checkout' | 'done'
  const STORAGE_KEY_CARD_NUM       = 'topps_card_number';
  const STORAGE_KEY_CARD_EXP_MM   = 'topps_card_exp_mm';
  const STORAGE_KEY_CARD_EXP_YY   = 'topps_card_exp_yy';
  const STORAGE_KEY_CARD_CVV       = 'topps_card_cvv';
  const STORAGE_KEY_CARD_NAME      = 'topps_card_name';
  const STORAGE_KEY_CARD_BLUR      = 'topps_card_blurred';
  const STORAGE_KEY_DISCOUNT       = 'topps_discount_code';
  const STORAGE_KEY_STATUS_LOG     = 'topps_status_log';
  // ─── Background Stock Monitor Keys ────────────────────────────────────────
  const STORAGE_KEY_WATCH_URLS     = 'topps_watch_urls';      // JSON array of {url, label, autoBuy}
  const STORAGE_KEY_WATCH_MIN      = 'topps_watch_min';       // min poll interval in seconds
  const STORAGE_KEY_WATCH_MAX      = 'topps_watch_max';       // max poll interval in seconds
  const STORAGE_KEY_WATCH_ACTIVE   = 'topps_watch_active';    // boolean
  const STORAGE_KEY_SOUND_ENABLED  = 'topps_sound_enabled';   // boolean
  const STORAGE_KEY_WEBHOOK_URL    = 'topps_webhook_url';     // string
  const STORAGE_KEY_PANEL_POS      = 'topps_panel_pos';       // object {x, y}
  const STORAGE_KEY_MAX_RETRIES    = 'topps_max_retries';     // number
  const STORAGE_KEY_ATC_ATTEMPTS   = 'topps_atc_attempts';    // number
  const STORAGE_KEY_API_MIN_DELAY  = 'topps_api_min_delay';   // number
  const STORAGE_KEY_API_MAX_DELAY  = 'topps_api_max_delay';   // number

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const get = (k, d) => { try { return GM_getValue(k, d); } catch { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function renderLogs() {
    const el = document.getElementById('tbot-status');
    const wrap = document.getElementById('tbot-status-wrap');
    if (!el || !wrap) return;
    
    let logs = [];
    try { logs = JSON.parse(get(STORAGE_KEY_STATUS_LOG, '[]')); } catch {}
    if (!Array.isArray(logs)) logs = [];
    
    el.innerHTML = logs.map(l => `<div class="tbot-log-msg">${l}</div>`).join('');
    wrap.scrollTop = wrap.scrollHeight;
  }

  function log(msg) {
    console.log('[ToppsBot]', msg);
    
    let logs = [];
    try { logs = JSON.parse(get(STORAGE_KEY_STATUS_LOG, '[]')); } catch {}
    if (!Array.isArray(logs)) logs = [];
    
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const formatted = `[${time}] ${msg}`;
    
    logs.push(formatted);
    if (logs.length > 30) logs = logs.slice(logs.length - 30);
    
    set(STORAGE_KEY_STATUS_LOG, JSON.stringify(logs));
    
    // Also keep the single string for backward compatibility
    set(STORAGE_KEY_STATUS, msg); 
    
    renderLogs();
  }

  function currentPageType() {
    const u = location.href;
    if (u.includes('/catalogsearch/result'))    return 'search';
    if (u.includes('/checkout/cart'))           return 'cart';
    if (/\/checkouts\b/i.test(u))               return 'checkout';
    const productUrl = get(STORAGE_KEY_URL, '');
    if (productUrl && u.includes(productUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0])) return 'product';
    if (/\/products\/[^/?#]+/.test(u))          return 'product';
    return 'home';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── BACKGROUND STOCK CHECKER ─────────────────────────────────────────────
  // Uses GM_xmlhttpRequest to call Shopify's /products/{handle}.js endpoint
  // without needing the product page to be open.  No cookies / auth required —
  // Shopify returns available:true/false in every variant object.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Extract the Shopify product handle from a Topps product URL.
   * e.g. https://www.topps.com/products/2026-bowman-chrome%C2%AE-baseball-hobby-box
   *   → "2026-bowman-chrome%C2%AE-baseball-hobby-box"
   */
  function handleFromUrl(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/');
      const idx = parts.indexOf('products');
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    } catch {}
    return null;
  }

  /**
   * Fetch /products/{handle}.js via GM_xmlhttpRequest (bypasses CORS & 403 on
   * server-side fetches). Returns a Promise resolving to the parsed JSON or null.
   */
  function fetchProductJs(handle) {
    return new Promise(resolve => {
      const url = `https://www.topps.com/products/${handle}.js`;
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        onload(resp) {
          if (resp.status === 200) {
            try { resolve(JSON.parse(resp.responseText)); }
            catch { resolve(null); }
          } else {
            resolve(null);
          }
        },
        onerror() { resolve(null); },
        ontimeout() { resolve(null); },
        timeout: 12000
      });
    });
  }

  /**
   * Check if a Shopify product (by handle) has ANY variant available.
   * Returns: { available: bool, title: string, handle: string, variants: [] }
   *          or null on network error.
   */
  async function checkStockViaApi(productUrl) {
    const handle = handleFromUrl(productUrl);
    if (!handle) return null;

    const data = await fetchProductJs(handle);
    if (!data) return null;

    // Shopify's .js endpoint shape:
    // { id, title, handle, variants: [{ id, title, available, price, ... }], ... }
    const variants = data.variants || [];
    const anyAvailable = variants.some(v => v.available === true);
    const availableVariants = variants.filter(v => v.available);

    return {
      available: anyAvailable,
      title: data.title || handle,
      handle,
      totalVariants: variants.length,
      availableVariants: availableVariants.length,
      variants: availableVariants.map(v => ({ id: v.id, title: v.title, price: v.price }))
    };
  }

  // ─── Background polling loop ───────────────────────────────────────────────
  let _watchTimer = null;
  let _alreadyAlerted = {}; // handle → true, so we only alert once per in-stock event

  function beepAlert() {
    if (!get(STORAGE_KEY_SOUND_ENABLED, true)) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [880, 1100, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.3);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.35);
      });
    } catch {}
  }

  function sendBrowserNotification(title, body) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: 'https://www.topps.com/favicon.ico' });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') new Notification(title, { body, icon: 'https://www.topps.com/favicon.ico' });
      });
    }
  }

  function sendWebhook(message) {
    const webhookUrl = get(STORAGE_KEY_WEBHOOK_URL, '').trim();
    if (!webhookUrl) return;
    
    // Check if Discord webhook
    const payload = webhookUrl.includes('discord.com') 
      ? { content: message } 
      : { text: message }; // Assume Slack/Teams format for others

    GM_xmlhttpRequest({
      method: 'POST',
      url: webhookUrl,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      onload: () => console.log('[ToppsBot] Webhook sent successfully.'),
      onerror: () => console.error('[ToppsBot] Failed to send webhook.')
    });
  }

  async function runWatchCycle() {
    // Works regardless of whether watch is "active" (also used by manual Check Now)
    let watchList = [];
    try { watchList = JSON.parse(get(STORAGE_KEY_WATCH_URLS, '[]')); } catch {}
    if (!Array.isArray(watchList) || watchList.length === 0) return;

    const updatedList = [...watchList];

    for (let idx = 0; idx < updatedList.length; idx++) {
      const item = updatedList[idx];
      const url  = typeof item === 'string' ? item : item.url;
      if (!url) continue;

      const result = await checkStockViaApi(url);
      const now    = Date.now();

      if (!result) {
        log(`⚠ Check failed: ${decodeURIComponent(url.split('/').pop())}`);
        continue;
      }

      // Persist stock state & timestamp back into the list
      const cur = typeof item === 'object' ? item : { url: item };
      updatedList[idx] = { ...cur, _stock: result.available, _lastChecked: now };

      const statusIcon = result.available ? '🟢' : '🔴';
      const variantInfo = result.available
        ? `${result.availableVariants}/${result.totalVariants} in stock`
        : `all ${result.totalVariants} sold out`;
      log(`${statusIcon} ${result.title} — ${variantInfo}`);

      // Update pill & timestamp in UI without full rebuild
      const pill = document.querySelector(`[data-watch-badge="${result.handle}"]`);
      if (pill) {
        pill.textContent  = result.available ? '✓ In Stock' : '✗ Sold Out';
        pill.className    = 'tbot-stock-pill ' + (result.available ? 'pill-instock' : 'pill-soldout');
      }
      const timeEl = document.querySelector(`[data-watch-time="${result.handle}"]`);
      if (timeEl) {
        const t = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        timeEl.textContent = '@ ' + t;
      }
      const rowEl = document.querySelector(`.tbot-watch-item[data-url="${url}"]`);
      if (rowEl) {
        rowEl.classList.remove('in-stock', 'sold-out');
        if (result.available) rowEl.classList.add('in-stock');
        else                  rowEl.classList.add('sold-out');
      }

      // Alert & optional auto-buy
      if (result.available && !_alreadyAlerted[result.handle]) {
        _alreadyAlerted[result.handle] = true;
        beepAlert();
        const alertMsg = `🚨 IN STOCK: ${result.title}`;
        log(alertMsg);
        sendBrowserNotification('Topps Auto Buyer', alertMsg);
        sendWebhook(alertMsg + `\nLink: ${url}`);

        const isAutoBuy = typeof item === 'object' && item.autoBuy;
        if (isAutoBuy && !get(STORAGE_KEY_ACTIVE, false)) {
          log('🤖 Auto-buy triggered! Starting purchase flow…');
          set(STORAGE_KEY_URL,    url);
          set(STORAGE_KEY_ACTIVE, true);
          set(STORAGE_KEY_STAGE,  'idle');
          const qty = typeof item === 'object' && item.qty ? item.qty : 1;
          await startBuyFlow(url, qty);
        }
      } else if (!result.available) {
        delete _alreadyAlerted[result.handle];
      }

      await sleep(600);
    }

    // Persist updated stock state so UI rebuilds show it after reload
    set(STORAGE_KEY_WATCH_URLS, JSON.stringify(updatedList));
  }

  function _nextDelay() {
    const min = Math.max(5, parseInt(get(STORAGE_KEY_WATCH_MIN, 20), 10));
    const max = Math.max(min, parseInt(get(STORAGE_KEY_WATCH_MAX, 40), 10));
    return Math.floor(min + Math.random() * (max - min));
  }

  function startBackgroundMonitor() {
    stopBackgroundMonitor();
    if (!get(STORAGE_KEY_WATCH_ACTIVE, false)) return;

    log(`🔍 Monitor started — first check running now.`);

    // Run once immediately, then use variable delays
    runWatchCycle().then(() => scheduleNextWatch());
  }

  function scheduleNextWatch() {
    if (!get(STORAGE_KEY_WATCH_ACTIVE, false)) return;
    const delaySec = _nextDelay();
    console.log(`[${new Date().toLocaleTimeString()}] [Topps Auto Buyer] 📡 Background Monitor: Next check in ${delaySec} seconds...`);
    if (typeof window._tbotStartCountdown === 'function') window._tbotStartCountdown(delaySec);
    _watchTimer = setTimeout(() => {
      runWatchCycle().then(() => scheduleNextWatch());
    }, delaySec * 1000);
  }

  function stopBackgroundMonitor() {
    if (_watchTimer) { clearTimeout(_watchTimer); _watchTimer = null; }
    if (typeof window._tbotStopCountdown === 'function') window._tbotStopCountdown();
  }

  // ─── Wait Helpers ──────────────────────────────────────────────────────────
  function waitForElement(selector, timeout = 15000, root = document) {
    return new Promise((resolve, reject) => {
      const el = root.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = root.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(root.body || root.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
    });
  }

  function waitForElementByText(selector, text, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
          if (el.textContent.includes(text)) return el;
        }
        return null;
      };
      const found = check();
      if (found) return resolve(found);

      const obs = new MutationObserver(() => {
        const f = check();
        if (f) { obs.disconnect(); resolve(f); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error(`Timeout: ${text}`)); }, timeout);
    });
  }

  // ─── Human-Like Typing Simulation ─────────────────────────────────────────
  function _setVal(input, val) {
    let applied = false;
    try {
      const win = input.ownerDocument.defaultView || window;
      const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
      if (setter) { setter.call(input, val); applied = true; }
    } catch {}
    if (!applied) { try { input.value = val; } catch {} }
    try { input.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch {}
  }

  // Make sure `input` is the DOM active element, refocusing if Shopify stole focus
  function _ensureFocus(input) {
    if (document.activeElement !== input) input.focus();
  }

  async function humanType(input, text) {
    if (!input || !text) return;

    input.focus();
    await sleep(80);

    // Clear via native setter first (most reliable)
    _setVal(input, '');
    // Also delete via execCommand for masked-input compat
    if (typeof input.select === 'function') input.select();
    try { document.execCommand('delete', false); } catch {}
    await sleep(40);

    for (let i = 0; i < text.length; i++) {
      _ensureFocus(input); // Refocus if Shopify stole focus
      const char = text[i];
      const keyInit = {
        key: char,
        code: isNaN(char) ? `Key${char.toUpperCase()}` : `Digit${char}`,
        bubbles: true, cancelable: true, composed: true
      };
      input.dispatchEvent(new KeyboardEvent('keydown', keyInit));
      input.dispatchEvent(new KeyboardEvent('keypress', keyInit));

      // Try execCommand (works with Shopify masks) — only when input is active
      let inserted = false;
      const valBefore = input.value || '';
      if (document.activeElement === input) {
        try { inserted = document.execCommand('insertText', false, char); } catch {}
      }
      
      const valAfter = input.value || '';
      // If execCommand failed or silently did nothing (value length didn't change)
      if (!inserted || valAfter.length <= valBefore.length) {
        _setVal(input, valBefore + char);
      }

      input.dispatchEvent(new KeyboardEvent('keyup', keyInit));
      await sleep(35 + Math.random() * 40);
    }

    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await sleep(50);
    if (typeof input.blur === 'function') input.blur();
  }

  // Fast paste for Card Number to avoid React mask fighting
  async function forcePaste(input, text) {
    if (!input || !text) return;
    input.focus();
    await sleep(40);
    _setVal(input, '');
    let inserted = false;
    if (document.activeElement === input) {
      try { inserted = document.execCommand('insertText', false, text); } catch {}
    }
    if (!inserted || (input.value || '').length < text.length) {
      _setVal(input, text);
    }
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await sleep(40);
    if (typeof input.blur === 'function') input.blur();
  }

  // Shopify expiry behavior (Shopify PCI iframe, React-controlled masked input):
  //   The field `input#expiry` (autocomplete="cc-exp") expects the FULL formatted
  //   string "MM / YY" (with space-slash-space separator).  It does NOT reliably
  //   auto-insert "/" on its own when driven by execCommand/synthetic events.
  //   Strategy: clear the field, then type every character of "MM / YY" one by
  //   one — including the spaces and slash — via execCommand('insertText').
  async function humanTypeExpiry(input, mm, yy) {
    if (!input || !mm || !yy) return;

    // Normalise to exactly 2-digit strings
    const m = mm.toString().padStart(2, '0').slice(-2);
    const y = yy.toString().slice(-2); // accept "2026" → "26"

    // Full string the field expects: "MM / YY"
    const fullExpiry = `${m} / ${y}`;

    input.focus();
    await sleep(100);

    // ── Clear existing value cleanly ──
    _setVal(input, '');
    if (typeof input.select === 'function') input.select();
    try { document.execCommand('selectAll', false); } catch {}
    try { document.execCommand('delete', false); } catch {}
    await sleep(60);

    // ── Type every character including " / " ──
    for (const char of fullExpiry) {
      _ensureFocus(input);
      await typeSingleChar(input, char);
      await sleep(55 + Math.random() * 45);
    }

    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await sleep(80);
    if (typeof input.blur === 'function') input.blur();
  }


  async function typeSingleChar(input, char) {
    // Guarantee focus is on our target before execCommand
    _ensureFocus(input);
    const keyInit = {
      key: char,
      code: isNaN(char) ? (char === '/' ? 'Slash' : `Key${char.toUpperCase()}`) : `Digit${char}`,
      bubbles: true, cancelable: true, composed: true
    };
    input.dispatchEvent(new KeyboardEvent('keydown', keyInit));
    input.dispatchEvent(new KeyboardEvent('keypress', keyInit));

    let inserted = false;
    const valBefore = input.value || '';
    if (document.activeElement === input) {
      try { inserted = document.execCommand('insertText', false, char); } catch {}
    }
    
    const valAfter = input.value || '';
    if (!inserted || valAfter.length <= valBefore.length) {
      _setVal(input, valBefore + char);
    }
    input.dispatchEvent(new KeyboardEvent('keyup', keyInit));
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // ─── IFRAME HANDLER ───────────────────────────────────────────────────────
  // Runs inside the Shopify PCI iframe that contains ALL card fields together.
  // We fill every field found in the current document in one pass.
  // ═══════════════════════════════════════════════════════════════════════════

  function notifyParent(fieldName, requestId) {
    try {
      // Use window.top so the confirmation reaches the main page even from deeply nested iframes
      window.top.postMessage(
        { type: 'TOPPS_FIELD_FILLED_CONFIRMATION', field: fieldName, requestId },
        '*'
      );
    } catch {}
  }

  function initIframeCardFiller() {
    // Only run inside Shopify PCI iframes (don't run on topps.com main pages)
    const isPciFrame = /shopify/i.test(location.hostname) && window !== window.top;
    if (!isPciFrame) return;

    let isTyping = false;

    window.addEventListener('message', async (e) => {
      if (!e.data || e.data.type !== 'TOPPS_FILL_FIELD') return;

      const { field, value, requestId } = e.data;
      let handled = false;

      // Query elements freshly when the message arrives to ensure DOM is fully loaded
      const numInput  = document.querySelector('input#number, input[name="number"], input[autocomplete="cc-number"]');
      const expInput  = document.querySelector('input#expiry, input[name="expiry"], input[autocomplete="cc-exp"]');
      const cvvInput  = document.querySelector('input#verification_value, input[name="verification_value"], input[autocomplete="cc-csc"]');
      const nameInput = document.querySelector('input[autocomplete="cc-name"]:not(.visually-hidden):not([type="hidden"]), input#name:not(.visually-hidden):not([type="hidden"])');

      if (field === 'number' && numInput) {
        if (isTyping) return;
        isTyping = true;
        try {
          await humanType(numInput, value);
          notifyParent('Card Number', requestId);
          handled = true;
        } finally {
          isTyping = false;
        }
      } else if (field === 'expiry' && expInput) {
        if (isTyping) return;
        isTyping = true;
        try {
          await humanTypeExpiry(expInput, value.mm, value.yy);
          notifyParent('Expiration Date', requestId);
          handled = true;
        } finally {
          isTyping = false;
        }
      } else if (field === 'cvv' && cvvInput) {
        if (isTyping) return;
        isTyping = true;
        try {
          await humanType(cvvInput, value);
          notifyParent('Security Code (CVV)', requestId);
          handled = true;
        } finally {
          isTyping = false;
        }
      } else if (field === 'name' && nameInput) {
        if (isTyping) return;
        isTyping = true;
        try {
          await humanType(nameInput, value);
          notifyParent('Name on Card', requestId);
          handled = true;
        } finally {
          isTyping = false;
        }
      }

      // If we didn't handle the message, forward it to any nested child iframes
      // (handles Shopify's new layout where each field is in its own nested iframe)
      if (!handled) {
        const childFrames = document.querySelectorAll('iframe');
        childFrames.forEach(frame => {
          try { frame.contentWindow.postMessage(e.data, '*'); } catch {}
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ─── TOP WINDOW (Main Bot UI & Checkout Orchestration) ────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  GM_addStyle(`
    #tbot-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'Segoe UI', system-ui, sans-serif;
      width: 348px;
      border-radius: 16px;
      background: linear-gradient(145deg, #0a0a14 0%, #11111f 55%, #0d1628 100%);
      box-shadow: 0 12px 50px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.06);
      overflow: hidden;
      transition: all .3s cubic-bezier(.4,0,.2,1);
    }
    #tbot-panel.collapsed { width: 54px; height: 54px; border-radius: 50%; cursor: pointer; }
    #tbot-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px;
      background: rgba(255,255,255,0.04);
      border-bottom: 1px solid rgba(255,255,255,0.07);
      user-select: none; cursor: pointer;
    }
    #tbot-header .title {
      font-size: 13px; font-weight: 700; letter-spacing: .5px;
      color: #e0e7ff;
      display: flex; align-items: center; gap: 8px;
    }
    /* Buy-bot status dot */
    #tbot-header .title .dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: #4ade80; box-shadow: 0 0 7px #4ade80;
      transition: background .3s, box-shadow .3s;
      flex-shrink: 0;
    }
    #tbot-header .title .dot.inactive { background: #334155; box-shadow: none; }
    /* Watch-bot pulse dot */
    #tbot-watch-dot {
      width: 9px; height: 9px; border-radius: 50%;
      background: #38bdf8; box-shadow: 0 0 7px #38bdf8;
      flex-shrink: 0; position: relative;
    }
    #tbot-watch-dot.idle { background: #334155; box-shadow: none; }
    #tbot-watch-dot.pulse::after {
      content: ''; position: absolute;
      top: -4px; left: -4px; right: -4px; bottom: -4px;
      border-radius: 50%; border: 2px solid #38bdf8;
      animation: tbot-ring 1.4s ease-out infinite;
    }
    @keyframes tbot-ring {
      0%   { opacity: .9; transform: scale(1); }
      100% { opacity: 0;  transform: scale(2.4); }
    }
    #tbot-header .toggle-btn {
      font-size: 18px; color: #94a3b8; transition: transform .3s;
      background: none; border: none; cursor: pointer; padding: 0;
    }
    #tbot-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
    .tbot-label {
      font-size: 10px; font-weight: 600; letter-spacing: .8px;
      color: #475569; text-transform: uppercase; margin-bottom: 3px;
    }
    .tbot-input {
      width: 100%; box-sizing: border-box;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 8px; color: #e2e8f0;
      font-size: 12px; padding: 8px 10px;
      outline: none; transition: border-color .2s;
    }
    .tbot-input:focus { border-color: #6366f1; background: rgba(99,102,241,0.07); }
    .tbot-row { display: flex; gap: 8px; align-items: flex-end; }
    .tbot-row .tbot-input { flex: 1; }
    #tbot-qty-input { width: 70px; flex: none; text-align: center; }
    #tbot-start-btn {
      width: 100%; padding: 10px; border-radius: 9px; border: none;
      font-size: 13px; font-weight: 700; letter-spacing: .4px;
      cursor: pointer; transition: all .2s;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      color: #fff; box-shadow: 0 4px 18px rgba(99,102,241,.4);
    }
    #tbot-start-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 22px rgba(99,102,241,.55); }
    #tbot-start-btn.active {
      background: linear-gradient(90deg, #ef4444, #dc2626);
      box-shadow: 0 4px 18px rgba(239,68,68,.4);
    }
    #tbot-status-wrap {
      background: rgba(0,0,0,0.3); border-radius: 9px; padding: 8px 10px;
      height: 90px; overflow-y: auto; display: flex; flex-direction: column;
      border: 1px solid rgba(255,255,255,0.05);
    }
    #tbot-status {
      font-size: 11px; color: #94a3b8; line-height: 1.5; word-break: break-word;
    }
    .tbot-log-msg {
      border-bottom: 1px solid rgba(255,255,255,0.04); padding-bottom: 3px; margin-bottom: 3px;
    }
    .tbot-log-msg:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    #tbot-page-badge {
      display: inline-block; font-size: 10px; font-weight: 600;
      padding: 2px 8px; border-radius: 20px; letter-spacing: .4px;
      background: rgba(99,102,241,0.18); color: #a5b4fc;
      border: 1px solid rgba(99,102,241,0.28);
    }
    
    /* ── Tabs ── */
    #tbot-tabs {
      display: flex; gap: 4px; border-bottom: 1px solid rgba(255,255,255,0.08);
      margin-bottom: 4px; padding-bottom: 6px;
    }
    .tbot-tab-btn {
      background: none; border: none; color: #94a3b8; font-size: 10px; font-weight: 700;
      padding: 5px 8px; cursor: pointer; border-radius: 5px; transition: all .2s;
    }
    .tbot-tab-btn:hover { background: rgba(255,255,255,0.05); color: #cbd5e1; }
    .tbot-tab-btn.active { background: rgba(99,102,241,0.2); color: #a5b4fc; }
    .tbot-tab-content { display: none; flex-direction: column; gap: 10px; }
    .tbot-tab-content.active { display: flex; }

    /* ════ Background Stock Monitor ════ */
    #tbot-watch-box {
      background: rgba(56,189,248,0.04);
      border: 1px solid rgba(56,189,248,0.12);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex; flex-direction: column; gap: 8px;
    }
    /* Header row inside monitor box */
    #tbot-watch-header-row {
      display: flex; align-items: center; justify-content: space-between;
    }
    #tbot-watch-title {
      font-size: 11px; font-weight: 700; color: #38bdf8;
      letter-spacing: .4px; display: flex; align-items: center; gap: 6px;
    }
    /* Countdown progress bar */
    #tbot-countdown-wrap {
      background: rgba(255,255,255,0.06); border-radius: 4px;
      height: 3px; overflow: hidden;
    }
    #tbot-countdown-bar {
      height: 100%; width: 100%;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      border-radius: 4px;
      transform-origin: left;
      transition: width 1s linear;
    }
    /* Next check label */
    #tbot-next-check {
      font-size: 9px; color: #475569; text-align: right;
    }
    /* Watch list */
    #tbot-watch-list { display: flex; flex-direction: column; gap: 5px; }
    .tbot-watch-item {
      background: rgba(255,255,255,0.035);
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 8px; padding: 7px 10px;
      display: flex; align-items: center; gap: 6px;
      transition: border-color .2s;
    }
    .tbot-watch-item:hover { border-color: rgba(56,189,248,0.25); }
    .tbot-watch-item.in-stock  { border-left: 3px solid #4ade80; }
    .tbot-watch-item.sold-out  { border-left: 3px solid #f87171; }
    .tbot-watch-item-left { flex: 1; overflow: hidden; }
    .tbot-watch-item-label {
      font-size: 10px; color: #cbd5e1; white-space: nowrap;
      overflow: hidden; text-overflow: ellipsis;
    }
    .tbot-watch-meta {
      font-size: 9px; color: #475569; margin-top: 2px;
      display: flex; align-items: center; gap: 5px;
    }
    .tbot-stock-pill {
      font-size: 8px; font-weight: 800; letter-spacing: .4px;
      padding: 1px 5px; border-radius: 10px; text-transform: uppercase;
    }
    .pill-unknown  { background: rgba(100,116,139,0.2); color: #64748b; }
    .pill-instock  { background: rgba(74,222,128,0.15); color: #4ade80; }
    .pill-soldout  { background: rgba(248,113,113,0.15); color: #f87171; }
    .tbot-watch-time { font-size: 9px; color: #334155; }
    /* Auto-buy & remove buttons */
    .tbot-watch-auto-buy {
      font-size: 9px; font-weight: 700; cursor: pointer;
      background: rgba(99,102,241,0.12); color: #6366f1;
      border: 1px solid rgba(99,102,241,0.25);
      border-radius: 5px; padding: 3px 6px; white-space: nowrap;
      flex-shrink: 0; transition: all .15s;
    }
    .tbot-watch-auto-buy:hover { background: rgba(99,102,241,0.25); }
    .tbot-watch-auto-buy.on {
      background: rgba(99,102,241,0.35); color: #e0e7ff;
      border-color: rgba(99,102,241,0.5);
      box-shadow: 0 0 8px rgba(99,102,241,.3);
    }
    .tbot-watch-remove {
      background: none; border: none; color: #475569;
      font-size: 13px; cursor: pointer; padding: 0 2px; line-height: 1;
      flex-shrink: 0; transition: color .15s;
    }
    .tbot-watch-remove:hover { color: #f87171; }
    /* Add URL row */
    .tbot-watch-add-row { display: flex; gap: 6px; align-items: center; }
    #tbot-watch-url-input { flex: 1; font-size: 11px; }
    #tbot-watch-add-btn {
      flex-shrink: 0; padding: 7px 10px; border-radius: 8px; border: none;
      background: rgba(56,189,248,0.2); color: #38bdf8;
      border: 1px solid rgba(56,189,248,0.3);
      font-size: 11px; font-weight: 700; cursor: pointer;
      transition: all .15s;
    }
    #tbot-watch-add-btn:hover { background: rgba(56,189,248,0.35); }
    /* Controls row */
    .tbot-watch-controls {
      display: flex; gap: 6px; align-items: center;
    }
    #tbot-watch-toggle {
      flex: 1; padding: 8px 10px; border-radius: 9px; border: none;
      font-size: 11px; font-weight: 700; cursor: pointer; transition: all .2s;
      background: linear-gradient(90deg, #0ea5e9, #0284c7);
      color: #fff; box-shadow: 0 3px 12px rgba(14,165,233,.3);
    }
    #tbot-watch-toggle:hover { box-shadow: 0 4px 18px rgba(14,165,233,.45); }
    #tbot-watch-toggle.watching {
      background: linear-gradient(90deg, #dc2626, #b91c1c);
      box-shadow: 0 3px 12px rgba(220,38,38,.3);
    }
    #tbot-check-now-btn {
      padding: 8px 10px; border-radius: 9px; border: none;
      background: rgba(255,255,255,0.07); color: #94a3b8;
      border: 1px solid rgba(255,255,255,0.1);
      font-size: 11px; font-weight: 700; cursor: pointer;
      flex-shrink: 0; transition: all .15s;
    }
    #tbot-check-now-btn:hover { background: rgba(56,189,248,0.15); color: #38bdf8; border-color: rgba(56,189,248,0.3); }
    /* Interval + jitter row */
    .tbot-timing-row {
      display: flex; gap: 6px; align-items: center;
    }
    .tbot-timing-row .tbot-timing-group {
      display: flex; align-items: center; gap: 4px; flex: 1;
    }
    .tbot-timing-num {
      width: 46px; text-align: center;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 7px; color: #e2e8f0;
      font-size: 11px; padding: 5px 4px; outline: none;
      box-sizing: border-box;
    }
    .tbot-timing-num:focus { border-color: #38bdf8; }
    .tbot-timing-label { font-size: 9px; color: #475569; white-space: nowrap; }

    /* ── Card Vault & Blur CSS ── */
    .tbot-section-title {
      font-size: 10px; font-weight: 700; letter-spacing: .8px; color: #818cf8;
      text-transform: uppercase; padding: 6px 0 2px;
      border-top: 1px solid rgba(255,255,255,0.07); margin-top: 2px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .tbot-card-box {
      display: flex; flex-direction: column; gap: 8px;
      transition: filter .3s cubic-bezier(.4,0,.2,1);
    }
    .tbot-card-box.blurred {
      filter: blur(5.5px);
      user-select: none;
      pointer-events: none;
    }
    .tbot-row-2 { display: flex; gap: 8px; }
    .tbot-row-2 > div { flex: 1; }
    .tbot-btn-row { display: flex; gap: 8px; }
    .tbot-action-btn {
      padding: 8px 10px; border-radius: 8px; border: none;
      font-size: 11px; font-weight: 700; cursor: pointer;
      transition: all .2s;
    }
    .btn-save {
      flex: 1;
      background: linear-gradient(90deg, #3b82f6, #2563eb);
      color: #fff; box-shadow: 0 3px 12px rgba(37,99,235,.35);
    }
    .btn-save:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(37,99,235,.5); }
    .btn-toggle {
      flex: 0 0 74px;
      background: rgba(255,255,255,0.08);
      color: #cbd5e1; border: 1px solid rgba(255,255,255,0.15);
    }
    .btn-toggle:hover { background: rgba(255,255,255,0.15); color: #fff; }
    #tbot-fill-btn {
      width: 100%; padding: 9px; border-radius: 8px; border: none;
      font-size: 12px; font-weight: 700; letter-spacing: .4px; cursor: pointer;
      transition: all .2s;
      background: linear-gradient(90deg, #10b981, #059669);
      color: #fff; box-shadow: 0 4px 15px rgba(16,185,129,.3);
    }
    #tbot-fill-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(16,185,129,.5); }

    .collapsed #tbot-body, .collapsed #tbot-status-wrap, .collapsed #tbot-header .title span,
    .collapsed #tbot-header .toggle-btn { display: none; }
    .collapsed #tbot-header { border: none; padding: 0; width: 52px; height: 52px;
      justify-content: center; border-radius: 50%; }
    .collapsed .dot { display: block !important; width: 18px; height: 18px; }
  `);

  function buildUI() {
    if (document.getElementById('tbot-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tbot-panel';

    const savedUrl    = get(STORAGE_KEY_URL, '');
    const savedQty    = get(STORAGE_KEY_QTY, 1);
    const isActive    = get(STORAGE_KEY_ACTIVE, false);
    const lastStatus  = get(STORAGE_KEY_STATUS, 'Ready — set URL & Card, then click Monitor & Buy');
    const isBlurred   = get(STORAGE_KEY_CARD_BLUR, false);
    const pageType    = currentPageType();

    const isWatching = get(STORAGE_KEY_WATCH_ACTIVE, false);
    const watchMin   = get(STORAGE_KEY_WATCH_MIN, 20);
    const watchMax   = get(STORAGE_KEY_WATCH_MAX, 40);
    let watchList = [];
    try { watchList = JSON.parse(get(STORAGE_KEY_WATCH_URLS, '[]')); } catch {}

    function renderWatchItem(item) {
      const url   = typeof item === 'string' ? item : item.url;
      const label = typeof item === 'object' && item.label
        ? item.label
        : decodeURIComponent(url.split('/').pop()).replace(/[®™]/g, '').replace(/-/g, ' ').substring(0, 34);
      const ab    = typeof item === 'object' && item.autoBuy;
      const h     = handleFromUrl(url) || '';
      const stock = typeof item === 'object' ? item._stock : undefined;  // cached after first check
      const lastChecked = typeof item === 'object' && item._lastChecked
        ? new Date(item._lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : null;

      const pillClass = stock === true ? 'pill-instock' : stock === false ? 'pill-soldout' : 'pill-unknown';
      const pillText  = stock === true ? '✓ In Stock'   : stock === false ? '✗ Sold Out'  : '? Unknown';
      const itemClass = stock === true ? 'in-stock'     : stock === false ? 'sold-out'    : '';

      const qty   = typeof item === 'object' && item.qty ? item.qty : 1;

      return `<div class="tbot-watch-item ${itemClass}" data-url="${url}">
        <div class="tbot-watch-item-left">
          <div class="tbot-watch-item-label" title="${url}">${label}</div>
          <div class="tbot-watch-meta">
            <span class="tbot-stock-pill ${pillClass}" data-watch-badge="${h}">${pillText}</span>
            <span class="tbot-watch-time" data-watch-time="${h}">${lastChecked ? '@ ' + lastChecked : ''}</span>
          </div>
        </div>
        <input class="tbot-input tbot-watch-qty" type="number" min="1" max="99" value="${qty}" data-url="${url}" title="Quantity to buy" style="width: 36px; padding: 2px; text-align: center; font-size: 10px;">
        <button class="tbot-watch-auto-buy ${ab ? 'on' : ''}" data-url="${url}" title="Auto-buy when in stock">${ab ? '🤖 Auto' : 'Auto'}</button>
        <button class="tbot-watch-remove" data-url="${url}" title="Remove">✕</button>
      </div>`;
    }

    const panelPos = get(STORAGE_KEY_PANEL_POS, { x: 24, y: 24 });
    
    panel.innerHTML = `
      <div id="tbot-header">
        <div class="title">
          <div class="dot ${isActive ? '' : 'inactive'}"></div>
          <span>Topps Auto Buyer</span>
          <div id="tbot-watch-dot" class="${isWatching ? 'pulse' : 'idle'}" title="Background stock monitor"></div>
        </div>
        <button class="toggle-btn" id="tbot-toggle" title="Collapse">▲</button>
      </div>
      <div id="tbot-body">
        <div id="tbot-tabs">
          <button class="tbot-tab-btn active" data-tab="monitor">Monitor & Buy</button>
          <button class="tbot-tab-btn" data-tab="vault">Card Vault</button>
          <button class="tbot-tab-btn" data-tab="settings">Settings</button>
        </div>

        <!-- ── Monitor Tab ── -->
        <div id="tbot-tab-monitor" class="tbot-tab-content active">
          <div>
            <div class="tbot-label">Page</div>
            <span id="tbot-page-badge">${pageType.toUpperCase()}</span>
          </div>
          <div>
            <div class="tbot-label">Product URL (Buy Target)</div>
            <input id="tbot-url-input" class="tbot-input" type="text"
              placeholder="https://www.topps.com/products/..." value="${savedUrl}">
          </div>
          <div class="tbot-row">
            <div style="flex:1">
              <div class="tbot-label">Quantity</div>
              <input id="tbot-qty-input" class="tbot-input" type="number" min="1" max="99" value="${savedQty}">
            </div>
          </div>
          <button id="tbot-start-btn" class="${isActive ? 'active' : ''}">
            ${isActive ? '⏹ Stop Monitoring' : '▶ Monitor & Buy'}
          </button>

          <!-- ════ Background Stock Monitor ════ -->
          <div id="tbot-watch-box">
            <!-- Monitor title + pulse dot -->
            <div id="tbot-watch-header-row">
              <div id="tbot-watch-title">
                📡 Stock Monitor
              </div>
              <span id="tbot-next-check">${isWatching ? 'starting…' : 'idle'}</span>
            </div>

            <!-- Countdown progress bar -->
            <div id="tbot-countdown-wrap"><div id="tbot-countdown-bar" style="width:100%"></div></div>

            <!-- Add URL row -->
            <div class="tbot-watch-add-row">
              <input id="tbot-watch-url-input" class="tbot-input" type="text"
                placeholder="Paste topps.com/products/… URL">
              <button id="tbot-watch-add-btn">+ Add</button>
            </div>

            <!-- Watch list -->
            <div id="tbot-watch-list">
              ${watchList.length === 0
                ? '<div style="font-size:10px;color:#334155;text-align:center;padding:6px 0">No URLs added yet</div>'
                : watchList.map(renderWatchItem).join('')}
            </div>

            <!-- Timing row: interval + jitter -->
            <div class="tbot-timing-row">
              <div class="tbot-timing-group">
                <span class="tbot-timing-label">Min</span>
                <input id="tbot-watch-min" class="tbot-timing-num" type="number" min="5" max="3600" value="${watchMin}">
                <span class="tbot-timing-label">s</span>
              </div>
              <div class="tbot-timing-group">
                <span class="tbot-timing-label">Max</span>
                <input id="tbot-watch-max" class="tbot-timing-num" type="number" min="5" max="3600" value="${watchMax}">
                <span class="tbot-timing-label">s</span>
              </div>
            </div>

            <!-- Controls: Start/Stop + Check Now -->
            <div class="tbot-watch-controls">
              <button id="tbot-watch-toggle" class="${isWatching ? 'watching' : ''}">
                ${isWatching ? '⏹ Stop' : '▶ Start Watching'}
              </button>
              <button id="tbot-check-now-btn" title="Run a check immediately">⚡ Check Now</button>
            </div>
          </div>
        </div>

        <!-- ── Settings Tab ── -->
        <div id="tbot-tab-settings" class="tbot-tab-content">
          <div class="tbot-section-title">
            <span>⚙️ Settings</span>
            <span style="font-size:9px; color:#94a3b8; font-weight:400">Audio, Webhook, Retries</span>
          </div>
          <div class="tbot-row">
            <label style="flex:1; display:flex; align-items:center; gap:6px; font-size:11px; color:#e2e8f0; cursor:pointer;">
              <input type="checkbox" id="tbot-sound-toggle" ${get(STORAGE_KEY_SOUND_ENABLED, true) ? 'checked' : ''}>
              🔊 Play Sound on In-Stock
            </label>
          </div>
          <div class="tbot-row">
            <div style="flex:1">
              <div class="tbot-label">Max ATC Retries</div>
              <input id="tbot-max-retries" class="tbot-input" type="number" min="1" max="20" value="${get(STORAGE_KEY_MAX_RETRIES, 5)}">
            </div>
          </div>
          <div class="tbot-row">
            <div style="flex:1">
              <div class="tbot-label">Webhook URL (Discord/Slack)</div>
              <input id="tbot-webhook-url" class="tbot-input" type="text" placeholder="https://..." value="${get(STORAGE_KEY_WEBHOOK_URL, '')}">
            </div>
          </div>
          
          <div class="tbot-section-title" style="margin-top: 15px;">
            <span>⏱️ Active Polling Delay</span>
            <span style="font-size:9px; color:#94a3b8; font-weight:400">When waiting on OOS product page</span>
          </div>
          <div class="tbot-row-2">
            <div style="flex:1">
              <div class="tbot-label">Min Delay (ms)</div>
              <input id="tbot-min-delay" class="tbot-input" type="number" min="500" max="60000" value="${get(STORAGE_KEY_API_MIN_DELAY, 4000)}">
            </div>
            <div style="flex:1">
              <div class="tbot-label">Max Delay (ms)</div>
              <input id="tbot-max-delay" class="tbot-input" type="number" min="500" max="60000" value="${get(STORAGE_KEY_API_MAX_DELAY, 6000)}">
            </div>
          </div>
        </div>

        <!-- ── Vault Tab ── -->
        <div id="tbot-tab-vault" class="tbot-tab-content">
          <div class="tbot-section-title">
            <span>🏷️ Discount Code</span>
            <span style="font-size:9px; color:#94a3b8; font-weight:400">Optional</span>
          </div>
          <div>
            <input id="tbot-discount-code" class="tbot-input" type="text"
              placeholder="e.g. SAVE10" value="${get(STORAGE_KEY_DISCOUNT, '')}">
          </div>

          <div class="tbot-section-title">
            <span>💳 Card Details</span>
            <span style="font-size:9px; color:#94a3b8; font-weight:400">Shopify PCI Auto-Fill</span>
          </div>

          <div id="tbot-card-container" class="tbot-card-box ${isBlurred ? 'blurred' : ''}">
            <div>
              <div class="tbot-label">Card Number</div>
              <input id="tbot-card-num" class="tbot-input" type="text"
                placeholder="1234 5678 9012 3456" maxlength="19"
                value="${get(STORAGE_KEY_CARD_NUM, '')}">
            </div>
            <div class="tbot-row-2">
              <div style="flex:0.7">
                <div class="tbot-label">Exp MM</div>
                <input id="tbot-card-exp-mm" class="tbot-input" type="text"
                  placeholder="MM" maxlength="2" style="text-align:center"
                  value="${get(STORAGE_KEY_CARD_EXP_MM, '')}">
              </div>
              <div style="flex:0.7">
                <div class="tbot-label">Exp YY</div>
                <input id="tbot-card-exp-yy" class="tbot-input" type="text"
                  placeholder="YY" maxlength="2" style="text-align:center"
                  value="${get(STORAGE_KEY_CARD_EXP_YY, '')}">
              </div>
              <div>
                <div class="tbot-label">CVV</div>
                <input id="tbot-card-cvv" class="tbot-input" type="password"
                  placeholder="•••" maxlength="4"
                  value="${get(STORAGE_KEY_CARD_CVV, '')}">
              </div>
            </div>
            <div>
              <div class="tbot-label">Name on Card</div>
              <input id="tbot-card-name" class="tbot-input" type="text"
                placeholder="Full name" value="${get(STORAGE_KEY_CARD_NAME, '')}">
            </div>
          </div>

          <div class="tbot-btn-row">
            <button id="tbot-save-card-btn" class="tbot-action-btn btn-save">💾 Save Card</button>
            <button id="tbot-toggle-blur-btn" class="tbot-action-btn btn-toggle" title="Show / Hide details">
              ${isBlurred ? '👁 Show' : '🔒 Hide'}
            </button>
          </div>

          <button id="tbot-fill-btn">⚡ Fill Card into Form</button>
        </div>

        <div id="tbot-status-wrap">
          <div id="tbot-status"></div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    renderLogs();

    // ── Tab switching ──
    document.querySelectorAll('.tbot-tab-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        document.querySelectorAll('.tbot-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tbot-tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById('tbot-tab-' + e.target.dataset.tab).classList.add('active');
      });
    });

    // ── Collapse panel toggle ──
    let collapsed = false;
    document.getElementById('tbot-toggle').addEventListener('click', e => {
      e.stopPropagation();
      collapsed = !collapsed;
      panel.classList.toggle('collapsed', collapsed);
      document.getElementById('tbot-toggle').textContent = collapsed ? '▼' : '▲';
    });
    panel.addEventListener('click', () => {
      if (collapsed) {
        collapsed = false;
        panel.classList.remove('collapsed');
        document.getElementById('tbot-toggle').textContent = '▲';
      }
    });

    // ── Settings listeners ──
    document.getElementById('tbot-sound-toggle').addEventListener('change', e => {
      set(STORAGE_KEY_SOUND_ENABLED, e.target.checked);
    });
    document.getElementById('tbot-max-retries').addEventListener('input', e => {
      set(STORAGE_KEY_MAX_RETRIES, parseInt(e.target.value, 10) || 5);
    });
    document.getElementById('tbot-webhook-url').addEventListener('input', e => {
      set(STORAGE_KEY_WEBHOOK_URL, e.target.value.trim());
    });

    // ── Panel Dragging ──
    const header = document.getElementById('tbot-header');
    let isDragging = false;
    let dragStartX, dragStartY;
    let initialX, initialY;

    // Apply saved pos
    if (panelPos.x !== undefined && panelPos.y !== undefined && !collapsed) {
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = panelPos.x + 'px';
      panel.style.top = panelPos.y + 'px';
    }

    header.addEventListener('mousedown', e => {
      if (e.target.id === 'tbot-toggle' || collapsed) return;
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = initialX + 'px';
      panel.style.top = initialY + 'px';
      panel.style.transition = 'none'; // disable transition while dragging
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      panel.style.left = (initialX + dx) + 'px';
      panel.style.top = (initialY + dy) + 'px';
    });

    document.addEventListener('mouseup', e => {
      if (!isDragging) return;
      isDragging = false;
      panel.style.transition = 'all .3s cubic-bezier(.4,0,.2,1)';
      const rect = panel.getBoundingClientRect();
      set(STORAGE_KEY_PANEL_POS, { x: rect.left, y: rect.top });
    });

    // ── Save Card & Blur Feature ──
    const saveCardBtn   = document.getElementById('tbot-save-card-btn');
    const toggleBlurBtn = document.getElementById('tbot-toggle-blur-btn');
    const cardBox       = document.getElementById('tbot-card-container');

    saveCardBtn.addEventListener('click', () => {
      const num      = document.getElementById('tbot-card-num').value.trim();
      const expMm    = document.getElementById('tbot-card-exp-mm').value.trim();
      const expYy    = document.getElementById('tbot-card-exp-yy').value.trim();
      const cvv      = document.getElementById('tbot-card-cvv').value.trim();
      const name     = document.getElementById('tbot-card-name').value.trim();
      const discount = document.getElementById('tbot-discount-code').value.trim();

      set(STORAGE_KEY_CARD_NUM,    num);
      set(STORAGE_KEY_CARD_EXP_MM, expMm);
      set(STORAGE_KEY_CARD_EXP_YY, expYy);
      set(STORAGE_KEY_CARD_CVV,    cvv);
      set(STORAGE_KEY_CARD_NAME,   name);
      set(STORAGE_KEY_DISCOUNT,    discount);
      set(STORAGE_KEY_CARD_BLUR,   true);

      cardBox.classList.add('blurred');
      toggleBlurBtn.textContent = '👁 Show';

      log('🔒 Card saved & blurred for security! Filling fields…');
      fillCardSequential();
    });

    toggleBlurBtn.addEventListener('click', () => {
      const isCurrentlyBlurred = cardBox.classList.contains('blurred');
      if (isCurrentlyBlurred) {
        cardBox.classList.remove('blurred');
        toggleBlurBtn.textContent = '🔒 Hide';
        set(STORAGE_KEY_CARD_BLUR, false);
      } else {
        cardBox.classList.add('blurred');
        toggleBlurBtn.textContent = '👁 Show';
        set(STORAGE_KEY_CARD_BLUR, true);
      }
    });

    // ── Manual Fill Card button ──
    document.getElementById('tbot-fill-btn').addEventListener('click', () => {
      fillCardSequential();
    });

    // ── Monitor helpers ──
    function saveWatchList(list) {
      set(STORAGE_KEY_WATCH_URLS, JSON.stringify(list));
    }

    function rebuildWatchListUI() {
      let wl = [];
      try { wl = JSON.parse(get(STORAGE_KEY_WATCH_URLS, '[]')); } catch {}
      const container = document.getElementById('tbot-watch-list');
      if (!container) return;
      container.innerHTML = wl.length === 0
        ? '<div style="font-size:10px;color:#334155;text-align:center;padding:6px 0">No URLs added yet</div>'
        : wl.map(renderWatchItem).join('');
      bindWatchListEvents();
    }

    function bindWatchListEvents() {
      document.querySelectorAll('.tbot-watch-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url;
          let wl = [];
          try { wl = JSON.parse(get(STORAGE_KEY_WATCH_URLS, '[]')); } catch {}
          wl = wl.filter(i => (typeof i === 'string' ? i : i.url) !== url);
          saveWatchList(wl);
          rebuildWatchListUI();
          log(`🗑 Removed: ${decodeURIComponent(url.split('/').pop())}`);
        });
      });

      document.querySelectorAll('.tbot-watch-auto-buy').forEach(btn => {
        btn.addEventListener('click', () => {
          const url = btn.dataset.url;
          let wl = [];
          try { wl = JSON.parse(get(STORAGE_KEY_WATCH_URLS, '[]')); } catch {}
          wl = wl.map(i => {
            const iUrl = typeof i === 'string' ? i : i.url;
            if (iUrl !== url) return i;
            const cur = typeof i === 'object' ? i : { url: i, qty: 1 };
            const next = { ...cur, autoBuy: !cur.autoBuy };
            log(next.autoBuy ? `🤖 Auto-buy ON for ${decodeURIComponent(url.split('/').pop())}` : `⬜ Auto-buy OFF`);
            return next;
          });
          saveWatchList(wl);
          rebuildWatchListUI();
        });
      });

      // Quantity change
      document.querySelectorAll('.tbot-watch-qty').forEach(input => {
        input.addEventListener('change', e => {
          const url = e.target.dataset.url;
          let wl = [];
          try { wl = JSON.parse(get(STORAGE_KEY_WATCH_URLS, '[]')); } catch {}
          wl = wl.map(i => {
            const iUrl = typeof i === 'string' ? i : i.url;
            if (iUrl !== url) return i;
            const cur = typeof i === 'object' ? i : { url: i, autoBuy: false };
            return { ...cur, qty: parseInt(e.target.value, 10) || 1 };
          });
          saveWatchList(wl);
        });
      });
    }

    // ── Add URL ──
    function addWatchUrl() {
      const urlInput = document.getElementById('tbot-watch-url-input');
      const url = urlInput.value.trim();
      if (!url || !url.includes('topps.com/products/')) {
        log('⚠ Enter a valid topps.com/products/… URL');
        return;
      }
      let wl = [];
      try { wl = JSON.parse(get(STORAGE_KEY_WATCH_URLS, '[]')); } catch {}
      if (wl.some(i => (typeof i === 'string' ? i : i.url) === url)) {
        log('⚠ Already in watch list.');
        return;
      }
      wl.push({ url, autoBuy: false });
      saveWatchList(wl);
      urlInput.value = '';
      rebuildWatchListUI();
      log(`✅ Added: ${decodeURIComponent(url.split('/').pop())}`);
    }
    document.getElementById('tbot-watch-add-btn').addEventListener('click', addWatchUrl);
    document.getElementById('tbot-watch-url-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') addWatchUrl();
    });

    // ── Countdown bar logic ──
    let _countdownTotal = 0;
    let _countdownRemain = 0;
    let _countdownTick = null;

    function startCountdown(totalSec) {
      if (_countdownTick) clearInterval(_countdownTick);
      _countdownTotal  = totalSec;
      _countdownRemain = totalSec;
      updateCountdownUI();
      _countdownTick = setInterval(() => {
        _countdownRemain = Math.max(0, _countdownRemain - 1);
        updateCountdownUI();
      }, 1000);
    }

    function updateCountdownUI() {
      const bar  = document.getElementById('tbot-countdown-bar');
      const lbl  = document.getElementById('tbot-next-check');
      if (!bar || !lbl) return;
      const pct  = _countdownTotal > 0 ? (_countdownRemain / _countdownTotal) * 100 : 100;
      bar.style.width = pct + '%';
      lbl.textContent = _countdownRemain > 0 ? `next in ${_countdownRemain}s` : 'checking…';
    }

    function stopCountdown() {
      if (_countdownTick) { clearInterval(_countdownTick); _countdownTick = null; }
      const bar = document.getElementById('tbot-countdown-bar');
      const lbl = document.getElementById('tbot-next-check');
      if (bar) bar.style.width = '100%';
      if (lbl) lbl.textContent = 'idle';
    }

    // ── Expose countdown starter so startBackgroundMonitor can call it ──
    window._tbotStartCountdown = startCountdown;
    window._tbotStopCountdown  = stopCountdown;

    document.getElementById('tbot-watch-min').addEventListener('change', e => {
      set(STORAGE_KEY_WATCH_MIN, parseInt(e.target.value, 10) || 20);
    });

    document.getElementById('tbot-watch-max').addEventListener('change', e => {
      set(STORAGE_KEY_WATCH_MAX, parseInt(e.target.value, 10) || 40);
    });

    document.getElementById('tbot-min-delay').addEventListener('change', e => {
      set(STORAGE_KEY_API_MIN_DELAY, parseInt(e.target.value, 10) || 4000);
    });

    document.getElementById('tbot-max-delay').addEventListener('change', e => {
      set(STORAGE_KEY_API_MAX_DELAY, parseInt(e.target.value, 10) || 6000);
    });

    // ── Start / Stop watch ──
    const watchToggleBtn = document.getElementById('tbot-watch-toggle');
    const watchDot = document.getElementById('tbot-watch-dot');

    watchToggleBtn.addEventListener('click', () => {
      const nowWatching = !get(STORAGE_KEY_WATCH_ACTIVE, false);
      const intervalVal = parseInt(document.getElementById('tbot-watch-interval').value, 10) || 30;
      const jitterVal   = parseInt(document.getElementById('tbot-watch-jitter').value,   10) || 0;
      set(STORAGE_KEY_WATCH_INTERVAL, intervalVal);
      set(STORAGE_KEY_WATCH_JITTER,   jitterVal);
      set(STORAGE_KEY_WATCH_ACTIVE,   nowWatching);

      if (nowWatching) {
        watchToggleBtn.textContent = '⏹ Stop';
        watchToggleBtn.classList.add('watching');
        if (watchDot) { watchDot.classList.remove('idle'); watchDot.classList.add('pulse'); }
        const headerDot = document.querySelector('#tbot-watch-dot');
        if (headerDot) { headerDot.classList.remove('idle'); headerDot.classList.add('pulse'); }
        startBackgroundMonitor();
      } else {
        watchToggleBtn.textContent = '▶ Start Watching';
        watchToggleBtn.classList.remove('watching');
        if (watchDot) { watchDot.classList.remove('pulse'); watchDot.classList.add('idle'); }
        stopBackgroundMonitor();
        stopCountdown();
        log('⏹ Background monitor stopped.');
      }
    });

    // ── Check Now ──
    document.getElementById('tbot-check-now-btn').addEventListener('click', () => {
      log('⚡ Manual check triggered…');
      runWatchCycle();
    });

    // Initial bind
    bindWatchListEvents();

    // Resume monitor if it was active
    if (get(STORAGE_KEY_WATCH_ACTIVE, false)) {
      startBackgroundMonitor();
    }

    // ── Start / Stop button ──
    document.getElementById('tbot-start-btn').addEventListener('click', () => {
      const nowActive = !get(STORAGE_KEY_ACTIVE, false);

      if (nowActive) {
        const url = document.getElementById('tbot-url-input').value.trim();
        const qty = parseInt(document.getElementById('tbot-qty-input').value, 10) || 1;
        if (!url) { log('⚠ Please enter a product URL first.'); return; }

        set(STORAGE_KEY_URL, url);
        set(STORAGE_KEY_QTY, qty);
        set(STORAGE_KEY_STAGE, 'idle');
      }

      set(STORAGE_KEY_ACTIVE, nowActive);

      const btn = document.getElementById('tbot-start-btn');
      const dot = document.querySelector('#tbot-panel .dot');
      if (nowActive) {
        btn.textContent = '⏹ Stop Monitoring';
        btn.classList.add('active');
        dot.classList.remove('inactive');
        log('🟢 Monitoring started. Navigating to product…');
        startBuyFlow(get(STORAGE_KEY_URL, ''), get(STORAGE_KEY_QTY, 1));
      } else {
        btn.textContent = '▶ Monitor & Buy';
        btn.classList.remove('active');
        dot.classList.add('inactive');
        log('⏹ Monitoring stopped.');
      }
    });

    // ── Sync UI state periodically ──
    setInterval(() => {
      const isActive = get(STORAGE_KEY_ACTIVE, false);
      const btn = document.getElementById('tbot-start-btn');
      const dot = document.querySelector('#tbot-panel .dot');
      if (!btn) return;

      if (isActive && !btn.classList.contains('active')) {
        btn.textContent = '⏹ Stop Monitoring';
        btn.classList.add('active');
        dot.classList.remove('inactive');
      } else if (!isActive && btn.classList.contains('active')) {
        btn.textContent = '▶ Monitor & Buy';
        btn.classList.remove('active');
        dot.classList.add('inactive');
      }

      const stat = document.getElementById('tbot-status');
      if (stat) {
        // Just re-render logs to make sure we have the latest from cross-page sync
        renderLogs();
      }
    }, 1000);
  }

  // ─── Dispatch single field to all child iframes with confirmation ────────
  function sendFieldToIframes(field, value, timeoutMs = 4500) {
    return new Promise(resolve => {
      let resolved = false;
      const handler = (e) => {
        if (e.data && e.data.type === 'TOPPS_FIELD_FILLED_CONFIRMATION') {
          const match = (field === 'number' && e.data.field === 'Card Number') ||
                        (field === 'expiry' && e.data.field === 'Expiration Date') ||
                        (field === 'cvv'    && e.data.field === 'Security Code (CVV)') ||
                        (field === 'name'   && e.data.field === 'Name on Card');
          if (match) {
            resolved = true;
            window.removeEventListener('message', handler);
            resolve(true);
          }
        }
      };
      window.addEventListener('message', handler);

      const payload = { type: 'TOPPS_FILL_FIELD', field, value };
      const frames = document.querySelectorAll('iframe');
      frames.forEach(frame => {
        try { frame.contentWindow.postMessage(payload, '*'); } catch {}
      });

      setTimeout(() => {
        if (!resolved) {
          window.removeEventListener('message', handler);
          resolve(false);
        }
      }, timeoutMs);
    });
  }

  // ─── Clean sequential card autofill ─────────────────────────────────────────
  async function fillCardSequential() {
    const cardNum   = get(STORAGE_KEY_CARD_NUM,  '').replace(/\D/g, '');
    const cardExpMm = get(STORAGE_KEY_CARD_EXP_MM, '').trim();
    const cardExpYy = get(STORAGE_KEY_CARD_EXP_YY, '').trim();
    const cardCvv   = get(STORAGE_KEY_CARD_CVV,  '').replace(/\D/g, '');
    const cardName  = get(STORAGE_KEY_CARD_NAME, '').trim();

    if (!cardNum && !cardExpMm && !cardCvv && !cardName) {
      log('⚠ Please enter card details in the panel first.');
      return false;
    }

    // Pre-flight validation warnings for user awareness
    if (cardExpYy) {
      const yyNum = parseInt(cardExpYy, 10);
      if (yyNum < 26) {
        log(`⚠ Warning: Expiration year '${cardExpYy}' is in the past! (Current year is 2026). Please update to a future year.`);
      }
    }
    if (cardNum && cardNum.length < 15) {
      log(`⚠ Warning: Card number has only ${cardNum.length} digits. Standard cards are 15-16 digits.`);
    }

    log('⚡ Starting sequential card autofill…');

    // 1. Card Number
    if (cardNum) {
      log('✍ Typing Card Number…');
      const ok = await sendFieldToIframes('number', cardNum);
      if (ok) log('✅ Card Number filled successfully!');
      else log('⚠ Card Number iframe did not confirm — moving next…');
      await sleep(200);
    }

    // 2. Expiration Date
    if (cardExpMm && cardExpYy) {
      log('✍ Typing Expiration Date…');
      const ok = await sendFieldToIframes('expiry', { mm: cardExpMm, yy: cardExpYy });
      if (ok) log('✅ Expiration Date filled successfully!');
      else log('⚠ Expiration Date iframe did not confirm — moving next…');
      await sleep(200);
    }

    // 3. Security Code (CVV)
    if (cardCvv) {
      log('✍ Typing Security Code (CVV)…');
      const ok = await sendFieldToIframes('cvv', cardCvv);
      if (ok) log('✅ Security Code (CVV) filled successfully!');
      else log('⚠ Security Code iframe did not confirm — moving next…');
      await sleep(200);
    }

    // 4. Name on Card
    if (cardName) {
      log('✍ Typing Name on card in iframe…');
      const ok = await sendFieldToIframes('name', cardName);
      if (ok) {
        log('✅ Name on Card filled successfully in iframe!');
      } else {
        // Fallback: try top-level page
        const topNameSelectors = [
          'input[name="name"][type="text"]:not(.visually-hidden)',
          'input[placeholder*="Name on card" i]',
          'input[placeholder*="name on card" i]',
          'input[placeholder*="Cardholder" i]',
          'input[autocomplete="cc-name"]:not(.visually-hidden)',
          '#name:not(.visually-hidden)',
          'input[name="name"]:not(.visually-hidden)'
        ];
        let topName = null;
        for (const sel of topNameSelectors) {
          const el = document.querySelector(sel);
          if (el && el.type !== 'hidden' && !el.classList.contains('visually-hidden')) {
            topName = el;
            break;
          }
        }
        if (topName) {
          log('✍ Typing Name on card (fallback)…');
          await forcePaste(topName, cardName);
          log('✅ Name on Card filled successfully!');
        } else {
          log('⚠ Name on Card field not found anywhere.');
        }
      }
      await sleep(300);
    }

    log('🎉 Card details filled!');
    return true;
  }

  // ─── Apply Discount Code ──────────────────────────────────────────────────
  // Fills the Shopify discount input and clicks the Apply button.
  // Skips silently if no code is saved.

  // ─── Wait for Shopify to accept all card fields ────────────────────────────
  // Polls up to maxWaitMs (default 20s) for:
  //   1. No red Shopify validation error text visible on the page
  //   2. Pay now button aria-busy is "false" (not processing)
  //   3. Pay now button is not disabled
  async function waitForPayReady(maxWaitMs = 20000) {
    const payBtnSelectors = [
      '#checkout-pay-button',
      'button[data-event-name="pay_button_inline"]',
      'button[aria-label="Pay now"]'
    ];

    // Shopify error message selectors (red text under fields)
    const errorSelectors = [
      '[id^="error-for-"]',
      '[data-error]',
      '.field__message--error',
      '[role="alert"]',
      '.notice--error',
      '[aria-live][aria-atomic] span',
      'p[data-checkout-field-error]'
    ];

    const started = Date.now();
    let attempt = 0;
    while (Date.now() - started < maxWaitMs) {
      attempt++;

      // Check Pay button exists and is not busy/disabled
      let btn = null;
      for (const sel of payBtnSelectors) {
        btn = document.querySelector(sel);
        if (btn) break;
      }

      if (!btn) {
        await sleep(500);
        continue;
      }

      const isBusy     = btn.getAttribute('aria-busy') === 'true';
      const isDisabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';

      // Check for completely missing fields (not just "invalid" from fake cards)
      let hasMissingError = false;
      const errorSelectors = [
        '[id^="error-for-"]',
        '[data-error]',
        '.field__message--error',
        '[role="alert"]',
        '.notice--error',
        '[aria-live][aria-atomic] span',
        'p[data-checkout-field-error]'
      ];

      for (const sel of errorSelectors) {
        const errEls = document.querySelectorAll(sel);
        for (const el of errEls) {
          const txt = el.textContent.trim();
          if (txt && el.offsetParent !== null) {
            const lowerTxt = txt.toLowerCase();
            
            // If it's just telling us to enter a *valid* card, we ignore it (fake card testing)
            if (lowerTxt.includes('enter a valid')) continue;

            // If it says exactly "enter a card number", the field is missing/cleared
            if (lowerTxt === 'enter a card number' || lowerTxt.includes('card number is incomplete')) {
              hasMissingError = true;
              if (attempt % 4 === 0) log('🔄 Auto-refilling missing Card Number...');
              const cardNum = get(STORAGE_KEY_CARD_NUM, '').replace(/\D/g, '');
              if (cardNum && attempt % 4 === 0) sendFieldToIframes('number', cardNum, 2000).catch(()=>{});
            } else if (lowerTxt === 'enter an expiration date' || lowerTxt.includes('expiration date is incomplete')) {
              hasMissingError = true;
              if (attempt % 4 === 0) log('🔄 Auto-refilling missing Expiration Date...');
              const mm = get(STORAGE_KEY_CARD_EXP_MM, '').trim();
              const yy = get(STORAGE_KEY_CARD_EXP_YY, '').trim();
              if (mm && yy && attempt % 4 === 0) sendFieldToIframes('expiry', { mm, yy }, 2000).catch(()=>{});
            } else if (lowerTxt === 'enter the cvv or security code on your card' || lowerTxt.includes('security code is incomplete')) {
              hasMissingError = true;
              if (attempt % 4 === 0) log('🔄 Auto-refilling missing CVV...');
              const cvv = get(STORAGE_KEY_CARD_CVV, '').replace(/\D/g, '');
              if (cvv && attempt % 4 === 0) sendFieldToIframes('cvv', cvv, 2000).catch(()=>{});
            } else if (lowerTxt.includes('enter your name')) {
              hasMissingError = true;
              if (attempt % 4 === 0) {
                log('🔄 Auto-refilling missing Name...');
                const name = get(STORAGE_KEY_CARD_NAME, '').trim();
                if (name) sendFieldToIframes('name', name, 2000).catch(()=>{});
              }
            }
          }
        }
      }

      // If button is ready and we don't have MISSING fields (ignoring fake invalid fields)
      if (!isBusy && !isDisabled && !hasMissingError) {
        log('✅ Pay button ready (ignoring fake card warnings) — proceeding to click!');
        return true;
      }

      const statusParts = [];
      if (isBusy)     statusParts.push('button busy');
      if (isDisabled) statusParts.push('button disabled');
      if (hasMissingError) statusParts.push('refilling missing fields');
      if (attempt % 4 === 0 && statusParts.length > 0) log(`⏳ Waiting for Shopify: ${statusParts.join(', ')}…`);

      await sleep(500);
    }
    return false; // timed out
  }

  // ─── Apply Discount Code ──────────────────────────────────────────────────
  // Fills the Shopify discount input and clicks the Apply button.
  // Skips silently if no code is saved.
  async function applyDiscountCode() {
    const code = get(STORAGE_KEY_DISCOUNT, '').trim();
    if (!code) return; // user left blank — skip

    log(`🏷️ Applying discount code: ${code}…`);

    // Selectors for the discount input on Shopify checkout
    const inputSelectors = [
      'input[name="reductions"]',
      'input[placeholder*="Discount code" i]',
      'input[placeholder*="discount" i]',
      'input[id*="Reductions" i]',
      '#checkout_reduction_code'
    ];

    let discountInput = null;
    for (const sel of inputSelectors) {
      discountInput = document.querySelector(sel);
      if (discountInput) break;
    }

    if (!discountInput) {
      log('⚠ Discount input not found — skipping coupon step.');
      return;
    }

    await humanType(discountInput, code);
    await sleep(400);

    // Click the Apply button
    const applySelectors = [
      'button[aria-label*="Apply Discount" i]',
      'button[data-event-name="apply_discount"]',
      'button[aria-label*="Apply" i]'
    ];

    let applyBtn = null;
    for (const sel of applySelectors) {
      applyBtn = document.querySelector(sel);
      if (applyBtn) break;
    }

    if (applyBtn) {
      applyBtn.click();
      log('✅ Discount code applied! Waiting for confirmation…');
      await sleep(1500); // wait for Shopify to validate & update totals
    } else {
      log('⚠ Apply button not found — code may not have been submitted.');
    }
  }

  // ─── Main buy flow ─────────────────────────────────────────────────────────
  async function startBuyFlow(productUrl, qty) {
    log(`🔍 Checking stock for ${productUrl} before navigating...`);
    const stock = await checkStockViaApi(productUrl);
    
    if (stock && !stock.available) {
      log('⛔ Item is OOS. Aborting manual navigate to prevent wasted load.');
      set(STORAGE_KEY_STAGE, 'idle');
      set(STORAGE_KEY_ACTIVE, false);
      return;
    }

    const targetPath = productUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\/$/, '');
    const currentPath = location.pathname.replace(/\/$/, '');

    set(STORAGE_KEY_ATC_ATTEMPTS, 0); // reset ATC retries

    if (currentPath === targetPath || location.href === productUrl) {
      log('📄 Already on product page. Starting purchase…');
      await buyOnProductPage(qty);
    } else {
      log('🔗 In stock! Opening product page…');
      location.href = productUrl;
    }
  }

  async function buyOnProductPage(qty) {
    if (!get(STORAGE_KEY_ACTIVE, false)) return;
    set(STORAGE_KEY_STAGE, 'adding');

    let attempts = get(STORAGE_KEY_ATC_ATTEMPTS, 0);
    const maxRetries = get(STORAGE_KEY_MAX_RETRIES, 5);
    
    if (attempts >= maxRetries) {
      log(`⛔ Max ATC retries reached (${maxRetries}). Cooldown triggered.`);
      set(STORAGE_KEY_STAGE, 'idle');
      set(STORAGE_KEY_ACTIVE, false);
      set(STORAGE_KEY_ATC_ATTEMPTS, 0);
      return;
    }

    attempts++;
    set(STORAGE_KEY_ATC_ATTEMPTS, attempts);

    try {
      log(`⏳ Waiting for Add to Cart button (Attempt ${attempts}/${maxRetries})…`);
      // Use a shorter timeout to fail fast and retry if it doesn't appear
      const addToCartBtn = await waitForElement('[data-testid="product-add-to-cart"]', 10000);

      // Check if button is disabled (sold out)
      if (addToCartBtn.disabled || addToCartBtn.textContent.toLowerCase().includes('sold out')) {
        log('⚠ ATC button is disabled (Sold Out).');
        await pollApiUntilInStock();
        return;
      }

      if (qty > 1) {
        log(`🔢 Setting quantity to ${qty}…`);
        const increaseBtn = await waitForElement('[aria-label="Increase quantity by one"]', 5000);
        for (let i = 1; i < qty; i++) {
          if (!get(STORAGE_KEY_ACTIVE, false)) return;
          if (increaseBtn && !increaseBtn.disabled) increaseBtn.click();
          await sleep(250 + Math.random() * 150);
        }
        await sleep(400 + Math.random() * 200);
      }

      if (!get(STORAGE_KEY_ACTIVE, false)) return;
      log('🛒 Clicking Add to Cart…');
      addToCartBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300 + Math.random() * 200);
      addToCartBtn.click();

      log('⏳ Waiting for cart to update…');
      const cartUpdated = await waitForCartUpdate(8000); // Shorter wait to retry faster

      if (cartUpdated) {
        log('✅ Item added to cart! Navigating to checkout…');
        set(STORAGE_KEY_STAGE, 'cart');
        set(STORAGE_KEY_ATC_ATTEMPTS, 0); // success, reset
        await sleep(600 + Math.random() * 300);
        location.href = 'https://www.topps.com/checkout/cart';
      } else {
        log('⚠ Cart did not update. Retrying ATC...');
        await sleep(1500);
        location.reload(); // Reload page for fresh state on retry
      }
    } catch (err) {
      if (err.message.includes('product-add-to-cart')) {
        log('⚠ ATC button not found on page.');
        await pollApiUntilInStock();
        return;
      }
      log(`❌ Error: ${err.message}. Retrying...`);
      await sleep(2000);
      location.reload();
    }
  }

  async function pollApiUntilInStock() {
    log('📡 Pausing page refresh, checking API in background...');
    while (get(STORAGE_KEY_ACTIVE, false)) {
      const minDelay = parseInt(get(STORAGE_KEY_API_MIN_DELAY, 4000), 10) || 4000;
      const maxDelay = parseInt(get(STORAGE_KEY_API_MAX_DELAY, 6000), 10) || 6000;
      const delayMs = Math.floor(minDelay + Math.random() * Math.max(0, maxDelay - minDelay));
      
      console.log(`[${new Date().toLocaleTimeString()}] [Topps Auto Buyer] 📡 Waiting ${delayMs}ms before next API check...`);
      await sleep(delayMs);
      
      console.log(`[${new Date().toLocaleTimeString()}] [Topps Auto Buyer] 📡 Checking API for: ${location.href}`);
      const stock = await checkStockViaApi(location.href);
      if (stock && stock.available) {
        console.log(`[${new Date().toLocaleTimeString()}] [Topps Auto Buyer] 🚨 IN STOCK! Refreshing page...`);
        log('🚨 API says In Stock! Reloading page to click ATC...');
        location.reload();
        return;
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] [Topps Auto Buyer] 🔴 Still Sold Out.`);
      }
    }
  }

  function waitForCartUpdate(timeout = 12000) {
    return new Promise(resolve => {
      const existing = document.querySelector('[data-testid="header-cart-count"]');
      if (existing) { resolve(true); return; }

      const obs = new MutationObserver(() => {
        const badge = document.querySelector('[data-testid="header-cart-count"]');
        if (badge) { obs.disconnect(); resolve(true); return; }

        const cartLink = document.querySelector('a[href="https://www.topps.com/checkout/cart"]');
        if (cartLink && cartLink.classList.contains('bg-interactive-secondary')) {
          obs.disconnect(); resolve(true); return;
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { obs.disconnect(); resolve(false); }, timeout);
    });
  }

  async function proceedToCheckout() {
    if (!get(STORAGE_KEY_ACTIVE, false)) return;
    try {
      log('⏳ Waiting for Proceed to Checkout button…');
      const checkoutBtn = await waitForElementByText('button', 'Proceed to checkout', 20000);
      if (checkoutBtn) {
        log('✅ Clicking Proceed to checkout…');
        set(STORAGE_KEY_STAGE, 'checkout');
        checkoutBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(500 + Math.random() * 300);
        checkoutBtn.click();
      }
    } catch (err) {
      log(`❌ Error: ${err.message}`);
      set(STORAGE_KEY_STAGE, 'idle');
      set(STORAGE_KEY_ACTIVE, false);
    }
  }

  // ─── Auto-resume logic ────────────────────────────────────────────────────
  async function autoResumeIfNeeded() {
    const isActive   = get(STORAGE_KEY_ACTIVE, false);
    const stage      = get(STORAGE_KEY_STAGE, 'idle');
    const qty        = get(STORAGE_KEY_QTY, 1);
    const productUrl = get(STORAGE_KEY_URL, '');
    const pageType   = currentPageType();

    // ── Checkout page handling ──
    if (pageType === 'checkout') {
      log('💳 Checkout page detected. Checking for discount code…');

      // Step 1: Apply discount code first (if any)
      await sleep(1000); // let the page settle
      await applyDiscountCode();

      // Step 2: Wait for payment iframe then fill card
      log('⏳ Waiting for credit card fields…');
      try {
        await waitForElement(
          'iframe[id*="card"], iframe[src*="shopify"], [data-card-field="number"]',
          15000
        );
      } catch {
        log('⚠ Payment iframes taking time – will attempt autofill…');
      }
      await sleep(800);

      // Step 3: Sequential autofill of card fields
      const filled = await fillCardSequential();
      if (!filled) {
        log('⛔ Card fill failed — check your card details in the panel.');
        return;
      }

      // Step 4: Wait for Shopify to validate all fields (no red errors + button ready)
      log('🔍 Verifying all fields accepted by Shopify…');
      const ready = await waitForPayReady();
      if (!ready) {
        log('⛔ Shopify still showing validation errors. Please fix and click Pay now manually.');
        return;
      }

      // Step 5: Submit payment
      log('💸 All fields valid. Submitting payment…');
      await sleep(300); 
      
      const payBtnSelectors = [
        '#checkout-pay-button',
        'button[data-event-name="pay_button_inline"]',
        'button[aria-label="Pay now"]'
      ];
      
      let payBtn = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        for (const sel of payBtnSelectors) {
          const btn = document.querySelector(sel);
          if (btn) {
            payBtn = btn;
            break;
          }
        }
        if (payBtn) break;
        await sleep(500);
      }
      
      if (payBtn) {
        log('🚀 Clicking Pay now button…');
        payBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        payBtn.focus();
        payBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        payBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        payBtn.click();
        const form = payBtn.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          try { form.requestSubmit(payBtn); } catch {}
        }
        log('🚀 Payment submitted!');
      } else {
        log('⚠ Pay now button not found. Please click manually.');
      }

      set(STORAGE_KEY_STAGE, 'done');
      set(STORAGE_KEY_ACTIVE, false);
      
      return;
    }

    if (!isActive || !productUrl) return;

    const targetPath  = productUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\/$/, '');
    const currentPath = location.pathname.replace(/\/$/, '');

    if (pageType === 'product' && (currentPath === targetPath || location.href === productUrl)) {
      if (stage === 'idle' || stage === 'adding') {
        await sleep(1800);
        log('🔄 Auto-resuming purchase on product page…');
        await buyOnProductPage(qty);
      }
    } else if (pageType === 'cart' && stage === 'cart') {
      await sleep(1800);
      log('🛒 On cart page. Proceeding to checkout…');
      await proceedToCheckout();
    } else if (stage === 'idle' || stage === 'adding') {
      log('🔗 Auto-resuming: navigating to product page…');
      location.href = productUrl;
    }
  }

  // ─── Entry Point ──────────────────────────────────────────────────────────
  function init() {
    // If running inside a cross-origin iframe (e.g. checkout.pci.shopifyinc.com)
    if (window.self !== window.top) {
      initIframeCardFiller();
      return;
    }

    // Main top-level window
    const inject = () => {
      buildUI();
      autoResumeIfNeeded();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      setTimeout(inject, 800);
    }
  }

  init();
})();
