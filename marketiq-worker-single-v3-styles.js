export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") return new Response("ok", { status: 200 });

      // ===== MINI APP (inline) =====
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
        return htmlResponse(MINI_APP_HTML);
      }
      if (request.method === "GET" && url.pathname === "/app.js") {
        return jsResponse(MINI_APP_JS);
      }

      // ===== MINI APP APIs =====
      if (url.pathname === "/api/user" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);
        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env);
        const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
        const symbols = [...MAJORS, ...METALS, ...INDICES, ...CRYPTOS];

        return jsonResponse({
          ok: true,
          welcome: WELCOME_MINIAPP,
          state: st,
          quota,
          symbols,
          wallet: (await getWallet(env)) || "",
        });
      }

      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env);

        // users can tweak only their preferences (admin-only prompt/wallet enforced elsewhere)
        if (typeof body.timeframe === "string") st.timeframe = body.timeframe;
        if (typeof body.style === "string") st.style = body.style;
        if (typeof body.risk === "string") st.risk = body.risk;
        if (typeof body.newsEnabled === "boolean") st.newsEnabled = body.newsEnabled;

        if (env.BOT_KV) await saveUser(v.userId, st, env);

        const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
        return jsonResponse({ ok: true, state: st, quota });
      }

      if (url.pathname === "/api/analyze" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await verifyTelegramInitData(body.initData, env.TELEGRAM_BOT_TOKEN);
        if (!v.ok) return jsonResponse({ ok: false, error: v.reason }, 401);

        const st = await ensureUser(v.userId, env);
        const symbol = String(body.symbol || "").trim();
        if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

        // must complete onboarding before using AI analysis (name+contact at least)
        if (!st.profile?.name || !st.profile?.phone) {
          return jsonResponse({ ok: false, error: "onboarding_required" }, 403);
        }

        if (env.BOT_KV && !canAnalyzeToday(st, v.fromLike, env)) {
          const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
          return jsonResponse({ ok: false, error: `quota_exceeded_${quota}` }, 429);
        }

        if (env.BOT_KV) {
          consumeDaily(st, v.fromLike, env);
          await saveUser(v.userId, st, env);
        }

        const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt : "";

        try {
          const result = await runSignalTextFlowReturnText(env, v.fromLike, st, symbol, userPrompt);
          const quota = isStaff(v.fromLike, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
          return jsonResponse({ ok: true, result, state: st, quota });
        } catch (e) {
          console.error("api/analyze error:", e);
          return jsonResponse({ ok: false, error: "server_error" }, 500);
        }
      }

      // Telegram webhook route: /telegram/<secret>
      if (url.pathname.startsWith("/telegram/")) {
        const secret = url.pathname.split("/")[2] || "";
        if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== String(env.TELEGRAM_WEBHOOK_SECRET)) {
          return new Response("forbidden", { status: 403 });
        }
        if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

        const update = await request.json().catch(() => null);
        if (!update) return new Response("bad request", { status: 400 });

        // respond fast; do heavy work in waitUntil
        ctx.waitUntil(handleUpdate(update, env));
        return new Response("ok", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("fetch error:", e);
      return new Response("error", { status: 500 });
    }
  },
};

/* ========================== BRAND / COPY ========================== */
const BOT_NAME = "MarketiQ";
const WELCOME_BOT =
`🎯 متن خوش‌آمدگویی بات تلگرام MarketiQ

👋 به MarketiQ خوش آمدید
هوش تحلیلی شما در بازارهای مالی

────────────────────────

📊 MarketiQ یک ایجنت تخصصی تحلیل بازارهای مالی است که با تمرکز بر تصمیم‌سازی هوشمند، در کنار شماست تا بازار را درست‌تر، عمیق‌تر و حرفه‌ای‌تر ببینید.

🔍 در MarketiQ چه دریافت می‌کنید؟
✅ تحلیل فاندامنتال بازارهای مالی
✅ تحلیل تکنیکال دقیق و ساختاریافته
✅ سیگنال‌های معاملاتی با رویکرد مدیریت ریسک
✅ پوشش بازارها:
- 🪙 کریپتوکارنسی
- 💱 جفت‌ارزها (Forex)
- 🪙 فلزات گران‌بها
- 📈 سهام

────────────────────────

🧠 فلسفه MarketiQ
ما سیگنال نمی‌فروشیم، ما «درک بازار» می‌سازیم.
هدف ما کمک به شما برای تصمیم‌گیری آگاهانه است، نه وابستگی کورکورانه به سیگنال.

────────────────────────

🚀 شروع کنید
/start | شروع تحلیل
/signals | سیگنال‌ها
/education | آموزش و مفاهیم بازار
/support | پشتیبانی

────────────────────────

⚠️ سلب مسئولیت:
تمام تحلیل‌ها صرفاً جنبه آموزشی و تحلیلی دارند و مسئولیت نهایی معاملات بر عهده کاربر است.`;

const WELCOME_MINIAPP =
`👋 به MarketiQ خوش آمدید — هوش تحلیلی شما در بازارهای مالی
این مینی‌اپ برای گرفتن تحلیل سریع، تنظیمات، و مدیریت دسترسی طراحی شده است.
⚠️ تحلیل‌ها آموزشی است و مسئولیت معاملات با شماست.`;

/* ========================== CONFIG ========================== */
const MAJORS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"];
const METALS = ["XAUUSD", "XAGUSD"];
const INDICES = ["DJI", "NDX", "SPX"];
const CRYPTOS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
  "ADAUSDT","DOGEUSDT","TRXUSDT","TONUSDT","AVAXUSDT",
  "LINKUSDT","DOTUSDT","MATICUSDT","LTCUSDT","BCHUSDT",
];

const BTN = {
  ANALYZE: "✅ تحلیل کن",
  SIGNAL: "📈 سیگنال‌ها",
  SETTINGS: "⚙️ تنظیمات",
  PROFILE: "👤 پروفایل",
  SUPPORT: "🆘 پشتیبانی",
  EDUCATION: "📚 آموزش",
  LEVELING: "🧪 تعیین سطح",
  BACK: "⬅️ برگشت",
  HOME: "🏠 منوی اصلی",
  MINIAPP: "🧩 مینی‌اپ",

  CAT_MAJORS: "💱 ماجورها",
  CAT_METALS: "🪙 فلزات",
  CAT_INDICES: "📊 شاخص‌ها",
  CAT_CRYPTO: "₿ کریپتو (15)",

  SET_TF: "⏱ تایم‌فریم",
  SET_STYLE: "🎯 سبک",
  SET_RISK: "⚠️ ریسک",
  SET_NEWS: "📰 خبر",
};

const TYPING_INTERVAL_MS = 4000;
const TIMEOUT_TEXT_MS = 11000;
const TIMEOUT_VISION_MS = 12000;
const TIMEOUT_POLISH_MS = 9000;

/* ========================== UTILS ========================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunkText(s, size = 3500) {
  const out = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function timeoutPromise(ms, label = "timeout") {
  return new Promise((_, rej) => setTimeout(() => rej(new Error(label)), ms));
}

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

function toInt(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normHandle(h) {
  if (!h) return "";
  return "@" + String(h).replace(/^@/, "").toLowerCase();
}

function isStaff(from, env) {
  // staff = admin or owner
  return isOwner(from, env) || isAdmin(from, env);
}

function isOwner(from, env) {
  const u = normHandle(from?.username);
  if (!u) return false;
  const raw = (env.OWNER_HANDLES || "").toString().trim();
  if (!raw) return false;
  const set = new Set(raw.split(",").map(normHandle).filter(Boolean));
  return set.has(u);
}

function isAdmin(from, env) {
  const u = normHandle(from?.username);
  if (!u) return false;
  const raw = (env.ADMIN_HANDLES || "").toString().trim();
  if (!raw) return false;
  const set = new Set(raw.split(",").map(normHandle).filter(Boolean));
  return set.has(u);
}

function kyivDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function parseOrder(raw, fallbackArr) {
  const s = (raw || "").toString().trim();
  if (!s) return fallbackArr;
  return s.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
}

function detectMimeFromHeaders(resp, fallback = "image/jpeg") {
  const ct = resp.headers.get("content-type") || "";
  if (ct.startsWith("image/")) return ct.split(";")[0].trim();
  return fallback;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function randomCode(len = 10) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/* ========================== PROMPTS (ADMIN/OWNER ONLY) ========================== */
const DEFAULT_ANALYSIS_PROMPT = `SYSTEM OVERRIDE: ACTIVATE INSTITUTIONAL MODE

ROLE: You are an elite “Liquidity Hunter Algorithm” tracking Smart Money.
INPUT CONTEXT: {TIMEFRAME} Timeframe Chart.

MINDSET
Retail traders predict. Whales react.
Focus on Liquidity Pools (Targets) and Imbalances (Magnets).
Crucial: Determine what happens AT the target level (Reversal vs. Continuation).

ANALYSIS PROTOCOL
LIQUIDITY MAPPING: Where are the Stop Losses? (The Target).
MANIPULATION DETECTOR: Identify recent traps/fake-outs.
INSTITUTIONAL FOOTPRINT: Locate Order Blocks/FVGs (The Defense Wall).
THE KILL ZONE: Predict the next move to the liquidity pool.
REACTION LOGIC (THE MOST IMPORTANT PART): Analyze the specific target level. What specifically needs to happen for a “Reversal” (Sweep) vs a “Collapse” (Breakout)?

OUTPUT FORMAT (STRICTLY PERSIAN - فارسی)
Use a sharp, revealing, and “whistle-blower” tone.

۱. نقشه پول‌های پارک‌شده (شکارگاه نهنگ‌ها):
۲. تله‌های قیمتی اخیر (فریب بازار):
۳. ردپای ورود پول هوشمند (دیوار بتنی):
۴. سناریوی بی‌رحمانه بعدی (مسیر احتمالی):
۵. استراتژی لحظه برخورد (ماشه نهایی):

سناریوی بازگشت (Reversal):
سناریوی سقوط/صعود (Continuation):`;

/* ========================== STYLE PROMPTS (DEFAULTS) ==========================
 * Users choose st.style (Persian labels) and we inject a style-specific guide
 * into the analysis prompt. Admin can still override the global base prompt via KV.
 */
const STYLE_PROMPTS_DEFAULT = {
  "پرایس اکشن": `You are a professional Price Action trader and market analyst.

Analyze the given market (Symbol, Timeframe) using pure Price Action concepts only.
Do NOT use indicators unless explicitly requested.

Your analysis must include:

1. Market Structure
- Identify the current structure (Uptrend / Downtrend / Range)
- Mark HH, HL, LH, LL
- Specify whether structure is intact or broken (BOS / MSS)

2. Key Levels
- Strong Support & Resistance zones
- Flip zones (SR → Resistance / Resistance → Support)
- Psychological levels (if relevant)

3. Candlestick Behavior
- Identify strong rejection candles (Pin bar, Engulfing, Inside bar)
- Explain what these candles indicate about buyers/sellers

4. Entry Scenarios
For each valid setup:
- Entry zone
- Stop Loss (logical, structure-based)
- Take Profit targets (TP1 / TP2)
- Risk to Reward (minimum 1:2)

5. Bias & Scenarios
- Main bias (Bullish / Bearish / Neutral)
- Alternative scenario if price invalidates the setup

6. Execution Plan
- Is this a continuation or reversal trade?
- What confirmation is required before entry?

Explain everything step-by-step, clearly and professionally.
Avoid overtrading. Focus on high-probability setups only.`,
  "ICT": `You are an ICT (Inner Circle Trader) & Smart Money analyst.

Analyze the market (Symbol, Timeframe) using ICT & Smart Money Concepts ONLY.

Your analysis must include:

1. Higher Timeframe Bias
- Determine HTF bias (Daily / H4)
- Identify Premium & Discount zones
- Is price in equilibrium or imbalance?

2. Liquidity Mapping
- Identify:
  - Equal Highs / Equal Lows
  - Buy-side liquidity
  - Sell-side liquidity
- Mark likely stop-loss pools

3. Market Structure
- Identify:
  - BOS (Break of Structure)
  - MSS (Market Structure Shift)
- Clarify whether the move is manipulation or expansion

4. PD Arrays
- Order Blocks (Bullish / Bearish)
- Fair Value Gaps (FVG)
- Liquidity Voids
- Previous High / Low (PDH, PDL, PWH, PWL)

5. Kill Zones (if intraday)
- London Kill Zone
- New York Kill Zone
- Explain timing relevance

6. Entry Model
- Entry model used (e.g. Liquidity Sweep → MSS → FVG entry)
- Entry price
- Stop Loss (below/above OB or swing)
- Take Profits (liquidity targets)

7. Narrative
- Explain the story:
  - Who is trapped?
  - Where did smart money enter?
  - Where is price likely engineered to go?

Provide a clear bullish/bearish execution plan and an invalidation point.`,
  "ATR": `You are a quantitative trading assistant specializing in volatility-based strategies.

Analyze the market (Symbol, Timeframe) using ATR (Average True Range) as the core tool.

Your analysis must include:

1. Volatility State
- Current ATR value
- Compare current ATR with historical average
- Is volatility expanding or contracting?

2. Market Condition
- Trending or Ranging?
- Is the market suitable for breakout or mean reversion?

3. Trade Setup
- Optimal Entry based on price structure
- ATR-based Stop Loss:
  - SL = Entry ± (ATR × Multiplier)
- ATR-based Take Profit:
  - TP1, TP2 based on ATR expansion

4. Position Sizing
- Risk per trade (%)
- Position size calculation based on SL distance

5. Trade Filtering
- When NOT to trade based on ATR
- High-risk volatility conditions (news, spikes)

6. Risk Management
- Max daily loss
- Max consecutive losses
- Trailing Stop logic using ATR

7. Summary
- Is this trade statistically justified?
- Expected trade duration
- Risk classification (Low / Medium / High)

Keep the explanation practical and execution-focused.`,
};

function normalizeStyleLabel(style) {
  const s = String(style || "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low === "price action" || low === "priceaction") return "پرایس اکشن";
  if (low === "ict") return "ICT";
  if (low === "atr") return "ATR";
  return s;
}

function getStyleGuide(style) {
  const key = normalizeStyleLabel(style);
  return STYLE_PROMPTS_DEFAULT[key] || "";
}


async function getAnalysisPrompt(env) {
  const kv = env.BOT_KV;
  if (!kv) return DEFAULT_ANALYSIS_PROMPT;
  const p = await kv.get("settings:analysis_prompt");
  return (p && p.trim()) ? p : DEFAULT_ANALYSIS_PROMPT;
}

/* ========================== KEYBOARDS ========================== */
function kb(rows) {
  return {
    keyboard: rows,
    resize_keyboard: true,
    one_time_keyboard: false,
    input_field_placeholder: "از دکمه‌ها استفاده کن…",
  };
}

function mainMenuKeyboard(env) {
  const url = getMiniappUrl(env);
  const miniRow = url ? [{ text: BTN.MINIAPP, web_app: { url } }] : [BTN.MINIAPP];
  return kb([[BTN.SIGNAL, BTN.SETTINGS], [BTN.PROFILE, BTN.SUPPORT], [BTN.EDUCATION, BTN.LEVELING], miniRow, [BTN.HOME]]);
}

function signalMenuKeyboard() {
  return kb([[BTN.CAT_MAJORS, BTN.CAT_METALS], [BTN.CAT_INDICES, BTN.CAT_CRYPTO], [BTN.BACK, BTN.HOME]]);
}

function settingsMenuKeyboard() {
  return kb([[BTN.SET_TF, BTN.SET_STYLE], [BTN.SET_RISK, BTN.SET_NEWS], [BTN.BACK, BTN.HOME]]);
}

function listKeyboard(items, columns = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  rows.push([BTN.BACK, BTN.HOME]);
  return kb(rows);
}

function optionsKeyboard(options) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));
  rows.push([BTN.BACK, BTN.HOME]);
  return kb(rows);
}

function contactKeyboard() {
  return {
    keyboard: [[{ text: "📱 ارسال شماره تماس", request_contact: true }], [BTN.BACK, BTN.HOME]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function getMiniappUrl(env) {
  const u = (env.MINIAPP_URL || env.PUBLIC_BASE_URL || "").toString().trim();
  return u;
}
function miniappInlineKeyboard(env) {
  const url = getMiniappUrl(env);
  if (!url) return null;
  return { inline_keyboard: [[{ text: BTN.MINIAPP, web_app: { url } }]] };
}

/* ========================== KV STATE ========================== */
async function getUser(userId, env) {
  if (!env.BOT_KV) return null;
  const raw = await env.BOT_KV.get(`u:${userId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function saveUser(userId, st, env) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`u:${userId}`, JSON.stringify(st));
}

function defaultUser(userId) {
  return {
    userId,
    createdAt: new Date().toISOString(),

    // bot state machine
    state: "idle",
    selectedSymbol: "",

    // preferences
    timeframe: "H4",
    style: "اسمارت‌مانی",
    risk: "متوسط",
    newsEnabled: true,

    // usage quota
    dailyDate: kyivDateString(),
    dailyUsed: 0,

    // onboarding/profile
    profile: {
      name: "",
      phone: "",
      username: "",
      firstName: "",
      lastName: "",
      marketExperience: "",
      preferredMarket: "",
      level: "", // beginner/intermediate/pro
      levelNotes: "",
      onboardingDone: false,
    },

    // referral / points / subscription
    referral: {
      codes: [],            // 5 codes
      referredBy: "",       // inviter userId
      referredByCode: "",   // which code
      successfulInvites: 0,
      points: 0,
    },
    subscription: {
      active: false,
      type: "free", // free/premium/gift
      expiresAt: "",
      dailyLimit: 50, // per requirement
    },

    // provider overrides
    textOrder: "",
    visionOrder: "",
    polishOrder: "",
  };
}

function patchUser(st, userId) {
  const d = defaultUser(userId);
  const merged = { ...d, ...st };
  merged.profile = { ...d.profile, ...(st?.profile || {}) };
  merged.referral = { ...d.referral, ...(st?.referral || {}) };
  merged.subscription = { ...d.subscription, ...(st?.subscription || {}) };

  merged.timeframe = merged.timeframe || d.timeframe;
  merged.style = merged.style || d.style;
  merged.risk = merged.risk || d.risk;
  merged.newsEnabled = typeof merged.newsEnabled === "boolean" ? merged.newsEnabled : d.newsEnabled;

  merged.dailyDate = merged.dailyDate || d.dailyDate;
  merged.dailyUsed = Number.isFinite(Number(merged.dailyUsed)) ? Number(merged.dailyUsed) : d.dailyUsed;

  merged.state = merged.state || "idle";
  merged.selectedSymbol = merged.selectedSymbol || "";

  merged.textOrder = typeof merged.textOrder === "string" ? merged.textOrder : "";
  merged.visionOrder = typeof merged.visionOrder === "string" ? merged.visionOrder : "";
  merged.polishOrder = typeof merged.polishOrder === "string" ? merged.polishOrder : "";

  return merged;
}

async function ensureUser(userId, env, from) {
  const existing = await getUser(userId, env);
  let st = patchUser(existing || {}, userId);

  if (from?.username) st.profile.username = String(from.username);
  if (from?.first_name) st.profile.firstName = String(from.first_name);
  if (from?.last_name) st.profile.lastName = String(from.last_name);

  const today = kyivDateString();
  if (st.dailyDate !== today) {
    st.dailyDate = today;
    st.dailyUsed = 0;
  }

  if (!Array.isArray(st.referral.codes) || st.referral.codes.length < 5) {
    st.referral.codes = (st.referral.codes || []).filter(Boolean);
    while (st.referral.codes.length < 5) st.referral.codes.push(randomCode(10));
  }

  if (env.BOT_KV) await saveUser(userId, st, env);
  return st;
}

function dailyLimit(env, st) {
  const base = 50;
  return toInt(st?.subscription?.dailyLimit, base) || base;
}

function canAnalyzeToday(st, from, env) {
  if (isStaff(from, env)) return true;
  const today = kyivDateString();
  const used = (st.dailyDate === today) ? (st.dailyUsed || 0) : 0;
  return used < dailyLimit(env, st);
}

function consumeDaily(st, from, env) {
  if (isStaff(from, env)) return;
  const today = kyivDateString();
  if (st.dailyDate !== today) {
    st.dailyDate = today;
    st.dailyUsed = 0;
  }
  st.dailyUsed = (st.dailyUsed || 0) + 1;
}

/* ========================== TELEGRAM API ========================== */
async function tgApi(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) console.error("Telegram API error:", method, j);
  return j;
}
async function tgSendMessage(env, chatId, text, replyMarkup) {
  return tgApi(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 3900),
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}
async function tgSendChatAction(env, chatId, action) {
  return tgApi(env, "sendChatAction", { chat_id: chatId, action });
}
async function tgGetFilePath(env, fileId) {
  const j = await tgApi(env, "getFile", { file_id: fileId });
  return j?.result?.file_path || "";
}

// Send SVG as document (Telegram reliably shows it)
async function tgSendSvgDocument(env, chatId, svgText, filename = "zones.svg", caption = "🖼️ نقشه زون‌ها") {
  const boundary = "----tgform" + Math.random().toString(16).slice(2);
  const CRLF = "\r\n";

  const parts = [];
  const push = (s) => parts.push(typeof s === "string" ? new TextEncoder().encode(s) : s);

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="chat_id"${CRLF}${CRLF}`);
  push(String(chatId) + CRLF);

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="caption"${CRLF}${CRLF}`);
  push(String(caption) + CRLF);

  push(`--${boundary}${CRLF}`);
  push(`Content-Disposition: form-data; name="document"; filename="${filename}"${CRLF}`);
  push(`Content-Type: image/svg+xml${CRLF}${CRLF}`);
  push(svgText + CRLF);

  push(`--${boundary}--${CRLF}`);

  const body = concatU8(parts);
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
  const j = await r.json().catch(() => null);
  if (!j || !j.ok) console.error("Telegram sendDocument error:", j);
  return j;
}

function concatU8(chunks) {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(new Uint8Array(c), off); off += c.byteLength; }
  return out;
}

/* ========================== TYPING LOOP ========================== */
function stopToken() { return { stop: false }; }
async function typingLoop(env, chatId, token) {
  while (!token.stop) {
    await tgSendChatAction(env, chatId, "typing");
    await sleep(TYPING_INTERVAL_MS);
  }
}

/* ========================== IMAGE PICKING ========================== */
function extractImageFileId(msg, env) {
  if (msg.photo && msg.photo.length) {
    const maxBytes = Number(env.VISION_MAX_BYTES || 900000);
    const sorted = [...msg.photo].sort((a, b) => (a.file_size || 0) - (b.file_size || 0));
    let best = null;
    for (const p of sorted) {
      if ((p.file_size || 0) <= maxBytes) best = p;
    }
    if (!best) best = sorted[0];
    return best?.file_id || "";
  }
  if (msg.document && msg.document.mime_type?.startsWith("image/")) {
    return msg.document.file_id || "";
  }
  return "";
}

/* ========================== PROVIDER CHAINS ========================== */
async function runTextProviders(prompt, env, orderOverride) {
  const chain = parseOrder(orderOverride || env.TEXT_PROVIDER_ORDER, ["cf","openai","gemini"]);
  let lastErr = null;
  for (const p of chain) {
    try {
      const out = await Promise.race([
        textProvider(p, prompt, env),
        timeoutPromise(TIMEOUT_TEXT_MS, `text_${p}_timeout`)
      ]);
      if (out && String(out).trim()) return String(out).trim();
    } catch (e) {
      lastErr = e;
      console.error("text provider failed:", p, e?.message || e);
    }
  }
  throw lastErr || new Error("all_text_providers_failed");
}

async function runPolishProviders(draft, env, orderOverride) {
  const raw = (orderOverride || env.POLISH_PROVIDER_ORDER || "").toString().trim();
  if (!raw) return draft;

  const chain = parseOrder(raw, ["openai","cf","gemini"]);
  const polishPrompt =
    `تو یک ویراستار سخت‌گیر فارسی هستی. متن زیر را فقط “سفت‌وسخت” کن:\n` +
    `- فقط فارسی\n- قالب شماره‌دار ۱ تا ۵ حفظ شود\n- لحن افشاگر/تیز\n- اضافه‌گویی حذف\n- خیال‌بافی نکن\n\n` +
    `متن:\n${draft}`;

  for (const p of chain) {
    try {
      const out = await Promise.race([
        textProvider(p, polishPrompt, env),
        timeoutPromise(TIMEOUT_POLISH_MS, `polish_${p}_timeout`)
      ]);
      if (out && String(out).trim()) return String(out).trim();
    } catch (e) {
      console.error("polish provider failed:", p, e?.message || e);
    }
  }
  return draft;
}

async function runVisionProviders(imageUrl, visionPrompt, env, orderOverride) {
  const chain = parseOrder(orderOverride || env.VISION_PROVIDER_ORDER, ["openai","cf","gemini","hf"]);
  const totalBudget = Number(env.VISION_TOTAL_BUDGET_MS || 20000);
  const deadline = Date.now() + totalBudget;

  let lastErr = null;
  let cached = null;

  for (const p of chain) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    try {
      if ((p === "cf" || p === "gemini" || p === "hf") && cached?.tooLarge) continue;

      const out = await Promise.race([
        visionProvider(p, imageUrl, visionPrompt, env, () => cached, (c) => (cached = c)),
        timeoutPromise(Math.min(TIMEOUT_VISION_MS, remaining), `vision_${p}_timeout`)
      ]);
      if (out && String(out).trim()) return String(out).trim();
    } catch (e) {
      lastErr = e;
      console.error("vision provider failed:", p, e?.message || e);
    }
  }

  throw lastErr || new Error("all_vision_providers_failed_or_budget_exceeded");
}

async function textProvider(name, prompt, env) {
  name = String(name || "").toLowerCase();

  if (name === "cf") {
    if (!env.AI) throw new Error("AI_binding_missing");
    const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 900,
      temperature: 0.25,
    });
    return out?.response || out?.result || "";
  }

  if (name === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.25,
      }),
    }, TIMEOUT_TEXT_MS);
    const j = await r.json().catch(() => null);
    return j?.choices?.[0]?.message?.content || "";
  }

  if (name === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY_missing");
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.25, maxOutputTokens: 900 },
        }),
      },
      TIMEOUT_TEXT_MS
    );
    const j = await r.json().catch(() => null);
    return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  }

  throw new Error(`unknown_text_provider:${name}`);
}

async function ensureImageCache(imageUrl, env, getCache, setCache) {
  const cur = getCache();
  if (cur?.buf && cur?.mime) return cur;

  const maxBytes = Number(env.VISION_MAX_BYTES || 900000);

  const resp = await fetchWithTimeout(imageUrl, {}, TIMEOUT_VISION_MS);

  const len = Number(resp.headers.get("content-length") || "0");
  if (len && len > maxBytes) {
    const c = { tooLarge: true, mime: "image/jpeg" };
    setCache(c);
    return c;
  }

  const mime = detectMimeFromHeaders(resp, "image/jpeg");
  const buf = await resp.arrayBuffer();

  if (buf.byteLength > maxBytes) {
    const c = { tooLarge: true, mime };
    setCache(c);
    return c;
  }

  const u8 = new Uint8Array(buf);
  const bytesArr = [...u8];
  const base64 = arrayBufferToBase64(buf);

  const c = { buf, mime, base64, bytesArr, u8, tooLarge: false };
  setCache(c);
  return c;
}

async function visionProvider(name, imageUrl, visionPrompt, env, getCache, setCache) {
  name = String(name || "").toLowerCase();

  if (name === "openai") {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
    const body = {
      model: env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: visionPrompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      }],
      temperature: 0.2,
    };
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }, TIMEOUT_VISION_MS);
    const j = await r.json().catch(() => null);
    return j?.choices?.[0]?.message?.content || "";
  }

  if (name === "cf") {
    if (!env.AI) throw new Error("AI_binding_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if (c.tooLarge) return "";
    const out = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", { image: c.bytesArr, prompt: visionPrompt });
    return out?.description || out?.response || out?.result || "";
  }

  if (name === "gemini") {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if (c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: visionPrompt },
              { inlineData: { mimeType: c.mime, data: c.base64 } },
            ],
          }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
        }),
      },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(() => null);
    return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "";
  }

  if (name === "hf") {
    if (!env.HF_API_KEY) throw new Error("HF_API_KEY_missing");
    const model = (env.HF_VISION_MODEL || "Salesforce/blip-image-captioning-large").toString().trim();
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if (c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.HF_API_KEY}`,
          "Content-Type": "application/octet-stream",
        },
        body: c.u8,
      },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(() => null);
    const txt = Array.isArray(j) ? j?.[0]?.generated_text : (j?.generated_text || j?.text);
    return txt ? String(txt) : "";
  }

  throw new Error(`unknown_vision_provider:${name}`);
}

/* ========================== MARKET DATA (LIVE) ========================== */
function assetKind(symbol) {
  if (symbol.endsWith("USDT")) return "crypto";
  if (/^[A-Z]{6}$/.test(symbol)) return "forex";
  if (symbol === "XAUUSD" || symbol === "XAGUSD") return "metal";
  if (symbol === "DJI" || symbol === "NDX" || symbol === "SPX") return "index";
  return "unknown";
}

function mapTimeframeToBinance(tf) {
  const m = { M15: "15m", H1: "1h", H4: "4h", D1: "1d" };
  return m[tf] || "4h";
}
function mapTimeframeToTwelve(tf) {
  const m = { M15: "15min", H1: "1h", H4: "4h", D1: "1day" };
  return m[tf] || "4h";
}
function mapForexSymbolForTwelve(symbol) {
  if (/^[A-Z]{6}$/.test(symbol)) return `${symbol.slice(0,3)}/${symbol.slice(3,6)}`;
  if (symbol === "XAUUSD") return "XAU/USD";
  if (symbol === "XAGUSD") return "XAG/USD";
  return symbol;
}

function mapTimeframeToAlphaVantage(tf) {
  const m = { M15:"15min", H1:"60min" };
  return m[tf] || "60min";
}

function toYahooSymbol(symbol) {
  if (/^[A-Z]{6}$/.test(symbol)) return `${symbol}=X`;
  if (symbol.endsWith("USDT")) return `${symbol.replace("USDT","-USD")}`;
  if (symbol === "XAUUSD") return "XAUUSD=X";
  if (symbol === "XAGUSD") return "XAGUSD=X";
  return symbol;
}
function yahooInterval(tf) {
  const m = { M15:"15m", H1:"60m", H4:"240m", D1:"1d" };
  return m[tf] || "240m";
}

async function fetchBinanceCandles(symbol, timeframe, limit, timeoutMs) {
  if (!symbol.endsWith("USDT")) throw new Error("binance_not_crypto");
  const interval = mapTimeframeToBinance(timeframe);
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const r = await fetchWithTimeout(url, {}, timeoutMs);
  if (!r.ok) throw new Error(`binance_http_${r.status}`);
  const data = await r.json();
  return data.map(k => ({
    t: k[0],
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
  }));
}

async function fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env) {
  if (!env.TWELVEDATA_API_KEY) throw new Error("twelvedata_key_missing");
  const kind = assetKind(symbol);
  if (kind === "unknown") throw new Error("twelvedata_unknown_symbol");

  const interval = mapTimeframeToTwelve(timeframe);
  const sym = mapForexSymbolForTwelve(symbol);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&outputsize=${limit}&apikey=${encodeURIComponent(env.TWELVEDATA_API_KEY)}`;

  const r = await fetchWithTimeout(url, {}, timeoutMs);
  if (!r.ok) throw new Error(`twelvedata_http_${r.status}`);
  const j = await r.json();
  if (j.status === "error") throw new Error(`twelvedata_err_${j.code || ""}`);

  const values = Array.isArray(j.values) ? j.values : [];
  return values.reverse().map(v => ({
    t: Date.parse(v.datetime + "Z") || Date.now(),
    o: Number(v.open),
    h: Number(v.high),
    l: Number(v.low),
    c: Number(v.close),
    v: v.volume ? Number(v.volume) : null,
  }));
}

async function fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env) {
  if (!env.ALPHAVANTAGE_API_KEY) throw new Error("alphavantage_key_missing");
  if (!/^[A-Z]{6}$/.test(symbol) && symbol !== "XAUUSD" && symbol !== "XAGUSD") throw new Error("alphavantage_only_fx_like");

  const from = symbol.slice(0,3);
  const to = symbol.slice(3,6);
  const interval = mapTimeframeToAlphaVantage(timeframe);

  const url =
    `https://www.alphavantage.co/query?function=FX_INTRADAY` +
    `&from_symbol=${encodeURIComponent(from)}` +
    `&to_symbol=${encodeURIComponent(to)}` +
    `&interval=${encodeURIComponent(interval)}` +
    `&outputsize=compact` +
    `&apikey=${encodeURIComponent(env.ALPHAVANTAGE_API_KEY)}`;

  const r = await fetchWithTimeout(url, {}, timeoutMs);
  if (!r.ok) throw new Error(`alphavantage_http_${r.status}`);
  const j = await r.json();

  const key = Object.keys(j).find(k => k.startsWith("Time Series FX"));
  if (!key) throw new Error("alphavantage_no_timeseries");

  const ts = j[key];
  const rows = Object.entries(ts)
    .slice(0, limit)
    .map(([dt, v]) => ({
      t: Date.parse(dt + "Z") || Date.now(),
      o: Number(v["1. open"]),
      h: Number(v["2. high"]),
      l: Number(v["3. low"]),
      c: Number(v["4. close"]),
      v: null,
    }))
    .reverse();

  return rows;
}

function mapTimeframeToFinnhubResolution(tf) {
  const m = { M15:"15", H1:"60", H4:"240", D1:"D" };
  return m[tf] || "240";
}
async function fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env) {
  if (!env.FINNHUB_API_KEY) throw new Error("finnhub_key_missing");
  if (!/^[A-Z]{6}$/.test(symbol)) throw new Error("finnhub_only_forex");

  const res = mapTimeframeToFinnhubResolution(timeframe);
  const inst = `OANDA:${symbol.slice(0,3)}_${symbol.slice(3,6)}`;

  const now = Math.floor(Date.now() / 1000);
  const lookbackSec = 60 * 60 * 24 * 10;
  const from = now - lookbackSec;

  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(inst)}&resolution=${encodeURIComponent(res)}&from=${from}&to=${now}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`;

  const r = await fetchWithTimeout(url, {}, timeoutMs);
  if (!r.ok) throw new Error(`finnhub_http_${r.status}`);
  const j = await r.json();
  if (j.s !== "ok") throw new Error(`finnhub_status_${j.s}`);

  const candles = j.t.map((t, i) => ({
    t: t * 1000,
    o: Number(j.o[i]),
    h: Number(j.h[i]),
    l: Number(j.l[i]),
    c: Number(j.c[i]),
    v: j.v ? Number(j.v[i]) : null,
  }));
  return candles.slice(-limit);
}

async function fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs) {
  const interval = yahooInterval(timeframe);
  const range = "10d";
  const ysym = toYahooSymbol(symbol);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, timeoutMs);
  if (!r.ok) throw new Error(`yahoo_http_${r.status}`);
  const j = await r.json();

  const result = j?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0];
  if (!ts.length || !q) throw new Error("yahoo_no_data");

  const candles = ts.map((t, i) => ({
    t: t * 1000,
    o: Number(q.open?.[i]),
    h: Number(q.high?.[i]),
    l: Number(q.low?.[i]),
    c: Number(q.close?.[i]),
    v: q.volume?.[i] != null ? Number(q.volume[i]) : null
  })).filter(x => Number.isFinite(x.c));

  return candles.slice(-limit);
}

async function getMarketCandlesWithFallback(env, symbol, timeframe) {
  const timeoutMs = Number(env.MARKET_DATA_TIMEOUT_MS || 7000);
  const limit = Number(env.MARKET_DATA_CANDLES_LIMIT || 120);

  const chain = parseOrder(env.MARKET_DATA_PROVIDER_ORDER, ["twelvedata","alphavantage","finnhub","yahoo"]);
  let lastErr = null;

  for (const p of chain) {
    try {
      if (p === "binance") return await fetchBinanceCandles(symbol, timeframe, limit, timeoutMs);
      if (p === "twelvedata") return await fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env);
      if (p === "alphavantage") return await fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env);
      if (p === "finnhub") return await fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env);
      if (p === "yahoo") return await fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs);
    } catch (e) {
      lastErr = e;
      console.error("market provider failed:", p, e?.message || e);
    }
  }

  throw lastErr || new Error("market_data_all_failed");
}

function computeSnapshot(candles) {
  if (!candles?.length) return null;
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;

  const closes = candles.map(x => x.c);
  const sma = (arr, p) => {
    if (arr.length < p) return null;
    const s = arr.slice(-p).reduce((a,b)=>a+b,0);
    return s / p;
  };

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const trend = (sma20 && sma50) ? (sma20 > sma50 ? "صعودی" : "نزولی") : "نامشخص";

  const n = Math.min(50, candles.length);
  const recent = candles.slice(-n);
  const hi = Math.max(...recent.map(x => x.h));
  const lo = Math.min(...recent.map(x => x.l));

  const lastClose = last.c;
  const changePct = prev?.c ? ((lastClose - prev.c) / prev.c) * 100 : 0;

  return {
    lastPrice: lastClose,
    changePct: Number(changePct.toFixed(3)),
    trend,
    range50: { hi, lo },
    sma20: sma20 ? Number(sma20.toFixed(6)) : null,
    sma50: sma50 ? Number(sma50.toFixed(6)) : null,
    lastTs: last.t,
  };
}

function candlesToCompactCSV(candles, maxRows = 80) {
  const tail = candles.slice(-maxRows);
  return tail.map(x => `${x.t},${x.o},${x.h},${x.l},${x.c}`).join("\n");
}

/* ========================== TEXT BUILDERS ========================== */
async function buildTextPromptForSymbol(symbol, userPrompt, st, marketBlock, env) {
  const tf = st.timeframe || "H4";
  const baseRaw = await getAnalysisPrompt(env);
  const base = baseRaw.replaceAll("{TIMEFRAME}", tf);

  const userExtra = (isStaff({ username: st.profile?.username }, env) && userPrompt?.trim())
    ? userPrompt.trim()
    : "تحلیل با حالت نهادی";

  return (
    `${base}\n\n` +
    (getStyleGuide(st.style) ? `STYLE_GUIDE:\n${getStyleGuide(st.style)}\n\n` : ``) +
    `ASSET: ${symbol}\n` +
    `USER SETTINGS: Style=${st.style}, Risk=${st.risk}\n\n` +
    `MARKET_DATA:\n${marketBlock}\n\n` +
    `RULES:\n` +
    `- خروجی فقط فارسی و دقیقاً بخش‌های ۱ تا ۵\n` +
    `- سطح‌های قیمتی را مشخص کن (X/Y/Z)\n` +
    `- شرط کندلی را واضح بگو (close/wick)\n` +
    `- از داده OHLC استفاده کن، خیال‌بافی نکن\n\n` +
    `EXTRA:\n${userExtra}`
  );
}

async function buildVisionPrompt(st, env) {
  const tf = st.timeframe || "H4";
  const baseRaw = await getAnalysisPrompt(env);
  const base = baseRaw.replaceAll("{TIMEFRAME}", tf);
  return (
    `${base}\n\n` +
    `TASK: این تصویر چارت را تحلیل کن. دقیقاً خروجی ۱ تا ۵ بده و سطح‌ها را مشخص کن.\n` +
    `RULES: فقط فارسی، لحن افشاگر، خیال‌بافی نکن.\n`
  );
}

/* ========================== WALLET (ADMIN ONLY) ========================== */
async function getWallet(env) {
  if (!env.BOT_KV) return (env.WALLET_ADDRESS || "").toString().trim();
  const v = await env.BOT_KV.get("settings:wallet");
  return (v || env.WALLET_ADDRESS || "").toString().trim();
}
async function setWallet(env, wallet) {
  if (!env.BOT_KV) throw new Error("BOT_KV_missing");
  await env.BOT_KV.put("settings:wallet", String(wallet || "").trim());
}

/* ========================== LEVELING (AI) ========================== */
const QUIZ = [
  { key: "q1", text: "۱) بیشتر دنبال چی هستی؟", options: ["اسکالپ سریع", "سوئینگ چندروزه", "هولد/سرمایه‌گذاری", "نمی‌دانم"] },
  { key: "q2", text: "۲) وقتی معامله خلاف تو رفت…", options: ["فوراً می‌بندم", "صبر می‌کنم تا ساختار مشخص شود", "میانگین کم می‌کنم", "تجربه‌ای ندارم"] },
  { key: "q3", text: "۳) ابزار تحلیل‌ات؟", options: ["پرایس‌اکشن", "اندیکاتور", "اسمارت‌مانی", "هیچکدام"] },
  { key: "q4", text: "۴) تحمل ریسک؟", options: ["کم", "متوسط", "زیاد", "نمی‌دانم"] },
  { key: "q5", text: "۵) تایم آزاد برای چک کردن بازار؟", options: ["ساعتی", "چندبار در روز", "روزانه", "هفتگی/کم"] },
];

async function evaluateLevelWithAI(env, profile, quizAnswers) {
  const prompt =
`تو یک مشاور تعیین‌سطح معامله‌گری هستی. خروجی فقط JSON باشد.
ورودی:
- تجربه بازار: ${profile.marketExperience}
- بازار مورد علاقه: ${profile.preferredMarket}
- پاسخ‌های آزمون: ${JSON.stringify(quizAnswers)}

خروجی JSON با کلیدهای:
level یکی از: beginner|intermediate|pro
recommendedMarket یکی از: crypto|forex|metals|stocks
settings: { timeframe: "M15|H1|H4|D1", style: "اسکالپ|سوئینگ|اسمارت‌مانی", risk: "کم|متوسط|زیاد" }
notes: رشته کوتاه فارسی`;

  try {
    const out = await runTextProviders(prompt, env, env.TEXT_PROVIDER_ORDER);
    const json = safeExtractJson(out);
    if (json && json.settings) return json;
  } catch (e) {
    console.error("evaluateLevelWithAI failed:", e);
  }

  const risk = (quizAnswers.q4 || "").includes("کم") ? "کم" : (quizAnswers.q4 || "").includes("زیاد") ? "زیاد" : "متوسط";
  const tf = (quizAnswers.q1 || "").includes("اسکالپ") ? "M15" : (quizAnswers.q1 || "").includes("سوئینگ") ? "H4" : "H1";
  return {
    level: "beginner",
    recommendedMarket: mapPreferredMarket(profile.preferredMarket),
    settings: { timeframe: tf, style: "اسمارت‌مانی", risk },
    notes: "تنظیمات اولیه بر اساس پاسخ‌های شما چیده شد.",
  };
}

function safeExtractJson(txt) {
  const s = String(txt || "");
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function mapPreferredMarket(s) {
  s = (s || "").toLowerCase();
  if (s.includes("کریپتو") || s.includes("crypto")) return "crypto";
  if (s.includes("فارکس") || s.includes("forex")) return "forex";
  if (s.includes("فلز") || s.includes("gold") || s.includes("xau")) return "metals";
  if (s.includes("سهام") || s.includes("stock")) return "stocks";
  return "crypto";
}

/* ========================== REFERRAL / POINTS ========================== */
async function storeReferralCodeOwner(env, code, ownerUserId) {
  if (!env.BOT_KV) return;
  await env.BOT_KV.put(`ref:${code}`, String(ownerUserId));
}
async function resolveReferralOwner(env, code) {
  if (!env.BOT_KV) return "";
  const v = await env.BOT_KV.get(`ref:${code}`);
  return (v || "").toString().trim();
}

async function hashPhone(phone) {
  const data = new TextEncoder().encode(String(phone || "").trim());
  const digest = await crypto.subtle.digest("SHA-256", data);
  const u8 = new Uint8Array(digest);
  let hex = "";
  for (const b of u8) hex += b.toString(16).padStart(2, "0");
  return hex;
}

async function isPhoneNew(env, phone) {
  if (!env.BOT_KV) return true;
  const h = await hashPhone(phone);
  const key = `phone:${h}`;
  const exists = await env.BOT_KV.get(key);
  return !exists;
}

async function markPhoneSeen(env, phone, userId) {
  if (!env.BOT_KV) return;
  const h = await hashPhone(phone);
  await env.BOT_KV.put(`phone:${h}`, String(userId));
}

async function awardReferralIfEligible(env, newUserSt) {
  if (!env.BOT_KV) return;
  const phone = newUserSt.profile?.phone || "";
  if (!phone) return;

  const isNew = await isPhoneNew(env, phone);
  await markPhoneSeen(env, phone, newUserSt.userId);

  if (!newUserSt.referral?.referredBy || !newUserSt.referral?.referredByCode) return;
  if (!isNew) return;

  const inviterId = String(newUserSt.referral.referredBy);
  const inviter = await ensureUser(inviterId, env);
  inviter.referral.successfulInvites = (inviter.referral.successfulInvites || 0) + 1;
  inviter.referral.points = (inviter.referral.points || 0) + 3;

  if (inviter.referral.points >= 500) {
    inviter.referral.points -= 500;
    inviter.subscription.active = true;
    inviter.subscription.type = "gift";
    inviter.subscription.dailyLimit = 50;
    inviter.subscription.expiresAt = futureISO(30);
  }

  await saveUser(inviterId, inviter, env);
}

function futureISO(days) {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return d.toISOString();
}

/* ========================== UPDATE HANDLER ========================== */
async function handleUpdate(update, env) {
  try {
    const msg = update.message;
    if (!msg) return;

    const chatId = msg.chat?.id;
    const from = msg.from;
    const userId = from?.id;
    if (!chatId || !userId) return;

    const st = await ensureUser(userId, env, from);

    if (msg.contact && msg.contact.phone_number) {
      await handleContact(env, chatId, from, st, msg.contact);
      return;
    }

    const imageFileId = extractImageFileId(msg, env);
    if (imageFileId) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای استفاده از تحلیل، ابتدا نام و شماره را ثبت کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      await handleVisionFlow(env, chatId, from, userId, st, imageFileId);
      return;
    }

    const text = (msg.text || "").trim();

    if (text === "/start") {
      const refArg = (msg.text || "").split(" ").slice(1).join(" ").trim();
      await onStart(env, chatId, from, st, refArg);
      return;
    }

    if (text.startsWith("/setwallet")) {
      if (!isAdmin(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین می‌تواند آدرس ولت را تنظیم کند.", mainMenuKeyboard(env));
      const wallet = text.split(" ").slice(1).join(" ").trim();
      if (!wallet) return tgSendMessage(env, chatId, "فرمت: /setwallet <wallet_address>", mainMenuKeyboard(env));
      await setWallet(env, wallet);
      return tgSendMessage(env, chatId, "✅ آدرس ولت ذخیره شد.", mainMenuKeyboard(env));
    }

    if (text.startsWith("/setprompt")) {
      if (!isStaff(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند پرامپت تحلیل را تعیین کند.", mainMenuKeyboard(env));
      const p = text.split(" ").slice(1).join(" ").trim();
      if (!p) return tgSendMessage(env, chatId, "فرمت: /setprompt <prompt_text>", mainMenuKeyboard(env));
      if (!env.BOT_KV) return tgSendMessage(env, chatId, "⛔️ BOT_KV فعال نیست.", mainMenuKeyboard(env));
      await env.BOT_KV.put("settings:analysis_prompt", p);
      return tgSendMessage(env, chatId, "✅ پرامپت تحلیل ذخیره شد.", mainMenuKeyboard(env));
    }

    if (text === "/signals" || text === "/signal" || text === BTN.SIGNAL) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای شروع تحلیل، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      st.state = "choose_symbol";
      st.selectedSymbol = "";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "📈 دسته‌بندی سیگنال‌ها:", signalMenuKeyboard());
    }

    if (text === "/settings" || text === BTN.SETTINGS) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای تنظیمات، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      return sendSettingsSummary(env, chatId, st, from);
    }

    if (text === "/profile" || text === BTN.PROFILE) {
      return tgSendMessage(env, chatId, profileText(st, from, env), mainMenuKeyboard(env));
    }

    if (text === "/education" || text === BTN.EDUCATION) {
      return tgSendMessage(env, chatId, "📚 آموزش و مفاهیم بازار\n\nبه‌زودی محتوای آموزشی اضافه می‌شود.\nفعلاً برای تعیین سطح روی «🧪 تعیین سطح» بزن.", mainMenuKeyboard(env));
    }

    if (text === "/support" || text === BTN.SUPPORT) {
      const handle = env.SUPPORT_HANDLE || "@support";
      const wallet = await getWallet(env);
      const walletLine = wallet ? `\n\n💳 آدرس ولت جهت پرداخت:\n${wallet}` : "";
      return tgSendMessage(env, chatId, `🆘 پشتیبانی\n\nپیام بده به: ${handle}${walletLine}`, mainMenuKeyboard(env));
    }

    if (text === "/miniapp" || text === BTN.MINIAPP) {
      const url = getMiniappUrl(env);
      if (!url) {
        return tgSendMessage(env, chatId, "⚠️ لینک مینی‌اپ تنظیم نشده.\n\nدر Wrangler / داشبورد یک متغیر ENV به نام MINIAPP_URL یا PUBLIC_BASE_URL بگذار (مثلاً https://<your-worker-domain>/ ) و دوباره Deploy کن.", mainMenuKeyboard(env));
      }
      return tgSendMessage(env, chatId, "🧩 برای باز کردن مینی‌اپ روی دکمه زیر بزن:", miniappInlineKeyboard(env) || mainMenuKeyboard(env));
    }

    if (text === "/users") {
      if (!isStaff(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند لیست کاربران را ببیند.", mainMenuKeyboard(env));
      return sendUsersList(env, chatId);
    }

    if (text === BTN.LEVELING || text === "/level") {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای تعیین سطح، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }
      await startLeveling(env, chatId, from, st);
      return;
    }

    if (text === BTN.HOME) {
      st.state = "idle";
      st.selectedSymbol = "";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }

    if (text === BTN.BACK) {
      if (st.state.startsWith("quiz_")) {
        st.state = "idle";
        await saveUser(userId, st, env);
        return tgSendMessage(env, chatId, "🏠 برگشتی به منوی اصلی.", mainMenuKeyboard(env));
      }
      if (st.state === "await_prompt") {
        st.state = "choose_symbol";
        st.selectedSymbol = "";
        await saveUser(userId, st, env);
        return tgSendMessage(env, chatId, "📈 دسته‌بندی سیگنال‌ها:", signalMenuKeyboard());
      }
      if (st.state.startsWith("set_")) {
        st.state = "idle";
        await saveUser(userId, st, env);
        return sendSettingsSummary(env, chatId, st, from);
      }
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }

    if (st.state === "onb_name") {
      const name = text.replace(/\s+/g, " ").trim();
      if (!name || name.length < 2) return tgSendMessage(env, chatId, "نام را درست وارد کن (حداقل ۲ حرف).", contactKeyboard());
      st.profile.name = name;
      st.state = "onb_contact";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "عالی ✅ حالا لطفاً شماره تماس را با دکمه زیر ارسال کن:", contactKeyboard());
    }

    if (st.state === "onb_experience") {
      st.profile.marketExperience = text;
      st.state = "onb_market";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "بازار مورد علاقه‌ات کدام است؟", optionsKeyboard(["کریپتو", "فارکس", "فلزات", "سهام"]));
    }

    if (st.state === "onb_market") {
      st.profile.preferredMarket = text;
      await saveUser(userId, st, env);
      await startLeveling(env, chatId, from, st);
      return;
    }

    if (st.state.startsWith("quiz_")) {
      const idx = Number(st.state.split("_")[1] || "0");
      if (!Number.isFinite(idx)) return;
      const q = QUIZ[idx];
      if (!q) return;

      st.profile.quizAnswers = st.profile.quizAnswers || {};
      st.profile.quizAnswers[q.key] = text;

      const nextIdx = idx + 1;
      if (nextIdx < QUIZ.length) {
        st.state = `quiz_${nextIdx}`;
        await saveUser(userId, st, env);
        const nq = QUIZ[nextIdx];
        return tgSendMessage(env, chatId, nq.text, optionsKeyboard(nq.options));
      }

      st.state = "idle";
      await saveUser(userId, st, env);

      await tgSendMessage(env, chatId, "⏳ در حال تحلیل پاسخ‌های آزمون و تنظیم خودکار پروفایل…", kb([[BTN.HOME]]));

      const result = await evaluateLevelWithAI(env, st.profile, st.profile.quizAnswers || {});
      st.profile.level = result.level || "";
      st.profile.levelNotes = result.notes || "";
      st.timeframe = result.settings?.timeframe || st.timeframe;
      st.style = result.settings?.style || st.style;
      st.risk = result.settings?.risk || st.risk;
      st.profile.onboardingDone = true;

      await saveUser(userId, st, env);

      const marketFa = ({crypto:"کریپتو", forex:"فارکس", metals:"فلزات", stocks:"سهام"})[result.recommendedMarket] || "کریپتو";
      return tgSendMessage(
        env,
        chatId,
        `✅ تعیین سطح انجام شد.\n\nسطح: ${st.profile.level}\nپیشنهاد بازار: ${marketFa}\n\nتنظیمات پیشنهادی:\n⏱ ${st.timeframe} | 🎯 ${st.style} | ⚠️ ${st.risk}\n\nیادداشت:\n${st.profile.levelNotes || "—"}\n\nاگر می‌خوای دوباره تعیین‌سطح انجام بدی یا تنظیماتت تغییر کنه، به پشتیبانی پیام بده (ادمین بررسی می‌کند).`,
        mainMenuKeyboard(env)
      );
    }

    if (text === BTN.CAT_MAJORS) return tgSendMessage(env, chatId, "💱 ماجورها:", listKeyboard(MAJORS));
    if (text === BTN.CAT_METALS) return tgSendMessage(env, chatId, "🪙 فلزات:", listKeyboard(METALS));
    if (text === BTN.CAT_INDICES) return tgSendMessage(env, chatId, "📊 شاخص‌ها:", listKeyboard(INDICES));
    if (text === BTN.CAT_CRYPTO) return tgSendMessage(env, chatId, "₿ کریپتو:", listKeyboard(CRYPTOS));

    if (text === BTN.SET_TF) {
      st.state = "set_tf";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "⏱ تایم‌فریم:", optionsKeyboard(["M15","H1","H4","D1"]));
    }
    if (text === BTN.SET_STYLE) {
      st.state = "set_style";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🎯 سبک:", optionsKeyboard(["اسکالپ","سوئینگ","اسمارت‌مانی","پرایس اکشن","ICT","ATR"]));
    }
    if (text === BTN.SET_RISK) {
      st.state = "set_risk";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "⚠️ ریسک:", optionsKeyboard(["کم","متوسط","زیاد"]));
    }
    if (text === BTN.SET_NEWS) {
      st.state = "set_news";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "📰 خبر:", optionsKeyboard(["روشن ✅","خاموش ❌"]));
    }

    if (st.state === "set_tf") { st.timeframe = text; st.state = "idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ تایم‌فریم: ${st.timeframe}`, mainMenuKeyboard(env)); }
    if (st.state === "set_style") { st.style = text; st.state = "idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ سبک: ${st.style}`, mainMenuKeyboard(env)); }
    if (st.state === "set_risk") { st.risk = text; st.state = "idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ ریسک: ${st.risk}`, mainMenuKeyboard(env)); }
    if (st.state === "set_news") { st.newsEnabled = text.includes("روشن"); st.state = "idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}`, mainMenuKeyboard(env)); }

    if (isSymbol(text)) {
      if (!st.profile?.name || !st.profile?.phone) {
        await tgSendMessage(env, chatId, "برای شروع تحلیل، ابتدا پروفایل را کامل کن ✅", mainMenuKeyboard(env));
        await startOnboarding(env, chatId, from, st);
        return;
      }

      st.selectedSymbol = text;
      st.state = "await_prompt";
      await saveUser(userId, st, env);

      const quota = isStaff(from, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
      return tgSendMessage(env, chatId, `✅ نماد: ${st.selectedSymbol}\n\nبرای شروع تحلیل روی «${BTN.ANALYZE}» بزن.\n\nسهمیه امروز: ${quota}`, kb([[BTN.ANALYZE], [BTN.BACK, BTN.HOME]]));
    }

    if (st.state === "await_prompt" && st.selectedSymbol) {
      if (env.BOT_KV && !canAnalyzeToday(st, from, env)) {
        return tgSendMessage(env, chatId, `⛔️ سهمیه امروزت تموم شده (${dailyLimit(env, st)} تحلیل در روز).`, mainMenuKeyboard(env));
      }

      const symbol = st.selectedSymbol;
      const isAnalyzeCmd = text === BTN.ANALYZE || text.replace(/\s+/g, "") === "تحلیلکن";
      if (!isAnalyzeCmd) return tgSendMessage(env, chatId, `برای شروع تحلیل روی «${BTN.ANALYZE}» بزن ✅`, kb([[BTN.ANALYZE], [BTN.BACK, BTN.HOME]]));

      st.state = "idle";
      st.selectedSymbol = "";

      if (env.BOT_KV) {
        consumeDaily(st, from, env);
        await saveUser(userId, st, env);
      }

      await runSignalTextFlow(env, chatId, from, st, symbol, "");
      return;
    }

    return tgSendMessage(env, chatId, "از منوی پایین استفاده کن ✅", mainMenuKeyboard(env));
  } catch (e) {
    console.error("handleUpdate error:", e);
  }
}

/* ========================== START / ONBOARDING ========================== */
async function onStart(env, chatId, from, st, refArg) {
  st.state = "idle";
  st.selectedSymbol = "";
  st.profile.username = from?.username ? String(from.username) : st.profile.username;

  if (env.BOT_KV) {
    for (const c of st.referral.codes || []) {
      await storeReferralCodeOwner(env, c, st.userId);
    }
  }

  if (refArg && refArg.startsWith("ref_") && !st.referral.referredBy) {
    const code = refArg.replace(/^ref_/, "").trim();
    const ownerId = await resolveReferralOwner(env, code);
    if (ownerId && String(ownerId) !== String(st.userId)) {
      st.referral.referredBy = String(ownerId);
      st.referral.referredByCode = code;
    }
  }

  await saveUser(st.userId, st, env);

  await tgSendMessage(env, chatId, WELCOME_BOT, mainMenuKeyboard(env));

  if (!st.profile?.name || !st.profile?.phone) {
    await startOnboarding(env, chatId, from, st);
  }
}

async function startOnboarding(env, chatId, from, st) {
  if (!st.profile?.name) {
    st.state = "onb_name";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "👤 لطفاً نام خود را وارد کنید:", kb([[BTN.HOME]]));
  }
  if (!st.profile?.phone) {
    st.state = "onb_contact";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "📱 برای فعال‌سازی، شماره تماس را ارسال کنید (Share Contact):", contactKeyboard());
  }
  if (!st.profile?.marketExperience) {
    st.state = "onb_experience";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "سطح آشنایی/تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["تازه‌کار","کمتر از ۶ ماه","۶ تا ۲۴ ماه","بیشتر از ۲ سال"]));
  }
  if (!st.profile?.preferredMarket) {
    st.state = "onb_market";
    await saveUser(st.userId, st, env);
    return tgSendMessage(env, chatId, "بازار مورد علاقه‌ات کدام است؟", optionsKeyboard(["کریپتو", "فارکس", "فلزات", "سهام"]));
  }
  await startLeveling(env, chatId, from, st);
}

async function handleContact(env, chatId, from, st, contact) {
  if (contact.user_id && String(contact.user_id) !== String(st.userId)) {
    return tgSendMessage(env, chatId, "⚠️ لطفاً فقط شماره خودت را با دکمه ارسال کن.", contactKeyboard());
  }

  const phone = String(contact.phone_number || "").trim();
  st.profile.phone = phone;
  st.profile.onboardingDone = Boolean(st.profile.name && st.profile.phone);

  await awardReferralIfEligible(env, st);

  if (st.state === "onb_contact") st.state = "onb_experience";
  await saveUser(st.userId, st, env);

  await tgSendMessage(env, chatId, "✅ شماره ثبت شد. ممنون!", mainMenuKeyboard(env));
  return startOnboarding(env, chatId, from, st);
}

async function startLeveling(env, chatId, from, st) {
  st.profile.quizAnswers = {};
  st.state = "quiz_0";
  await saveUser(st.userId, st, env);
  return tgSendMessage(env, chatId, QUIZ[0].text, optionsKeyboard(QUIZ[0].options));
}

/* ========================== ADMIN: USERS LIST ========================== */
async function sendUsersList(env, chatId) {
  if (!env.BOT_KV || typeof env.BOT_KV.list !== "function") {
    return tgSendMessage(env, chatId, "⛔️ KV list در دسترس نیست. (BOT_KV را درست بایند کن)", mainMenuKeyboard(env));
  }

  const res = await env.BOT_KV.list({ prefix: "u:", limit: 20 });
  const keys = res?.keys || [];
  if (!keys.length) return tgSendMessage(env, chatId, "هیچ کاربری ثبت نشده.", mainMenuKeyboard(env));

  const users = [];
  for (const k of keys) {
    const raw = await env.BOT_KV.get(k.name);
    if (!raw) continue;
    try {
      const u = JSON.parse(raw);
      users.push(u);
    } catch {}
  }

  const lines = users.map(u => {
    const name = u?.profile?.name || "-";
    const phone = u?.profile?.phone ? maskPhone(u.profile.phone) : "-";
    const username = u?.profile?.username ? ("@" + u.profile.username) : "-";
    const used = `${u.dailyUsed || 0}/${dailyLimit(env, u)}`;
    const pts = u?.referral?.points || 0;
    const inv = u?.referral?.successfulInvites || 0;
    return `• ${name} | ${username} | ${phone} | استفاده: ${used} | امتیاز: ${pts} | دعوت: ${inv}`;
  });

  return tgSendMessage(env, chatId, "👥 کاربران (۲۰ تای اول):\n\n" + lines.join("\n"), mainMenuKeyboard(env));
}

function maskPhone(p) {
  const s = String(p);
  if (s.length <= 6) return s;
  return s.slice(0, 3) + "****" + s.slice(-3);
}

/* ========================== ROUTING HELPERS ========================== */
function isSymbol(t) {
  return MAJORS.includes(t) || METALS.includes(t) || INDICES.includes(t) || CRYPTOS.includes(t);
}

/* ========================== TEXTS ========================== */
async function sendSettingsSummary(env, chatId, st, from) {
  const quota = isStaff(from, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
  const wallet = await getWallet(env);
  const txt =
    `⚙️ تنظیمات:\n\n` +
    `⏱ تایم‌فریم: ${st.timeframe}\n` +
    `🎯 سبک: ${st.style}\n` +
    `⚠️ ریسک: ${st.risk}\n` +
    `📰 خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}\n\n` +
    `سهمیه امروز: ${quota}\n` +
    (wallet ? `\n💳 آدرس ولت:\n${wallet}\n` : "") +
    (isStaff(from, env) ? `\n(ادمین/اونر) برای تغییر پرامپت: /setprompt ...\n` : "");
  return tgSendMessage(env, chatId, txt, settingsMenuKeyboard());
}

function profileText(st, from, env) {
  const quota = isStaff(from, env) ? "∞" : `${st.dailyUsed}/${dailyLimit(env, st)}`;
  const adminTag = isStaff(from, env) ? "✅ ادمین/اونر" : "👤 کاربر";
  const level = st.profile?.level ? `\nسطح: ${st.profile.level}` : "";
  const pts = st.referral?.points || 0;
  const inv = st.referral?.successfulInvites || 0;

  const botUser = env.BOT_USERNAME ? String(env.BOT_USERNAME).replace(/^@/, "") : "";
  const links = (st.referral?.codes || []).slice(0, 5).map((c, i) => {
    const deep = botUser ? `https://t.me/${botUser}?start=ref_${c}` : `ref_${c}`;
    return `${i+1}) ${deep}`;
  }).join("\n");

  return `👤 پروفایل\n\nوضعیت: ${adminTag}\n🆔 ID: ${st.userId}\nنام: ${st.profile?.name || "-"}\nیوزرنیم: ${st.profile?.username ? "@"+st.profile.username : "-"}\nشماره: ${st.profile?.phone ? maskPhone(st.profile.phone) : "-"}${level}\n\n📅 امروز(Kyiv): ${kyivDateString()}\nسهمیه امروز: ${quota}\n\n🎁 امتیاز: ${pts}\n👥 دعوت موفق: ${inv}\n\n🔗 لینک‌های رفرال (۵ عدد):\n${links}\n\nℹ️ هر دعوت موفق ۳ امتیاز.\nهر ۵۰۰ امتیاز = ۳۰ روز اشتراک هدیه.`;
}

/* ========================== FLOWS ========================== */
async function runSignalTextFlow(env, chatId, from, st, symbol, userPrompt) {
  await tgSendMessage(env, chatId, `⏳ جمع‌آوری داده و تحلیل ${symbol}...`, kb([[BTN.HOME]]));

  const t = stopToken();
  const typingTask = typingLoop(env, chatId, t);

  try {
    const result = await runSignalTextFlowReturnText(env, from, st, symbol, userPrompt);

    if (String(env.RENDER_ZONES || "") === "1") {
      const svg = buildZonesSvgFromAnalysis(result, symbol, st.timeframe || "H4");
      await tgSendSvgDocument(env, chatId, svg, "zones.svg", `🖼️ نقشه زون‌ها: ${symbol} (${st.timeframe || "H4"})`);
    }

    t.stop = true;
    await Promise.race([typingTask, sleep(10)]).catch(() => {});

    for (const part of chunkText(result, 3500)) {
      await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));
    }
  } catch (e) {
    console.error("runSignalTextFlow error:", e);
    t.stop = true;
    await tgSendMessage(env, chatId, "⚠️ فعلاً امکان انجام این عملیات نیست. لطفاً بعداً دوباره تلاش کن.", mainMenuKeyboard(env));
  }
}

async function runSignalTextFlowReturnText(env, from, st, symbol, userPrompt) {
  const candles = await getMarketCandlesWithFallback(env, symbol, st.timeframe || "H4");
  const snap = computeSnapshot(candles);
  const ohlc = candlesToCompactCSV(candles, 80);

  const marketBlock =
    `lastPrice=${snap?.lastPrice}\n` +
    `changePct=${snap?.changePct}%\n` +
    `trend=${snap?.trend}\n` +
    `range50_hi=${snap?.range50?.hi} range50_lo=${snap?.range50?.lo}\n` +
    `sma20=${snap?.sma20} sma50=${snap?.sma50}\n` +
    `lastTs=${snap?.lastTs}\n\n` +
    `OHLC_CSV(t,o,h,l,c):\n${ohlc}`;

  const prompt = await buildTextPromptForSymbol(symbol, userPrompt, st, marketBlock, env);
  const draft = await runTextProviders(prompt, env, st.textOrder);
  const polished = await runPolishProviders(draft, env, st.polishOrder);
  return polished;
}

async function handleVisionFlow(env, chatId, from, userId, st, fileId) {
  if (env.BOT_KV && !canAnalyzeToday(st, from, env)) {
    await tgSendMessage(env, chatId, `⛔️ سهمیه امروزت تموم شده (${dailyLimit(env, st)} تحلیل در روز).`, mainMenuKeyboard(env));
    return;
  }

  await tgSendMessage(env, chatId, "🖼️ عکس دریافت شد… در حال تحلیل 🔍", kb([[BTN.HOME]]));

  const t = stopToken();
  const typingTask = typingLoop(env, chatId, t);

  try {
    const filePath = await tgGetFilePath(env, fileId);
    if (!filePath) throw new Error("no_file_path");
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    if (env.BOT_KV) {
      consumeDaily(st, from, env);
      await saveUser(userId, st, env);
    }

    const vPrompt = await buildVisionPrompt(st, env);
    const visionRaw = await runVisionProviders(imageUrl, vPrompt, env, st.visionOrder);

    const tf = st.timeframe || "H4";
    const baseRaw = await getAnalysisPrompt(env);
    const base = baseRaw.replaceAll("{TIMEFRAME}", tf);

    const finalPrompt =
      `${base}\n\n` +
      `ورودی ویژن (مشاهدات تصویر):\n${visionRaw}\n\n` +
      `وظیفه: بر اساس همین مشاهده‌ها خروجی دقیق ۱ تا ۵ بده. سطح‌ها را مشخص کن.\n` +
      `قوانین: فقط فارسی، لحن افشاگر، خیال‌بافی نکن.\n` ;

    const draft = await runTextProviders(finalPrompt, env, st.textOrder);
    const polished = await runPolishProviders(draft, env, st.polishOrder);

    if (String(env.RENDER_ZONES || "") === "1") {
      const svg = buildZonesSvgFromAnalysis(polished, "CHART", tf);
      await tgSendSvgDocument(env, chatId, svg, "zones.svg", `🖼️ نقشه زون‌ها (${tf})`);
    }

    t.stop = true;
    await Promise.race([typingTask, sleep(10)]).catch(() => {});

    for (const part of chunkText(polished, 3500)) {
      await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));
    }
  } catch (e) {
    console.error("handleVisionFlow error:", e);
    t.stop = true;
    await tgSendMessage(env, chatId, "⚠️ فعلاً امکان تحلیل تصویر نیست. لطفاً بعداً دوباره تلاش کن.", mainMenuKeyboard(env));
  }
}

/* ========================== ZONES RENDER (SVG) ========================== */
function extractLevels(text) {
  const nums = (String(text || "").match(/\b\d{1,6}(?:\.\d{1,6})?\b/g) || [])
    .map(Number)
    .filter(n => Number.isFinite(n));
  const uniq = [...new Set(nums)].sort((a,b)=>a-b);
  return uniq.slice(0, 6);
}

function buildZonesSvgFromAnalysis(analysisText, symbol, timeframe) {
  const levels = extractLevels(analysisText);
  const W = 900, H = 520;
  const pad = 60;

  const bg = `
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0B0F17"/>
        <stop offset="100%" stop-color="#090D14"/>
      </linearGradient>
      <linearGradient id="a" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#6D5EF6" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="#00D1FF" stop-opacity="0.35"/>
      </linearGradient>
      <style>
        .t{ font: 700 20px ui-sans-serif,system-ui; fill:#ffffff; }
        .s{ font: 500 14px ui-sans-serif,system-ui; fill:rgba(255,255,255,.75); }
        .l{ stroke: rgba(255,255,255,.20); stroke-width: 2; }
        .z{ fill:url(#a); opacity:0.18; }
        .p{ font: 700 14px ui-monospace,monospace; fill: rgba(255,255,255,.92); }
      </style>
    </defs>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#g)"/>
    <rect x="${pad}" y="${pad}" width="${W-2*pad}" height="${H-2*pad}" rx="24" fill="rgba(255,255,255,.05)" stroke="rgba(255,255,255,.10)"/>
  `;

  const header = `
    <text class="t" x="${pad}" y="${pad-18}">MarketiQ • Zones</text>
    <text class="s" x="${pad}" y="${pad-0}">${escapeXml(symbol)} — ${escapeXml(timeframe)} — (auto)</text>
  `;

  const plotX = pad + 30;
  const plotY = pad + 30;
  const plotW = W - 2*pad - 60;
  const plotH = H - 2*pad - 80;

  let lines = "";
  if (levels.length >= 2) {
    const min = levels[0], max = levels[levels.length-1];
    const toY = (v) => plotY + plotH - ((v - min) / (max - min || 1)) * plotH;

    for (let i = 0; i < Math.min(levels.length-1, 4); i++) {
      const y1 = toY(levels[i+1]);
      const y2 = toY(levels[i]);
      lines += `<rect class="z" x="${plotX}" y="${Math.min(y1,y2)}" width="${plotW}" height="${Math.abs(y2-y1)}" rx="14"/>`;
      lines += `<line class="l" x1="${plotX}" y1="${y1}" x2="${plotX+plotW}" y2="${y1}"/>`;
      lines += `<text class="p" x="${plotX+plotW+10}" y="${y1+5}">${levels[i+1]}</text>`;
    }
    const y0 = toY(levels[0]);
    lines += `<line class="l" x1="${plotX}" y1="${y0}" x2="${plotX+plotW}" y2="${y0}"/>`;
    lines += `<text class="p" x="${plotX+plotW+10}" y="${y0+5}">${levels[0]}</text>`;
  } else {
    lines += `<text class="s" x="${plotX}" y="${plotY+30}">Level یافت نشد. برای رندر بهتر، خروجی مدل باید شامل چند عدد سطح باشد.</text>`;
  }

  const footer = `
    <text class="s" x="${pad}" y="${H-18}">Generated by MarketiQ (SVG) — Educational use only</text>
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${bg}${header}${lines}${footer}</svg>`;
}

function escapeXml(s) {
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&apos;");
}

/* ========================== MINI APP INLINE ASSETS ========================== */
function htmlResponse(html, status = 200) {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
function jsResponse(js, status = 200) {
  return new Response(js, { status, headers: { "content-type": "application/javascript; charset=utf-8" } });
}
function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

/* ========================== TELEGRAM MINI APP initData verification ========================== */
async function verifyTelegramInitData(initData, botToken) {
  if (!initData || typeof initData !== "string") return { ok: false, reason: "initData_missing" };
  if (!botToken) return { ok: false, reason: "bot_token_missing" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "hash_missing" };
  params.delete("hash");

  const authDate = Number(params.get("auth_date") || "0");
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "auth_date_invalid" };
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 60 * 60) return { ok: false, reason: "initData_expired" };

  const pairs = [];
  for (const [k, v] of params.entries()) pairs.push([k, v]);
  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = await hmacSha256Raw(utf8("WebAppData"), utf8(botToken));
  const sigHex = await hmacSha256Hex(secretKey, utf8(dataCheckString));

  if (!timingSafeEqualHex(sigHex, hash)) return { ok: false, reason: "hash_mismatch" };

  const user = safeJsonParse(params.get("user") || "") || {};
  const userId = user?.id;
  if (!userId) return { ok: false, reason: "user_missing" };

  const fromLike = { username: user?.username || "" };
  return { ok: true, userId, fromLike };
}

function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }
function utf8(s) { return new TextEncoder().encode(String(s)); }

async function hmacSha256Raw(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}
async function hmacSha256Hex(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return toHex(new Uint8Array(sig));
}
function toHex(u8) { let out=""; for (const b of u8) out += b.toString(16).padStart(2,"0"); return out; }
function timingSafeEqualHex(a, b) {
  a = String(a || "").toLowerCase();
  b = String(b || "").toLowerCase();
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ========================== MINI APP UI (MODERN TRADING) ========================== */
const MINI_APP_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>MarketiQ Mini App</title>
  <meta name="color-scheme" content="dark light" />
  <style>
    :root{
      --bg: #0B0F17;
      --card: rgba(255,255,255,.06);
      --text: rgba(255,255,255,.92);
      --muted: rgba(255,255,255,.62);
      --good:#2FE3A5;
      --warn:#FFB020;
      --bad:#FF4D4D;
      --shadow: 0 10px 30px rgba(0,0,0,.35);
      --radius: 18px;
      --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans";
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: var(--font);
      color: var(--text);
      background:
        radial-gradient(900px 500px at 25% -10%, rgba(109,94,246,.35), transparent 60%),
        radial-gradient(800px 500px at 90% 0%, rgba(0,209,255,.20), transparent 60%),
        linear-gradient(180deg, #070A10 0%, #0B0F17 60%, #090D14 100%);
      padding: 12px 12px calc(14px + env(safe-area-inset-bottom));
    }
    .shell{ max-width: 760px; margin: 0 auto; }
    .topbar{
      position: sticky; top: 0; z-index: 50;
      backdrop-filter: blur(10px);
      background: rgba(11,15,23,.65);
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 20px;
      padding: 12px;
      box-shadow: var(--shadow);
      display:flex; align-items:center; justify-content:space-between;
      gap: 10px;
      margin-bottom: 12px;
    }
    .brand{ display:flex; align-items:center; gap:10px; min-width: 0; }
    .logo{
      width: 38px; height: 38px; border-radius: 14px;
      background: linear-gradient(135deg, rgba(109,94,246,1), rgba(0,209,255,1));
      box-shadow: 0 10px 22px rgba(109,94,246,.25);
      display:flex; align-items:center; justify-content:center;
      font-weight: 900;
    }
    .titlewrap{ min-width: 0; }
    .title{ font-size: 15px; font-weight: 900; white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
    .subtitle{ font-size: 12px; color: var(--muted); white-space: nowrap; overflow:hidden; text-overflow: ellipsis; }
    .pill{
      display:inline-flex; align-items:center; gap:7px;
      padding: 9px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.06);
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .dot{ width: 8px; height: 8px; border-radius: 99px; background: var(--good); box-shadow: 0 0 0 3px rgba(47,227,165,.12); }
    .grid{ display:grid; grid-template-columns: 1fr; gap: 12px; }
    .card{
      background: var(--card);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      overflow:hidden;
    }
    .card-h{
      padding: 12px 14px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.03);
    }
    .card-h strong{ font-size: 13px; }
    .card-h span{ font-size: 12px; color: var(--muted); }
    .card-b{ padding: 14px; }
    .row{ display:flex; gap:10px; flex-wrap: wrap; align-items:center; }
    .field{ display:flex; flex-direction: column; gap:8px; min-width: 140px; flex:1; }
    .label{ font-size: 12px; color: var(--muted); }
    .control{
      width:100%;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: var(--text);
      padding: 12px 12px;
      font-size: 14px;
      outline:none;
    }
    .chips{ display:flex; gap:8px; flex-wrap: wrap; }
    .chip{
      border:1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: var(--muted);
      padding: 9px 12px;
      border-radius: 999px;
      font-size: 13px;
      cursor:pointer;
      user-select:none;
    }
    .chip.on{
      color: rgba(255,255,255,.92);
      border-color: rgba(109,94,246,.55);
      background: rgba(109,94,246,.16);
      box-shadow: 0 8px 20px rgba(109,94,246,.15);
    }
    .actions{ display:flex; gap:10px; flex-wrap:wrap; }
    .btn{
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: var(--text);
      padding: 12px 12px;
      border-radius: 16px;
      font-size: 14px;
      cursor:pointer;
      display:inline-flex; align-items:center; justify-content:center; gap:8px;
      min-width: 120px;
      flex: 1;
    }
    .btn.primary{
      border-color: rgba(109,94,246,.65);
      background: linear-gradient(135deg, rgba(109,94,246,.92), rgba(0,209,255,.55));
      box-shadow: 0 12px 30px rgba(109,94,246,.20);
      font-weight: 900;
    }
    .btn.ghost{ color: var(--muted); }
    .out{
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
      font-size: 13px;
      line-height: 1.75;
      white-space: pre-wrap;
      background: rgba(0,0,0,.20);
      border-top: 1px solid rgba(255,255,255,.08);
      min-height: 240px;
    }
    .toast{
      position: fixed;
      left: 12px; right: 12px;
      bottom: calc(12px + env(safe-area-inset-bottom));
      max-width: 760px;
      margin: 0 auto;
      background: rgba(20,25,36,.92);
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 16px;
      padding: 12px 12px;
      box-shadow: var(--shadow);
      display:none;
      gap: 10px;
      align-items: center;
      z-index: 100;
    }
    .toast.show{ display:flex; }
    .toast .t{ font-size: 13px; color: var(--text); }
    .toast .s{ font-size: 12px; color: var(--muted); }
    .toast .badge{
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid rgba(255,255,255,.10);
      background: rgba(255,255,255,.06);
      color: var(--muted);
      white-space: nowrap;
    }
    .spin{
      width: 16px; height: 16px;
      border-radius: 50%;
      border: 2px solid rgba(255,255,255,.25);
      border-top-color: rgba(255,255,255,.85);
      animation: spin .8s linear infinite;
    }
    @keyframes spin{ to { transform: rotate(360deg); } }
    .muted{ color: var(--muted); }
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div class="brand">
        <div class="logo">MQ</div>
        <div class="titlewrap">
          <div class="title">MarketiQ Mini App</div>
          <div class="subtitle" id="sub">اتصال…</div>
        </div>
      </div>
      <div class="pill"><span class="dot"></span><span id="pillTxt">Online</span></div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-h">
          <strong>تحلیل سریع</strong>
          <span id="meta">—</span>
        </div>
        <div class="card-b">
          <div class="row">
            <div class="field" style="flex:1.4">
              <div class="label">جستجوی نماد</div>
              <input id="q" class="control" placeholder="مثلاً BTC یا EUR یا XAU…" />
            </div>
            <div class="field" style="flex:1">
              <div class="label">نماد</div>
              <select id="symbol" class="control"></select>
            </div>
          </div>

          <div style="height:10px"></div>

          <div class="row">
            <div class="field">
              <div class="label">تایم‌فریم</div>
              <div class="chips" id="tfChips">
                <div class="chip" data-tf="M15">M15</div>
                <div class="chip" data-tf="H1">H1</div>
                <div class="chip on" data-tf="H4">H4</div>
                <div class="chip" data-tf="D1">D1</div>
              </div>
              <select id="timeframe" class="control" style="display:none">
                <option value="M15">M15</option>
                <option value="H1">H1</option>
                <option value="H4" selected>H4</option>
                <option value="D1">D1</option>
              </select>
            </div>
            <div class="field">
              <div class="label">سبک</div>
              <select id="style" class="control">
                <option value="اسکالپ">اسکالپ</option>
                <option value="سوئینگ">سوئینگ</option>
                <option value="اسمارت‌مانی" selected>اسمارت‌مانی</option>
                <option value="پرایس اکشن">پرایس اکشن</option>
                <option value="ICT">ICT</option>
                <option value="ATR">ATR</option>
              </select>
            </div>
            <div class="field">
              <div class="label">ریسک</div>
              <select id="risk" class="control">
                <option value="کم">کم</option>
                <option value="متوسط" selected>متوسط</option>
                <option value="زیاد">زیاد</option>
              </select>
            </div>
            <div class="field">
              <div class="label">خبر</div>
              <select id="newsEnabled" class="control">
                <option value="true" selected>روشن ✅</option>
                <option value="false">خاموش ❌</option>
              </select>
            </div>
          </div>

          <div style="height:12px"></div>

          <div class="actions">
            <button id="save" class="btn">💾 ذخیره</button>
            <button id="analyze" class="btn primary">⚡ تحلیل</button>
            <button id="close" class="btn ghost">✖ بستن</button>
          </div>

          <div style="height:10px"></div>
          <div class="muted" style="font-size:12px; line-height:1.6;" id="welcome"></div>
        </div>

        <div class="out" id="out">آماده…</div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast">
    <div class="spin" id="spin" style="display:none"></div>
    <div style="min-width:0">
      <div class="t" id="toastT">…</div>
      <div class="s" id="toastS"></div>
    </div>
    <div class="badge" id="toastB"></div>
  </div>

  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;

const MINI_APP_JS = `const tg = window.Telegram?.WebApp;
if (tg) tg.ready();

const out = document.getElementById("out");
const meta = document.getElementById("meta");
const sub = document.getElementById("sub");
const pillTxt = document.getElementById("pillTxt");
const welcome = document.getElementById("welcome");

function el(id){ return document.getElementById(id); }
function val(id){ return el(id).value; }
function setVal(id, v){ el(id).value = v; }

const toast = el("toast");
const toastT = el("toastT");
const toastS = el("toastS");
const toastB = el("toastB");
const spin = el("spin");

let ALL_SYMBOLS = [];

function showToast(title, subline = "", badge = "", loading = false){
  toastT.textContent = title || "";
  toastS.textContent = subline || "";
  toastB.textContent = badge || "";
  spin.style.display = loading ? "inline-block" : "none";
  toast.classList.add("show");
}
function hideToast(){ toast.classList.remove("show"); }

function fillSymbols(list){
  ALL_SYMBOLS = Array.isArray(list) ? list.slice() : [];
  const sel = el("symbol");
  const cur = sel.value;
  sel.innerHTML = "";
  for (const s of ALL_SYMBOLS) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  }
  if (cur && ALL_SYMBOLS.includes(cur)) sel.value = cur;
}

function filterSymbols(q){
  q = (q || "").trim().toUpperCase();
  const sel = el("symbol");
  const cur = sel.value;
  sel.innerHTML = "";

  const list = !q ? ALL_SYMBOLS : ALL_SYMBOLS.filter(s => s.includes(q));
  for (const s of list) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    sel.appendChild(opt);
  }
  if (cur && list.includes(cur)) sel.value = cur;
}

function setTf(tf){
  setVal("timeframe", tf);
  const chips = el("tfChips")?.querySelectorAll(".chip") || [];
  for (const c of chips) c.classList.toggle("on", c.dataset.tf === tf);
}

async function api(path, body){
  const r = await fetch(path, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j };
}

function prettyErr(j, status){
  const e = j?.error || "نامشخص";
  if (status === 429 && String(e).startsWith("quota_exceeded")) return "سهمیه امروز تمام شد.";
  if (status === 403 && String(e) === "onboarding_required") return "ابتدا نام و شماره را داخل ربات ثبت کنید.";
  if (status === 401) return "احراز هویت تلگرام ناموفق است.";
  return "مشکلی پیش آمد. لطفاً دوباره تلاش کنید.";
}

function updateMeta(state, quota){
  meta.textContent = \`سهمیه: \${quota || "-"}\`;
  sub.textContent = \`ID: \${state?.userId || "-"} | امروز(Kyiv): \${state?.dailyDate || "-"}\`;
}

async function boot(){
  out.textContent = "⏳ در حال آماده‌سازی…";
  pillTxt.textContent = "Connecting…";
  showToast("در حال اتصال…", "دریافت پروفایل و تنظیمات", "API", true);

  const initData = tg?.initData || "";
  const {status, json} = await api("/api/user", { initData });

  if (!json?.ok) {
    hideToast();
    pillTxt.textContent = "Offline";
    out.textContent = "⚠️ خطا: " + prettyErr(json, status);
    showToast("خطا", prettyErr(json, status), "API", false);
    return;
  }

  welcome.textContent = json.welcome || "";
  fillSymbols(json.symbols || []);
  if (json.state?.timeframe) setTf(json.state.timeframe);
  if (json.state?.style) setVal("style", json.state.style);
  if (json.state?.risk) setVal("risk", json.state.risk);
  setVal("newsEnabled", String(!!json.state?.newsEnabled));

  if (json.symbols?.length) setVal("symbol", json.symbols[0]);

  updateMeta(json.state, json.quota);
  out.textContent = "آماده ✅";
  pillTxt.textContent = "Online";
  hideToast();
}

el("q").addEventListener("input", (e) => filterSymbols(e.target.value));

el("tfChips").addEventListener("click", (e) => {
  const chip = e.target?.closest?.(".chip");
  const tf = chip?.dataset?.tf;
  if (!tf) return;
  setTf(tf);
});

el("save").addEventListener("click", async () => {
  showToast("در حال ذخیره…", "تنظیمات ذخیره می‌شود", "SET", true);
  out.textContent = "⏳ ذخیره تنظیمات…";

  const initData = tg?.initData || "";
  const payload = {
    initData,
    timeframe: val("timeframe"),
    style: val("style"),
    risk: val("risk"),
    newsEnabled: val("newsEnabled") === "true",
  };

  const {status, json} = await api("/api/settings", payload);
  if (!json?.ok) {
    out.textContent = "⚠️ خطا: " + prettyErr(json, status);
    showToast("خطا", prettyErr(json, status), "SET", false);
    return;
  }

  out.textContent = "✅ تنظیمات ذخیره شد.";
  updateMeta(json.state, json.quota);
  showToast("ذخیره شد ✅", "تنظیمات اعمال شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("analyze").addEventListener("click", async () => {
  showToast("در حال تحلیل…", "جمع‌آوری دیتا + تولید خروجی", "AI", true);
  out.textContent = "⏳ در حال تحلیل…";

  const initData = tg?.initData || "";
  const payload = { initData, symbol: val("symbol"), userPrompt: "" };

  const {status, json} = await api("/api/analyze", payload);
  if (!json?.ok) {
    const msg = prettyErr(json, status);
    out.textContent = "⚠️ " + msg;
    showToast("خطا", msg, status === 429 ? "Quota" : "AI", false);
    return;
  }

  out.textContent = json.result || "⚠️ بدون خروجی";
  updateMeta(json.state, json.quota);
  showToast("آماده ✅", "خروجی دریافت شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("close").addEventListener("click", () => tg?.close());

boot();`;
