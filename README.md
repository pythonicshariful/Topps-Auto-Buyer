# Topps Auto Buyer

A powerful, automated Userscript for monitoring and purchasing products on Topps.com (Shopify).

This tool is designed to help you secure limited drops and restocks by combining passive background API monitoring with aggressive, human-like automated checkout flows.

---

## 🚀 Features

### 1. 📡 Background Stock Monitor (Passive Mode)
- **Invisible API Polling:** Silently pings the Shopify JSON API (`/products/{handle}.js`) in the background without refreshing the page, saving bandwidth and avoiding rate-limiting.
- **Human-Like Delays:** Configurable **Min** and **Max** poll-interval settings randomize the time between checks (jitter).
- **Multi-URL Support:** Watch an unlimited number of product URLs simultaneously.
- **Alerts & Webhooks:** Plays a notification beep and sends a Discord/Slack Webhook the moment a product comes in stock.
- **🤖 Auto-Buy:** Toggle the **Auto** button next to any watched item. When the API detects stock, it will automatically launch the active checkout flow.

### 2. ▶ Monitor & Buy (Active Mode)
- **Pre-flight API Checks:** If you activate the bot on an Out-of-Stock product page, it won't endlessly hard-refresh your browser. Instead, it pauses and enters a background API polling loop. When stock is detected, it refreshes exactly **once** to grab the active "Add to Cart" button.
- **Auto Add to Cart:** Automatically selects your desired quantity and clicks "Add to Cart".
- **Cart Validation:** Ensures the cart actually updated before proceeding to checkout to avoid empty-cart errors.

### 3. 💳 Card Vault & Shopify PCI Auto-Fill
- **Secure Local Storage:** Saves your card details directly in your browser's local storage (never sent externally).
- **Blur Mode:** Hide your sensitive card details from the UI while streaming or screen sharing.
- **Advanced iframe Injection:** Shopify isolates credit card fields inside strict, cross-origin PCI-compliant iframes. This script injects an auto-filler directly into those iframes.
- **Human-Like Typing:** Simulates real keyboard events (`keydown`, `keypress`, `keyup`) with random millisecond delays between keystrokes.
- **Missing Field Recovery:** During checkout, if Shopify clears a field (e.g., CVV), the bot detects the error and automatically re-fills the missing field before retrying payment.

### 4. ⚙️ Floating Tabbed UI
- **Compact Design:** A draggable, collapsible floating panel organized into three tabs — **Monitor & Buy**, **Card Vault**, and **Settings**.
- **Position Memory:** Remembers exactly where you dragged the panel across page reloads.

---

## 🛠️ Installation

1. **Install a Userscript Manager:** Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey) for your browser.
2. **Install the Script:** Open Tampermonkey dashboard → **Create new script** → paste the full contents of `topps_autobuyer.user.js` → Save.
3. **Grant Permissions:** On first load, allow the script to send browser notifications when prompted.

---

## 📖 Complete Usage Guide

The bot appears as a small floating panel on **every `topps.com` page**. Click the header to collapse it to a small dot; click the dot to expand it again. Drag the header to reposition it anywhere on screen.

The panel has **three tabs**: `Monitor & Buy`, `Card Vault`, and `Settings`.

---

### Tab 1 — Monitor & Buy

This is the main control tab. It has two sections: the **Active Buy Bot** at the top and the **Background Stock Monitor** below.

#### Active Buy Bot

| Field / Button | What to enter / What it does |
|---|---|
| **Page** badge | Shows what page type the bot currently detects: `HOME`, `PRODUCT`, `CART`, `CHECKOUT`, or `SEARCH`. Read-only. |
| **Product URL (Buy Target)** | Paste the full Topps product page URL here (e.g., `https://www.topps.com/products/some-product`). This is the item the bot will navigate to, add to cart, and purchase. |
| **Quantity** | How many units to add to the cart. Min: 1, Max: 99. Defaults to 1. |
| **▶ Monitor & Buy** button | Starts the active buy flow (see [In Stock](#when-product-is-in-stock) / [Out of Stock](#when-product-is-out-of-stock) sections below). Turns red showing **⏹ Stop Monitoring** while active — click again to abort. |

#### Background Stock Monitor

| Field / Button | What to enter / What it does |
|---|---|
| **Paste URL input** | Paste a `https://www.topps.com/products/…` URL here, then press **+ Add** or hit `Enter`. Must be a valid topps.com product URL. |
| **+ Add** button | Adds the URL from the paste input to your watch list. Duplicate URLs are ignored. |
| **Watch list rows** | Each added URL appears as a row with a colored left border (🟢 green = in stock, 🔴 red = sold out) and a status pill (`✓ In Stock` / `✗ Sold Out` / `? Unknown`). Shows last-checked timestamp after the first poll. |
| **Qty** (per row, small number input) | The quantity to auto-buy for that specific URL when Auto-buy triggers. Set per-URL independently. |
| **Auto** button (per row) | Toggles auto-buy for that URL. When **🤖 Auto** is lit (purple glow), the bot will automatically trigger the full purchase flow the moment this item comes in stock. |
| **✕** button (per row) | Removes that URL from the watch list permanently. |
| **Min** (seconds) | Minimum poll interval for the background monitor. The bot always waits at least this many seconds between checks. Minimum: 5 s. Default: 20 s. |
| **Max** (seconds) | Maximum poll interval. The bot picks a random delay between Min and Max before each check (jitter). Default: 40 s. |
| **▶ Start Watching** button | Starts the background monitor. Immediately runs a first check on all URLs, then waits a random Min–Max interval before the next cycle. The blue pulse dot in the panel header activates. Turns red **⏹ Stop** while running. |
| **⚡ Check Now** button | Manually triggers an immediate stock check for all URLs in your watch list, regardless of whether the auto-monitor is running. |
| **Countdown bar** | A thin progress bar below the monitor title that drains down to zero to show time remaining until the next scheduled check. |

---

### Tab 2 — Card Vault

All card details are saved to browser local storage (via Tampermonkey's `GM_setValue`). They are **never transmitted anywhere** except directly into the Shopify PCI checkout iframe displayed on your screen.

| Field | What to enter |
|---|---|
| **Discount Code** | Optional. Enter a Topps/Shopify coupon or promo code (e.g., `SAVE10`). The bot will find the discount field at checkout and apply it automatically. Leave blank to skip this step. |
| **Card Number** | Your full 15–16 digit credit/debit card number. Spaces are fine — the bot strips non-digit characters before typing into the checkout form. |
| **Exp MM** | Card expiry **month** as exactly 2 digits (e.g., `06` for June, `12` for December). Max 2 characters. |
| **Exp YY** | Card expiry **year** as exactly 2 digits (e.g., `28` for 2028). Max 2 characters. Do **not** enter 4 digits. |
| **CVV** | The 3-digit (Visa/Mastercard/Discover) or 4-digit (Amex) security code printed on your card. Stored as a masked password field. |
| **Name on Card** | The cardholder name exactly as printed on the card (e.g., `John Smith`). Must match your billing details. |
| **Phone Number** | Your phone number in international format (e.g., `+14015551234`). **Required** by Shopify to complete checkout — orders may be rejected without it. |

| Button | What it does |
|---|---|
| **💾 Save Card** | Saves all card fields to local storage, automatically blurs (hides) the form for security, and immediately attempts to fill the card into any currently open Shopify checkout iframe. Always click this after entering or changing your card details. |
| **🔒 Hide / 👁 Show** | Toggles the blur overlay on the card fields so you can safely stream or screenshare without exposing card data. The saved values are never erased by toggling. |
| **⚡ Fill Card into Form** | Manually triggers the iframe card-fill sequence on the current page. Use this if the auto-fill didn't fire, or if you want to re-fill on an already-open checkout page. |

---

### Tab 3 — Settings

| Field / Toggle | What it does |
|---|---|
| **🔊 Play Sound on In-Stock** (checkbox) | When checked, plays a three-tone ascending beep alert the moment a watched product is detected in stock. Uncheck to silence all audio alerts. |
| **Max ATC Retries** | How many times the bot will retry clicking "Add to Cart" if the cart fails to update (e.g., due to race conditions or network lag). Default: 5. Range: 1–20. |
| **Webhook URL (Discord/Slack)** | Paste a Discord or Slack incoming webhook URL here. When any watched item comes in stock, the bot POSTs an alert message to that channel. Discord webhooks are auto-detected via `discord.com` in the URL; all other URLs use Slack/generic JSON format. Leave blank to disable. |
| **Min Delay (ms)** | Minimum delay in **milliseconds** between API stock checks when the bot is waiting on an out-of-stock product page in **Active Mode**. Default: 4000 ms (4 s). Minimum: 500 ms. |
| **Max Delay (ms)** | Maximum delay in **milliseconds** for the same Active Mode OOS polling loop. The bot picks a random value between Min and Max each cycle. Default: 6000 ms (6 s). |

> **Note — Two separate delay settings exist:**
> - **Active Polling Delay (ms)** in the Settings tab → controls the Active Buy Bot's OOS wait loop (milliseconds, default 4000–6000 ms).
> - **Min / Max (seconds)** in the Monitor section of the Monitor & Buy tab → controls the Background Stock Monitor's passive polling interval (seconds, default 20–40 s).

---

## 🔄 Behavior: In Stock vs. Out of Stock

### When product is In Stock

#### Active Mode (▶ Monitor & Buy)

1. Bot navigates to the product page URL you entered.
2. It calls the Shopify API to confirm at least one variant is available.
3. It selects the desired **Quantity**.
4. It clicks **Add to Cart** and waits for the cart counter to increment.
5. If the cart doesn't update, it retries up to **Max ATC Retries** times.
6. Once cart is confirmed, it navigates to `/checkout`.
7. At checkout it fills the **Phone Number** field.
8. If a **Discount Code** is saved, it finds the discount input, types the code, and clicks Apply.
9. It fills **Card Number → Expiry Date → CVV → Name on Card** into the Shopify PCI iframe sequentially.
10. It waits for all Shopify validation errors to clear (no red messages, Pay button enabled and not processing).
11. It clicks the **Pay now** button.
12. Done! 🎉 The bot stops monitoring.

#### Background Monitor + Auto-Buy

The same steps as above trigger automatically when the monitor detects in-stock and Auto is enabled for that URL.

---

### When product is Out of Stock

#### Active Mode (▶ Monitor & Buy) — OOS Loop

1. You click **▶ Monitor & Buy** (bot may also be on the product page already).
2. The bot calls the Shopify API (`/products/{handle}.js`) — it detects all variants are `available: false`.
3. It enters a **silent polling loop**: calls the API every random **Min–Max Delay ms** (Settings tab, default 4–6 s).
4. **No hard page refreshes** occur — the page stays loaded, saving bandwidth and avoiding detection.
5. Status log shows: `🔴 [Product Title] — all X sold out` on each poll cycle.
6. The moment **any variant** becomes available:
   - Logs `🟢 IN STOCK: [Product Title]`
   - Performs a **single page refresh** (`location.reload()`) to load the live product page with the Add to Cart button active.
   - Immediately proceeds through the full purchase flow.

#### Background Monitor (Passive Mode) — OOS State

1. You paste a URL → click **+ Add** → click **▶ Start Watching**.
2. The bot polls the Shopify API for each watch-list URL one by one, every random **Min–Max seconds** (default 20–40 s).
3. **While sold out:**
   - Row shows 🔴 red left border and `✗ Sold Out` pill.
   - Status log: `🔴 [Title] — all X sold out`.
   - Bot waits the configured interval and polls again.
4. **When stock is detected:**
   - Row turns 🟢 green with `✓ In Stock` pill and a last-checked timestamp.
   - A **beep alert** plays (if sound is enabled).
   - A **browser push notification** fires: *"Topps Auto Buyer — 🚨 IN STOCK: [Title]"*.
   - A **webhook message** is POSTed to your Discord/Slack channel (if configured).
   - If **Auto** is enabled for that URL, the bot sets it as the active buy target and triggers the full purchase flow.
   - Each in-stock event fires the alert only **once per stock period** (de-duplicated). If the item sells out and restocks again, it alerts again.

---

## 💡 Tips & Best Practices

- **Set up your Card Vault first.** Before starting any buy flow, fill all fields in the **Card Vault** tab and click **💾 Save Card**.
- **Use reasonable poll intervals.** Setting Min/Max in the background monitor below 10 s significantly increases the risk of your IP being rate-limited by Shopify. 20–40 s is a safe default.
- **Keep the tab open.** The background monitor only runs while the topps.com tab is alive. The tab does **not** need to be in focus.
- **One active buy at a time.** If Auto-buy fires for one item, it won't trigger for another item until the first flow finishes or is stopped.
- **Phone number is required.** Shopify may reject the order without a valid phone. Ensure the Phone Number field in the Card Vault is filled.
- **Discount codes are optional.** Leave the field blank if you have no code — the bot silently skips that step.
- **Manual fill on any checkout page.** Open the Card Vault tab and click **⚡ Fill Card into Form** to manually trigger auto-fill without running the full bot flow.
- **Exp YY must be 2 digits.** Enter `28`, not `2028`. The bot will warn you in the status log if the year appears to be in the past.

---

## ⚠️ Disclaimer

This tool is for educational purposes only. Use responsibly. Rapidly calling the Shopify API or automating checkout can lead to your IP being temporarily banned by Shopify or Topps. Always use reasonable Min/Max delays and do not run multiple simultaneous bots on the same IP.
