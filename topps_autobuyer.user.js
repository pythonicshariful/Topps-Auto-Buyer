// ==UserScript==
// @name         Topps Auto Buyer
// @namespace    https://www.topps.com/
// @version      1.5
// @description  Monitor & auto-buy products on topps.com with a floating UI panel
// @author       Pythonic Shariful
// @match        https://www.topps.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const STORAGE_KEY_URL      = 'topps_product_url';
  const STORAGE_KEY_QTY      = 'topps_quantity';
  const STORAGE_KEY_ACTIVE   = 'topps_monitoring';
  const STORAGE_KEY_STATUS   = 'topps_status';
  const STORAGE_KEY_STAGE    = 'topps_stage';   // 'idle' | 'adding' | 'done'

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const get = (k, d) => { try { return GM_getValue(k, d); } catch { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch {} };

  function log(msg) {
    console.log('[ToppsBot]', msg);
    set(STORAGE_KEY_STATUS, msg);
    const el = document.getElementById('tbot-status');
    if (el) el.textContent = msg;
  }

  function currentPageType() {
    const u = location.href;
    if (u.includes('/catalogsearch/result')) return 'search';
    if (u.includes('/checkout/cart'))        return 'cart';
    const productUrl = get(STORAGE_KEY_URL, '');
    if (productUrl && u.includes(productUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0])) return 'product';
    // Generic product page detection
    if (/\/products\/[^/?#]+/.test(u)) return 'product';
    return 'home';
  }

  // ─── Sleep helper ─────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ─── Wait for element ─────────────────────────────────────────────────────
  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const found = document.querySelector(selector);
        if (found) { obs.disconnect(); resolve(found); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
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

  // ─── CSS ──────────────────────────────────────────────────────────────────
  GM_addStyle(`
    #tbot-panel {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'Segoe UI', system-ui, sans-serif;
      width: 320px;
      border-radius: 14px;
      background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 60%, #16213e 100%);
      box-shadow: 0 8px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07);
      overflow: hidden;
      transition: all .3s cubic-bezier(.4,0,.2,1);
    }
    #tbot-panel.collapsed { width: 52px; height: 52px; border-radius: 50%; cursor: pointer; }
    #tbot-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px;
      background: rgba(255,255,255,0.05);
      border-bottom: 1px solid rgba(255,255,255,0.07);
      user-select: none; cursor: pointer;
    }
    #tbot-header .title {
      font-size: 13px; font-weight: 700; letter-spacing: .5px;
      color: #e0e7ff;
      display: flex; align-items: center; gap: 8px;
    }
    #tbot-header .title .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #4ade80; box-shadow: 0 0 6px #4ade80;
      transition: background .3s;
    }
    #tbot-header .title .dot.inactive { background: #6b7280; box-shadow: none; }
    #tbot-header .toggle-btn {
      font-size: 18px; color: #94a3b8; transition: transform .3s;
      background: none; border: none; cursor: pointer; padding: 0;
    }
    #tbot-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 10px; }
    .tbot-label {
      font-size: 10px; font-weight: 600; letter-spacing: .8px;
      color: #64748b; text-transform: uppercase; margin-bottom: 3px;
    }
    .tbot-input {
      width: 100%; box-sizing: border-box;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; color: #e2e8f0;
      font-size: 12px; padding: 8px 10px;
      outline: none; transition: border-color .2s;
    }
    .tbot-input:focus { border-color: #6366f1; }
    .tbot-row { display: flex; gap: 8px; align-items: flex-end; }
    .tbot-row .tbot-input { flex: 1; }
    #tbot-qty-input { width: 70px; flex: none; text-align: center; }
    #tbot-start-btn {
      width: 100%; padding: 10px; border-radius: 8px; border: none;
      font-size: 13px; font-weight: 700; letter-spacing: .4px;
      cursor: pointer; transition: all .2s;
      background: linear-gradient(90deg, #6366f1, #8b5cf6);
      color: #fff; box-shadow: 0 4px 15px rgba(99,102,241,.35);
    }
    #tbot-start-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(99,102,241,.5); }
    #tbot-start-btn.active {
      background: linear-gradient(90deg, #ef4444, #dc2626);
      box-shadow: 0 4px 15px rgba(239,68,68,.35);
    }
    #tbot-status-wrap {
      background: rgba(0,0,0,0.25); border-radius: 8px; padding: 8px 10px;
      min-height: 36px;
    }
    #tbot-status {
      font-size: 11px; color: #94a3b8; line-height: 1.4;
      word-break: break-word;
    }
    #tbot-page-badge {
      display: inline-block; font-size: 10px; font-weight: 600;
      padding: 2px 8px; border-radius: 20px; letter-spacing: .4px;
      background: rgba(99,102,241,0.2); color: #a5b4fc;
      border: 1px solid rgba(99,102,241,0.3);
    }
    .collapsed #tbot-body, .collapsed #tbot-status-wrap, .collapsed #tbot-header .title span,
    .collapsed #tbot-header .toggle-btn { display: none; }
    .collapsed #tbot-header { border: none; padding: 0; width: 52px; height: 52px;
      justify-content: center; border-radius: 50%; }
    .collapsed .dot { display: block !important; width: 18px; height: 18px; }
  `);

  // ─── Build panel UI ────────────────────────────────────────────────────────
  function buildUI() {
    if (document.getElementById('tbot-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tbot-panel';

    const savedUrl   = get(STORAGE_KEY_URL, '');
    const savedQty   = get(STORAGE_KEY_QTY, 1);
    const isActive   = get(STORAGE_KEY_ACTIVE, false);
    const lastStatus = get(STORAGE_KEY_STATUS, 'Idle — set a product URL and click Monitor & Buy');
    const pageType   = currentPageType();

    panel.innerHTML = `
      <div id="tbot-header">
        <div class="title">
          <div class="dot ${isActive ? '' : 'inactive'}"></div>
          <span>Topps Auto Buyer</span>
        </div>
        <button class="toggle-btn" id="tbot-toggle" title="Collapse">▲</button>
      </div>
      <div id="tbot-body">
        <div>
          <div class="tbot-label">Page</div>
          <span id="tbot-page-badge">${pageType.toUpperCase()}</span>
        </div>
        <div>
          <div class="tbot-label">Product URL</div>
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
        <div id="tbot-status-wrap">
          <div id="tbot-status">${lastStatus}</div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // ── Collapse toggle ──
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

    // ── Sync UI state periodically across tabs ──
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
      
      // Update status text safely
      const stat = document.getElementById('tbot-status');
      const savedStat = get(STORAGE_KEY_STATUS, '');
      if (stat && stat.textContent !== savedStat) {
        stat.textContent = savedStat;
      }
    }, 1000);
  }

  // ─── Main buy flow ─────────────────────────────────────────────────────────
  async function startBuyFlow(productUrl, qty) {
    // Normalise URL comparison
    const targetPath = productUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\/$/, '');
    const currentPath = location.pathname.replace(/\/$/, '');

    if (currentPath === targetPath || location.href === productUrl) {
      log('📄 Already on product page. Starting purchase…');
      await buyOnProductPage(qty);
    } else {
      log('🔗 Opening product page…');
      location.href = productUrl;
    }
  }

  // ─── Execute purchase on product page ─────────────────────────────────────
  async function buyOnProductPage(qty) {
    if (!get(STORAGE_KEY_ACTIVE, false)) return;
    set(STORAGE_KEY_STAGE, 'adding');

    try {
      // 1. Wait for the Add to Cart button to appear and be enabled
      log('⏳ Waiting for Add to Cart button…');
      const addToCartBtn = await waitForElement('[data-testid="product-add-to-cart"]', 20000);

      // 2. Set quantity (click + button qty-1 times, starting from 1)
      if (qty > 1) {
        log(`🔢 Setting quantity to ${qty}…`);
        const increaseBtn = await waitForElement('[aria-label="Increase quantity by one"]', 10000);
        for (let i = 1; i < qty; i++) {
          if (!get(STORAGE_KEY_ACTIVE, false)) return;
          increaseBtn.click();
          await sleep(250 + Math.random() * 150); // human-like delay
        }
        // Verify quantity input
        const qtyInput = document.querySelector('[aria-label="Quantity input"]');
        if (qtyInput) {
          log(`✅ Quantity set to ${qtyInput.value}`);
        }
        await sleep(400 + Math.random() * 200);
      }

      // 3. Click Add to Cart
      if (!get(STORAGE_KEY_ACTIVE, false)) return;
      log('🛒 Clicking Add to Cart…');

      // Scroll into view for realism
      addToCartBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(300 + Math.random() * 200);
      addToCartBtn.click();

      // 4. Wait for cart icon to update (badge appears or class changes)
      log('⏳ Waiting for cart to update…');
      const cartUpdated = await waitForCartUpdate(12000);

      if (cartUpdated) {
        log('✅ Item added to cart! Navigating to checkout…');
        set(STORAGE_KEY_STAGE, 'cart');
        await sleep(600 + Math.random() * 300);
        location.href = 'https://www.topps.com/checkout/cart';
      } else {
        log('⚠ Cart may not have updated. Check manually.');
        set(STORAGE_KEY_STAGE, 'idle');
        set(STORAGE_KEY_ACTIVE, false);
      }
    } catch (err) {
      log(`❌ Error: ${err.message}`);
      set(STORAGE_KEY_STAGE, 'idle');
    }
  }

  // ─── Detect cart update ───────────────────────────────────────────────────
  function waitForCartUpdate(timeout = 12000) {
    return new Promise(resolve => {
      // Already has a count badge?
      const existing = document.querySelector('[data-testid="header-cart-count"]');
      if (existing) { resolve(true); return; }

      const obs = new MutationObserver(() => {
        // Check for cart count badge appearing
        const badge = document.querySelector('[data-testid="header-cart-count"]');
        if (badge) { obs.disconnect(); resolve(true); return; }

        // Check cart icon bg change (bg-interactive-secondary added to cart link)
        const cartLink = document.querySelector('a[href="https://www.topps.com/checkout/cart"]');
        if (cartLink && cartLink.classList.contains('bg-interactive-secondary')) {
          obs.disconnect(); resolve(true); return;
        }
      });
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      setTimeout(() => { obs.disconnect(); resolve(false); }, timeout);
    });
  }

  // ─── Proceed to checkout on cart page ─────────────────────────────────────
  async function proceedToCheckout() {
    if (!get(STORAGE_KEY_ACTIVE, false)) return;
    try {
      log('⏳ Waiting for Proceed to Checkout button…');
      const checkoutBtn = await waitForElementByText('button', 'Proceed to checkout', 20000);
      if (checkoutBtn) {
        log('✅ Clicking Proceed to checkout…');
        set(STORAGE_KEY_STAGE, 'checkout');
        set(STORAGE_KEY_ACTIVE, false); // Bot finishes here, or you can expand later
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

  // ─── Auto-resume on product page ──────────────────────────────────────────
  async function autoResumeIfNeeded() {
    const isActive = get(STORAGE_KEY_ACTIVE, false);
    const stage    = get(STORAGE_KEY_STAGE, 'idle');
    const qty      = get(STORAGE_KEY_QTY, 1);
    const productUrl = get(STORAGE_KEY_URL, '');

    if (!isActive || !productUrl) return;

    const pageType = currentPageType();
    const targetPath = productUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0].replace(/\/$/, '');
    const currentPath = location.pathname.replace(/\/$/, '');

    if (pageType === 'product' && (currentPath === targetPath || location.href === productUrl)) {
      if (stage === 'idle' || stage === 'adding') {
        // Small delay to let the page render
        await sleep(1800);
        log('🔄 Auto-resuming purchase on product page…');
        await buyOnProductPage(qty);
      }
    } else if (pageType === 'cart' && stage === 'cart') {
      // Small delay to let cart load
      await sleep(1800);
      log('🛒 On cart page. Proceeding to checkout…');
      await proceedToCheckout();
    } else if (stage === 'idle' || stage === 'adding') {
      // Bot is active but we're not on the target product page or cart.
      // E.g. user refreshed the home page or opened a new tab.
      log('🔗 Auto-resuming: navigating to product page…');
      location.href = productUrl;
    }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    const inject = () => {
      buildUI();
      autoResumeIfNeeded();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', inject);
    } else {
      // Short delay for SPA hydration
      setTimeout(inject, 800);
    }
  }

  init();
})();
