// @ts-nocheck

function parseIdList(x){
  return String(x||"").split(",").map(t=>t.trim()).filter(Boolean);
}
function isOwnerId(env, userId){
  const ids = parseIdList(env.OWNER_IDS || env.OWNER_ID);
  return ids.includes(String(userId));
}
function isManagerL1(env, userId){
  const ids = parseIdList(env.MANAGER_L1_IDS || "");
  return ids.includes(String(userId)) || isOwnerId(env, userId);
}
function isManagerL2(env, userId){
  const ids = parseIdList(env.MANAGER_L2_IDS || "");
  return ids.includes(String(userId)) || isOwnerId(env, userId);
}
// @ts-nocheck
/*
  MarketiQ Worker (single-file)
  v4 hotfix: define response helpers BEFORE export default.
  دلیل: در بعضی جریان‌های Build/Editor کلودفلر، اگر helper ها پایین فایل باشند،
  ممکن است در اولین اجرا ReferenceError بخورند.
*/

var env; // global placeholder to avoid ReferenceError in helper calls

/* ========================== WORKER RESPONSE HELPERS (PRELUDE) ========================== */
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function jsResponse(js, status = 200) {
  return new Response(js, {
    status,
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
export default {
  async fetch(request, env, ctx) {
  // Base URL for building Mini App links when PUBLIC_BASE_URL is not set
  env.__BASE_URL = new URL(request.url).origin;
    if(hasD1(env)) { try{ ctx.waitUntil(ensureD1Schema(env)); }catch(_e){} }
    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") return new Response("ok", { status: 200 });

      // ===== Payment Page =====
      if (request.method === "GET" && url.pathname === "/pay") {
        const wallet = await getWallet(env);
        const price = await getSubPrice(env);
        const currency = await getSubCurrency(env);
        const days = await getSubDays(env);
        return htmlResponse(buildPaymentPageHtml({ brand: BRAND, wallet, price, currency, days, support: (env.SUPPORT_HANDLE || "@support") }));
      }

      // ===== Mini App (inline) =====
      if (request.method === "GET" && url.pathname === "/") return htmlResponse(MINI_APP_HTML);
      if (request.method === "GET" && url.pathname === "/app.js") return jsResponse(MINI_APP_JS);

      if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) return htmlResponse(ADMIN_APP_HTML);
      if (request.method === "GET" && url.pathname === "/admin.js") return jsResponse(ADMIN_APP_JS);

      // ===== Mini App APIs =====
      if (url.pathname === "/api/user" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        const onboardOk = isOnboardComplete(st);
        const quota = await quotaText(st, v.fromLike, env);
        const dLim = await dailyLimitForUser(st, v.fromLike, env);
        const mLim = await monthlyLimitForUser(st, v.fromLike, env);
        const energy = {
          daily: { used: st.dailyUsed||0, limit: Number.isFinite(dLim)?dLim:null, remaining: Number.isFinite(dLim)?Math.max(0, dLim-(st.dailyUsed||0)):null },
          monthly: { used: st.monthlyUsed||0, limit: Number.isFinite(mLim)?mLim:null, remaining: Number.isFinite(mLim)?Math.max(0, mLim-(st.monthlyUsed||0)):null },
        };
        const offer = await getOfferConfig(env);
        const customPrompt = (() => {
          if(!st.customPromptRequestedAt) return { status:"none" };
          const readyMs = Date.parse(st.customPromptReadyAt||"");
          const isReady = Number.isFinite(readyMs) && Date.now() >= readyMs;
          if(st.customPromptDeliveredAt) return { status:"delivered", requestedAt: st.customPromptRequestedAt, deliveredAt: st.customPromptDeliveredAt };
          if(isReady) return { status:"ready", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
          return { status:"pending", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
        })();

        const from = v.fromLike || { id: v.userId };
        const role = {
          owner: isOwner(from, env),
          admin: isAdmin(from, env),
          privileged: isPrivileged(from, env),
        };
        const symbols = [...MAJORS, ...METALS, ...INDICES, ...STOCKS, ...CRYPTOS];
        const wallet = await getWallet(env);
        const subPrice = await getSubPrice(env);
        const subCurrency = await getSubCurrency(env);
        const subDays = await getSubDays(env);
        const payUrl = new URL("/pay", url.origin).toString();

        const styleCatalog = await getStyleCatalog(env);
        const stylesVersion = await getStylesVersion(env);
        const bannersVersion = await getBannersVersion(env);
        const styles = (styleCatalog||[]).filter(s=>s && s.enabled).map(s=>({ key:s.key, label:s.label }));
        const styleKey = styleKeyFromLabel(st.style, styleCatalog) || "";
        const bannerKey = await getActiveBanner(env);
        const bannerUrl = bannerKey ? new URL(`/banner/${bannerKey}`, url.origin).toString() : "";

        return jsonResponse({
          ok: true,
          state: stPublic(st),
          quota,
          symbols,
          styles,
          stylesVersion,
          bannersVersion,
          styleKey,
          bannerUrl,
          profile: {
            refLink: (()=>{ const botUsername = String(env.BOT_USERNAME||"").replace(/^@/,"").trim(); const code = Array.isArray(st.refCodes)&&st.refCodes.length?st.refCodes[0]:""; return (botUsername&&code)?`https://t.me/${botUsername}?start=${code}`:(code||""); })(),
            points: st.points||0,
            invites: st.successfulInvites||0,
            balance: st.walletBalance||0,
            depositRequests: st.walletDepositRequests||0,
            withdrawRequests: st.walletWithdrawRequests||0,
            bep20Address: st.bep20Address||"",
          },
          onboardOk,
          wallet,
          subPrice,
          subCurrency,
          subDays,
          payUrl,
          welcome: MINI_APP_WELCOME_TEXT,
          role,
          offer,
          energy,
          customPrompt,
          infoText: CUSTOM_PROMPT_INFO_TEXT,
        });
      }

      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if (!isOnboardComplete(st)) return jsonResponse({ ok: false, error: "onboarding_required" }, 403);

        if (typeof body.timeframe === "string") st.timeframe = sanitizeTimeframe(body.timeframe) || st.timeframe;
        if (typeof body.style === "string") {
          const nextStyle = sanitizeStyle(body.style) || st.style;
          if(nextStyle === "پرامپت اختصاصی" && !st.customPromptDeliveredAt){
            return jsonResponse({ ok:false, error:"custom_prompt_required", info: CUSTOM_PROMPT_INFO_TEXT }, 400);
          }
          st.style = nextStyle;
        }
        if (typeof body.risk === "string") st.risk = sanitizeRisk(body.risk) || st.risk;
        if (typeof body.newsEnabled === "boolean") st.newsEnabled = body.newsEnabled;
        await saveUser(v.userId, st, env);
        const quota = await quotaText(st, v.fromLike, env);
        const dLim = await dailyLimitForUser(st, v.fromLike, env);
        const mLim = await monthlyLimitForUser(st, v.fromLike, env);
        const energy = {
          daily: { used: st.dailyUsed||0, limit: Number.isFinite(dLim)?dLim:null, remaining: Number.isFinite(dLim)?Math.max(0, dLim-(st.dailyUsed||0)):null },
          monthly: { used: st.monthlyUsed||0, limit: Number.isFinite(mLim)?mLim:null, remaining: Number.isFinite(mLim)?Math.max(0, mLim-(st.monthlyUsed||0)):null },
        };
        const offer = await getOfferConfig(env);
        const customPrompt = (() => {
          if(!st.customPromptRequestedAt) return { status:"none" };
          const readyMs = Date.parse(st.customPromptReadyAt||"");
          const isReady = Number.isFinite(readyMs) && Date.now() >= readyMs;
          if(st.customPromptDeliveredAt) return { status:"delivered", requestedAt: st.customPromptRequestedAt, deliveredAt: st.customPromptDeliveredAt };
          if(isReady) return { status:"ready", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
          return { status:"pending", requestedAt: st.customPromptRequestedAt, readyAt: st.customPromptReadyAt };
        })();

        return jsonResponse({ ok: true, state: stPublic(st), quota });
      }

if (url.pathname === "/api/analyze" && request.method === "POST") {
  const body = (request._cachedJson ?? await request.json().catch(()=>null));
  if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

  const v = await authMiniApp(body, env);
  if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

  const st = await ensureUser(v.userId, env, v.fromLike);
  if (!isOnboardComplete(st)) return jsonResponse({ ok: false, error: "onboarding_required" }, 403);

  const symbol = normalizeSymbol(body.symbol);
  if (!symbol || !isSymbol(symbol)) return jsonResponse({ ok: false, error: "invalid_symbol" }, 400);

  // quota check (subscription-aware)
  if (env.BOT_KV && !(await canAnalyzeToday(st, v.fromLike, env))) {
    const quota = await quotaText(st, v.fromLike, env);
    return jsonResponse({ ok: false, error: "quota_exceeded", quota }, 429);
  }

  const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt : "";

  try {
    // Run analysis first (don't consume quota on failure)
    const out = await runSignalTextFlowReturnText(env, v.fromLike, st, symbol, userPrompt);

    if (env.BOT_KV && out && out.ok) {
      await consumeDaily(st, v.fromLike, env);
      await saveUser(v.userId, st, env);
    }

    const quota = await quotaText(st, v.fromLike, env);
    return jsonResponse({
      ok: true,
      result: out?.text || "",
      chartUrl: out?.chartUrl || "",
      headlines: out?.headlines || [],
      modelJson: out?.plan || null,
      state: stPublic(st),
      quota,
    });
  } catch (e) {
    console.error("api/analyze error:", e);

    const msg = String(e?.message || "");
    let code = "try_again";
    if (
      msg.includes("AI_binding_missing") ||
      msg.includes("OPENAI_API_KEY_missing") ||
      msg.includes("GEMINI_API_KEY_missing") ||
      msg.includes("all_text_providers_failed")
    ) code = "ai_not_configured";
    else if (
      msg.includes("market_data") ||
      msg.includes("binance_") ||
      msg.includes("yahoo_") ||
      msg.includes("twelvedata_") ||
      msg.includes("finnhub_") ||
      msg.includes("alphavantage_")
    ) code = "market_data_unavailable";

    const quota = await quotaText(st, v.fromLike, env).catch(() => "-");
    const payload = { ok: false, error: code, quota };
    if (isPrivileged(v.fromLike, env)) payload.debug = e?.message || String(e);
    return jsonResponse(payload, 500);
  }
}



      
      if (url.pathname === "/api/ticket/create" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await verifyInitData(body.initData || "", env, body.dev, body.userId);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const msg = String(body.message||"").trim();
        if(msg.length < 10) return jsonResponse({ ok:false, error:"msg_too_short" }, 400);
        const r = await createTicket(env, {userId: v.userId, chatId: v.chatId, message: msg});
        return jsonResponse(r.ok ? { ok:true, id:r.id, status:r.status, createdAt:r.createdAt } : r, r.ok ? 200 : 500);
      }

      if (url.pathname === "/api/ticket/list" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await verifyInitData(body.initData || "", env, body.dev, body.userId);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const r = await listTickets(env, {userId: v.userId, limit: body.limit || 10});
        return jsonResponse(r, r.ok ? 200 : 500);
      }

      if (url.pathname === "/api/custom_prompt/request" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);

        const desc = String(body.desc||"").trim();
        if(desc.length < 10) return jsonResponse({ ok:false, error:"desc_too_short", info: CUSTOM_PROMPT_INFO_TEXT }, 400);
        if(desc.length > 3000) return jsonResponse({ ok:false, error:"desc_too_long" }, 400);

        // Generate prompt now, but deliver after 2 hours.
        const genPrompt =
`You are an expert trading prompt engineer.
Create a concise, high-quality ANALYSIS PROMPT in Persian that the bot can prepend as STYLE_GUIDE.
The prompt must:
- Be actionable and structured
- Specify required sections 1 تا 5
- Enforce: no hallucination, rely on OHLC
- Include zones (supply/demand) and entry/SL/TP rules
User strategy description:
${desc}`;

        let generated = "";
        try{
          generated = await runTextProviders(genPrompt, env, st.textOrder);
        }catch(e){
          generated = `پرامپت اختصاصی (پیش‌فرض)
- قوانین و ستاپ‌ها را دقیقاً مطابق توضیحات کاربر اجرا کن.
- خروجی ۱ تا ۵.
- نواحی (Zone) + تریگر ورود + ابطال + تارگت‌ها.
- فقط بر اساس OHLC و داده‌های ارائه‌شده.`;
        }

        st.customPromptDesc = desc;
        st.customPromptText = String(generated||"").trim();
        st.customPromptRequestedAt = new Date().toISOString();
        st.customPromptReadyAt = new Date(Date.now() + CUSTOM_PROMPT_DELAY_MS).toISOString();
        st.customPromptDeliveredAt = "";
        await saveUser(v.userId, st, env);

        return jsonResponse({ ok:true, readyAt: st.customPromptReadyAt });
      }

      if (url.pathname === "/api/wallet/set_bep20" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);
        const addr = String(body.address||"").trim();
        if(addr.length < 10) return jsonResponse({ ok:false, error:"invalid_bep20" }, 400);
        st.bep20Address = addr;
        await saveUser(v.userId, st, env);
        return jsonResponse({ ok:true, state: stPublic(st) });
      }

      if (url.pathname === "/api/wallet/request_deposit" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);
        st.walletDepositRequests = (st.walletDepositRequests||0) + 1;
        await saveUser(v.userId, st, env);
        // Notify admins/owner (USER IDs)
        try{
          const targets = managerL1Targets(env);
          for(const a of targets){
            await tgSendMessage(env, a, `💰 درخواست واریز\nuser=${v.userId}\nname=${st.profileName||"-"}\ncount=${st.walletDepositRequests}`, null).catch(()=>{});
          }
        }catch(_e){}
return jsonResponse({ ok:true });
      }

      if (url.pathname === "/api/wallet/request_withdraw" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);
        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);
        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if(!isOnboardComplete(st)) return jsonResponse({ ok:false, error:"onboarding_required" }, 403);
        if(!st.bep20Address) return jsonResponse({ ok:false, error:"bep20_required" }, 400);
        st.walletWithdrawRequests = (st.walletWithdrawRequests||0) + 1;
        await saveUser(v.userId, st, env);
        // Notify admins/owner (USER IDs)
        try{
          const targets = managerL1Targets(env);
          for(const a of targets){
            await tgSendMessage(env, a, `🏦 درخواست برداشت\nuser=${v.userId}\nname=${st.profileName||"-"}\nBEP20=${st.bep20Address}\ncount=${st.walletWithdrawRequests}`, null).catch(()=>{});
          }
        }catch(_e){}
return jsonResponse({ ok:true });
      }
      if (url.pathname === "/api/payment/submit" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if (!body) return jsonResponse({ ok: false, error: "bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if (!v.ok) return jsonResponse({ ok: false, error: "auth_failed" }, 401);

        const st = await ensureUser(v.userId, env, { username: v.fromLike?.username || "" });
        if (!isOnboardComplete(st)) return jsonResponse({ ok: false, error: "onboarding_required" }, 403);

        const txid = normalizeTxId(body.txid || "");
        if (!txid) return jsonResponse({ ok: false, error: "invalid_txid" }, 400);

        try{
          const rec = await createPendingPayment(env, v.userId, txid);

          // Notify admins/owner (USER IDs)
          const targets = managerL1Targets(env);
          for(const a of targets){
            await tgSendMessage(env, a,
            `💳 پرداخت جدید (مرحله ۱)\nuser=${v.userId}\nTxID=${rec.txid}\namount=${rec.amount} ${rec.currency}\ndays=${rec.days}\n\nبرای تایید/رد از دکمه‌ها استفاده کن:`,
            { inline_keyboard: [[
              { text:"✅ تایید مرحله ۱", callback_data:`PAY1:${rec.txid}` },
              { text:"❌ رد", callback_data:`PAYREJ:${rec.txid}` }
            ]] }
          ).catch(()=>{});
          }
return jsonResponse({ ok: true });
        }catch(e){
          const msg = (e?.message === "txid_exists") ? "txid_exists" : "try_again";
          return jsonResponse({ ok: false, error: msg }, 400);
        }
      }

      if (url.pathname === "/api/admin/get" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        const wallet = await getWallet(env);
        const price = await getSubPrice(env);
        const currency = await getSubCurrency(env);
        const days = await getSubDays(env);
        const freeLimit = await getFreeDailyLimit(env);
        const subLimit = await getSubDailyLimit(env);
        const monthlyLimit = await getMonthlyLimit(env);
        const offer = await getOfferConfig(env);

        return jsonResponse({ ok:true, config:{ wallet, price, currency, days, freeLimit, subLimit, monthlyLimit, offer }, role:{
          owner: isOwner(from, env),
          admin: isAdmin(from, env),
          privileged: true
        }});
      }

      if (url.pathname === "/api/admin/set" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        try{
          // Wallet (ADMIN only)
          if(body.wallet !== undefined){
            if(!isAdmin(from, env)) return jsonResponse({ ok:false, error:"wallet_admin_only" }, 403);
            await setWallet(env, String(body.wallet||"").trim(), from);
          }

          // Subscription settings (Owner/Admin)
          if(body.price !== undefined) await setSubPrice(env, body.price);
          if(body.currency !== undefined) await setSubCurrency(env, body.currency);
          if(body.days !== undefined) await setSubDays(env, body.days);

          // Limits
          if(body.freeLimit !== undefined) await setFreeDailyLimit(env, body.freeLimit);
          if(body.subLimit !== undefined) await setSubDailyLimit(env, body.subLimit);
          if(body.monthlyLimit !== undefined) await setMonthlyLimit(env, body.monthlyLimit);

          // Offer banner
          if(body.offer !== undefined){
            const o = body.offer || {};
            await setOfferConfig(env, { enabled: !!o.enabled, text: o.text || "", url: o.url || "", image: o.image || "" });
          }

          // Style prompt override
          if(body.styleKey !== undefined && body.stylePrompt !== undefined){
            const key = String(body.styleKey||"").trim();
            const prompt = String(body.stylePrompt||"");
            const safeKey = key.replace(/[^a-z0-9_]/gi, "").toLowerCase();
            if(["rtm","ict","price_action","prompt","custom_method","custom_prompt"].includes(safeKey)){
              await setCfg(env, `style_prompt_${safeKey}`, `cfg:style_prompt:${safeKey}`, prompt);
            }
          }

          return jsonResponse({ ok:true });
        }catch(e){
          console.error("admin/set error:", e);
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      if (url.pathname === "/api/admin/payments" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        const res = await listPendingPayments(env, 30);
        return jsonResponse({ ok:true, items: res.items });
      }

      if (url.pathname === "/api/admin/approve" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        try{
          const rec = await markPaymentApproved(env, body.txid, v.userId);
          await tgSendMessage(env, rec.userId, `✅ پرداخت تایید شد. اشتراک شما فعال شد (${rec.days} روز).`).catch(()=>{});
          return jsonResponse({ ok:true });
        }catch(e){
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      if (url.pathname === "/api/admin/reject" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

        try{
          const rec = await markPaymentRejected(env, body.txid, v.userId);
          await tgSendMessage(env, rec.userId, "🚫 پرداخت شما رد شد. اگر اشتباه شده، با پشتیبانی تماس بگیرید.").catch(()=>{});
          return jsonResponse({ ok:true });
        }catch(e){
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      if (url.pathname === "/api/admin/commission_set" && request.method === "POST") {
  const body = (request._cachedJson ?? await request.json().catch(()=>null));
  if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

  const v = await authMiniApp(body, env);
  if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

  const from = v.fromLike || { id: v.userId };
  if(!isPrivileged(from, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);

  try{
    const uid = String(body.userId||"").trim();
    if(!uid) return jsonResponse({ ok:false, error:"no_user" }, 400);
    let st = patchUser((await getUser(uid, env))||{}, uid);
    if(body.pct === null || body.pct === undefined || body.pct === ""){
      delete st.refCommissionPctOverride;
    } else {
      const n = Number(body.pct);
      if(!Number.isFinite(n) || n < 0 || n > 100) return jsonResponse({ ok:false, error:"bad_pct" }, 400);
      st.refCommissionPctOverride = Math.round(n*100)/100;
    }
    await saveUser(uid, st, env);
    return jsonResponse({ ok:true });
  }catch(e){
    return jsonResponse({ ok:false, error:"try_again" }, 400);
  }
}

if (url.pathname === "/api/admin/refgen" && request.method === "POST") {
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const v = await authMiniApp(body, env);
        if(!v.ok) return jsonResponse({ ok:false, error:"auth_failed" }, 401);

        const from = v.fromLike || { id: v.userId };
        if(!isAdmin(from, env)) return jsonResponse({ ok:false, error:"admin_only" }, 403);

        try{
          const targetId = String(body.userId||"").trim();
          const codes = await adminGenerateRefCodes(env, targetId, 5);
          const botUsername = String(env.BOT_USERNAME||"").replace(/^@/,"");
          const links = botUsername ? codes.map(c=>`https://t.me/${botUsername}?start=${c}`) : codes;
          return jsonResponse({ ok:true, codes, links });
        }catch(e){
          return jsonResponse({ ok:false, error:"try_again" }, 400);
        }
      }

      
      
      // ===== Admin Web Panel (token-based, NOT Telegram Mini App) =====
      if (url.pathname === "/api/admin2/bootstrap" && request.method === "POST") {
        if(!isAdminToken(request, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);
        await ensureD1Schema(env);

        const wallet = await getWallet(env);
        const price = await getSubPrice(env);
        const currency = await getSubCurrency(env);
        const days = await getSubDays(env);
        const freeLimit = await getFreeDailyLimit(env);
        const subLimit = await getSubDailyLimit(env);
        const monthlyLimit = await getMonthlyLimit(env);

        const styles = (await getStyleCatalog(env)).map(s=>({ key:s.key, label:s.label, prompt:s.prompt, enabled:!!s.enabled, sort:Number(s.sort||10) }));
        let banners = [];
        if(hasD1(env)){
          try{
            const rows = await env.BOT_DB.prepare("SELECT key, content_type, size, active, created_at FROM banners ORDER BY active DESC, created_at DESC").all();
            banners = (rows?.results||[]).map(b=>({
              key:String(b.key),
              active: Number(b.active||0) ? true : false,
              contentType: String(b.content_type||""),
              size: Number(b.size||0),
              serveUrl: `${env.__BASE_URL}/banner/${String(b.key)}`
            }));
          }catch(_e){}
        }

        return jsonResponse({ ok:true, config:{ wallet, price, currency, days, freeLimit, subLimit, monthlyLimit }, styles, banners });
      }

      if (url.pathname === "/api/admin2/config/set" && request.method === "POST") {
        if(!isAdminToken(request, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        if(body.price !== undefined) await setSubPrice(env, body.price);
        if(body.currency !== undefined) await setSubCurrency(env, body.currency);
        if(body.days !== undefined) await setSubDays(env, body.days);
        if(body.freeLimit !== undefined) await setFreeDailyLimit(env, body.freeLimit);
        if(body.subLimit !== undefined) await setSubDailyLimit(env, body.subLimit);
        if(body.monthlyLimit !== undefined) await setMonthlyLimit(env, body.monthlyLimit);

        return jsonResponse({ ok:true });
      }

      if (url.pathname === "/api/admin2/style/upsert" && request.method === "POST") {
        if(!isAdminToken(request, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const key = String(body.key||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
        const label = String(body.label||"").trim();
        const prompt = String(body.prompt||"");
        const enabled = body.enabled ? 1 : 0;
        const sort = Number.isFinite(Number(body.sort)) ? Number(body.sort) : 10;
        if(!key || !label) return jsonResponse({ ok:false, error:"bad_style" }, 400);

        await ensureD1Schema(env);
        if(hasD1(env)){
          await env.BOT_DB.prepare(
            "INSERT INTO styles (key,label,prompt,enabled,sort,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7) " +
            "ON CONFLICT(key) DO UPDATE SET label=excluded.label, prompt=excluded.prompt, enabled=excluded.enabled, sort=excluded.sort, updated_at=excluded.updated_at"
          ).bind(key, label, prompt, enabled, sort, nowIso(), nowIso()).run();
        }

        // KV fallback mirror
        const cat = (await getStyleCatalog(env)).filter(s=>s.key!==key);
        cat.push({ key, label, prompt, enabled: !!enabled, sort });
        cat.sort((a,b)=>(Number(a.sort||10)-Number(b.sort||10))||String(a.key).localeCompare(String(b.key)));
        if(env.BOT_KV) await env.BOT_KV.put("cfg:styles_json", JSON.stringify(cat)).catch(()=>{});
        _STYLE_CACHE.items = null; _STYLE_CACHE.at = 0; _STYLE_CACHE.ver = "0";
        await bumpStylesVersion(env);

        return jsonResponse({ ok:true });
      }

      if (url.pathname === "/api/admin2/style/delete" && request.method === "POST") {
        if(!isAdminToken(request, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const key = String(body.key||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
        if(!key) return jsonResponse({ ok:false, error:"bad_style" }, 400);

        await ensureD1Schema(env);
        if(hasD1(env)){
          await env.BOT_DB.prepare("DELETE FROM styles WHERE key=?1").bind(key).run().catch(()=>{});
        }

        // KV mirror
        const cat = (await getStyleCatalog(env)).filter(s=>s.key!==key);
        if(env.BOT_KV) await env.BOT_KV.put("cfg:styles_json", JSON.stringify(cat)).catch(()=>{});
        _STYLE_CACHE.items = null; _STYLE_CACHE.at = 0; _STYLE_CACHE.ver = "0";
        await bumpStylesVersion(env);

        return jsonResponse({ ok:true });
      }

      if (url.pathname === "/api/admin2/banner/upload" && request.method === "POST") {
        if(!isAdminToken(request, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        if(!r2Has(env)) return jsonResponse({ ok:false, error:"r2_not_bound" }, 400);

        const urlStr = String(body.url||"").trim();
        if(!urlStr) return jsonResponse({ ok:false, error:"no_url" }, 400);

        let key = String(body.key||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
        if(!key) key = `banner_${Date.now()}`;

        // Fetch remote (with safe fallbacks)
        const r = await fetch(urlStr, { redirect:"follow" }).catch(()=>null);
        if(!r || !r.ok) return jsonResponse({ ok:false, error:"fetch_failed" }, 400);

        const ct = String(r.headers.get("content-type")||"image/jpeg").split(";")[0].trim() || "image/jpeg";
        const ab = await r.arrayBuffer();
        if(ab.byteLength > 5*1024*1024) return jsonResponse({ ok:false, error:"too_large" }, 400);

        await env.BOT_R2.put(key, ab, { httpMetadata: { contentType: ct } });

        await ensureD1Schema(env);
        if(hasD1(env)){
          await env.BOT_DB.prepare(
            "INSERT INTO banners (key, content_type, size, active, created_at) VALUES (?1,?2,?3,0,?4) " +
            "ON CONFLICT(key) DO UPDATE SET content_type=excluded.content_type, size=excluded.size"
          ).bind(key, ct, ab.byteLength, nowIso()).run();
        }

        _BANNER_CACHE.at = 0; _BANNER_CACHE.key = null; _BANNER_CACHE.ver = "0";
        await bumpBannersVersion(env);
        return jsonResponse({ ok:true, key });
      }

      if (url.pathname === "/api/admin2/banner/activate" && request.method === "POST") {
        if(!isAdminToken(request, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const key = String(body.key||"").trim();
        if(!key) return jsonResponse({ ok:false, error:"bad_key" }, 400);

        await ensureD1Schema(env);
        if(hasD1(env)){
          await env.BOT_DB.prepare("UPDATE banners SET active=0").run().catch(()=>{});
          await env.BOT_DB.prepare("UPDATE banners SET active=1 WHERE key=?1").bind(key).run().catch(()=>{});
        }

        _BANNER_CACHE.at = 0; _BANNER_CACHE.key = null; _BANNER_CACHE.ver = "0";
        await bumpBannersVersion(env);
        return jsonResponse({ ok:true });
      }

      if (url.pathname === "/api/admin2/commission/set" && request.method === "POST") {
        if(!isAdminToken(request, env)) return jsonResponse({ ok:false, error:"forbidden" }, 403);
        const body = (request._cachedJson ?? await request.json().catch(()=>null));
        if(!body) return jsonResponse({ ok:false, error:"bad_json" }, 400);

        const pct = (body.pct === null || body.pct === undefined || body.pct === "") ? null : Number(body.pct);
        if(pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return jsonResponse({ ok:false, error:"bad_pct" }, 400);

        await ensureD1Schema(env);

        // 1) per-code override
        const code = body.code ? String(body.code).trim() : "";
        if(code){
          if(!hasD1(env)) return jsonResponse({ ok:false, error:"d1_required" }, 400);
          await env.BOT_DB.prepare("UPDATE referral_codes SET commission_pct_override=?2 WHERE code=?1")
            .bind(code, pct === null ? null : pct).run().catch(()=>{});
          // Also keep KV cache for lookupReferrerIdByCode (unchanged)
          return jsonResponse({ ok:true, scope:"code", code, pct });
        }

        // 2) per-user (by username) fallback
        const username = body.username ? String(body.username).replace(/^@/,"").trim().toLowerCase() : "";
        if(!username) return jsonResponse({ ok:false, error:"no_target" }, 400);

        let uid = null;
        if(hasD1(env)){
          const row = await env.BOT_DB.prepare("SELECT user_id FROM username_index WHERE username=?1").bind(username).first().catch(()=>null);
          uid = row?.user_id ? String(row.user_id) : null;
        }
        if(!uid) return jsonResponse({ ok:false, error:"user_not_found" }, 404);

        let st = patchUser((await getUser(uid, env))||{}, uid);
        if(pct === null) delete st.refCommissionPctOverride;
        else st.refCommissionPctOverride = Math.round(pct*100)/100;
        await saveUser(uid, st, env);

        return jsonResponse({ ok:true, scope:"user", userId: uid, username, pct });
      }

      // ===== Banner serve (R2) =====
      if (request.method === "GET" && url.pathname.startsWith("/banner/")) {
        if(!r2Has(env)) return new Response("r2_not_bound", { status: 404 });
        const key = url.pathname.split("/")[2] || "";
        if(!key) return new Response("not_found", { status: 404 });
        const obj = await env.BOT_R2.get(key).catch(()=>null);
        if(!obj) return new Response("not_found", { status: 404 });
        const headers = new Headers();
        headers.set("cache-control", "public, max-age=3600");
        headers.set("content-type", obj.httpMetadata?.contentType || "application/octet-stream");
        return new Response(obj.body, { status: 200, headers });
      }
// ===== Telegram webhook route: /telegram/<secret> =====
      // نکته: تلگرام ریدایرکت (3xx) را قبول نمی‌کند؛ پس این مسیر باید مستقیم 200 بدهد.
      // برای تست در مرورگر/پروکسی: GET/HEAD/OPTIONS همیشه 200 + ok (بدون نیاز به secret).
      {
        const p = url.pathname.replace(/\/+$/g, "");
        if (p.startsWith("/telegram/")) {
          const secret = p.split("/")[2] || "";
          const m = request.method;

          const okHeaders = {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "POST, GET, OPTIONS",
            "access-control-allow-headers": "content-type",
          };

          // Browser/proxy preflight checks: always OK
          if (m === "GET" || m === "HEAD" || m === "OPTIONS") {
            return new Response("ok", { status: 200, headers: okHeaders });
          }

          // Only POST is a real Telegram update; require secret for POST.
          const expected = String(env.TELEGRAM_WEBHOOK_SECRET || "Admin");
          if (secret !== expected) {
            return new Response("forbidden", { status: 403, headers: okHeaders });
          }
          if (m !== "POST") {
            return new Response("ok", { status: 200, headers: okHeaders });
          }

          const update = (request._cachedJson ?? await request.json().catch(()=>null));
          if (!update) return new Response("bad request", { status: 400, headers: okHeaders });

          ctx.waitUntil(handleUpdate(update, env));
          return new Response("ok", { status: 200, headers: okHeaders });
        }
      }

if (env.ASSETS?.fetch) return env.ASSETS.fetch(request);
      return new Response("not found", { status: 404 });
    } catch (e) {
      // Don't leak internal errors to end-users (Mini App / Bot). Log server-side فقط.
      console.error("fetch error:", e);

      let path = "";
      try { path = new URL(request.url).pathname || ""; } catch {}

      if (path.startsWith("/api/")) {
        return jsonResponse({ ok: false, error: "try_again" }, 200);
      }

      // For browser/MiniApp load: show a friendly fallback instead of raw "error"
      return htmlResponse(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">
<title>MarketiQ</title><body style="font-family:system-ui; padding:16px; line-height:1.8">
<h2>در حال بروزرسانی…</h2>
<div>اگر از تلگرام وارد شدی، چند ثانیه بعد دوباره تلاش کن.</div>
</body></html>`, 200);
    }
  },
  async scheduled(event, env, ctx) {
    try{
      await processReadyCustomPrompts(env);
    }catch(_e){}
  },
};

 /* ========================== CONFIG ========================== */
const BRAND = "MarketiQ";

const MAJORS = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"];
const METALS = ["XAUUSD", "XAGUSD"];
const INDICES = ["DJI", "NDX", "SPX"];
const STOCKS = ["AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "META", "GOOGL"];
const CRYPTOS = [
  "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
  "ADAUSDT","DOGEUSDT","TRXUSDT","TONUSDT","AVAXUSDT",
  "LINKUSDT","DOTUSDT","MATICUSDT","LTCUSDT","BCHUSDT",
];

const BTN = {
  SIGNALS: "📈 سیگنال‌ها",
  SETTINGS: "⚙️ تنظیمات",
  PROFILE: "👤 پروفایل",
  SUPPORT: "🆘 پشتیبانی",
  SUPPORT_NEW_TICKET: "🎫 ارسال تیکت",
  SUPPORT_STATUS: "📌 وضعیت تیکت‌ها",
  EDUCATION: "📚 آموزش",
  REFERRAL: "🎁 دعوت دوستان",
  BUY: "💳 خرید اشتراک",
  MINIAPP: "🧩 مینی‌اپ",
  OWNER: "👑 گزارش اونر",
  BACK: "⬅️ برگشت",
  HOME: "🏠 منوی اصلی",

  CAT_MAJORS: "💱 جفت‌ارزها (Forex)",
  CAT_METALS: "🪙 فلزات",
  CAT_INDICES: "📊 شاخص‌ها",
  CAT_STOCKS: "📈 سهام",
  CAT_CRYPTO: "₿ کریپتو",

  SET_TF: "⏱ تایم‌فریم",
  SET_STYLE: "🎯 سبک",
  SET_RISK: "⚠️ ریسک",
  SET_NEWS: "📰 خبر",

  SHARE_CONTACT: "📱 ارسال شماره (Share Contact)",
  REQUEST_RELEVEL: "🔁 درخواست تعیین سطح مجدد",
  REQUEST_SETTINGS: "✉️ درخواست تغییر تنظیمات",
};

// Backward-compatible aliases (some older menu code used these keys)
BTN.PAY = BTN.BUY;
BTN.EDU = BTN.EDUCATION;
BTN.SIG_FX = BTN.CAT_MAJORS;
BTN.SIG_CRYPTO = BTN.CAT_CRYPTO;
BTN.SIG_METALS = BTN.CAT_METALS;
BTN.SIG_STOCKS = BTN.CAT_STOCKS;



const TYPING_INTERVAL_MS = 4000;
const TIMEOUT_TEXT_MS = 11000;
const TIMEOUT_VISION_MS = 12000;
const TIMEOUT_POLISH_MS = 9000;

const REF_CODES_PER_USER = 5;
const REF_POINTS_PER_SUCCESS = 6;
const REF_POINTS_FOR_FREE_SUB = 500;

// Points & limits
const SUB_POINTS_PER_SUB = 1000;
const DEFAULT_DAILY_LIMIT = 50;
const DEFAULT_MONTHLY_LIMIT = 500;

// Custom prompt flow (2h delay)
const CUSTOM_PROMPT_DELAY_MS = 2 * 60 * 60 * 1000;
const CUSTOM_PROMPT_INFO_TEXT = "استراتژی و سبک خود را بصورت متن توضیح دهید تا کارشناسان ما در اسرع وقت پاسخ دهند";


/* ========================== WELCOME TEXT ========================== */
const WELCOME_TEXT = `👋 به MarketiQ خوش آمدید — هوش تحلیلی شما در بازارهای مالی

📊 MarketiQ یک ایجنت تخصصی تحلیل بازارهای مالی است که با تمرکز بر تصمیم‌سازی هوشمند، در کنار شماست تا بازار را درست‌تر، عمیق‌تر و حرفه‌ای‌تر ببینید.

🔍 در MarketiQ چه دریافت می‌کنید؟

✅ تحلیل فاندامنتال بازارهای مالی
✅ تحلیل تکنیکال دقیق و ساختاریافته
✅ سیگنال‌های معاملاتی با رویکرد مدیریت ریسک
✅ پوشش بازارها:

🪙 کریپتوکارنسی

💱 جفت‌ارزها (Forex)

🪙 فلزات گران‌بها

📈 سهام


🧠 فلسفه MarketiQ

ما سیگنال نمی‌فروشیم، ما «درک بازار» می‌سازیم.
هدف ما کمک به شما برای تصمیم‌گیری آگاهانه است، نه وابستگی کورکورانه به سیگنال.

🚀 شروع کنید:
از منوی پایین انتخاب کنید یا دستورهای زیر:
/start | شروع
/analysis | تحلیل
/signals | سیگنال‌ها
/education | آموزش
/support | پشتیبانی

⚠️ سلب مسئولیت: تمام تحلیل‌ها صرفاً جنبه آموزشی و تحلیلی دارند و مسئولیت نهایی معاملات بر عهده کاربر است.`;


const MINI_APP_WELCOME_TEXT = `👋 به MarketiQ خوش آمدید — هوش تحلیلی شما در بازارهای مالی
این مینی‌اپ برای گرفتن تحلیل سریع، تنظیمات، و مدیریت دسترسی طراحی شده است.
⚠️ تحلیل‌ها آموزشی است و مسئولیت معاملات با شماست.`;

/* ========================== UTILS ========================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chunkText = (s, size = 3500) => { const out=[]; for(let i=0;i<s.length;i+=size) out.push(s.slice(i,i+size)); return out; };
const timeoutPromise = (ms, label="timeout") => new Promise((_,rej)=>setTimeout(()=>rej(new Error(label)), ms));

async function fetchWithTimeout(url, init, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); }
  finally { clearTimeout(t); }
}

function toInt(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function normHandle(h){ if(!h) return ""; return "@"+String(h).replace(/^@/,"").toLowerCase(); }
function parseIds(raw){ const s=(raw||"").toString().trim(); if(!s) return []; return s.split(",").map(x=>String(x).trim()).filter(Boolean); }

// Admin/Owner targets are TELEGRAM USER IDs (not group chat IDs).
function ownerUserIdTargets(env){
  const ownerIds = parseIds(env.OWNER_IDS||"");
  const single = String(env.OWNER_ID||"").trim(); // backward-compat
  if(single) ownerIds.push(single);
  return [...new Set(ownerIds.map(String).filter(Boolean))];
}
function adminUserIdTargets(env){
  const ids = [
    ...ownerUserIdTargets(env),
    ...parseIds(env.ADMIN_IDS||""),
    ...parseIds(env.ADMIN_NOTIFY_CHAT_IDS||env.ADMIN_CHAT_IDS||env.NOTIFY_CHAT_IDS||"") // backward-compat
  ];
  return [...new Set(ids.map(String).filter(Boolean))];
}

function managerL1Targets(env){
  const ids = parseIdList(env.MANAGER_L1_IDS || env.ADMIN_IDS || "");
  const out = new Set(ids.map(String));
  for(const x of parseIdList(env.OWNER_IDS || env.OWNER_ID)) out.add(String(x));
  return Array.from(out).filter(Boolean);
}
function managerL2Targets(env){
  const ids = parseIdList(env.MANAGER_L2_IDS || "");
  const out = new Set(ids.map(String));
  for(const x of parseIdList(env.OWNER_IDS || env.OWNER_ID)) out.add(String(x));
  return Array.from(out).filter(Boolean);
}

function isAdmin(from, env) {
  // Owners are always admins
  try { if (isOwner(from, env)) return true; } catch(e) {}

  const userId = String((from && from.id) || "").trim();
  const username = String((from && from.username) || "").replace(/^@/,"").trim().toLowerCase();

  const idsRaw = String(env.ADMIN_IDS || env.ADMIN_ID || "").trim();
  const handlesRaw = String(env.ADMIN_HANDLES || env.ADMIN_HANDLE || "").trim();

  const ids = idsRaw ? idsRaw.split(/[\s,]+/).filter(Boolean) : [];
  const handles = handlesRaw ? handlesRaw.split(/[\s,]+/).filter(Boolean).map(x=>String(x).replace(/^@/,"").toLowerCase()) : [];

  if (userId && ids.includes(userId)) return true;
  if (username && handles.includes(username)) return true;
  return false;
}
function isOwner(from, env) {
  const u = normHandle(from?.username);
  const setH = new Set((env.OWNER_HANDLES||"").toString().split(",").map(normHandle).filter(Boolean));
  const setI = new Set(parseIds(env.OWNER_IDS||""));
  return (u && setH.has(u)) || (from?.id && setI.has(String(from.id)));
}
function isPrivileged(from, env){ return isAdmin(from, env) || isOwner(from, env); }

function publicBaseUrl(env){
  const raw = (env.PUBLIC_BASE_URL || env.PUBLIC_URL || env.BASE_URL || "").toString().trim();
  return raw ? raw.replace(/\/+$/,"") : "";
}
function paymentPageUrl(env){
  const base = publicBaseUrl(env);
  return base ? `${base}/pay` : "";
}

function kyivDateString(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Kyiv", year:"numeric", month:"2-digit", day:"2-digit" }).format(d);
}

function kyivMonthString(d = new Date()) {
  // YYYY-MM in Kyiv timezone
  return new Intl.DateTimeFormat("en-CA", { timeZone:"Europe/Kyiv", year:"numeric", month:"2-digit" }).format(d);
}

function nowIso(){ return new Date().toISOString(); }

function parseOrder(raw, fallbackArr){
  const s=(raw||"").toString().trim();
  if(!s) return fallbackArr;
  return s.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
}

function sanitizeTimeframe(tf){ tf=String(tf||"").toUpperCase().trim(); return ["M15","H1","H4","D1"].includes(tf)?tf:null; }
function sanitizeStyle(s){
  s = String(s||"").trim();
  if(!s) return null;

  const low = s.toLowerCase();

  // 1) Dynamic catalog (fast path from cache)
  try{
    const cat = (_STYLE_CACHE && Array.isArray(_STYLE_CACHE.items)) ? _STYLE_CACHE.items : null;
    if(cat && cat.length){
      // accept key
      const hitK = cat.find(x=>String(x.key||"").toLowerCase() === low);
      if(hitK) return String(hitK.label);
      // accept label
      const hitL = cat.find(x=>String(x.label||"").trim() === s);
      if(hitL) return String(hitL.label);
    }
  }catch(_e){}

  // 2) Legacy hardcoded map (fallback)
  const map = {
    scalp:"اسکالپ", swing:"سوئینگ", intraday:"اینترادی", smart:"اسمارت‌مانی", smartmoney:"اسمارت‌مانی",
    rtm:"RTM", ict:"ICT", "priceaction":"پرایس اکشن", "price_action":"پرایس اکشن",
    "prompt":"پرامپت", "custom":"روش اختصاصی", "custommethod":"روش اختصاصی",
    "custom_prompt":"پرامپت اختصاصی"
  };
  if(map[low]) return map[low];

  // normalize common Persian variants
  if(low.includes("پرایس") && low.includes("اکشن")) return "پرایس اکشن";
  if(low.includes("اختصاصی") && low.includes("پرامپت")) return "پرامپت اختصاصی";
  if(low.includes("روش") && low.includes("اختصاصی")) return "روش اختصاصی";

  // allow any label that exists in defaults
  const allowed = ["اسکالپ","سوئینگ","اینترادی","اسمارت‌مانی","RTM","ICT","پرایس اکشن","پرامپت","روش اختصاصی","پرامپت اختصاصی"];
  return allowed.includes(s) ? s : null;
}
function sanitizeRisk(s){
  s = String(s||"").trim().toLowerCase();
  const map = { low:"کم", med:"متوسط", mid:"متوسط", medium:"متوسط", high:"زیاد" };
  if(map[s]) return map[s];
  const v = String(s||"").trim();
  if(["کم","متوسط","زیاد"].includes(v)) return v;
  return null;
}
function sanitizeNewsChoice(s){ s=String(s||"").trim(); if(s.includes("روشن")) return true; if(s.includes("خاموش")) return false; return null; }

function isOnboardComplete(st){ return !!(st.profileName && st.phone); }

async function quotaText(st, from, env){
  const dLim = await dailyLimitForUser(st, from, env);
  const mLim = await monthlyLimitForUser(st, from, env);
  if(!Number.isFinite(dLim) && !Number.isFinite(mLim)) return "∞";
  const dPart = Number.isFinite(dLim) ? `روز: ${st.dailyUsed}/${dLim}` : "روز: ∞";
  const mPart = Number.isFinite(mLim) ? `ماه: ${st.monthlyUsed}/${mLim}` : "ماه: ∞";
  return `${dPart} | ${mPart}`;
}

/* ========================== KEYBOARDS ========================== */
function kb(rows){
  return { keyboard: rows, resize_keyboard:true, one_time_keyboard:false, input_field_placeholder:"از دکمه‌ها استفاده کن یا پیام بده…" };
}
function getMiniappUrl(env) {
  env = env || {};
  const raw = (env.MINIAPP_URL || env.PUBLIC_BASE_URL || env.__BASE_URL || "").toString().trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "") + "/";
}
function miniappKey(env) {
  const url = getMiniappUrl(env);
  if (!url) return BTN.MINIAPP;
  return { text: BTN.MINIAPP, web_app: { url } };
}
function appendMiniRow(rows, env) {
  rows = rows || [];
  rows.push([miniappKey(env)]);
  return rows;
}

function requestContactKeyboard(env) {
  return {
    keyboard: [
      [{ text: "📱 ارسال شماره تماس", request_contact: true }],
      [BTN.BACK, BTN.HOME],
      [miniappKey(env)],
    ],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function mainMenuKeyboard(env) {
  const rows = [
    [BTN.SIGNALS],
    [BTN.SETTINGS, BTN.PROFILE],
    [BTN.REFERRAL, BTN.BUY],
    [BTN.EDUCATION, BTN.SUPPORT],
  ];
  // owner-only row
  try{
    if(isOwner({id:null, username:null}, env)){}
  }catch(_e){}
  // real owner-only row appended in appendOwnerRow
  appendOwnerRow(rows, env);
  appendMiniRow(rows, env);
  return kb(rows);
}

function appendOwnerRow(rows, env){
  try{
    if(!env) return;
    const ids = ownerUserIdTargets(env);
    if(ids && ids.length) rows.push([BTN.OWNER]);
  }catch(_e){}
}


function signalsMenuKeyboard(env) {
  const rows = [
    [BTN.CAT_CRYPTO, BTN.CAT_MAJORS],
    [BTN.CAT_METALS, BTN.CAT_STOCKS],
    [BTN.CAT_INDICES],
    [BTN.BACK, BTN.HOME],
  ];
  appendMiniRow(rows, env);
  return kb(rows);
}


function settingsMenuKeyboard(env) {
  const rows = [
    [BTN.SET_TF, BTN.SET_STYLE],
    [BTN.SET_RISK, BTN.SET_NEWS],
    [BTN.BACK, BTN.HOME],
  ];
  appendMiniRow(rows, env);
  return kb(rows);
}

function listKeyboard(items, columns = 2, env) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  rows.push([BTN.BACK, BTN.HOME]);
  appendMiniRow(rows, env);
  return kb(rows);
}

function optionsKeyboard(options, env) {
  const rows = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));
  rows.push([BTN.BACK, BTN.HOME]);
  appendMiniRow(rows, env);
  return kb(rows);
}

/* ========================== STATE (D1 + KV) ========================== */
/**
 * Storage strategy:
 * - D1 = source of truth (durable, queryable)
 * - KV = cache + reverse indexes (fast reads) + legacy keys
 *
 * Required bindings:
 * - env.BOT_DB   (D1 database binding)
 * - env.BOT_KV   (KV namespace)
 */
function hasD1(env){
  return !!(env && env.BOT_DB && typeof env.BOT_DB.prepare === "function");
}

/* ========================== D1 SCHEMA (AUTO-MIGRATE) + R2 ========================== */
let _D1_SCHEMA_READY = false;
async function ensureD1Schema(env){
  if(_D1_SCHEMA_READY) return;
  if(!hasD1(env)) return;
  // Best-effort, idempotent
  try{
    await env.BOT_DB.exec(`

      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS referral_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT,
        commission_pct_override REAL
      );
      CREATE TABLE IF NOT EXISTS phone_index (
        phone TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS username_index (
        username TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS styles (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 10,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS banners (
        key TEXT PRIMARY KEY,
        content_type TEXT,
        size INTEGER,
        active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT
      );
CREATE TABLE IF NOT EXISTS payments (
  txid TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_status_created ON payments(status, created_at);
CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  txid TEXT,
  referrer_id TEXT NOT NULL,
  invited_user_id TEXT NOT NULL,
  code_used TEXT,
  pct REAL,
  amount REAL,
  status TEXT NOT NULL DEFAULT 'due',
  created_at TEXT,
  paid_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_commissions_referrer_created ON commissions(referrer_id, created_at);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_user_created ON tickets(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status_updated ON tickets(status, updated_at);

CREATE TABLE IF NOT EXISTS custom_prompt_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  style_text TEXT,
  strategy_text TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cpr_status_ready ON custom_prompt_requests(status, ready_at);
CREATE INDEX IF NOT EXISTS idx_cpr_user_created ON custom_prompt_requests(user_id, created_at);
    
    `);
  }catch(_e){}
  _D1_SCHEMA_READY = true;
}

function r2Has(env){
  return !!(env && env.BOT_R2 && typeof env.BOT_R2.get === "function");
}

async function getBannersVersion(env){
  if(!env || !env.BOT_KV) return "0";
  const v = await env.BOT_KV.get("cfg:banners_version").catch(()=>null);
  return (v && String(v).trim()) ? String(v).trim() : "0";
}
async function bumpBannersVersion(env){
  if(!env || !env.BOT_KV) return;
  await env.BOT_KV.put("cfg:banners_version", String(Date.now())).catch(()=>{});
}

const _BANNER_CACHE = { at:0, key:null, ver:"0" };
async function getActiveBanner(env){
  if(!hasD1(env)) return null;
  await ensureD1Schema(env);

  const ttl = _cfgTtl(env);
  const ver = await getBannersVersion(env);
  const now = Date.now();
  if(_BANNER_CACHE.ver === ver && (now - _BANNER_CACHE.at) < ttl) return _BANNER_CACHE.key;

  try{
    const row = await env.BOT_DB.prepare("SELECT key FROM banners WHERE active=1 LIMIT 1").first();
    const k = row?.key ? String(row.key) : null;
    _BANNER_CACHE.at = now;
    _BANNER_CACHE.key = k;
    _BANNER_CACHE.ver = ver;
    return k;
  }catch(_e){
    return null;
  }
}

/* ========================== STYLE CATALOG/* ========================== STYLE CATALOG (D1 -> KV -> DEFAULT) ========================== */
const STYLE_DEFAULTS = [
  { key:"swing", label:"سوئینگ", prompt:"تحلیل به سبک سوئینگ: روند کلان، سطوح کلیدی، نقاط ورود/خروج، حدضرر/حدسود و مدیریت ریسک." , sort:10, enabled:true },
  { key:"intraday", label:"اینترادی", prompt:"تحلیل اینترادی: تایم‌فریم‌های پایین‌تر، نقاط ورود دقیق، سناریوهای محتمل، حدضرر/حدسود و مدیریت ریسک." , sort:20, enabled:true },
  { key:"scalp", label:"اسکالپ", prompt:"تحلیل اسکالپ: ستاپ سریع، ورود/خروج کوتاه، حدضرر نزدیک، مدیریت ریسک سختگیرانه." , sort:30, enabled:true },
  { key:"smart", label:"اسمارت‌مانی", prompt:"تحلیل اسمارت‌مانی: ساختار بازار، نقدینگی، BOS/CHOCH، نواحی عرضه/تقاضا، سناریوهای ورود." , sort:40, enabled:true },

  { key:"rtm", label:"RTM", prompt:"تحلیل به روش RTM: FL/FT، انحصار قیمت، بیس/شکست، نواحی ورود، حدضرر، اهداف." , sort:60, enabled:true },
  { key:"ict", label:"ICT", prompt:"تحلیل به روش ICT: ساختار، Liquidity, FVG, OTE، Killzone (در صورت نیاز)، سناریوهای ورود/خروج." , sort:70, enabled:true },
  { key:"price_action", label:"پرایس اکشن", prompt:"تحلیل پرایس اکشن: روند، سطوح، کندل‌خوانی، پولبک/بریک، سناریوها و مدیریت ریسک." , sort:80, enabled:true },

  { key:"prompt", label:"پرامپت", prompt:"با توجه به درخواست کاربر، تحلیل دقیق و مرحله‌به‌مرحله ارائه بده." , sort:90, enabled:true },
  { key:"custom_method", label:"روش اختصاصی", prompt:"با روش اختصاصی (طبق توضیح کاربر/ادمین) تحلیل را انجام بده." , sort:100, enabled:true },
  { key:"custom_prompt", label:"پرامپت اختصاصی", prompt:"از پرامپت اختصاصی کاربر استفاده کن (اگر آماده باشد)." , sort:110, enabled:true },
];


async function getStylesVersion(env){
  if(!env || !env.BOT_KV) return "0";
  const v = await env.BOT_KV.get("cfg:styles_version").catch(()=>null);
  return (v && String(v).trim()) ? String(v).trim() : "0";
}
async function bumpStylesVersion(env){
  if(!env || !env.BOT_KV) return;
  await env.BOT_KV.put("cfg:styles_version", String(Date.now())).catch(()=>{});
}

const _STYLE_CACHE = { at:0, items:null, ver:"0" };
async function getStyleCatalog(env){
  const ttl = _cfgTtl(env);
  const ver = await getStylesVersion(env);
  if(_STYLE_CACHE.items && _STYLE_CACHE.ver === ver && (Date.now()-_STYLE_CACHE.at) < ttl) return _STYLE_CACHE.items;

  // 1) D1 (source of truth)
  if(hasD1(env)){
    await ensureD1Schema(env);
    try{
      const rows = await env.BOT_DB.prepare("SELECT key,label,prompt,enabled,sort FROM styles ORDER BY sort ASC, key ASC").all();
      const items = (rows?.results||[]).map(r=>({
        key:String(r.key),
        label:String(r.label),
        prompt:String(r.prompt||""),
        enabled: Number(r.enabled||0) ? true : false,
        sort: Number(r.sort||10)
      }));
      if(items.length){
        _STYLE_CACHE.at = Date.now();
        _STYLE_CACHE.ver = ver;
        _STYLE_CACHE.items = items;
        return items;
      }
    }catch(_e){}
  }

  // 2) KV fallback (single json blob)
  if(env.BOT_KV){
    const raw = await env.BOT_KV.get("cfg:styles_json").catch(()=>null);
    const j = raw ? safeJsonParse(raw) : null;
    if(Array.isArray(j) && j.length){
      _STYLE_CACHE.at = Date.now();
      _STYLE_CACHE.ver = ver;
      _STYLE_CACHE.items = j;
      return j;
    }
  }

  // 3) Defaults
  _STYLE_CACHE.at = Date.now();
  _STYLE_CACHE.ver = ver;
  _STYLE_CACHE.items = STYLE_DEFAULTS.slice();
  return _STYLE_CACHE.items;
}

function styleKeyFromLabel(label, catalog){
  const l = String(label||"").trim();
  const c = Array.isArray(catalog) ? catalog : [];
  const hit = c.find(x=>String(x.label)===l);
  return hit ? String(hit.key) : "";
}
function styleLabelFromKey(key, catalog){
  const k = String(key||"").trim().toLowerCase();
  const c = Array.isArray(catalog) ? catalog : [];
  const hit = c.find(x=>String(x.key).toLowerCase()===k);
  return hit ? String(hit.label) : null;
}

/* ========================== ADMIN TOKEN AUTH (WEB PANEL) ========================== */
function adminTokenFromReq(request){
  const h = request.headers.get("x-admin-token") || "";
  if(h) return h.trim();
  try{
    const u = new URL(request.url);
    const q = u.searchParams.get("token") || "";
    return q.trim() || h.trim();
  }catch(_e){}
  return h.trim();
}
function isAdminToken(request, env){
  const tok = adminTokenFromReq(request);
  const want = String(env.ADMIN_TOKEN||"").trim();
  return !!(want && tok && tok === want);
}
async function d1GetUser(userId, env){
  const uid = String(userId);
  const row = await env.BOT_DB.prepare("SELECT data FROM users WHERE user_id=?1").bind(uid).first();
  if(!row?.data) return null;
  return safeJsonParse(row.data);
}
async function d1UpsertUser(userId, st, env){
  const uid = String(userId);
  const createdAt = st?.createdAt || nowIso();
  const updatedAt = st?.updatedAt || nowIso();
  const data = JSON.stringify(st || {});
  await env.BOT_DB.prepare(
    "INSERT INTO users (user_id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4) " +
    "ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at"
  ).bind(uid, data, createdAt, updatedAt).run();
}
async function getUser(userId, env){
  const uid = String(userId);
  // 1) KV cache first
  if(env.BOT_KV){
    const raw = await env.BOT_KV.get(`u:${uid}`);
    if(raw){
      try { return JSON.parse(raw); } catch {}
    }
  }
  // 2) D1 source of truth
  if(hasD1(env)){
    const st = await d1GetUser(uid, env);
    if(st && env.BOT_KV){
      // populate cache (best-effort)
      await env.BOT_KV.put(`u:${uid}`, JSON.stringify(st)).catch(()=>{});
    }
    return st;
  }
  return null;
}
async function saveUser(userId, st, env){
  const uid = String(userId);
  if(!st) return;
  st.updatedAt = nowIso();
  // D1 write first (durable)
  if(hasD1(env)){
    await d1UpsertUser(uid, st, env);
    // username index for fast admin lookup
    if(st?.username){
      const un = String(st.username||"").replace(/^@/,"").trim().toLowerCase();
      if(un){
        try{ await env.BOT_DB.prepare("INSERT INTO username_index (username, user_id, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(username) DO UPDATE SET user_id=excluded.user_id, updated_at=excluded.updated_at").bind(un, uid, st.updatedAt).run(); }catch(_e){}
      }
    }
  } else if(!env.BOT_KV){
    // no persistence available
    return;
  }
  // KV cache write (best-effort)
  if(env.BOT_KV){
    await env.BOT_KV.put(`u:${uid}`, JSON.stringify(st)).catch(()=>{});
  }
}
function defaultUser(userId){
  return {
    userId, createdAt: nowIso(), updatedAt: nowIso(),
    chatId:null, username:"",
    state:"idle", selectedSymbol:"",
    timeframe:"H4", style:"اسمارت‌مانی", risk:"متوسط", newsEnabled:true,
    profileName:"", phone:"",
    experience:"", preferredMarket:"",
    level:"", levelScore:null, levelSummary:"", suggestedMarket:"",
    refCodes:[], pendingReferrerId:null, refCodeUsed:null, referrerId:null, successfulInvites:0, points:0, refCommissionTotal:0, lastPaymentTx:"", lastPaymentStatus:"",
    subActiveUntil:"", freeSubRedeemed:0,
    dailyDate: kyivDateString(), dailyUsed:0,
    monthKey: kyivMonthString(), monthlyUsed:0,
    bep20Address:"", walletBalance:0, walletDepositRequests:0, walletWithdrawRequests:0,
    customPromptDesc:"", customPromptText:"", customPromptRequestedAt:"", customPromptReadyAt:"", customPromptDeliveredAt:"",
    textOrder:"", visionOrder:"", polishOrder:"",
    quiz:{ active:false, idx:0, answers:[] },
  };
}
function patchUser(st, userId){
  const d = defaultUser(userId);
  const out = { ...d, ...st, userId };
  out.timeframe = sanitizeTimeframe(out.timeframe) || d.timeframe;
  out.style = sanitizeStyle(out.style) || d.style;
  out.risk = sanitizeRisk(out.risk) || d.risk;
  out.newsEnabled = typeof out.newsEnabled === "boolean" ? out.newsEnabled : d.newsEnabled;
  out.profileName = typeof out.profileName === "string" ? out.profileName : "";
  out.phone = typeof out.phone === "string" ? out.phone : "";
  out.experience = typeof out.experience === "string" ? out.experience : "";
  out.preferredMarket = typeof out.preferredMarket === "string" ? out.preferredMarket : "";
  out.level = typeof out.level === "string" ? out.level : "";
  out.levelSummary = typeof out.levelSummary === "string" ? out.levelSummary : "";
  out.suggestedMarket = typeof out.suggestedMarket === "string" ? out.suggestedMarket : "";
  out.refCodes = Array.isArray(out.refCodes) ? out.refCodes : [];
  out.pendingReferrerId = out.pendingReferrerId ?? null;
  out.referrerId = out.referrerId ?? null;
  out.successfulInvites = Number.isFinite(Number(out.successfulInvites)) ? Number(out.successfulInvites) : 0;
  out.points = Number.isFinite(Number(out.points)) ? Number(out.points) : 0;
  out.subActiveUntil = typeof out.subActiveUntil === "string" ? out.subActiveUntil : "";
  out.freeSubRedeemed = Number.isFinite(Number(out.freeSubRedeemed)) ? Number(out.freeSubRedeemed) : 0;
  out.dailyDate = out.dailyDate || d.dailyDate;
  out.dailyUsed = Number.isFinite(Number(out.dailyUsed)) ? Number(out.dailyUsed) : 0;
  out.monthKey = out.monthKey || d.monthKey;
  out.monthlyUsed = Number.isFinite(Number(out.monthlyUsed)) ? Number(out.monthlyUsed) : 0;
  out.bep20Address = typeof out.bep20Address === "string" ? out.bep20Address : "";
  out.walletBalance = Number.isFinite(Number(out.walletBalance)) ? Number(out.walletBalance) : 0;
  out.walletDepositRequests = Number.isFinite(Number(out.walletDepositRequests)) ? Number(out.walletDepositRequests) : 0;
  out.walletWithdrawRequests = Number.isFinite(Number(out.walletWithdrawRequests)) ? Number(out.walletWithdrawRequests) : 0;
  out.customPromptDesc = typeof out.customPromptDesc === "string" ? out.customPromptDesc : "";
  out.customPromptText = typeof out.customPromptText === "string" ? out.customPromptText : "";
  out.customPromptRequestedAt = typeof out.customPromptRequestedAt === "string" ? out.customPromptRequestedAt : "";
  out.customPromptReadyAt = typeof out.customPromptReadyAt === "string" ? out.customPromptReadyAt : "";
  out.customPromptDeliveredAt = typeof out.customPromptDeliveredAt === "string" ? out.customPromptDeliveredAt : "";
  out.quiz = out.quiz && typeof out.quiz === "object" ? out.quiz : d.quiz;
  if (typeof out.quiz.active !== "boolean") out.quiz.active = false;
  if (!Number.isFinite(Number(out.quiz.idx))) out.quiz.idx = 0;
  if (!Array.isArray(out.quiz.answers)) out.quiz.answers = [];
  return out;
}

async function ensureUser(userId, env, fromLike={}){
  const existing = await getUser(userId, env);
  let st = patchUser(existing||{}, userId);

  let dirty = false;

  // Daily reset (Kyiv)
  const today = kyivDateString();
  if(st.dailyDate !== today){
    st.dailyDate = today;
    st.dailyUsed = 0;
    dirty = true;
  }

  // Monthly reset (Kyiv)
  const monthKey = kyivMonthString();
  if(st.monthKey !== monthKey){
    st.monthKey = monthKey;
    st.monthlyUsed = 0;
    dirty = true;
  }

  // Save username once/when changed
  if(fromLike?.username){
    const u = String(fromLike.username||"").trim();
    if(u && st.username !== u){
      st.username = u;
      dirty = true;
    }
  }

  // Ensure each user has at least one referral code so their referral link is always available in profile.
  // (Per requirement: show each user's referral link in /profile.)
  if (env.BOT_KV || hasD1(env)) {
    try { st = await ensureReferralCodes(env, st); } catch (e) { console.error("ensureReferralCodes error:", e); }
  }

  // If custom prompt is ready and not delivered, try deliver on any interaction
  try{ await deliverCustomPromptIfReady(env, st); }catch(_e){}

  if(dirty){
    st.updatedAt = nowIso();
        await saveUser(userId, st, env);
  }

  return st;
}

function isSubscribed(st){
  if(!st?.subActiveUntil) return false;
  const t = Date.parse(st.subActiveUntil);
  return Number.isFinite(t) && Date.now() < t;
}
async function dailyLimitForUser(st, from, env){
  if(isPrivileged(from, env)) return Infinity;
  const freeLimit = await getFreeDailyLimit(env);
  const subLimit = await getSubDailyLimit(env);
  return isSubscribed(st) ? subLimit : freeLimit;
}

async function monthlyLimitForUser(st, from, env){
  if(isPrivileged(from, env)) return Infinity;
  const lim = await getMonthlyLimit(env);
  return lim;
}

async function canAnalyzeToday(st, from, env){
  if(isPrivileged(from, env)) return true;
  const today = kyivDateString();
  const monthKey = kyivMonthString();
  const dUsed = (st.dailyDate === today) ? (st.dailyUsed||0) : 0;
  const mUsed = (st.monthKey === monthKey) ? (st.monthlyUsed||0) : 0;
  const dLim = await dailyLimitForUser(st, from, env);
  const mLim = await monthlyLimitForUser(st, from, env);
  return dUsed < dLim && mUsed < mLim;
}
function consumeDaily(st, from, env){
  if(isPrivileged(from, env)) return;
  const today = kyivDateString();
  const monthKey = kyivMonthString();
  if(st.dailyDate !== today){ st.dailyDate = today; st.dailyUsed = 0; }
  if(st.monthKey !== monthKey){ st.monthKey = monthKey; st.monthlyUsed = 0; }
  st.dailyUsed = (st.dailyUsed||0) + 1;
  st.monthlyUsed = (st.monthlyUsed||0) + 1;
}
function stPublic(st){
  return {
    userId: st.userId,
    createdAt: st.createdAt,
    dailyDate: st.dailyDate,
    dailyUsed: st.dailyUsed,
    monthKey: st.monthKey,
    monthlyUsed: st.monthlyUsed,
    timeframe: st.timeframe,
    style: st.style,
    risk: st.risk,
    newsEnabled: st.newsEnabled,
    profileName: st.profileName || "",
    experience: st.experience,
    preferredMarket: st.preferredMarket,
    level: st.level,
    suggestedMarket: st.suggestedMarket,
    successfulInvites: st.successfulInvites,
    points: st.points,
    subActiveUntil: st.subActiveUntil,
  };
}

/* ========================== REFERRALS ========================== */
function randCode(len=10){
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out="";
  for(let i=0;i<len;i++) out += alphabet[Math.floor(Math.random()*alphabet.length)];
  return out;
}
async function ensureReferralCodes(env, st){
  const existing = new Set((st.refCodes||[]).filter(Boolean));
  const codes = (st.refCodes||[]).slice(0, REF_CODES_PER_USER).filter(Boolean);

  // Helper: insert mapping into D1 (if enabled)
  async function d1Put(code, userId){
    if(!hasD1(env)) return true;
    try{
      await env.BOT_DB.prepare(
        "INSERT INTO referral_codes (code, user_id, created_at) VALUES (?1, ?2, ?3)"
      ).bind(String(code), String(userId), nowIso()).run();
      return true;
    }catch(e){
      // unique collision
      return false;
    }
  }

  while(codes.length < REF_CODES_PER_USER){
    const c = `mq${randCode(10)}`;
    if(existing.has(c)) continue;

    // D1 insert first (so we don't publish an unowned code)
    const ok = await d1Put(c, st.userId);
    if(!ok) continue;

    existing.add(c);
    codes.push(c);

    // KV reverse index (cache)
    if(env.BOT_KV) await env.BOT_KV.put(`ref:${c}`, String(st.userId)).catch(()=>{});
  }

  st.refCodes = codes;

  // Persist updated user (so profile always has codes)
  await saveUser(st.userId, st, env);
  return st;
}

async function adminGenerateRefCodes(env, targetUserId, count=5){
  const userId = String(targetUserId||"").trim();
  if(!userId) throw new Error("invalid_userid");

  let st = patchUser((await getUser(userId, env))||{}, userId);

  // Revoke old codes (best-effort)
  if(Array.isArray(st.refCodes)){
    for(const c of st.refCodes){
      if(env.BOT_KV) await env.BOT_KV.delete(`ref:${c}`).catch(()=>{});
      if(hasD1(env)) await env.BOT_DB.prepare("DELETE FROM referral_codes WHERE code=?1").bind(String(c)).run().catch(()=>{});
    }
  }

  const codes = [];
  const n = Math.max(1, Math.min(20, Number(count)||5));
  for(let i=0;i<n;i++){
    // Avoid collisions (best-effort)
    let code = "";
    for(let tries=0; tries<20; tries++){
      code = `mq${randCode(10)}`;
      // D1 check/insert first
      if(hasD1(env)){
        try{
          await env.BOT_DB.prepare(
            "INSERT INTO referral_codes (code, user_id, created_at) VALUES (?1, ?2, ?3)"
          ).bind(code, userId, nowIso()).run();
          break;
        }catch(e){
          code = "";
        }
      } else if(env.BOT_KV){
        const exists = await env.BOT_KV.get(`ref:${code}`);
        if(!exists) break;
        code = "";
      }
    }
    if(!code) continue;
    codes.push(code);
    if(env.BOT_KV) await env.BOT_KV.put(`ref:${code}`, userId).catch(()=>{});
  }

  st.refCodes = codes;
  await saveUser(userId, st, env);
  return codes;
}

async function lookupReferrerIdByCode(code, env){
  const c = String(code||"").trim();
  if(!c) return null;

  // KV cache first
  if(env.BOT_KV){
    const id = await env.BOT_KV.get(`ref:${c}`);
    if(id) return String(id);
  }

  // D1 fallback
  if(hasD1(env)){
    const row = await env.BOT_DB.prepare("SELECT user_id FROM referral_codes WHERE code=?1").bind(c).first();
    const id = row?.user_id ? String(row.user_id) : null;
    if(id && env.BOT_KV){
      await env.BOT_KV.put(`ref:${c}`, id).catch(()=>{});
    }
    return id;
  }

  return null;
}
function normalizePhone(p){
  let s = String(p||"").trim();
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  return s;
}
async function bindPhoneToUser(userId, phone, env){
  const uid = String(userId);
  const p = String(phone);

  // D1: enforce uniqueness at DB level
  if(hasD1(env)){
    try{
      await env.BOT_DB.prepare(
        "INSERT INTO phone_index (phone, user_id, created_at) VALUES (?1, ?2, ?3)"
      ).bind(p, uid, nowIso()).run();
    }catch(e){
      // already used by someone else (or same user)
      const row = await env.BOT_DB.prepare("SELECT user_id FROM phone_index WHERE phone=?1").bind(p).first().catch(()=>null);
      if(row?.user_id && String(row.user_id) !== uid) return { ok:false, reason:"phone_already_used" };
      // same user re-binding -> ok
    }
  } else {
    // KV-only fallback
    if(!env.BOT_KV) return { ok:false, reason:"kv_missing" };
    const key = `phone:${p}`;
    const existing = await env.BOT_KV.get(key);
    if(existing && String(existing) !== uid) return { ok:false, reason:"phone_already_used" };
    await env.BOT_KV.put(key, uid);
  }

  // KV cache for fast lookup
  if(env.BOT_KV) await env.BOT_KV.put(`phone:${p}`, uid).catch(()=>{});
  return { ok:true };
}

/* ========================== BOT CONFIG (WALLET / PROMPTS / SUBSCRIPTION) ========================== */
const _CFG_MEM = new Map();
function _cfgTtl(env){ return toInt(env.CFG_CACHE_TTL_MS, 60000); }

const _CFG_VER = { ver:"0", exp:0 };
async function getCfgVersion(env){
  const now = Date.now();
  if(_CFG_VER.exp > now) return _CFG_VER.ver;
  if(!env || !env.BOT_KV){ _CFG_VER.ver = "0"; _CFG_VER.exp = now + 5000; return _CFG_VER.ver; }
  const v = await env.BOT_KV.get("cfg:global_version").catch(()=>null);
  _CFG_VER.ver = (v && String(v).trim()) ? String(v).trim() : "0";
  _CFG_VER.exp = now + Math.min(5000, _cfgTtl(env));
  return _CFG_VER.ver;
}
async function bumpCfgVersion(env){
  if(!env || !env.BOT_KV) return;
  await env.BOT_KV.put("cfg:global_version", String(Date.now())).catch(()=>{});
  // also bust local cache immediately
  _CFG_VER.ver = String(Date.now());
  _CFG_VER.exp = Date.now() + 1000;
  _CFG_MEM.clear();
}

async function getCfg(env, memKey, kvKey, envFallback=""){
  const now = Date.now();
  const curVer = await getCfgVersion(env);
  const cached = _CFG_MEM.get(memKey);
  if(cached && cached.exp > now && cached.ver === curVer) return cached.v;

  let v = "";
  if(env.BOT_KV) v = (await env.BOT_KV.get(kvKey)) || "";
  if(!v) v = (envFallback || "").toString();
  v = String(v || "").trim();

  _CFG_MEM.set(memKey, { v, exp: now + _cfgTtl(env), ver: curVer });
  return v;
}
async function setCfg(env, memKey, kvKey, value){
  const v = String(value || "").trim();
  if(!env.BOT_KV) throw new Error("kv_missing");
  await env.BOT_KV.put(kvKey, v);
  await bumpCfgVersion(env);
  const curVer = await getCfgVersion(env);
  _CFG_MEM.set(memKey, { v, exp: Date.now() + _cfgTtl(env), ver: curVer });
  return v;
}

async function getWallet(env){
  return await getCfg(env, "wallet", "cfg:wallet", env.WALLET_ADDRESS);
}
async function setWallet(env, addr, changedBy){
  const v = String(addr||"").trim();
  if(!v) throw new Error("invalid_wallet");
  // Read previous
  let prev = "";
  try{ prev = await getCfg(env, "wallet", "cfg:wallet", env.WALLET || ""); }catch(_e){ prev = ""; }
  await setCfg(env, "wallet", "cfg:wallet", v);

  // Alert owner if changed
  try{
    const ownerIds = ownerUserIdTargets(env);
    if(ownerIds.length && prev && prev !== v){
      const by = changedBy?.username ? ("@"+String(changedBy.username).replace(/^@/,"")) : (changedBy?.id ? ("ID:"+changedBy.id) : "-");
      const msg =
`🚨 تغییر آدرس ولت

ولت قبلی:
\`${prev}\`

ولت جدید:
\`${v}\`

تغییر توسط: ${by}
زمان: ${new Date().toISOString()}`;
      for(const oid of ownerIds){ await tgSendMessage(env, oid, msg, null).catch(()=>{}); }
      }
  }catch(_e){}

  return v;
}

async function getSubPrice(env){
  const v = await getCfg(env, "sub_price", "cfg:sub_price", env.SUB_PRICE);
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
async function setSubPrice(env, amount){
  const n = Number(amount);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_price");
  await setCfg(env, "sub_price", "cfg:sub_price", String(n));
  return n;
}
async function getSubCurrency(env){
  const v = await getCfg(env, "sub_currency", "cfg:sub_currency", env.SUB_CURRENCY || "USDT");
  return (v || "USDT").toUpperCase();
}
async function setSubCurrency(env, cur){
  const v = String(cur || "").trim().toUpperCase();
  if(!v) throw new Error("invalid_currency");
  await setCfg(env, "sub_currency", "cfg:sub_currency", v);
  return v;
}
async function getOfferConfig(env){
  const enabled = await getCfg(env, "offer_enabled", "cfg:offer_enabled", env.OFFER_ENABLED || "0");
  const text = await getCfg(env, "offer_text", "cfg:offer_text", env.OFFER_TEXT || "");
  const url = await getCfg(env, "offer_url", "cfg:offer_url", env.OFFER_URL || "");
  const image = await getCfg(env, "offer_image", "cfg:offer_image", env.OFFER_IMAGE || "");
  return {
    enabled: String(enabled||"0") === "1",
    text: String(text||"").trim(),
    url: String(url||"").trim(),
    image: String(image||"").trim(),
  };
}


async function setOfferConfig(env, cfg){
  const en = cfg?.enabled ? "1" : "0";
  await setCfg(env, "offer_enabled", "cfg:offer_enabled", en);
  await setCfg(env, "offer_text", "cfg:offer_text", String(cfg?.text||"").trim());
  await setCfg(env, "offer_url", "cfg:offer_url", String(cfg?.url||"").trim());
  await setCfg(env, "offer_image", "cfg:offer_image", String(cfg?.image||"").trim());
}

async function getSubDays(env){
  const v = await getCfg(env, "sub_days", "cfg:sub_days", env.SUB_DAYS || "30");
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}
async function setSubDays(env, days){
  const n = Number(days);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_days");
  await setCfg(env, "sub_days", "cfg:sub_days", String(Math.floor(n)));
  return Math.floor(n);
}


// Global daily limits (configurable by Admin/Owner via commands)
async function getFreeDailyLimit(env){
  const v = await getCfg(env, "free_daily_limit", "cfg:free_daily_limit", env.FREE_DAILY_LIMIT || String(DEFAULT_DAILY_LIMIT));
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}
async function setFreeDailyLimit(env, limit){
  const n = Number(limit);
  if(!Number.isFinite(n) || n < 0) throw new Error("invalid_free_limit");
  await setCfg(env, "free_daily_limit", "cfg:free_daily_limit", String(Math.floor(n)));
  return Math.floor(n);
}
async function getSubDailyLimit(env){
  const v = await getCfg(env, "sub_daily_limit", "cfg:sub_daily_limit", env.SUB_DAILY_LIMIT || String(DEFAULT_DAILY_LIMIT));
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_LIMIT;
}
async function setSubDailyLimit(env, limit){
  const n = Number(limit);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_sub_limit");
  await setCfg(env, "sub_daily_limit", "cfg:sub_daily_limit", String(Math.floor(n)));
  return Math.floor(n);
}


async function getMonthlyLimit(env){
  const v = await getCfg(env, "monthly_limit", "cfg:monthly_limit", env.MONTHLY_LIMIT || String(DEFAULT_MONTHLY_LIMIT));
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MONTHLY_LIMIT;
}

async function getReferralCommissionRate(env){
  // Default: 10%
  const v = await getCfg(env, "ref_commission_rate", "cfg:ref_commission_rate", "10");
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 10;
}

async function getMaxRewardedReferrals(env){
  // Default: 1
  const v = await getCfg(env, "max_rewarded_referrals", "cfg:max_rewarded_referrals", "1");
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

async function setMonthlyLimit(env, limit){
  const n = Number(limit);
  if(!Number.isFinite(n) || n <= 0) throw new Error("invalid_monthly_limit");
  await setCfg(env, "monthly_limit", "cfg:monthly_limit", String(Math.floor(n)));
  return Math.floor(n);
}

/* ========================== PAYMENTS (Manual Crypto, TxID) ========================== */
function normalizeTxId(txid){
  return String(txid||"").trim().replace(/\s+/g, "");
}

function addDaysToIso(iso, days){
  const n = Number(days);
  const now = new Date();
  const base = (iso && new Date(iso) > now) ? new Date(iso) : now;
  base.setUTCDate(base.getUTCDate() + Math.floor(n));
  return base.toISOString();
}

async function createPendingPayment(env, userId, txid){
  const clean = normalizeTxId(txid);
  if(clean.length < 6) throw new Error("invalid_txid");

  const price = await getSubPrice(env);
  const currency = await getSubCurrency(env);
  const days = await getSubDays(env);

  const rec = {
    txid: clean,
    userId: String(userId),
    amount: price,
    currency,
    days,
    status: "pending_l1",
    createdAt: new Date().toISOString(),
  };

  if(hasD1(env)){
    try{
      await env.BOT_DB.prepare(
        "INSERT INTO payments (txid, data, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)"
      ).bind(clean, JSON.stringify(rec), "pending", rec.createdAt, rec.createdAt).run();
    }catch(e){
      throw new Error("txid_exists");
    }
  } else {
    if(!env.BOT_KV) throw new Error("kv_required");
    const exists = await env.BOT_KV.get(`pay:tx:${clean}`);
    if(exists) throw new Error("txid_exists");
  }

  // KV legacy keys (for admin UI + backwards compat)
  if(env.BOT_KV){
    await env.BOT_KV.put(`pay:pending:${clean}`, JSON.stringify(rec)).catch(()=>{});
    await env.BOT_KV.put(`pay:tx:${clean}`, "pending").catch(()=>{});
  }
  return rec;
}

async function markPaymentApproved(env, txid, approvedBy){
  const clean = normalizeTxId(txid);

  let rec = null;

  if(hasD1(env)){
    const row = await env.BOT_DB.prepare("SELECT data FROM payments WHERE txid=?1 AND status='pending'").bind(clean).first();
    if(!row?.data) throw new Error("payment_not_found");
    rec = safeJsonParse(row.data);
    if(!rec) throw new Error("payment_corrupt");

    rec.status = "approved";
    rec.approvedAt = new Date().toISOString();
    rec.approvedBy = approvedBy ? String(approvedBy) : "";

    await env.BOT_DB.prepare(
      "UPDATE payments SET data=?2, status='approved', updated_at=?3 WHERE txid=?1"
    ).bind(clean, JSON.stringify(rec), rec.approvedAt).run();
  } else {
    if(!env.BOT_KV) throw new Error("kv_required");
    const raw = await env.BOT_KV.get(`pay:pending:${clean}`);
    if(!raw) throw new Error("payment_not_found");
    rec = safeJsonParse(raw);
    if(!rec) throw new Error("payment_corrupt");
    rec.status = "approved";
    rec.approvedAt = new Date().toISOString();
    rec.approvedBy = approvedBy ? String(approvedBy) : "";
  }

  // KV legacy cleanup
  if(env.BOT_KV){
    await env.BOT_KV.delete(`pay:pending:${clean}`).catch(()=>{});
    await env.BOT_KV.put(`pay:approved:${clean}`, JSON.stringify(rec)).catch(()=>{});
    await env.BOT_KV.put(`pay:tx:${clean}`, "approved").catch(()=>{});
  }

  // Activate subscription for user
  let st = patchUser((await getUser(rec.userId, env))||{}, rec.userId);
  st.subActiveUntil = addDaysToIso(st.subActiveUntil, rec.days);
  st.points = (st.points||0) + SUB_POINTS_PER_SUB;
  st.lastPaymentTx = clean;
  st.lastPaymentStatus = "approved";
  await saveUser(rec.userId, st, env);

// Referral commission: priority = per-code override (D1) -> per-user override -> base rate
if(st.referrerId){
  try{
    let refSt = patchUser((await getUser(st.referrerId, env))||{}, st.referrerId);

    const maxRewarded = await getMaxRewardedReferrals(env);
    refSt.rewardedReferralsCount = Number.isFinite(Number(refSt.rewardedReferralsCount)) ? Number(refSt.rewardedReferralsCount) : 0;

    // Only reward up to maxRewarded times
    if(refSt.rewardedReferralsCount < maxRewarded){
      const basePct = await getReferralCommissionRate(env);

      // per-code override (requires D1)
      let codePct = null;
      const usedCode = String(st.refCodeUsed||"").trim();
      if(usedCode && hasD1(env)){
        try{
          const row = await env.BOT_DB.prepare("SELECT commission_pct_override FROM referral_codes WHERE code=?1").bind(usedCode).first();
          if(row && row.commission_pct_override !== null && row.commission_pct_override !== undefined){
            const n = Number(row.commission_pct_override);
            if(Number.isFinite(n)) codePct = n;
          }
        }catch(_e){}
      }

      const userPct = Number.isFinite(Number(refSt.refCommissionPctOverride)) ? Number(refSt.refCommissionPctOverride) : null;
      const pct = (codePct !== null) ? codePct : (userPct !== null ? userPct : basePct);

      const amount = Number(rec.amount);
      const commission = Number.isFinite(amount) ? (amount * (pct/100)) : 0;

      refSt.refCommissionTotal = Number(refSt.refCommissionTotal||0) + (Number.isFinite(commission)?commission:0);
      refSt.rewardedReferralsCount += 1;

      
      // record commission due for manual payout
      try{
        if(hasD1(env) && commission > 0){
          const cid = "c_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
          await env.BOT_DB.prepare(
            "INSERT INTO commissions (id, txid, referrer_id, invited_user_id, code_used, pct, amount, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'due', ?8)"
          ).bind(cid, String(rec.txid||""), String(refSt.userId), String(rec.userId||invitedUserId||""), String(usedCode||""), pct, commission, new Date().toISOString()).run();
        }
      }catch(_e){}
await saveUser(refSt.userId, refSt, env);
    }
  }catch(_e){}
}

  return rec;
}


async function markPaymentStage(env, txid, newStatus, byUserId){
  const clean = normalizeTxId(txid);
  if(!clean) return null;
  let rec = null;
  if(hasD1(env)){
    const row = await env.BOT_DB.prepare("SELECT data FROM payments WHERE txid=?1").bind(clean).first();
    if(!row) return null;
    rec = safeJsonParse(row.data, null) || null;
    if(!rec) return null;
    rec.status = newStatus;
    rec.updatedAt = new Date().toISOString();
    rec.stageBy = String(byUserId||"");
    await env.BOT_DB.prepare("UPDATE payments SET data=?1, status=?2, updated_at=?3 WHERE txid=?4")
      .bind(JSON.stringify(rec), newStatus, rec.updatedAt, clean).run();
  }else{
    rec = null;
  }
  return rec;
}
async function markPaymentRejected(env, txid, rejectedBy){
  const clean = normalizeTxId(txid);
  let rec = null;

  if(hasD1(env)){
    const row = await env.BOT_DB.prepare("SELECT data FROM payments WHERE txid=?1 AND status='pending'").bind(clean).first();
    if(!row?.data) throw new Error("payment_not_found");
    rec = safeJsonParse(row.data);
    if(!rec) throw new Error("payment_corrupt");

    rec.status = "rejected";
    rec.rejectedAt = new Date().toISOString();
    rec.rejectedBy = rejectedBy ? String(rejectedBy) : "";

    await env.BOT_DB.prepare(
      "UPDATE payments SET data=?2, status='rejected', updated_at=?3 WHERE txid=?1"
    ).bind(clean, JSON.stringify(rec), rec.rejectedAt).run();
  } else {
    if(!env.BOT_KV) throw new Error("kv_required");
    const raw = await env.BOT_KV.get(`pay:pending:${clean}`);
    if(!raw) throw new Error("payment_not_found");
    rec = safeJsonParse(raw);
    if(!rec) throw new Error("payment_corrupt");
    rec.status = "rejected";
    rec.rejectedAt = new Date().toISOString();
    rec.rejectedBy = rejectedBy ? String(rejectedBy) : "";
  }

  // KV legacy cleanup
  if(env.BOT_KV){
    await env.BOT_KV.delete(`pay:pending:${clean}`).catch(()=>{});
    await env.BOT_KV.put(`pay:rejected:${clean}`, JSON.stringify(rec)).catch(()=>{});
    await env.BOT_KV.put(`pay:tx:${clean}`, "rejected").catch(()=>{});
  }

  // mark on user
  let st = patchUser((await getUser(rec.userId, env))||{}, rec.userId);
  st.lastPaymentTx = clean;
  st.lastPaymentStatus = "rejected";
  await saveUser(rec.userId, st, env);

  return rec;
}

async function listPendingPayments(env, limit=20, cursor=null){
  const lim = Math.max(1, Math.min(100, Number(limit)||20));

  if(hasD1(env)){
    const res = await env.BOT_DB.prepare(
      "SELECT data FROM payments WHERE status='pending' ORDER BY created_at DESC LIMIT ?1"
    ).bind(lim).all();
    const items = [];
    for(const r of (res?.results || [])){
      const rec = safeJsonParse(r.data);
      if(rec) items.push(rec);
    }
    return { items, cursor: null, list_complete: true };
  }

  // KV fallback (legacy)
  if(!env.BOT_KV) throw new Error("kv_required");
  const res = await env.BOT_KV.list({ prefix: "pay:pending:", limit: lim, cursor: cursor || undefined });
  const items = [];
  for(const k of res.keys){
    const raw = await env.BOT_KV.get(k.name);
    const rec = safeJsonParse(raw);
    if(rec) items.push(rec);
  }
  return { items, cursor: res.cursor, list_complete: res.list_complete };
}


async function getAnalysisPromptTemplate(env){
  const p = await getCfg(env, "analysis_prompt", "cfg:analysis_prompt", "");
  return p ? p : null;
}
async function setAnalysisPromptTemplate(env, prompt){
  return await setCfg(env, "analysis_prompt", "cfg:analysis_prompt", prompt);
}
async function getVisionPromptTemplate(env){
  const p = await getCfg(env, "vision_prompt", "cfg:vision_prompt", "");
  return p ? p : null;
}
async function setVisionPromptTemplate(env, prompt){
  return await setCfg(env, "vision_prompt", "cfg:vision_prompt", prompt);
}

/* ========================== TELEGRAM API ========================== */
 async function tgApi(env, method, payload, isMultipart=false){
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const r = isMultipart
    ? await fetch(url, { method:"POST", body: payload })
    : await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload) });

  const j = await r.json().catch(()=>null);
  if(!j || !j.ok) console.error("Telegram API error:", method, j);
  return j;
}
async function tgSendMessage(env, chatId, text, replyMarkup){
  return tgApi(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0,3900),
    reply_markup: replyMarkup,
    disable_web_page_preview: true,
  });
}
async function tgSendChatAction(env, chatId, action){
  return tgApi(env, "sendChatAction", { chat_id: chatId, action });
}

async function tgAnswerCallbackQuery(env, callbackQueryId, text){
  return tgApi(env, "answerCallbackQuery", { callback_query_id: callbackQueryId, text: text ? String(text).slice(0,180) : undefined, show_alert: false });
}
async function tgGetFilePath(env, fileId){
  const j = await tgApi(env, "getFile", { file_id: fileId });
  return j?.result?.file_path || "";
}
async function tgSendPhotoByUrl(env, chatId, photoUrl, caption=""){
  return tgApi(env, "sendPhoto", { chat_id: chatId, photo: photoUrl, caption: caption ? String(caption).slice(0,900) : undefined });
}

/* ========================== TYPING LOOP ========================== */
function stopToken(){ return { stop:false }; }
async function typingLoop(env, chatId, token){
  while(!token.stop){
    await tgSendChatAction(env, chatId, "typing");
    await sleep(TYPING_INTERVAL_MS);
  }
}

/* ========================== IMAGE PICKING ========================== */
function extractImageFileId(msg, env){
  if (msg.photo && msg.photo.length) {
    const maxBytes = Number(env.VISION_MAX_BYTES || 900000);
    const sorted = [...msg.photo].sort((a,b)=>(a.file_size||0)-(b.file_size||0));
    let best = null;
    for(const p of sorted){ if((p.file_size||0) <= maxBytes) best = p; }
    if(!best) best = sorted[0];
    return best?.file_id || "";
  }
  if(msg.document && msg.document.mime_type?.startsWith("image/")) return msg.document.file_id || "";
  return "";
}

/* ========================== PROMPTS (DEFAULTS) ========================== */
function institutionalPrompt(timeframe="H4"){
  return `SYSTEM OVERRIDE: ACTIVATE INSTITUTIONAL MODE

ROLE: You are an elite “Liquidity Hunter Algorithm” tracking Smart Money.
INPUT CONTEXT: ${timeframe} Timeframe Chart.

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
}

/* ========================== PROVIDERS ========================== */
async function runTextProviders(prompt, env, orderOverride){
  const chain = parseOrder(orderOverride || env.TEXT_PROVIDER_ORDER, ["cf","openai","gemini"]);
  let lastErr=null;
  for(const p of chain){
    try{
      const out = await Promise.race([ textProvider(p, prompt, env), timeoutPromise(TIMEOUT_TEXT_MS, `text_${p}_timeout`) ]);
      if(out && String(out).trim()) return String(out).trim();
    } catch(e){ lastErr=e; console.error("text provider failed:", p, e?.message||e); }
  }
  throw lastErr || new Error("all_text_providers_failed");
}
async function runPolishProviders(draft, env, orderOverride){
  const raw = (orderOverride || env.POLISH_PROVIDER_ORDER || "").toString().trim();
  if(!raw) return draft;
  const chain = parseOrder(raw, ["openai","cf","gemini"]);
  const polishPrompt =
    `تو یک ویراستار سخت‌گیر فارسی هستی. متن زیر را فقط “سفت‌وسخت” کن:
`+
    `- فقط فارسی
- قالب شماره‌دار ۱ تا ۵ حفظ شود
- لحن افشاگر/تیز
- اضافه‌گویی حذف
- خیال‌بافی نکن

`+
    `متن:
${draft}`;
  for(const p of chain){
    try{
      const out = await Promise.race([ textProvider(p, polishPrompt, env), timeoutPromise(TIMEOUT_POLISH_MS, `polish_${p}_timeout`) ]);
      if(out && String(out).trim()) return String(out).trim();
    } catch(e){ console.error("polish provider failed:", p, e?.message||e); }
  }
  return draft;
}
async function runVisionProviders(imageUrl, visionPrompt, env, orderOverride){
  const chain = parseOrder(orderOverride || env.VISION_PROVIDER_ORDER, ["openai","cf","gemini","hf"]);
  const totalBudget = Number(env.VISION_TOTAL_BUDGET_MS || 20000);
  const deadline = Date.now() + totalBudget;
  let lastErr=null;
  let cached=null;
  for(const p of chain){
    const remaining = deadline - Date.now();
    if(remaining <= 500) break;
    try{
      if((p==="cf"||p==="gemini"||p==="hf") && cached?.tooLarge) continue;
      const out = await Promise.race([
        visionProvider(p, imageUrl, visionPrompt, env, ()=>cached, (c)=>cached=c),
        timeoutPromise(Math.min(TIMEOUT_VISION_MS, remaining), `vision_${p}_timeout`)
      ]);
      if(out && String(out).trim()) return String(out).trim();
    } catch(e){ lastErr=e; console.error("vision provider failed:", p, e?.message||e); }
  }
  throw lastErr || new Error("all_vision_providers_failed_or_budget_exceeded");
}

async function textProvider(name, prompt, env){
  name = String(name||"").toLowerCase();
  if(name==="cf"){
    if(!env.AI) throw new Error("AI_binding_missing");
    const out = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages:[{role:"user", content: prompt}], max_tokens:900, temperature:0.25 });
    return out?.response || out?.result || "";
  }
  if(name==="openai"){
    if(!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ Authorization:`Bearer ${env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify({ model: env.OPENAI_TEXT_MODEL || "gpt-4o-mini", messages:[{role:"user", content: prompt}], temperature:0.25 })
    }, TIMEOUT_TEXT_MS);
    const j = await r.json().catch(()=>null);
    return j?.choices?.[0]?.message?.content || "";
  }
  if(name==="gemini"){
    if(!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY_missing");
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_TEXT_MODEL || "gemini-1.5-flash")}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ contents:[{parts:[{text: prompt}]}], generationConfig:{ temperature:0.25, maxOutputTokens:900 } }) },
      TIMEOUT_TEXT_MS
    );
    const j = await r.json().catch(()=>null);
    return j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") || "";
  }
  throw new Error(`unknown_text_provider:${name}`);
}

function detectMimeFromHeaders(resp, fallback="image/jpeg"){
  const ct = resp.headers.get("content-type") || "";
  if(ct.startsWith("image/")) return ct.split(";")[0].trim();
  return fallback;
}
function arrayBufferToBase64(buf){
  const bytes = new Uint8Array(buf);
  let binary="";
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk){
    binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
  }
  return btoa(binary);
}
async function ensureImageCache(imageUrl, env, getCache, setCache){
  const cur=getCache();
  if(cur?.buf && cur?.mime) return cur;
  const maxBytes = Number(env.VISION_MAX_BYTES || 900000);
  const resp = await fetchWithTimeout(imageUrl, {}, TIMEOUT_VISION_MS);
  const len = Number(resp.headers.get("content-length") || "0");
  if(len && len > maxBytes){ const c={ tooLarge:true, mime:"image/jpeg" }; setCache(c); return c; }
  const mime = detectMimeFromHeaders(resp, "image/jpeg");
  const buf = await resp.arrayBuffer();
  if(buf.byteLength > maxBytes){ const c={ tooLarge:true, mime }; setCache(c); return c; }
  const u8 = new Uint8Array(buf);
  const base64 = arrayBufferToBase64(buf);
  const c = { buf, mime, base64, u8, tooLarge:false };
  setCache(c);
  return c;
}

async function visionProvider(name, imageUrl, visionPrompt, env, getCache, setCache){
  name = String(name||"").toLowerCase();
  if(name==="openai"){
    if(!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_missing");
    const body = {
      model: env.OPENAI_VISION_MODEL || (env.OPENAI_TEXT_MODEL || "gpt-4o-mini"),
      messages:[{ role:"user", content:[{type:"text", text: visionPrompt},{type:"image_url", image_url:{ url:imageUrl }}] }],
      temperature:0.2
    };
    const r = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method:"POST",
      headers:{ Authorization:`Bearer ${env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify(body)
    }, TIMEOUT_VISION_MS);
    const j = await r.json().catch(()=>null);
    return j?.choices?.[0]?.message?.content || "";
  }
  if(name==="cf"){
    if(!env.AI) throw new Error("AI_binding_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if(c.tooLarge) return "";
    const bytesArr = [...c.u8];
    const out = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", { image: bytesArr, prompt: visionPrompt });
    return out?.description || out?.response || out?.result || "";
  }
  if(name==="gemini"){
    if(!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY_missing");
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if(c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_VISION_MODEL || "gemini-1.5-flash")}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ contents:[{ parts:[{ text: visionPrompt },{ inlineData:{ mimeType: c.mime, data: c.base64 } }] }], generationConfig:{ temperature:0.2, maxOutputTokens:900 } }) },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(()=>null);
    return j?.candidates?.[0]?.content?.parts?.map(p=>p.text).join("") || "";
  }
  if(name==="hf"){
    if(!env.HF_API_KEY) throw new Error("HF_API_KEY_missing");
    const model = (env.HF_VISION_MODEL || "Salesforce/blip-image-captioning-large").toString().trim();
    const c = await ensureImageCache(imageUrl, env, getCache, setCache);
    if(c.tooLarge) return "";
    const r = await fetchWithTimeout(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model)}`,
      { method:"POST", headers:{ Authorization:`Bearer ${env.HF_API_KEY}`, "Content-Type":"application/octet-stream" }, body: c.u8 },
      TIMEOUT_VISION_MS
    );
    const j = await r.json().catch(()=>null);
    const txt = Array.isArray(j) ? j?.[0]?.generated_text : (j?.generated_text || j?.text);
    return txt ? String(txt) : "";
  }
  throw new Error(`unknown_vision_provider:${name}`);
}

/* ========================== MARKET DATA ========================== */
function assetKind(symbol){
  if(!symbol) return "unknown";
  if(symbol.endsWith("USDT")) return "crypto";
  if(/^[A-Z]{6}$/.test(symbol)) return "forex";
  if(symbol==="XAUUSD"||symbol==="XAGUSD") return "metal";
  if(symbol==="DJI"||symbol==="NDX"||symbol==="SPX") return "index";
  // allow generic stock tickers (incl. BRK.B)
  if(/^[A-Z]{1,5}$/.test(symbol) || /^[A-Z]{1,5}\.[A-Z]{1,2}$/.test(symbol) || STOCKS.includes(symbol)) return "stock";
  return "unknown";
}
function mapTimeframeToBinance(tf){ return ({M15:"15m",H1:"1h",H4:"4h",D1:"1d"})[tf] || "4h"; }
function mapTimeframeToTwelve(tf){ return ({M15:"15min",H1:"1h",H4:"4h",D1:"1day"})[tf] || "4h"; }
function mapForexSymbolForTwelve(symbol){
  if(/^[A-Z]{6}$/.test(symbol)) return `${symbol.slice(0,3)}/${symbol.slice(3,6)}`;
  if(symbol==="XAUUSD") return "XAU/USD";
  if(symbol==="XAGUSD") return "XAG/USD";
  return symbol;
}
function mapTimeframeToAlphaVantage(tf){ return ({M15:"15min",H1:"60min"})[tf] || "60min"; }
function toYahooSymbol(symbol){
  if(/^[A-Z]{6}$/.test(symbol)) return `${symbol}=X`;
  if(symbol.endsWith("USDT")) return `${symbol.replace("USDT","-USD")}`;
  if(symbol==="XAUUSD") return "XAUUSD=X";
  if(symbol==="XAGUSD") return "XAGUSD=X";
  return symbol;
}
function yahooInterval(tf){ return ({M15:"15m",H1:"60m",H4:"240m",D1:"1d"})[tf] || "240m"; }

async function fetchBinanceCandles(symbol, timeframe, limit, timeoutMs, env){
  if(!symbol.endsWith("USDT")) throw new Error("binance_not_crypto");
  const interval = mapTimeframeToBinance(timeframe);
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`binance_http_${r.status}`);
  const data = await r.json();
  return data.map(k => ({ t:k[0], o:Number(k[1]), h:Number(k[2]), l:Number(k[3]), c:Number(k[4]), v:Number(k[5]) }));
}

async function fetchBinanceTicker24h(symbol, timeoutMs, cacheTtlSec=60){
  if(!symbol.endsWith("USDT")) return null;
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
  const cacheKey = new Request(url, { method: "GET" });

  try{
    const cached = await caches.default.match(cacheKey);
    if(cached){
      const j = await cached.json().catch(()=>null);
      if(j) return j;
    }
  }catch{}

  const r = await fetchWithTimeout(url, { headers: { "User-Agent": "Mozilla/5.0" } }, timeoutMs);
  if(!r.ok) throw new Error(`binance_ticker_http_${r.status}`);
  const j = await r.json().catch(()=>null);
  if(!j) return null;

  const data = {
    last: Number(j.lastPrice),
    changePct: Number(j.priceChangePercent),
    high: Number(j.highPrice),
    low: Number(j.lowPrice),
    vol: Number(j.volume),
  };

  caches.default.put(cacheKey, new Response(JSON.stringify(data), {
    headers: { "content-type":"application/json; charset=utf-8", "cache-control": `public, max-age=${cacheTtlSec}` }
  })).catch(()=>{});

  return data;
}

async function fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env){
  if(!env.TWELVEDATA_API_KEY) throw new Error("twelvedata_key_missing");
  if(assetKind(symbol)==="unknown") throw new Error("twelvedata_unknown_symbol");
  const interval = mapTimeframeToTwelve(timeframe);
  const sym = mapForexSymbolForTwelve(symbol);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&outputsize=${limit}&apikey=${encodeURIComponent(env.TWELVEDATA_API_KEY)}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`twelvedata_http_${r.status}`);
  const j = await r.json();
  if(j.status==="error") throw new Error(`twelvedata_err_${j.code||""}`);
  const values = Array.isArray(j.values) ? j.values : [];
  return values.reverse().map(v => ({ t: Date.parse(v.datetime+"Z")||Date.now(), o:Number(v.open), h:Number(v.high), l:Number(v.low), c:Number(v.close), v: v.volume?Number(v.volume):null }));
}
async function fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env){
  if(!env.ALPHAVANTAGE_API_KEY) throw new Error("alphavantage_key_missing");
  if(!/^[A-Z]{6}$/.test(symbol) && symbol!=="XAUUSD" && symbol!=="XAGUSD") throw new Error("alphavantage_only_fx_like");
  const from = symbol.slice(0,3), to = symbol.slice(3,6);
  const interval = mapTimeframeToAlphaVantage(timeframe);
  const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${encodeURIComponent(from)}&to_symbol=${encodeURIComponent(to)}&interval=${encodeURIComponent(interval)}&outputsize=compact&apikey=${encodeURIComponent(env.ALPHAVANTAGE_API_KEY)}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`alphavantage_http_${r.status}`);
  const j = await r.json();
  const key = Object.keys(j).find(k=>k.startsWith("Time Series FX"));
  if(!key) throw new Error("alphavantage_no_timeseries");
  const ts = j[key];
  return Object.entries(ts).slice(0,limit).map(([dt,v]) => ({ t: Date.parse(dt+"Z")||Date.now(), o:Number(v["1. open"]), h:Number(v["2. high"]), l:Number(v["3. low"]), c:Number(v["4. close"]), v:null })).reverse();
}
function mapTimeframeToFinnhubResolution(tf){ return ({M15:"15",H1:"60",H4:"240",D1:"D"})[tf] || "240"; }
async function fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env){
  if(!env.FINNHUB_API_KEY) throw new Error("finnhub_key_missing");
  if(!/^[A-Z]{6}$/.test(symbol)) throw new Error("finnhub_only_forex");
  const res = mapTimeframeToFinnhubResolution(timeframe);
  const inst = `OANDA:${symbol.slice(0,3)}_${symbol.slice(3,6)}`;
  const now = Math.floor(Date.now()/1000);
  const from = now - 60*60*24*10;
  const url = `https://finnhub.io/api/v1/forex/candle?symbol=${encodeURIComponent(inst)}&resolution=${encodeURIComponent(res)}&from=${from}&to=${now}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`;
  const headers = { "User-Agent": "Mozilla/5.0" };
  if(env?.BINANCE_API_KEY) headers["X-MBX-APIKEY"] = env.BINANCE_API_KEY;
  const r = await fetchWithTimeout(url, { headers }, timeoutMs);
  if(!r.ok) throw new Error(`finnhub_http_${r.status}`);
  const j = await r.json();
  if(j.s!=="ok") throw new Error(`finnhub_status_${j.s}`);
  const candles = j.t.map((t,i)=>({ t:t*1000, o:Number(j.o[i]), h:Number(j.h[i]), l:Number(j.l[i]), c:Number(j.c[i]), v:j.v?Number(j.v[i]):null }));
  return candles.slice(-limit);
}

async function fetchFinnhubStockCandles(symbol, timeframe, limit, timeoutMs, env){
  if(!env.FINNHUB_API_KEY) throw new Error("finnhub_key_missing");
  // finnhub stock endpoint expects exchange symbol like NVDA, AAPL, etc.
  if(assetKind(symbol)!=="stock" && assetKind(symbol)!=="index") throw new Error("finnhub_only_stock");
  const res = mapTimeframeToFinnhubResolution(timeframe); // "15","60","240","D"
  const now = Math.floor(Date.now()/1000);
  const from = now - 60*60*24*30;
  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(res)}&from=${from}&to=${now}&token=${encodeURIComponent(env.FINNHUB_API_KEY)}`;
  const controller = new AbortController();
  const t = setTimeout(()=>controller.abort("timeout"), timeoutMs||12000);
  const resp = await fetch(url, { signal: controller.signal });
  clearTimeout(t);
  if(!resp.ok) throw new Error("finnhub_http_"+resp.status);
  const data = await resp.json().catch(()=>null);
  if(!data || data.s!=="ok" || !Array.isArray(data.t) || !data.t.length) throw new Error("finnhub_no_data");
  const rows = [];
  for(let i=0;i<data.t.length;i++){
    rows.push({ t: Number(data.t[i])*1000, o: Number(data.o[i]), h: Number(data.h[i]), l: Number(data.l[i]), c: Number(data.c[i]), v: data.v?Number(data.v[i]):null });
  }
  return rows.slice(-Math.max(50, Math.min(500, limit||200)));
}

async function fetchFinnhubCandles(symbol, timeframe, limit, timeoutMs, env){
  const kind = assetKind(symbol);
  if(kind==="forex" || kind==="metal") return fetchFinnhubForexCandles(symbol, timeframe, limit, timeoutMs, env);
  return fetchFinnhubStockCandles(symbol, timeframe, limit, timeoutMs, env);
}
async function fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs){
  const interval = yahooInterval(timeframe);
  const ysym = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}?interval=${encodeURIComponent(interval)}&range=10d`;
  const r = await fetchWithTimeout(url, { headers:{ "User-Agent":"Mozilla/5.0" } }, timeoutMs);
  if(!r.ok) throw new Error(`yahoo_http_${r.status}`);
  const j = await r.json();
  const result = j?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0];
  if(!ts.length || !q) throw new Error("yahoo_no_data");
  const candles = ts.map((t,i)=>({ t:t*1000, o:Number(q.open?.[i]), h:Number(q.high?.[i]), l:Number(q.low?.[i]), c:Number(q.close?.[i]), v:q.volume?.[i]!=null?Number(q.volume[i]):null })).filter(x=>Number.isFinite(x.c));
  return candles.slice(-limit);
}
async function getMarketCandlesWithFallbackMeta(env, symbol, timeframe){
  const timeoutMs = Number(env.MARKET_DATA_TIMEOUT_MS || 7000);
  const limit = Number(env.MARKET_DATA_CANDLES_LIMIT || 120);

  // Layer 1: edge cache (very short)
  const cacheTtlSec = toInt(env.MARKET_CACHE_TTL_SEC, 20);
  const cache = (typeof caches !== "undefined") ? caches.default : null;
  const cacheKey = cache
    ? new Request(`https://cache.local/market?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}&limit=${limit}`)
    : null;

  // Layer 2: KV cache (cross-request; safer for rate-limits)
  const kvTtlSec = toInt(env.MARKET_KV_TTL_SEC, 60);
  const kv = env.KV || env.BOT_KV || null;
  const kvKey = kv ? `md:v1:${symbol}:${timeframe}:${limit}` : null;

  // Try KV first
  if(kv && kvTtlSec > 0 && kvKey){
    try{
      const hit = await kv.get(kvKey);
      if(hit){
        const data = JSON.parse(hit);
        if(Array.isArray(data) && data.length){
          return { candles:data, provider:"kv", tried:[{provider:"kv", ok:true}], fromCache:true };
        }
      }
    }catch(_e){}
  }

  // Try edge cache
  if(cache && cacheTtlSec > 0 && cacheKey){
    try{
      const hit = await cache.match(cacheKey);
      if(hit){
        const data = await hit.json().catch(()=>null);
        if(Array.isArray(data) && data.length){
          if(kv && kvTtlSec > 0 && kvKey){
            kv.put(kvKey, JSON.stringify(data), { expirationTtl: kvTtlSec }).catch(()=>{});
          }
          return { candles:data, provider:"cache", tried:[{provider:"cache", ok:true}], fromCache:true };
        }
      }
    }catch(_e){}
  }

  const chain = parseOrder(env.MARKET_DATA_PROVIDER_ORDER, ["binance","twelvedata","alphavantage","finnhub","yahoo"]);
  const tried = [];
  let lastErr=null;

  for(const p of chain){
    try{
      let candles = null;

      if(p==="binance") candles = await fetchBinanceCandles(symbol, timeframe, limit, timeoutMs, env);
      if(p==="twelvedata") candles = await fetchTwelveDataCandles(symbol, timeframe, limit, timeoutMs, env);
      if(p==="alphavantage") candles = await fetchAlphaVantageFxIntraday(symbol, timeframe, limit, timeoutMs, env);
      if(p==="finnhub") candles = await fetchFinnhubCandles(symbol, timeframe, limit, timeoutMs, env);
      if(p==="yahoo") candles = await fetchYahooChartCandles(symbol, timeframe, limit, timeoutMs);

      if(candles && candles.length){
        tried.push({provider:p, ok:true});

        if(cache && cacheTtlSec > 0 && cacheKey){
          const resp = new Response(JSON.stringify(candles), {
            headers:{
              "content-type":"application/json; charset=utf-8",
              "cache-control":`public, max-age=${cacheTtlSec}`
            }
          });
          cache.put(cacheKey, resp).catch(()=>{});
        }
        if(kv && kvTtlSec > 0 && kvKey){
          kv.put(kvKey, JSON.stringify(candles), { expirationTtl: kvTtlSec }).catch(()=>{});
        }

        return { candles, provider:p, tried, fromCache:false };
      }

      tried.push({provider:p, ok:false, error:"empty"});
    }catch(e){
      lastErr = e;
      const msg = (e?.message || String(e || "error")).slice(0, 160);
      tried.push({provider:p, ok:false, error:msg});
      console.error("market provider failed:", p, msg);
    }
  }

  const err = lastErr || new Error("market_data_all_failed");
  err.tried = tried;
  throw err;
}

// Backward-compatible helper (older call sites expect just an array)
async function getMarketCandlesWithFallback(env, symbol, timeframe){
  const r = await getMarketCandlesWithFallbackMeta(env, symbol, timeframe);
  return r?.candles || [];
}


function computeSnapshot(candles){
  if(!candles?.length) return null;
  const last = candles[candles.length-1];
  const prev = candles[candles.length-2] || last;
  const closes = candles.map(x=>x.c);
  const sma = (arr,p)=>{ if(arr.length<p) return null; const s=arr.slice(-p).reduce((a,b)=>a+b,0); return s/p; };
  const sma20 = sma(closes,20);
  const sma50 = sma(closes,50);
  const trend = (sma20 && sma50) ? (sma20 > sma50 ? "صعودی" : "نزولی") : "نامشخص";
  const n = Math.min(50, candles.length);
  const recent = candles.slice(-n);
  const hi = Math.max(...recent.map(x=>x.h));
  const lo = Math.min(...recent.map(x=>x.l));
  const lastClose = last.c;
  const changePct = prev?.c ? ((lastClose - prev.c) / prev.c) * 100 : 0;
  return { lastPrice:lastClose, changePct:Number(changePct.toFixed(3)), trend, range50:{hi,lo}, sma20:sma20?Number(sma20.toFixed(6)):null, sma50:sma50?Number(sma50.toFixed(6)):null, lastTs:last.t };
}
function candlesToCompactCSV(candles, maxRows=80){
  const tail = candles.slice(-maxRows);
  return tail.map(x=>`${x.t},${x.o},${x.h},${x.l},${x.c}`).join("\n");
}


/* ========================== NEWS (newsdata.io) ========================== */
// Map symbols to reasonable news queries
function newsQueryForSymbol(symbol){
  symbol = String(symbol||"").toUpperCase().trim();
  if(!symbol) return "";

  // Crypto base names
  if(symbol.endsWith("USDT")){
    const base = symbol.replace("USDT","");
    const map = {
      BTC:"Bitcoin", ETH:"Ethereum", BNB:"Binance Coin", SOL:"Solana", XRP:"Ripple",
      ADA:"Cardano", DOGE:"Dogecoin", TRX:"Tron", TON:"Toncoin", AVAX:"Avalanche",
      LINK:"Chainlink", DOT:"Polkadot", MATIC:"Polygon", LTC:"Litecoin", BCH:"Bitcoin Cash",
    };
    const name = map[base] || base;
    return `${name} crypto`;
  }

  // Forex pairs
  if(/^[A-Z]{6}$/.test(symbol)){
    const map = {
      EURUSD:"Euro Dollar", GBPUSD:"British Pound Dollar", USDJPY:"USD JPY Yen", USDCHF:"USD CHF Swiss Franc",
      AUDUSD:"Australian Dollar", USDCAD:"Canadian Dollar", NZDUSD:"New Zealand Dollar"
    };
    return `${map[symbol] || symbol} forex`;
  }

  // Metals
  if(symbol === "XAUUSD") return "Gold price";
  if(symbol === "XAGUSD") return "Silver price";

  // Indices
  if(symbol === "SPX") return "S&P 500";
  if(symbol === "NDX") return "Nasdaq 100";
  if(symbol === "DJI") return "Dow Jones";

  return symbol;
}

// NewsData.io timeframe supports 1-48 hours OR minutes with "m" suffix
function newsTimeframeParam(tf){
  tf = String(tf||"").toUpperCase().trim();
  if(tf === "M15") return "240m";  // ~4h
  if(tf === "H1")  return "12";    // 12h
  if(tf === "H4")  return "24";    // 24h
  if(tf === "D1")  return "48";    // 48h
  return "24";
}

async function fetchNewsHeadlines(env, symbol, timeframe){
  try{
    if(!env.NEWSDATA_API_KEY) return [];
    const q = newsQueryForSymbol(symbol);
    if(!q) return [];

    const lang = (env.NEWS_LANGUAGE || "en").toString().trim() || "en";
    const cat  = (env.NEWS_CATEGORY || "business").toString().trim() || "business";
    const tf   = newsTimeframeParam(timeframe);

    const url =
      `https://newsdata.io/api/1/latest?apikey=${encodeURIComponent(env.NEWSDATA_API_KEY)}` +
      `&q=${encodeURIComponent(q)}` +
      `&language=${encodeURIComponent(lang)}` +
      `&category=${encodeURIComponent(cat)}` +
      `&timeframe=${encodeURIComponent(tf)}`;

    const cacheKey = new Request(url, { method: "GET" });
    try{
      const cached = await caches.default.match(cacheKey);
      if(cached){
        const j = await cached.json().catch(()=>null);
        if(Array.isArray(j)) return j;
      }
    }catch{}

    const timeoutMs = toInt(env.NEWS_TIMEOUT_MS, 6000);
    const r = await fetchWithTimeout(url, {}, timeoutMs);
    if(!r.ok) return [];
    const j = await r.json().catch(()=>null);
    const results = Array.isArray(j?.results) ? j.results : [];

    const items = results.slice(0, 10).map(x => ({
      title: String(x?.title||"").trim(),
      source: String(x?.source_id||x?.source||"").trim(),
      pubDate: String(x?.pubDate||x?.pubdate||"").trim(),
      link: String(x?.link||x?.url||"").trim(),
    })).filter(x => x.title);

    const ttl = toInt(env.NEWS_CACHE_TTL_SEC, 600);
    caches.default.put(cacheKey, new Response(JSON.stringify(items), {
      headers: { "content-type":"application/json; charset=utf-8", "cache-control": `public, max-age=${ttl}` }
    })).catch(()=>{});

    return items;
  }catch(e){
    console.error("news fetch failed:", e?.message || e);
    return [];
  }
}

function formatNewsForPrompt(headlines, maxItems=5){
  const list = Array.isArray(headlines) ? headlines.slice(0, maxItems) : [];
  if(!list.length) return "NEWS_HEADLINES: (none)";
  const lines = list.map(h => `- ${h.source ? "["+h.source+"] " : ""}${h.title}${h.pubDate ? " ("+h.pubDate+")" : ""}`);
  return "NEWS_HEADLINES:\n" + lines.join("\n");
}


const STYLE_DEFAULT_PROMPTS = {
  "RTM": `شما تحلیل‌گر سبک RTM هستید. خروجی را ساختاریافته بده:

1) Bias کلی بازار (Bull/Bear/Range) + دلیل
2) نواحی مهم: Base / Rally-Base-Drop / Drop-Base-Rally (بازه قیمت دقیق)
3) تایم‌فریم‌های هم‌راستا (HTF→LTF)
4) سناریو ورود/ابطال: Entry, SL, TP1/TP2, R:R
5) مدیریت ریسک و شرایط عدم معامله

قوانین: از حدس بی‌پایه پرهیز کن. اگر دیتا ناکافی است، سوال حداقلی بپرس.`,

  "ICT": `شما تحلیل‌گر سبک ICT هستید. خروجی:

1) Market Structure (BOS/CHOCH)
2) Liquidity: SSL/BSL، Equal High/Low، Stop Hunt
3) PD Arrays: FVG, OB, Mitigation, Breaker (با بازه‌های دقیق)
4) Killzones (در صورت بازار فارکس) و تایم مناسب
5) پلن معامله: Entry, SL, TP، و Confirmation + شرایط ابطال

قوانین: ریسک را شفاف بیان کن و فقط بر اساس داده OHLC و ساختار.`,

  "پرایس اکشن": `شما تحلیل‌گر Price Action هستید. خروجی:

1) روند و ساختار (HH/HL/LH/LL)
2) سطوح کلیدی S/R و واکنش‌های گذشته
3) الگوها (Pin/Engulf/Inside Bar/Breakout-Reject)
4) پلن معامله: Trigger ورود، SL منطقی، اهداف، R:R
5) سناریوی جایگزین در صورت شکست سطح`,

  "روش اختصاصی": `شما تحلیل‌گر روش اختصاصی MarketiQ هستید:

1) ترکیب روند + زون + تایمینگ (HTF→LTF)
2) سه زون: Zone A (Accumulation)، Zone B (Decision)، Zone C (Expansion)
3) معیار اعتبار زون: تعداد برخورد، حجم نسبی، کندل تاییدی
4) پلن اجرایی با مدیریت ریسک سخت‌گیرانه (Entry/SL/TP و شرایط ابطال)

خروجی کوتاه ولی دقیق، با عدد و سطح.`,

  "پرامپت اختصاصی": `اگر پرامپت اختصاصی کاربر فعال است، دقیقاً مطابق همان پرامپت تحلیل کن.
اگر فعال نیست، اجازه فعال‌سازی نده و کاربر را راهنمایی کن تا بعد از تحویل، آن را فعال کند.`
};


function styleKeyFromName(style){
  const s = String(style||"").trim();
  // Dynamic catalog (cached) label -> key
  try{
    const cat = (_STYLE_CACHE && Array.isArray(_STYLE_CACHE.items)) ? _STYLE_CACHE.items : null;
    if(cat && cat.length){
      const hit = cat.find(x=>String(x.label||"").trim() === s);
      if(hit) return String(hit.key||"general");
    }
  }catch(_e){}
  // Legacy fallback
  if(s === "RTM") return "rtm";
  if(s === "ICT") return "ict";
  if(s === "پرایس اکشن") return "price_action";
  if(s === "پرامپت") return "prompt";
  if(s === "روش اختصاصی") return "custom_method";
  if(s === "پرامپت اختصاصی") return "custom_prompt";
  if(s === "سوئینگ") return "swing";
  if(s === "اینترادی") return "intraday";
  if(s === "اسکالپ") return "scalp";
  if(s === "اسمارت‌مانی") return "smart";
  return "general";
}

async function getStylePrompt(env, st){
  const style = st?.style || "";

  // If user selected custom prompt style, prefer user's generated prompt (must be delivered)
  if(style === "پرامپت اختصاصی" && st?.customPromptDeliveredAt && st?.customPromptText){
    return st.customPromptText;
  }

  const key = styleKeyFromName(style);
  // Per-key override (cfg)
  const cfgKey = `cfg:style_prompt:${key}`;
  const v = await getCfg(env, `style_prompt_${key}`, cfgKey, "");
  if(v && String(v).trim()) return String(v).trim();

  // Catalog prompt (D1/KV/default)
  try{
    const cat = await getStyleCatalog(env);
    const hit = (cat||[]).find(x=>String(x.key||"").toLowerCase() === String(key).toLowerCase());
    if(hit && String(hit.prompt||"").trim()) return String(hit.prompt).trim();
  }catch(_e){}

  // Legacy static map
  return STYLE_DEFAULT_PROMPTS[style] || "";
}

/* ========================== PROMPT BUILDERS ========================== */
async function buildBasePrompt(env, tf){
  const tpl = await getAnalysisPromptTemplate(env);
  const base = tpl ? tpl : institutionalPrompt(tf);
  return String(base).replaceAll("{{TF}}", tf).replaceAll("{{TIMEFRAME}}", tf);
}
async function buildTextPromptForSymbol(env, symbol, userPrompt, st, marketBlock){
  const tf = st.timeframe || "H4";
  const base = await buildBasePrompt(env, tf);
  const styleGuide = await getStylePrompt(env, st);
  const userExtra = userPrompt?.trim() ? userPrompt.trim() : "تحلیل کامل طبق چارچوب MarketiQ";
  return `${base}\n\nASSET: ${symbol}\nUSER SETTINGS: Style=${st.style}, Risk=${st.risk}, Experience=${st.experience||"-"}, PreferredMarket=${st.preferredMarket||"-"}`
    + (styleGuide ? `\n\nSTYLE_GUIDE:\n${styleGuide}\n` : "\n")
    + `\nMARKET_DATA:\n${marketBlock}\n\nUSER EXTRA REQUEST:\n${userExtra}\n\nRULES:\n- خروجی فقط فارسی و دقیقاً بخش‌های ۱ تا ۵\n- سطح‌های قیمتی را مشخص کن (X/Y/Z)\n- شرط کندلی را واضح بگو (close/wick)\n- از داده OHLC استفاده کن، خیال‌بافی نکن
- اگر NEWS_HEADLINES داده شده و خبر روشن است، اثر احتمالی اخبار را خیلی کوتاه در بخش ۴ یا ۵ اضافه کن (بدون خروج از قالب)`;
}
async function buildVisionPrompt(env, st){
  const tf = st.timeframe || "H4";
  const tpl = await getVisionPromptTemplate(env);
  const base = (tpl ? String(tpl) : institutionalPrompt(tf)).replaceAll("{{TF}}", tf).replaceAll("{{TIMEFRAME}}", tf);
  return `${base}\n\nTASK: این تصویر چارت را تحلیل کن. دقیقاً خروجی ۱ تا ۵ بده و سطح‌ها را مشخص کن.\nRULES: فقط فارسی، لحن افشاگر، خیال‌بافی نکن.\n`;
}

/* ========================== CHART RENDERING (QuickChart) ========================== */
// NOTE: Uses QuickChart plugins chartjs-chart-financial (candlestick) + annotation.

function safeJsonParse(s){
  try{ return JSON.parse(s); }catch(e){
    // try to extract json from text fences
    const m = String(s||"").match(/\{[\s\S]*\}/);
    if(m){ try{ return JSON.parse(m[0]); }catch(_e){} }
    return null;
  }
}

function faDigitsToEn(s){
  return String(s||"")
    .replace(/[۰٠]/g, "0").replace(/[۱١]/g, "1").replace(/[۲٢]/g, "2").replace(/[۳٣]/g, "3").replace(/[۴٤]/g, "4")
    .replace(/[۵٥]/g, "5").replace(/[۶٦]/g, "6").replace(/[۷٧]/g, "7").replace(/[۸٨]/g, "8").replace(/[۹٩]/g, "9");
}

function normalizeNumberText(s){
  return faDigitsToEn(String(s||""))
    .replace(/٬/g, "")
    .replace(/,/g, "")
    .replace(/٫/g, ".");
}

function extractRenderPlanHeuristic(analysisText, candles){
  const t = normalizeNumberText(analysisText);

  const zones = [];
  const lines = [];

  // Ranges patterns (e.g., 123-130 | 123 تا 130)
  const rangeRe = /(\d+(?:\.\d+)?)[\s]*?(?:-|–|—|تا)[\s]*?(\d+(?:\.\d+)?)/g;
  let m;
  while((m = rangeRe.exec(t))){
    const a = Number(m[1]), b = Number(m[2]);
    if(!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const low = Math.min(a,b), high = Math.max(a,b);
    // classify by nearby words
    const ctx = t.slice(Math.max(0, m.index-30), Math.min(t.length, m.index+30)).toLowerCase();
    let label = "Zone";
    if(ctx.includes("حمایت") || ctx.includes("support") || ctx.includes("demand") || ctx.includes("تقاضا") || ctx.includes("دیمند")) label = "زون تقاضا";
    if(ctx.includes("مقاومت") || ctx.includes("resist") || ctx.includes("supply") || ctx.includes("عرضه") || ctx.includes("ساپلای")) label = "زون عرضه";
    zones.push({ label, low, high });
  }

  // Single numbers - attempt to map to entry/stop/targets
  const numRe = /(\d+(?:\.\d+)?)/g;
  const nums = [];
  while((m = numRe.exec(t))){
    const n = Number(m[1]);
    if(Number.isFinite(n)) nums.push({ n, idx: m.index });
  }

  // Filter by recent price range
  let minP = null, maxP = null;
  if(Array.isArray(candles) && candles.length){
    const recent = candles.slice(-200);
    minP = Math.min(...recent.map(x => x.l));
    maxP = Math.max(...recent.map(x => x.h));
  }
  const within = (n) => (minP==null || maxP==null) ? true : (n >= minP*0.7 && n <= maxP*1.3);

  // Stop loss
  for(const x of nums){
    if(!within(x.n)) continue;
    const ctx = t.slice(Math.max(0, x.idx-25), Math.min(t.length, x.idx+25)).toLowerCase();
    if(ctx.includes("حد ضرر") || ctx.includes("sl") || ctx.includes("stop")){
      lines.push({ label: "حد ضرر", price: x.n });
      break;
    }
  }
  // Entry
  for(const x of nums){
    if(!within(x.n)) continue;
    const ctx = t.slice(Math.max(0, x.idx-25), Math.min(t.length, x.idx+25)).toLowerCase();
    if(ctx.includes("ورود") || ctx.includes("entry")){
      lines.push({ label: "ورود", price: x.n });
      break;
    }
  }
  // Targets
  let targetCount = 0;
  for(const x of nums){
    if(targetCount >= 3) break;
    if(!within(x.n)) continue;
    const ctx = t.slice(Math.max(0, x.idx-25), Math.min(t.length, x.idx+25)).toLowerCase();
    if(ctx.includes("هدف") || ctx.includes("tp") || ctx.includes("تارگت") || ctx.includes("target")){
      targetCount++;
      lines.push({ label: `هدف ${targetCount}`, price: x.n });
    }
  }

  // Deduplicate
  const uniqZones = [];
  const seenZ = new Set();
  for(const z of zones){
    const key = `${z.label}|${z.low.toFixed(6)}|${z.high.toFixed(6)}`;
    if(seenZ.has(key)) continue;
    seenZ.add(key);
    uniqZones.push(z);
  }
  const uniqLines = [];
  const seenL = new Set();
  for(const l of lines){
    const key = `${l.label}|${Number(l.price).toFixed(6)}`;
    if(seenL.has(key)) continue;
    seenL.add(key);
    uniqLines.push(l);
  }

  return { zones: uniqZones.slice(0, 6), lines: uniqLines.slice(0, 6) };
}

async function extractRenderPlan(env, analysisText, candles, st){
  const wantAI = (env.RENDER_PLAN_AI || "1") !== "0";
  const fallback = extractRenderPlanHeuristic(analysisText, candles);

  // If heuristic found something, skip AI for speed
  if(fallback.zones.length || fallback.lines.length || !wantAI) return fallback;

  try{
    const recent = candles?.slice(-120) || [];
    const lo = recent.length ? Math.min(...recent.map(x => x.l)) : 0;
    const hi = recent.length ? Math.max(...recent.map(x => x.h)) : 0;

    const prompt =
`فقط JSON بده. از متن تحلیل زیر «زون‌ها» و «سطح‌ها» را استخراج کن.
- اگر عددی نبود، آرایه‌ها خالی باشند.
- قیمت‌ها باید عدد باشند.
- زون‌ها: low < high
- خط‌ها: price
- حداکثر 6 زون و 6 خط
- بازه منطقی قیمت: ${lo} تا ${hi}

فرمت:
{"zones":[{"label":"زون تقاضا","low":0,"high":0}],"lines":[{"label":"ورود","price":0},{"label":"حد ضرر","price":0},{"label":"هدف 1","price":0}]}

متن تحلیل:
${analysisText}`;

    const raw = await runTextProviders(prompt, env, st.textOrder);
    const j = safeJsonParse(raw);
    if(j && Array.isArray(j.zones) && Array.isArray(j.lines)){
      const zones = j.zones.map(z => ({
        label: String(z?.label||"Zone").slice(0, 24),
        low: Number(z?.low),
        high: Number(z?.high),
      })).filter(z => Number.isFinite(z.low) && Number.isFinite(z.high) && z.low < z.high).slice(0, 6);

      const lines = j.lines.map(l => ({
        label: String(l?.label||"Level").slice(0, 24),
        price: Number(l?.price),
      })).filter(l => Number.isFinite(l.price)).slice(0, 6);

      if(zones.length || lines.length) return { zones, lines };
    }
  }catch(e){
    console.error("extractRenderPlan AI failed:", e?.message || e);
  }

  return fallback;
}

function roundForChart(n){
  if(!Number.isFinite(n)) return n;
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 2 : abs >= 10 ? 4 : 6;
  return Number(n.toFixed(dp));
}

function buildCandlesForChart(candles, max=80){
  const tail = (candles || []).slice(-max);
  return tail.map(c => ({
    x: c.t,
    o: roundForChart(c.o),
    h: roundForChart(c.h),
    l: roundForChart(c.l),
    c: roundForChart(c.c),
  }));
}

function buildQuickChartCandlestickConfig(symbol, timeframe, candles, plan){
  const data = buildCandlesForChart(candles, 80);
  if(!data.length) return null;
  const startTs = data[0].x;
  const endTs = data[data.length-1].x;

  const annotations = {};
  const zones = Array.isArray(plan?.zones) ? plan.zones : [];
  const lines = Array.isArray(plan?.lines) ? plan.lines : [];

  let zi = 0;
  for(const z of zones){
    const low = Number(z.low), high = Number(z.high);
    if(!Number.isFinite(low) || !Number.isFinite(high) || low >= high) continue;
    zi++;
    const label = String(z.label || "Zone").slice(0, 24);
    const isSupply = /عرضه|مقاومت|supply|resist/i.test(label);
    const bg = isSupply ? "rgba(255,77,77,0.12)" : "rgba(47,227,165,0.10)";
    const br = isSupply ? "rgba(255,77,77,0.55)" : "rgba(47,227,165,0.55)";

    annotations[`zone${zi}`] = {
      type: "box",
      xMin: startTs, xMax: endTs,
      yMin: low, yMax: high,
      backgroundColor: bg,
      borderColor: br,
      borderWidth: 1,
      label: {
        display: true,
        content: label,
        position: "center",
        color: "rgba(255,255,255,0.85)",
        font: { size: 10, weight: "bold" }
      }
    };
  }

  let li = 0;
  for(const l of lines){
    const price = Number(l.price);
    if(!Number.isFinite(price)) continue;
    li++;
    const label = String(l.label || "Level").slice(0, 24);

    const isStop = /حد ضرر|sl|stop/i.test(label);
    const isEntry = /ورود|entry/i.test(label);
    const isTarget = /هدف|tp|target/i.test(label);

    const color = isStop ? "rgba(255,77,77,0.8)" :
                  isTarget ? "rgba(47,227,165,0.8)" :
                  isEntry ? "rgba(0,209,255,0.8)" :
                  "rgba(255,255,255,0.6)";

    annotations[`line${li}`] = {
      type: "line",
      xMin: startTs, xMax: endTs,
      yMin: price, yMax: price,
      borderColor: color,
      borderWidth: 2,
      label: {
        display: true,
        content: `${label}: ${roundForChart(price)}`,
        position: "start",
        color: "rgba(255,255,255,0.85)",
        backgroundColor: "rgba(0,0,0,0.35)",
        font: { size: 10 }
      }
    };
  }

  return {
    type: "candlestick",
    data: { datasets: [{ label: `${symbol} ${timeframe}`, data }] },
    options: {
      parsing: false,
      plugins: {
        legend: { display: false },
        title: { display: true, text: `${symbol} · ${timeframe}` },
        annotation: { annotations }
      },
      scales: {
        x: {
          type: "time",
          time: { unit: timeframe === "D1" ? "day" : "hour" },
          ticks: { maxTicksLimit: 8 }
        },
        y: { position: "right", ticks: { maxTicksLimit: 8 } }
      }
    }
  };
}

async function buildQuickChartImageUrl(env, chartConfig){
  if(!chartConfig) return "";
  const width = toInt(env.CHART_WIDTH, 900);
  const height = toInt(env.CHART_HEIGHT, 520);
  const version = String(env.CHARTJS_VERSION || "4");

  // Optional short URL if QuickChart key is provided
  if(env.QUICKCHART_API_KEY){
    try{
      const r = await fetchWithTimeout("https://quickchart.io/chart/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: env.QUICKCHART_API_KEY,
          backgroundColor: "transparent",
          width,
          height,
          format: "png",
          version,
          chart: chartConfig,
        })
      }, 8000);
      const j = await r.json().catch(()=>null);
      const url = j?.url || j?.short_url;
      if(url) return String(url);
    }catch(e){
      console.error("quickchart create failed:", e?.message || e);
    }
  }

  const params = new URLSearchParams({
    version,
    width: String(width),
    height: String(height),
    format: "png",
    backgroundColor: "transparent",
    c: JSON.stringify(chartConfig),
  });
  return `https://quickchart.io/chart?${params.toString()}`;
}


/* ========================== QUIZ (LEVEL TEST) ========================== */
const QUIZ = [
  { q:"۱) حد ضرر (Stop Loss) برای چیست؟", options:{A:"محدود کردن ضرر",B:"افزایش سود",C:"دو برابر کردن حجم",D:"حذف کارمزد"}, correct:"A" },
  { q:"۲) ریسک به ریوارد 1:2 یعنی چه؟", options:{A:"ریسک دو برابر سود",B:"سود دو برابر ریسک",C:"هر دو برابر",D:"یعنی بدون ریسک"}, correct:"B" },
  { q:"۳) اگر سرمایه ۱۰۰۰ دلار و ریسک هر معامله ۱٪ باشد، حداکثر ضرر مجاز چقدر است؟", options:{A:"۱ دلار",B:"۱۰ دلار",C:"۱۰۰ دلار",D:"۵۰ دلار"}, correct:"B" },
  { q:"۴) در تایم‌فریم H4 هر کندل چند ساعت است؟", options:{A:"۱ ساعت",B:"۲ ساعت",C:"۴ ساعت",D:"۱۲ ساعت"}, correct:"C" },
  { q:"۵) لوریج (Leverage) چه ریسکی دارد؟", options:{A:"ریسک ندارد",B:"ریسک را کاهش می‌دهد",C:"می‌تواند ضرر را بزرگ‌تر کند",D:"فقط روی سود اثر دارد"}, correct:"C" },
];
function quizKeyboard(q){
  return kb([[`A) ${q.options.A}`,`B) ${q.options.B}`],[`C) ${q.options.C}`,`D) ${q.options.D}`],[BTN.BACK,BTN.HOME]]);
}
function parseQuizAnswer(text){
  const t=String(text||"").trim();
  if(t.startsWith("A)")) return "A";
  if(t.startsWith("B)")) return "B";
  if(t.startsWith("C)")) return "C";
  if(t.startsWith("D)")) return "D";
  if(["A","B","C","D"].includes(t.toUpperCase())) return t.toUpperCase();
  return null;
}
function scoreQuiz(answers){
  let score=0;
  for(let i=0;i<QUIZ.length;i++){ if(answers?.[i]===QUIZ[i].correct) score++; }
  return score;
}
async function evaluateLevelByAI(env, st){
  const answers = st.quiz?.answers || [];
  const score = scoreQuiz(answers);

  const prompt =
`تو ارزیاب تعیین‌سطح MarketiQ هستی. خروجی فقط JSON و فارسی.

ورودی‌ها:
- تجربه کاربر: ${st.experience||"-"}
- بازار مورد علاقه: ${st.preferredMarket||"-"}
- پاسخ‌ها (A/B/C/D): ${answers.join(",")}
- امتیاز خام: ${score} از ${QUIZ.length}

وظیفه:
1) سطح کاربر را تعیین کن: "مبتدی" یا "متوسط" یا "حرفه‌ای"
2) تنظیمات پیشنهادی:
   - timeframe یکی از: M15/H1/H4/D1
   - style یکی از: اسکالپ/سوئینگ/اسمارت‌مانی
   - risk یکی از: کم/متوسط/زیاد
3) یک بازار پیشنهادی: کریپتو/فارکس/فلزات/سهام
4) توضیح کوتاه 2-3 خطی.

فرمت خروجی:
{"level":"...","recommended":{"timeframe":"H4","style":"اسمارت‌مانی","risk":"متوسط","market":"فارکس"},"summary":"..."}`;

  try{
    const raw = await runTextProviders(prompt, env, st.textOrder);
    const j = safeJsonParse(raw);
    if(j && j.recommended) return { ok:true, j, score };
  } catch(e){ console.error("evaluateLevelByAI failed:", e?.message||e); }

  let level="مبتدی";
  if(score>=4) level="حرفه‌ای"; else if(score>=3) level="متوسط";
  const recommended = {
    timeframe: level==="مبتدی" ? "H4" : (level==="متوسط" ? "H1" : "M15"),
    style: level==="حرفه‌ای" ? "اسکالپ" : "اسمارت‌مانی",
    risk: level==="مبتدی" ? "کم" : (level==="متوسط" ? "متوسط" : "زیاد"),
    market: st.preferredMarket || "فارکس"
  };
  const summary = `سطح تقریبی بر اساس امتیاز: ${score}/${QUIZ.length}`;
  return { ok:true, j:{ level, recommended, summary }, score };
}

/* ========================== UPDATE HANDLER ========================== */
async function handleUpdate(update, env){
  try{
    // callback buttons (payments)
    if(update && update.callback_query){
      const cq = update.callback_query;
      const from = cq.from || {};
      const data = String(cq.data||"");
      const chatId = cq.message && cq.message.chat && cq.message.chat.id;
      const cqid = cq.id;
      try{
        if(data.startsWith("PAY1:")){
          const tx = data.slice(5);
          if(!isManagerL1(env, from.id)){
            await tgAnswerCallbackQuery(env, cqid, "دسترسی کافی نداری.");
          }else{
            const r = await markPaymentStage(env, tx, "pending_l2", from.id);
            if(!r) await tgAnswerCallbackQuery(env, cqid, "پرداخت پیدا نشد.");
            else{
              // notify L2 with buttons
              for(const mid of managerL2Targets(env)){
                await tgSendMessage(env, mid,
                  `✅ تایید مرحله ۱\nTxID=${r.txid}\nuser=${r.userId}\namount=${r.amount} ${r.currency}\n\nبرای تایید نهایی یا رد، از دکمه‌ها استفاده کن:`,
                  { inline_keyboard: [[
                    { text:"✅ تایید نهایی", callback_data:`PAY2:${r.txid}` },
                    { text:"❌ رد", callback_data:`PAYREJ:${r.txid}` }
                  ]] }
                ).catch(()=>{});
              }
              if(chatId) await tgSendMessage(env, chatId, "مرحله ۱ تایید شد و برای مدیر سطح ۲ ارسال شد.", mainMenuKeyboard(env)).catch(()=>{});
              await tgAnswerCallbackQuery(env, cqid, "مرحله ۱ تایید شد.");
            }
          }
        }else if(data.startsWith("PAY2:")){
          const tx = data.slice(5);
          if(!isManagerL2(env, from.id)){
            await tgAnswerCallbackQuery(env, cqid, "دسترسی کافی نداری.");
          }else{
            const r = await markPaymentApproved(env, tx, from.id);
            if(!r) await tgAnswerCallbackQuery(env, cqid, "پرداخت پیدا نشد.");
            else{
              await tgSendMessage(env, r.userId, `✅ پرداخت تایید شد. اشتراک شما فعال شد (${r.days} روز).`).catch(()=>{});
              if(chatId) await tgSendMessage(env, chatId, "تایید نهایی انجام شد و اشتراک فعال شد.", mainMenuKeyboard(env)).catch(()=>{});
              await tgAnswerCallbackQuery(env, cqid, "تایید شد.");
            }
          }
        }else if(data.startsWith("PAYREJ:")){
          const tx = data.slice(7);
          if(!isManagerL1(env, from.id) && !isManagerL2(env, from.id)){
            await tgAnswerCallbackQuery(env, cqid, "دسترسی کافی نداری.");
          }else{
            const r = await markPaymentRejected(env, tx, from.id);
            if(!r) await tgAnswerCallbackQuery(env, cqid, "پرداخت پیدا نشد.");
            else{
              await tgSendMessage(env, r.userId, `❌ پرداخت شما رد شد. اگر فکر می‌کنی اشتباه شده، از پشتیبانی تیکت بزن.`).catch(()=>{});
              if(chatId) await tgSendMessage(env, chatId, "پرداخت رد شد.", mainMenuKeyboard(env)).catch(()=>{});
              await tgAnswerCallbackQuery(env, cqid, "رد شد.");
            }
          }
        }else{
          await tgAnswerCallbackQuery(env, cqid, "OK");
        }
      }catch(_e){
        await tgAnswerCallbackQuery(env, cqid, "خطا");
      }
      return;
    }

    const msg = update.message;
    if(!msg) return;
    const chatId = msg.chat?.id;
    const from = msg.from;
    const userId = from?.id;
    if(!chatId || !userId) return;

    const st = await ensureUser(userId, env, { username: from?.username || "" });
    let dirtyMeta = false;
    if(chatId && String(st.chatId||"") !== String(chatId)){
      st.chatId = chatId;
      dirtyMeta = true;
    }
    // username is mostly handled in ensureUser, but keep as safety
    if(from?.username){
      const u = String(from.username||"").trim();
      if(u && st.username !== u){
        st.username = u;
        dirtyMeta = true;
      }
    }
    if(dirtyMeta) await saveUser(userId, st, env);

    // Contact share first (needed for referral acceptance)
    if(msg.contact){
      await handleContactShare(env, chatId, from, st, msg.contact);
      return;
    }

    // Vision (image)
    const imageFileId = extractImageFileId(msg, env);
    if(imageFileId){
      if(!isOnboardComplete(st)){
        await tgSendMessage(env, chatId, "برای استفاده از تحلیل (ویژن)، ابتدا پروفایل را تکمیل کن: نام + شماره ✅", mainMenuKeyboard(env));
        await startOnboardingIfNeeded(env, chatId, from, st);
        return;
      }
      await handleVisionFlow(env, chatId, from, userId, st, imageFileId);
      return;
    }

    const text = (msg.text || "").trim();
    const { cmd, arg } = parseCommand(text);

    if(cmd==="/start" || cmd==="/menu"){
      if(arg) await attachReferralIfAny(st, arg, env);
      st.state="idle"; st.selectedSymbol=""; st.quiz={active:false, idx:0, answers:[]};
      await saveUser(userId, st, env);
      await tgSendMessage(env, chatId, WELCOME_TEXT, mainMenuKeyboard(env));
      await startOnboardingIfNeeded(env, chatId, from, st);
      return;
    }

    if(cmd==="/signals" || cmd==="/signal" || cmd==="/analysis" || text===BTN.SIGNALS){
  if(!isOnboardComplete(st)){
    await tgSendMessage(env, chatId, "برای دریافت سیگنال/تحلیل، ابتدا پروفایل را تکمیل کن ✅", mainMenuKeyboard(env));
    await startOnboardingIfNeeded(env, chatId, from, st);
    return;
  }
  st.state="choose_symbol";
  st.selectedSymbol="";
  await saveUser(userId, st, env);
  return tgSendMessage(env, chatId, "🧭 مرحله ۱: بازار را انتخاب کن:", signalsMenuKeyboard(env));
}

    
    if(cmd==="/owner" || text===BTN.OWNER){
      if(!isOwner(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی نداری.", mainMenuKeyboard(env));

      if(!hasD1(env)){
        return tgSendMessage(env, chatId, "⚠️ برای گزارش‌های اونر، D1 لازم است.", mainMenuKeyboard(env));
      }

      await ensureD1Schema(env);

      const userCount = (await env.BOT_DB.prepare("SELECT COUNT(1) AS c FROM users").first())?.c || 0;
      const phoneCount = (await env.BOT_DB.prepare("SELECT COUNT(1) AS c FROM phone_index").first())?.c || 0;
      const payCount = (await env.BOT_DB.prepare("SELECT COUNT(1) AS c FROM payments").first().catch(()=>({c:0})))?.c || 0;

      const phones = await env.BOT_DB.prepare("SELECT phone, user_id, created_at FROM phone_index ORDER BY created_at DESC LIMIT 25").all().catch(()=>({results:[]}));
      const pays = await env.BOT_DB.prepare("SELECT txid, status, created_at FROM payments ORDER BY created_at DESC LIMIT 25").all().catch(()=>({results:[]}));

      const phoneLines = (phones.results||[]).map(r=>`• ${r.phone}  |  user=${r.user_id}  |  ${r.created_at||""}`).join("\n") || "—";
      const payLines = (pays.results||[]).map(r=>`• ${r.txid}  |  ${r.status||""}  |  ${r.created_at||""}`).join("\n") || "—";

      const msg =
`👑 گزارش اونر
👤 کاربران: ${userCount}
📞 شماره‌ها: ${phoneCount}
💳 تراکنش‌ها: ${payCount}

📞 آخرین شماره‌ها:
${phoneLines}

💳 آخرین تراکنش‌ها:
${payLines}`;
      return tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
    }

if(cmd==="/settings" || text===BTN.SETTINGS){
      return sendSettingsSummary(env, chatId, st, from);
    }

    if(cmd==="/profile" || text===BTN.PROFILE){
      return tgSendMessage(env, chatId, await profileText(st, from, env), mainMenuKeyboard(env));
    }

    
    // Managers payment approvals (two-step)
    if(cmd==="/pay1" || cmd==="/pay2" || cmd==="/payreject"){
      const tx = (arg||"").trim();
      if(!tx) return tgSendMessage(env, chatId, "فرمت درست: /pay1 TXID  یا /pay2 TXID  یا /payreject TXID", mainMenuKeyboard(env));
      if(cmd==="/pay1"){
        if(!isManagerL1(env, from.id)) return tgSendMessage(env, chatId, "دسترسی کافی نداری.", mainMenuKeyboard(env));
        const r = await markPaymentStage(env, tx, "pending_l2", from.id);
        if(!r) return tgSendMessage(env, chatId, "پرداخت پیدا نشد.", mainMenuKeyboard(env));
        // notify L2 managers
        for(const mid of managerL2Targets(env)){
          await tgSendMessage(env, mid,
            `✅ تایید مرحله ۱\nTxID=${r.txid}\nuser=${r.userId}\namount=${r.amount} ${r.currency}\n\nبرای تایید نهایی یا رد، از دکمه‌ها استفاده کن:`,
            { inline_keyboard: [[
              { text:"✅ تایید نهایی", callback_data:`PAY2:${r.txid}` },
              { text:"❌ رد", callback_data:`PAYREJ:${r.txid}` }
            ]] }
          ).catch(()=>{});
        }
        return tgSendMessage(env, chatId, "مرحله ۱ تایید شد و برای مدیر سطح ۲ ارسال شد.", mainMenuKeyboard(env));
      }
      if(cmd==="/pay2"){
        if(!isManagerL2(env, from.id)) return tgSendMessage(env, chatId, "دسترسی کافی نداری.", mainMenuKeyboard(env));
        const r = await markPaymentApproved(env, tx, from.id); // final approve + activate sub + commission record
        if(!r) return tgSendMessage(env, chatId, "پرداخت پیدا نشد.", mainMenuKeyboard(env));
        await tgSendMessage(env, r.userId, `✅ پرداخت تایید شد. اشتراک شما فعال شد (${r.days} روز).`).catch(()=>{});
        return tgSendMessage(env, chatId, "تایید نهایی انجام شد و اشتراک فعال شد.", mainMenuKeyboard(env));
      }
      if(cmd==="/payreject"){
        if(!isManagerL1(env, from.id) && !isManagerL2(env, from.id)) return tgSendMessage(env, chatId, "دسترسی کافی نداری.", mainMenuKeyboard(env));
        const r = await markPaymentRejected(env, tx, from.id);
        if(!r) return tgSendMessage(env, chatId, "پرداخت پیدا نشد.", mainMenuKeyboard(env));
        await tgSendMessage(env, r.userId, `❌ پرداخت شما رد شد. اگر فکر می‌کنید اشتباه شده، به پشتیبانی پیام بدهید.\nTxID=${r.txid}`).catch(()=>{});
        return tgSendMessage(env, chatId, "رد شد.", mainMenuKeyboard(env));
      }
    }
if(cmd==="/buy" || cmd==="/pay" || text===BTN.BUY){
      await sendBuyInfo(env, chatId, from, st);
      return;
    }

    if(cmd==="/price"){
      const p = await getSubPrice(env);
      const c = await getSubCurrency(env);
      const d = await getSubDays(env);
      const msg = (p && p > 0)
        ? `💳 قیمت اشتراک: ${p} ${c} | مدت: ${d} روز`
        : "💳 قیمت اشتراک هنوز توسط مدیریت تعیین نشده است.";
      return tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
    }

    if(cmd==="/setprice"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      await handleSetPrice(env, chatId, arg);
      return;
    }

    // Global limits (Admin/Owner)
    if(cmd==="/setfreelimit"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/setfreelimit 5", mainMenuKeyboard(env));
      try{
        const n = await setFreeDailyLimit(env, arg);
        return tgSendMessage(env, chatId, `✅ سقف استفاده رایگان روزانه تنظیم شد: ${n}`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "عدد نامعتبر است.", mainMenuKeyboard(env));
      }
    }
    if(cmd==="/setsublimit"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/setsublimit 50", mainMenuKeyboard(env));
      try{
        const n = await setSubDailyLimit(env, arg);
        return tgSendMessage(env, chatId, `✅ سقف استفاده اشتراک روزانه تنظیم شد: ${n}`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "عدد نامعتبر است.", mainMenuKeyboard(env));
      }
    }

    // Payment TxID submission (User)
    if(cmd==="/tx"){
      if(!isOnboardComplete(st)){
        await tgSendMessage(env, chatId, "برای ثبت TxID ابتدا پروفایل را تکمیل کن (نام + شماره).", mainMenuKeyboard(env));
        await startOnboardingIfNeeded(env, chatId, from, st);
        return;
      }
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/tx YOUR_TXID", mainMenuKeyboard(env));
      try{
        const rec = await createPendingPayment(env, userId, arg);
        await tgSendMessage(env, chatId, "✅ TxID ثبت شد. پس از بررسی، اشتراک فعال می‌شود.", mainMenuKeyboard(env));

        // Notify admins/owner (USER IDs)
        const targets = managerL1Targets(env);
        for(const a of targets){
          await tgSendMessage(env, a, `💳 پرداخت جدید (مرحله ۱)
user=${userId}
TxID=${rec.txid}
amount=${rec.amount} ${rec.currency}
days=${rec.days}`, null).catch(()=>{});
        }
return;
      }catch(e){
        const msg = (e?.message === "txid_exists") ? "این TxID قبلاً ثبت شده است." : "ثبت TxID انجام نشد. لطفاً دوباره بررسی کن.";
        return tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
      }
    }

    // Admin/Owner: pending payments
    if(cmd==="/payments"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      try{
        const res = await listPendingPayments(env, 20);
        if(!res.items.length) return tgSendMessage(env, chatId, "✅ پرداخت در انتظار نداریم.", mainMenuKeyboard(env));
        const lines = res.items.map(x => `• ${x.txid} | user=${x.userId} | ${x.amount} ${x.currency} | ${x.days}d`).join("\n");
        return tgSendMessage(env, chatId, `💳 پرداخت‌های در انتظار:\n${lines}\n\nبرای تایید: /approve TXID\nبرای رد: /reject TXID`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "فعلاً امکان نمایش پرداخت‌ها نیست.", mainMenuKeyboard(env));
      }
    }
    if(cmd==="/approve"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/approve TXID", mainMenuKeyboard(env));
      try{
        const rec = await markPaymentApproved(env, arg, userId);
        await tgSendMessage(env, chatId, `✅ تایید شد: ${rec.txid}\nاشتراک کاربر فعال شد.`, mainMenuKeyboard(env));
        await tgSendMessage(env, rec.userId, `✅ پرداخت تایید شد. اشتراک شما فعال شد (${rec.days} روز).`).catch(()=>{});
        return;
      }catch(e){
        return tgSendMessage(env, chatId, "تایید انجام نشد (TxID پیدا نشد یا مشکل داده).", mainMenuKeyboard(env));
      }
    }
    if(cmd==="/reject"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/reject TXID", mainMenuKeyboard(env));
      try{
        const rec = await markPaymentRejected(env, arg, userId);
        await tgSendMessage(env, chatId, `🚫 رد شد: ${rec.txid}`, mainMenuKeyboard(env));
        await tgSendMessage(env, rec.userId, "🚫 پرداخت شما رد شد. اگر اشتباه شده، با پشتیبانی تماس بگیرید.").catch(()=>{});
        return;
      }catch(_e){
        return tgSendMessage(env, chatId, "رد انجام نشد (TxID پیدا نشد).", mainMenuKeyboard(env));
      }
    }

    // Admin: generate 5 referral codes for a user
    if(cmd==="/refgen"){
      if(!isAdmin(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین می‌تواند رفرال بسازد.", mainMenuKeyboard(env));
      const targetId = arg || String(userId);
      try{
        const codes = await adminGenerateRefCodes(env, targetId, 5);
        const botUsername = (env.BOT_USERNAME||"").toString().replace(/^@/,"").trim();
        const links = botUsername ? codes.map(c=>`https://t.me/${botUsername}?start=${c}`).join("\n") : codes.join("\n");
        return tgSendMessage(env, chatId, `✅ 5 رفرال ساخته شد برای user=${targetId}:\n\n${links}`, mainMenuKeyboard(env));
      }catch(_e){
        return tgSendMessage(env, chatId, "ساخت رفرال انجام نشد. مطمئن شو userId درست است و KV فعال است.", mainMenuKeyboard(env));
      }
    }

    if(cmd==="/support" || text===BTN.SUPPORT){
      return tgSendMessage(env, chatId,
        "🆘 پشتیبانی برای ارسال درخواست پشتیبانی، تیکت ثبت کن.✅ پاسخ از طریق همین بات ارسال می‌شود.",
        kb([[BTN.SUPPORT_NEW_TICKET],[BTN.SUPPORT_STATUS],[BTN.BACK,BTN.HOME]])
      );
    }

    if(text===BTN.SUPPORT_NEW_TICKET){
      st.state="support_ticket_text";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🎫 متن تیکت را بنویس (حداقل ۱۰ کاراکتر):", kb([[BTN.BACK,BTN.HOME]]));
    }
    if(text===BTN.SUPPORT_STATUS || cmd==="/tickets"){
      const res = await listTickets(env, {userId});
      if(!res.ok){
        return tgSendMessage(env, chatId, "⚠️ برای مشاهده وضعیت تیکت‌ها، دیتابیس (D1) باید فعال باشد.", mainMenuKeyboard(env));
      }
      const items = res.items || [];
      if(!items.length) return tgSendMessage(env, chatId, "📌 هنوز تیکتی ثبت نکردی.", mainMenuKeyboard(env));
      const lines = items.slice(0,10).map((t,i)=>`${i+1}) ${t.id} | ${t.status} | ${t.createdAt}`);
      return tgSendMessage(env, chatId, "📌 وضعیت تیکت‌ها:" + lines.join(""), mainMenuKeyboard(env));
    }

    if(cmd==="/education" || text===BTN.EDUCATION){
      return tgSendMessage(env, chatId, "📚 آموزش (نسخه MVP)\n\nبه‌زودی: مفاهیم مدیریت ریسک، ساختار مارکت، اسمارت‌مانی و …", mainMenuKeyboard(env));
    }


if(cmd==="/customprompt" || cmd==="/prompt"){
  if(!isOnboardComplete(st)){
    await tgSendMessage(env, chatId, "برای درخواست پرامپت اختصاصی، ابتدا پروفایل را تکمیل کن ✅", mainMenuKeyboard(env));
    await startOnboardingIfNeeded(env, chatId, from, st);
    return;
  }
  st.state="custom_prompt_style";
  await saveUser(userId, st, env);
  return tgSendMessage(env, chatId,
    "🧠 درخواست پرامپت اختصاصی مرحله ۱/۲: سبک معامله‌ات را بنویس (مثلاً: اسمارت‌مانی، RTM، پرایس‌اکشن…):",
    kb([[BTN.BACK, BTN.HOME]])
  );
}


    if(cmd==="/wallet"){
      const w = await getWallet(env);
      if(!w) return tgSendMessage(env, chatId, "فعلاً آدرس ولت تنظیم نشده است.", mainMenuKeyboard(env));
      return tgSendMessage(env, chatId, `💳 آدرس ولت MarketiQ:\n\n\`${w}\``, mainMenuKeyboard(env));
    }

    if(cmd==="/redeem"){
      await redeemPointsForSubscription(env, chatId, from, st);
      return;
    }

    if(cmd==="/ref" || text===BTN.REFERRAL){
      await sendReferralInfo(env, chatId, from, st);
      return;
    }

    // Admin/Owner views
    if(cmd==="/users"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      await adminListUsers(env, chatId);
      return;
    }
    if(cmd==="/user"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      await adminShowUser(env, chatId, arg, from);
      return;
    }

    // Only ADMIN can set wallet
    if(cmd==="/setwallet"){
      if(!isAdmin(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین می‌تواند آدرس ولت را تعیین کند.", mainMenuKeyboard(env));
      if(!arg) return tgSendMessage(env, chatId, "فرمت:\n/setwallet WALLET_ADDRESS", mainMenuKeyboard(env));
      await setWallet(env, arg, from);
      return tgSendMessage(env, chatId, "✅ آدرس ولت ذخیره شد.", mainMenuKeyboard(env));
    }

// Set per-user referral commission percent override (Admin/Owner)
// Usage: /setrefpct <userId> <percent>
// Example: /setrefpct 123456789 30
// Clear override: /setrefpct 123456789 0  (falls back to default percent)
if(cmd==="/setrefpct"){
  if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
  const parts = String(arg||"").trim().split(/\s+/).filter(Boolean);
  if(parts.length < 2){
    return tgSendMessage(env, chatId,
      "فرمت:\n/setrefpct <userId> <percent>\nمثال:\n/setrefpct 123456789 30\nبرای حذف Override:\n/setrefpct 123456789 0",
      mainMenuKeyboard(env)
    );
  }
  const targetId = parts[0];
  const pct = Number(parts[1]);
  if(!Number.isFinite(pct) || pct < 0 || pct > 100){
    return tgSendMessage(env, chatId, "درصد نامعتبر است (0..100).", mainMenuKeyboard(env));
  }
  const target = patchUser((await getUser(targetId, env))||{}, targetId);
  target.refCommissionPctOverride = (pct === 0) ? null : pct;
  await saveUser(targetId, target, env);
  return tgSendMessage(env, chatId, `✅ تنظیم شد.\nuser=${targetId}\noverride=${pct===0?"(cleared → default)":pct+"%"}`, mainMenuKeyboard(env));
}


    // Prompts only Admin/Owner
    if(cmd==="/setprompt"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند پرامپت را تعیین کند.", mainMenuKeyboard(env));
      st.state="admin_set_prompt"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "متن پرامپت تحلیل را همینجا ارسال کن (می‌تواند چندخطی باشد).", kb([[BTN.BACK,BTN.HOME]]));
    }
    if(cmd==="/setvisionprompt"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ فقط ادمین/اونر می‌تواند پرامپت ویژن را تعیین کند.", mainMenuKeyboard(env));
      st.state="admin_set_vision_prompt"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "متن پرامپت ویژن را همینجا ارسال کن (می‌تواند چندخطی باشد).", kb([[BTN.BACK,BTN.HOME]]));
    }
    if(cmd==="/getprompt"){
      if(!isPrivileged(from, env)) return tgSendMessage(env, chatId, "⛔️ دسترسی ندارید.", mainMenuKeyboard(env));
      const p = await getAnalysisPromptTemplate(env);
      return tgSendMessage(env, chatId, p ? `📌 پرامپت فعلی:\n\n${p}` : "پرامپت سفارشی تنظیم نشده؛ از پیش‌فرض استفاده می‌شود.", mainMenuKeyboard(env));
    }

    // Back/Home
    if(text === BTN.MINIAPP){
      const url = getMiniappUrl(env);
      if(url){
        return tgSendMessage(env, chatId, "🔗 برای باز کردن مینی‌اپ روی دکمه زیر بزن:", {
          reply_markup: {
            inline_keyboard: [[{ text: "باز کردن مینی‌اپ", web_app: { url } }]]
          }
        });
      }
      return tgSendMessage(env, chatId, "⚠️ لینک مینی‌اپ تنظیم نشده. لطفاً PUBLIC_BASE_URL یا MINIAPP_URL را تنظیم کن.", mainMenuKeyboard(env));
    }


    if(text===BTN.HOME){
      st.state="idle"; st.selectedSymbol=""; st.quiz={active:false, idx:0, answers:[]};
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }
    if(text===BTN.BACK){
      if(st.state==="choose_style"){ st.state="choose_symbol"; st.selectedSymbol=""; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "🧭 مرحله ۱: بازار را انتخاب کن:", signalsMenuKeyboard(env)); }
      if(st.state.startsWith("set_")){ st.state="idle"; await saveUser(userId, st, env); return sendSettingsSummary(env, chatId, st, from); }
      if(st.state.startsWith("onboard_") || st.quiz?.active){ st.state="idle"; st.quiz={active:false, idx:0, answers:[]}; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "متوقف شد. هر زمان خواستی دوباره از 🧪 تعیین سطح استفاده کن.", mainMenuKeyboard(env)); }
      if(st.state.startsWith("admin_set_")){ st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "لغو شد.", mainMenuKeyboard(env)); }
      return tgSendMessage(env, chatId, "🏠 منوی اصلی:", mainMenuKeyboard(env));
    }

    // Admin prompt states
    if(st.state==="admin_set_prompt"){
      const p = String(text||"").trim();
      if(!p) return tgSendMessage(env, chatId, "متن خالی است. دوباره ارسال کن یا ⬅️ برگشت.", kb([[BTN.BACK,BTN.HOME]]));
      await setAnalysisPromptTemplate(env, p);
      st.state="idle"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ پرامپت تحلیل ذخیره شد.", mainMenuKeyboard(env));
    }
    if(st.state==="admin_set_vision_prompt"){
      const p = String(text||"").trim();
      if(!p) return tgSendMessage(env, chatId, "متن خالی است. دوباره ارسال کن یا ⬅️ برگشت.", kb([[BTN.BACK,BTN.HOME]]));
      await setVisionPromptTemplate(env, p);
      st.state="idle"; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ پرامپت ویژن ذخیره شد.", mainMenuKeyboard(env));
    }

    // Onboarding
    if(st.state==="onboard_name"){
      const name = String(text||"").trim();
      if(name.length < 2) return tgSendMessage(env, chatId, "اسم کوتاه است. لطفاً نام خود را ارسال کن.", kb([[BTN.BACK,BTN.HOME]]));
      st.profileName = name.slice(0,48);
      st.state="onboard_contact";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "✅ ثبت شد.\n\nحالا لطفاً شماره‌ات را با دکمه زیر Share کن:", requestContactKeyboard(env));
    }
    if(st.state==="onboard_experience"){
      const exp = String(text||"").trim();
      if(!["مبتدی","متوسط","حرفه‌ای"].includes(exp)) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"]));
      st.experience = exp;
      st.state="onboard_market";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "کدام بازار برایت مهم‌تر است؟", optionsKeyboard(["کریپتو","فارکس","فلزات","سهام"]));
    }
    if(st.state==="onboard_market"){
      const m = String(text||"").trim();
      if(!["کریپتو","فارکس","فلزات","سهام"].includes(m)) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["کریپتو","فارکس","فلزات","سهام"]));
      st.preferredMarket = m;
      await saveUser(userId, st, env);
      await startQuiz(env, chatId, st);
      return;
    }

    if(st.state==="custom_prompt_style"){
      const s = String(text||"").trim();
      if(s===BTN.BACK){ st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "بازگشت.", mainMenuKeyboard(env)); }
      if(s.length < 2) return tgSendMessage(env, chatId, "لطفاً سبک معامله را واضح‌تر بنویس:", kb([[BTN.BACK,BTN.HOME]]));
      st.customPromptStyle = s;
      st.state="custom_prompt_strategy";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId,
        "مرحله ۲/۲: استراتژی/قوانین و جزئیات را بنویس (حداقل ۱۰ کاراکتر):",
        kb([[BTN.BACK,BTN.HOME]])
      );
    }

    if(st.state==="custom_prompt_strategy"){
      const desc = String(text||"").trim();
      if(desc===BTN.BACK){ st.state="custom_prompt_style"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "مرحله ۱/۲: سبک معامله را بنویس:", kb([[BTN.BACK,BTN.HOME]])); }
      if(desc.length < 10) return tgSendMessage(env, chatId, "متن کوتاه است. لطفاً دقیق‌تر توضیح بده (حداقل ۱۰ کاراکتر):", kb([[BTN.BACK,BTN.HOME]]));
      if(desc.length > 3000) return tgSendMessage(env, chatId, "متن خیلی طولانی است (حداکثر 3000 کاراکتر).", kb([[BTN.BACK,BTN.HOME]]));

      const styleText = String(st.customPromptStyle||"").trim();
      const genPrompt =
`You are an expert trading prompt engineer.
Create a concise, high-quality ANALYSIS PROMPT in Persian that the bot can prepend as STYLE_GUIDE.
The prompt must be actionable and structured.
It must enforce: no hallucination, rely ONLY on OHLC data provided.
It must request: market structure, bias, key levels, supply/demand zones, entry/SL/TP plan, invalidation.
User trading style: ${styleText}
User strategy details:
${desc}`;

      let generated = "";
      try{
        generated = await runTextProviders(genPrompt, env, st.textOrder);
      }catch(_e){
        generated =
`پرامپت اختصاصی (پیش‌فرض)
- تحلیل را فقط بر اساس OHLC انجام بده.
- ساختار/بایاس/سطوح کلیدی/زون‌ها را بده.
- پلن معامله: ورود/ابطال/حدضرر/تارگت‌ها.
- از حدس و اطلاعات خارج از داده‌ها خودداری کن.`;
      }

      st.customPromptDesc = desc;
      st.customPromptText = String(generated||"").trim();
      st.customPromptRequestedAt = new Date().toISOString();
      st.customPromptReadyAt = new Date(Date.now() + CUSTOM_PROMPT_DELAY_MS).toISOString();
      st.customPromptDeliveredAt = "";
      st.state="idle";
      await saveUser(userId, st, env);

      return tgSendMessage(env, chatId,
        "✅ درخواست شما ثبت شد.\n\n⏳ کارشناسان ما در حال ساخت پرامپت شما هستند.\n🕒 حدوداً ۲ ساعت دیگر نتیجه در همین چت ارسال می‌شود.",
        mainMenuKeyboard(env)
      );
    }




    if(st.state==="support_ticket_text"){
      const msg = String(text||"").trim();
      if(msg === BTN.BACK){ st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "بازگشت.", mainMenuKeyboard(env)); }
      if(msg.length < 10) return tgSendMessage(env, chatId, "متن تیکت کوتاه است. لطفاً حداقل ۱۰ کاراکتر بنویس:", kb([[BTN.BACK,BTN.HOME]]));
      if(msg.length > 2000) return tgSendMessage(env, chatId, "متن تیکت خیلی طولانی است (حداکثر 2000 کاراکتر).", kb([[BTN.BACK,BTN.HOME]]));
      const r = await createTicket(env, {userId, chatId, message: msg});
      st.state="idle";
      await saveUser(userId, st, env);
      if(!r.ok){
        return tgSendMessage(env, chatId, "⚠️ ثبت تیکت ممکن نیست (D1 فعال نیست).", mainMenuKeyboard(env));
      }
      return tgSendMessage(env, chatId, `✅ تیکت شما ثبت شد.\nکد پیگیری: ${r.id}\nوضعیت: ${r.status}`, mainMenuKeyboard(env));
    }

    // Quiz
    if(st.quiz?.active){
      const ans = parseQuizAnswer(text);
      if(!ans){
        const q = QUIZ[st.quiz.idx] || QUIZ[0];
        return tgSendMessage(env, chatId, "لطفاً یکی از گزینه‌های A/B/C/D را انتخاب کن.", quizKeyboard(q));
      }
      st.quiz.answers[st.quiz.idx] = ans;
      st.quiz.idx += 1;

      if(st.quiz.idx >= QUIZ.length){
        st.quiz.active=false;
        st.state="idle";
        await saveUser(userId, st, env);

        await tgSendMessage(env, chatId, "⏳ در حال تحلیل نتیجه تعیین سطح…", kb([[BTN.HOME]]));
        const t = stopToken();
        const typingTask = typingLoop(env, chatId, t);

        try{
          const evalRes = await evaluateLevelByAI(env, st);
          const rec = evalRes.j.recommended || {};
          st.level = evalRes.j.level || "متوسط";
          st.levelScore = evalRes.score;
          st.levelSummary = String(evalRes.j.summary || "").slice(0,800);
          st.suggestedMarket = String(rec.market || st.preferredMarket || "").trim();

          st.timeframe = sanitizeTimeframe(rec.timeframe) || st.timeframe;
          st.style = sanitizeStyle(rec.style) || st.style;
          st.risk = sanitizeRisk(rec.risk) || st.risk;

          await saveUser(userId, st, env);

          t.stop=true;
          await Promise.race([typingTask, sleep(10)]).catch(()=>{});

          const msgTxt =
`✅ نتیجه تعیین سطح MarketiQ

👤 نام: ${st.profileName || "-"}
📌 سطح: ${st.level}  (امتیاز: ${st.levelScore}/${QUIZ.length})
🎯 بازار پیشنهادی: ${st.suggestedMarket || "-"}

⚙️ تنظیمات پیشنهادی اعمال شد:
⏱ تایم‌فریم: ${st.timeframe}
🎯 سبک: ${st.style}
⚠️ ریسک: ${st.risk}

📝 توضیح:
${st.levelSummary || "—"}

اگر خواستی دوباره تعیین سطح بدی: /level`;

          await tgSendMessage(env, chatId, msgTxt, mainMenuKeyboard(env));
          return;
        } catch(e){
          console.error("quiz finalize error:", e);
          t.stop=true;
          await tgSendMessage(env, chatId, "⚠️ خطا در تعیین سطح. دوباره تلاش کن: /level", mainMenuKeyboard(env));
          return;
        }
      } else {
        await saveUser(userId, st, env);
        const q = QUIZ[st.quiz.idx];
        return tgSendMessage(env, chatId, q.q, quizKeyboard(q));
      }
    }

    // Categories
    if(text===BTN.CAT_MAJORS) return tgSendMessage(env, chatId, "💱 جفت‌ارزها (Forex):", listKeyboard(MAJORS, 2, env));
    if(text===BTN.CAT_METALS) return tgSendMessage(env, chatId, "🪙 فلزات:", listKeyboard(METALS, 2, env));
    if(text===BTN.CAT_INDICES) return tgSendMessage(env, chatId, "📊 شاخص‌ها:", listKeyboard(INDICES, 2, env));
    if(text===BTN.CAT_STOCKS) return tgSendMessage(env, chatId, "📈 سهام:", listKeyboard(STOCKS, 2, env));
    if(text===BTN.CAT_CRYPTO) return tgSendMessage(env, chatId, "₿ کریپتو:", listKeyboard(CRYPTOS, 2, env));

    // Requests to admins
    if(text===BTN.REQUEST_SETTINGS){
      await requestToAdmins(env, st, `درخواست تغییر تنظیمات از کاربر: ${st.profileName||"-"} (ID:${st.userId})`);
      return tgSendMessage(env, chatId, "✅ درخواست شما برای ادمین/اونر ارسال شد.", mainMenuKeyboard(env));
    }
    if(text===BTN.REQUEST_RELEVEL){
      await requestToAdmins(env, st, `درخواست تعیین سطح مجدد از کاربر: ${st.profileName||"-"} (ID:${st.userId})`);
      return tgSendMessage(env, chatId, "✅ درخواست شما برای بررسی سطح ارسال شد.", mainMenuKeyboard(env));
    }

    // Settings menu actions
    if(text===BTN.SET_TF){ st.state="set_tf"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "⏱ تایم‌فریم:", optionsKeyboard(["M15","H1","H4","D1"])); }
    if(text===BTN.SET_STYLE){
  st.state="set_style";
  await saveUser(userId, st, env);
  const cat = await getStyleCatalog(env);
  const labels = (cat.items||[]).filter(x=>x && x.enabled!==false).map(x=>String(x.label||"").trim()).filter(Boolean);
  if(!labels.length){ return tgSendMessage(env, chatId, "⚠️ هیچ سبک فعالی توسط ادمین تنظیم نشده است. لطفاً بعداً تلاش کن یا از ادمین بخواه سبک اضافه کند.", mainMenuKeyboard(env)); }
  return tgSendMessage(env, chatId, "🎯 سبک:", optionsKeyboard(labels));
}
    if(text===BTN.SET_RISK){ st.state="set_risk"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "⚠️ ریسک:", optionsKeyboard(["کم","متوسط","زیاد"])); }
    if(text===BTN.SET_NEWS){ st.state="set_news"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "📰 خبر:", optionsKeyboard(["روشن ✅","خاموش ❌"])); }

    if(st.state==="set_tf"){ const tf=sanitizeTimeframe(text); if(!tf) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["M15","H1","H4","D1"])); st.timeframe=tf; st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ تایم‌فریم: ${st.timeframe}`, mainMenuKeyboard(env)); }
    if(st.state==="set_style"){
      const v = sanitizeStyle(text);
      if(!v){
        const cat = await getStyleCatalog(env);
        const labels = (cat.items||[]).filter(x=>x && x.enabled!==false).map(x=>String(x.label||"").trim()).filter(Boolean);
        if(!labels.length) return tgSendMessage(env, chatId, "⚠️ هیچ سبک فعالی توسط ادمین تنظیم نشده است.", mainMenuKeyboard(env));
        return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(labels));
      }
      st.style = v;
      st.state="idle";
      await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, `✅ سبک: ${st.style}`, mainMenuKeyboard(env));
    }
    if(st.state==="set_risk"){ const v=sanitizeRisk(text); if(!v) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["کم","متوسط","زیاد"])); st.risk=v; st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ ریسک: ${st.risk}`, mainMenuKeyboard(env)); }
    if(st.state==="set_news"){ const v=sanitizeNewsChoice(text); if(v===null) return tgSendMessage(env, chatId, "یکی از گزینه‌ها را انتخاب کن:", optionsKeyboard(["روشن ✅","خاموش ❌"])); st.newsEnabled=v; st.state="idle"; await saveUser(userId, st, env); return tgSendMessage(env, chatId, `✅ خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}`, mainMenuKeyboard(env)); }

    
// Symbol selection (مرحله ۲)
if(isSymbol(text)){
  const symbol = text;

  // اگر کاربر ثبت‌نامش کامل نیست، اول ثبت‌نام انجام شود
  if(await startOnboardingIfNeeded(env, chatId, from, st)) return;

  // مرحله بعد: انتخاب سبک (از کاتالوگ ادمین)
  st.selectedSymbol = symbol;
  st.state = "choose_style";
  await saveUser(userId, st, env);

  const cat = await getStyleCatalog(env);
  const labels = (cat.items||[]).filter(x=>x && x.enabled!==false).map(x=>String(x.label||"").trim()).filter(Boolean);

  if(!labels.length){ st.state="idle"; st.selectedSymbol=""; await saveUser(userId, st, env); return tgSendMessage(env, chatId, "⚠️ فعلاً هیچ سبک فعالی برای تحلیل وجود ندارد.\nاز ادمین بخواه سبک‌ها را فعال کند.", mainMenuKeyboard(env)); }
  return tgSendMessage(env, chatId, `🧩 مرحله ۳: سبک تحلیل را انتخاب کن (نماد: ${symbol})`, optionsKeyboard(labels));
}

// Style selection (مرحله ۳ → مرحله ۴)
if(st.state==="choose_style" && st.selectedSymbol){
  const chosen = String(text||"").trim();
  const cat = await getStyleCatalog(env);
  const items = (cat.items||[]).filter(x=>x && x.key && x.label);
  const enabledItems = items.filter(x=>x.enabled!==false);

  // Resolve choice by key (case-insensitive) or label (exact)
  const low = chosen.toLowerCase();
  let item = enabledItems.find(x=>String(x.key||"").toLowerCase()===low) || enabledItems.find(x=>String(x.label||"").trim()===chosen);

  if(!item){
    const labels = enabledItems.map(x=>String(x.label||"").trim()).filter(Boolean);
    if(!labels.length){
      st.state="idle"; st.selectedSymbol=""; await saveUser(userId, st, env);
      return tgSendMessage(env, chatId, "⚠️ فعلاً هیچ سبک فعالی برای تحلیل وجود ندارد. از ادمین بخواه سبک‌ها را فعال کند.", mainMenuKeyboard(env));
    }
    return tgSendMessage(env, chatId, "یکی از سبک‌های موجود را انتخاب کن:", optionsKeyboard(labels));
  }

  // Persist resolved style
  st.selectedStyleKey = String(item.key);
  st.style = String(item.label);

  // مرحله ۴: اجرای تحلیل
  const symbol = st.selectedSymbol;
  const market = st.selectedMarket || "crypto";
  const tf = st.timeframe || "H4";
  const risk = st.risk || "متوسط";

  await tgSendMessage(env, chatId, `⏳ در حال دریافت دیتا و تحلیل (${market} | ${symbol} | ${tf} | ${st.style})…`, kb([[BTN.BACK, BTN.HOME]]));

  const res = await runAnalysisFlow(env, from, { market, symbol, timeframe: tf, styleKey: st.selectedStyleKey, styleLabel: st.style, risk, newsEnabled: !!st.newsEnabled });

  if(!res || !res.ok){
    // سهمیه کم نشود
    const msg = res?.error === "no_data" ? "⚠️ برای این نماد/بازار دیتا پیدا نشد. نماد یا بازار را تغییر بده." : ("⚠️ تحلیل انجام نشد: " + (res?.error||"خطای نامشخص"));
    st.state="choose_symbol"; st.selectedSymbol=""; await saveUser(userId, st, env);
    return tgSendMessage(env, chatId, msg, kb([[BTN.BACK, BTN.HOME]]));
  }

  // ارسال خروجی متن
  await tgSendMessage(env, chatId, res.text || "✅ تحلیل آماده است.", mainMenuKeyboard(env));

  // اگر چارت داریم ارسال کن
  if(res.chartUrl){
    await tgSendPhoto(env, chatId, res.chartUrl, `📊 چارت و زون‌ها (${symbol})`).catch(()=>{});
  }

  // کم کردن سهمیه فقط وقتی OK
  try{ await consumeOneUsage(env, from, market); }catch(_e){}

  st.state="idle"; st.selectedSymbol=""; await saveUser(userId, st, env);
  return;
}


    // Default fallback
    return tgSendMessage(env, chatId, "از منوی پایین استفاده کن ✅", mainMenuKeyboard(env));
  } catch(e){
    console.error("handleUpdate error:", e);
  }
}

function parseCommand(text){
  const t = String(text||"").trim();
  if(!t.startsWith("/")) return { cmd:"", arg:"" };
  const parts = t.split(/\s+/);
  return { cmd: parts[0].toLowerCase(), arg: parts.slice(1).join(" ").trim() };
}
function normalizeSymbol(t){
  t = String(t||"").trim().toUpperCase();

  // Convert Persian/Arabic digits to Latin digits
  t = t
    .replace(/[۰٠]/g,"0").replace(/[۱١]/g,"1").replace(/[۲٢]/g,"2").replace(/[۳٣]/g,"3").replace(/[۴٤]/g,"4")
    .replace(/[۵٥]/g,"5").replace(/[۶٦]/g,"6").replace(/[۷٧]/g,"7").replace(/[۸٨]/g,"8").replace(/[۹٩]/g,"9");

  // Normalize common separators and remove spaces
  t = t.replace(/\s+/g,"").replace(/[\-_/]/g,"");

  // If user typed forex pairs with lookalike digits (e.g., U5DJPY), convert digits to likely letters
  const leet = { "0":"O","1":"I","2":"Z","3":"E","4":"A","5":"S","6":"G","7":"T","8":"B","9":"P" };
  if(/^[A-Z0-9]{6}$/.test(t) && /\d/.test(t)){
    t = t.replace(/\d/g, d => leet[d] || d);
  }

  // Keep dots for tickers like BRK.B
  t = t.replace(/[^A-Z0-9\.]/g,"");
  if(!t) return "";

  // If user wrote BTC, assume USDT (crypto default) when available
  if(!t.includes(".") && !t.endsWith("USDT") && CRYPTOS.includes(t+"USDT")) return t+"USDT";

  return t;
}

function isSymbol(t){ return MAJORS.includes(t)||METALS.includes(t)||INDICES.includes(t)||STOCKS.includes(t)||CRYPTOS.includes(t); }

/* ========================== ONBOARDING ========================== */
async function startOnboardingIfNeeded(env, chatId, from, st){
  if(!st.profileName){
    st.state="onboard_name"; await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "👤 لطفاً اسم خودت را بفرست:", kb([[BTN.BACK,BTN.HOME]]));
    return;
  }
  if(!st.phone){
    st.state="onboard_contact"; await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "📱 برای فعال‌سازی کامل، شماره‌ات را Share کن:", requestContactKeyboard(env));
    return;
  }
  if(!st.experience){
    st.state="onboard_experience"; await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "سطح تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"]));
    return;
  }
  if(!st.preferredMarket){
    st.state="onboard_market"; await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "کدام بازار برایت مهم‌تر است؟", optionsKeyboard(["کریپتو","فارکس","فلزات","سهام"]));
    return;
  }
  if(!st.level){
    await tgSendMessage(env, chatId, "🧪 برای پیشنهاد دقیق تنظیمات، یک تعیین سطح کوتاه انجام بده: /level", mainMenuKeyboard(env));
  }
}

async function handleContactShare(env, chatId, from, st, contact){
  if(contact.user_id && String(contact.user_id) !== String(st.userId)){
    await tgSendMessage(env, chatId, "⛔️ این شماره مربوط به خودت نیست. لطفاً با همان اکانت شماره‌ی خودت را Share کن.", mainMenuKeyboard(env));
    return;
  }
  const phone = normalizePhone(contact.phone_number);
  if(!phone || phone.length < 6){
    await tgSendMessage(env, chatId, "شماره نامعتبر است. دوباره تلاش کن.", requestContactKeyboard(env));
    return;
  }
  if(!env.BOT_KV){
    st.phone = phone;
    st.state = "idle";
    await tgSendMessage(env, chatId, "✅ شماره ذخیره شد (KV غیرفعال).", mainMenuKeyboard(env));
    return;
  }

  const bind = await bindPhoneToUser(st.userId, phone, env);
  if(!bind.ok){
    if(bind.reason==="phone_already_used"){
      await tgSendMessage(env, chatId, "⛔️ این شماره قبلاً در سیستم ثبت شده است و قابل استفاده نیست.\n\nاگر فکر می‌کنی اشتباه است، به پشتیبانی پیام بده.", mainMenuKeyboard(env));
      return;
    }
    await tgSendMessage(env, chatId, "⚠️ خطا در ذخیره شماره. دوباره تلاش کن.", requestContactKeyboard(env));
    return;
  }

  st.phone = phone;

  // Referral accepted ONLY if: contact shared + phone is new (we enforce uniqueness here)
  if(st.pendingReferrerId && !st.referrerId && String(st.pendingReferrerId) !== String(st.userId)){
    await creditReferral(env, st.pendingReferrerId, st.userId);
    st.referrerId = st.pendingReferrerId;
  }
  st.pendingReferrerId = null;

  if(st.state==="onboard_contact"){
    st.state="onboard_experience";
    await saveUser(st.userId, st, env);
    await tgSendMessage(env, chatId, "✅ شماره ثبت شد.\n\nسطح تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"]));
    return;
  }

  await saveUser(st.userId, st, env);
  await tgSendMessage(env, chatId, "✅ شماره ثبت شد.", mainMenuKeyboard(env));
}

async function attachReferralIfAny(st, code, env){
  const c = String(code||"").trim();
  if(!c) return;

  const referrerId = await lookupReferrerIdByCode(c, env);
  if(!referrerId) return;
  if(String(referrerId) === String(st.userId)) return;
  if(st.referrerId || st.pendingReferrerId) return;

  st.pendingReferrerId = String(referrerId);
  st.refCodeUsed = c; // keep the exact code for per-link commission overrides
  await saveUser(st.userId, st, env);
}

async function creditReferral(env, referrerId, invitedUserId){
  if(!env.BOT_KV) return;
  const refStRaw = await getUser(referrerId, env);
  if(!refStRaw) return;
  const refSt = patchUser(refStRaw, referrerId);
  refSt.successfulInvites = (refSt.successfulInvites||0) + 1;
  refSt.points = (refSt.points||0) + REF_POINTS_PER_SUCCESS;
  await saveUser(referrerId, refSt, env);

  if(refSt.chatId){
    const msg =
`🎉 معرفی موفق در MarketiQ

✅ یک کاربر جدید با موفقیت ثبت‌نام کرد.
➕ امتیاز دریافت‌شده: ${REF_POINTS_PER_SUCCESS}
⭐ امتیاز فعلی شما: ${refSt.points}

هر ${REF_POINTS_FOR_FREE_SUB} امتیاز = یک اشتراک رایگان (/redeem)`;
    await tgSendMessage(env, refSt.chatId, msg, mainMenuKeyboard(env)).catch(()=>{});
  }
}

async function deliverCustomPromptIfReady(env, st){
  if(!st || !st.customPromptReadyAt || !st.customPromptText) return false;
  if(st.customPromptDeliveredAt) return false;

  const readyMs = Date.parse(st.customPromptReadyAt);
  if(!Number.isFinite(readyMs)) return false;
  if(Date.now() < readyMs) return false;

  if(st.chatId){
    const msg =
`✅ پرامپت اختصاصی شما آماده شد

${st.customPromptText}

برای استفاده، وارد تنظیمات شوید و «پرامپت اختصاصی» را انتخاب کنید.`;
    await tgSendMessage(env, st.chatId, msg, mainMenuKeyboard(env)).catch(()=>{});
  }

  st.customPromptDeliveredAt = new Date().toISOString();
  await saveUser(st.userId, st, env);
  return true;
}

async function processReadyCustomPrompts(env){
  // Runs on Cron (scheduled) to deliver pending custom prompts.
  if(!hasD1(env)) return;
  const now = new Date().toISOString();

  const res = await env.BOT_DB.prepare(`
    SELECT user_id, data FROM users
    WHERE json_extract(data,'$.customPromptReadyAt') IS NOT NULL
      AND json_extract(data,'$.customPromptReadyAt') <= ?1
      AND (json_extract(data,'$.customPromptDeliveredAt') IS NULL OR json_extract(data,'$.customPromptDeliveredAt') = '')
      AND json_extract(data,'$.customPromptText') IS NOT NULL
      AND json_extract(data,'$.customPromptText') <> ''
    LIMIT 50
  `).bind(now).all();

  for(const row of (res.results||[])){
    const st = patchUser(safeJsonParse(row.data)||{}, row.user_id);
    await deliverCustomPromptIfReady(env, st).catch(()=>{});
  }
}



/* ========================== ADMIN VIEWS ========================== */
async function adminListUsers(env, chatId){
  const lines = [];

  if(hasD1(env)){
    const res = await env.BOT_DB.prepare("SELECT user_id, data FROM users ORDER BY updated_at DESC LIMIT 50").all();
    const rows = res?.results || [];
    if(!rows.length) return tgSendMessage(env, chatId, "کاربری یافت نشد.", mainMenuKeyboard(env));
    for(const r of rows.slice(0,30)){
      const id = String(r.user_id);
      const u = patchUser(safeJsonParse(r.data)||{}, id);
      lines.push(`- ${u.profileName||"-"} | ID:${u.userId} | @${u.username||"-"} | points:${u.points} | invites:${u.successfulInvites}`);
    }
    return tgSendMessage(env, chatId, `👥 لیست کاربران (حداکثر ۳۰):

${lines.join("\n")}

برای دیدن جزئیات:
/user USER_ID`, mainMenuKeyboard(env));
  }

  // KV fallback
  if(!env.BOT_KV?.list) return tgSendMessage(env, chatId, "KV list در این محیط فعال نیست.", mainMenuKeyboard(env));
  const list = await env.BOT_KV.list({ prefix:"u:", limit:50 });
  const keys = list?.keys || [];
  if(!keys.length) return tgSendMessage(env, chatId, "کاربری یافت نشد.", mainMenuKeyboard(env));
  for(const k of keys.slice(0,30)){
    const id = k.name.replace(/^u:/,"");
    const u = await getUser(id, env);
    const st = patchUser(u||{}, id);
    lines.push(`- ${st.profileName||"-"} | ID:${st.userId} | @${st.username||"-"} | points:${st.points} | invites:${st.successfulInvites}`);
  }
  return tgSendMessage(env, chatId, `👥 لیست کاربران (حداکثر ۳۰):

${lines.join("\n")}

برای دیدن جزئیات:
/user USER_ID`, mainMenuKeyboard(env));
}
async function adminShowUser(env, chatId, userIdArg, from){
  const id = String(userIdArg||"").trim();
  if(!id) return tgSendMessage(env, chatId, "فرمت:\n/user USER_ID", mainMenuKeyboard(env));
  const u = await getUser(id, env);
  if(!u) return tgSendMessage(env, chatId, "کاربر پیدا نشد.", mainMenuKeyboard(env));
  const st = patchUser(u, id);
  const quota = await quotaText(st, from, env);
  const sub = isSubscribed(st) ? `✅ تا ${st.subActiveUntil}` : "—";
  const txt =
`👤 مشخصات کاربر
نام: ${st.profileName||"-"}
یوزرنیم: @${st.username||"-"}
ID: ${st.userId}
چت: ${st.chatId||"-"}

📱 شماره: ${st.phone ? "`"+st.phone+"`" : "-"}

⚙️ تنظیمات:
TF=${st.timeframe} | Style=${st.style} | Risk=${st.risk} | News=${st.newsEnabled?"ON":"OFF"}

🧪 سطح:
Experience=${st.experience||"-"} | Preferred=${st.preferredMarket||"-"} | Level=${st.level||"-"} | Score=${st.levelScore ?? "-"}

🎁 رفرال:
invites=${st.successfulInvites} | points=${st.points} | referrer=${st.referrerId||"-"}

💳 اشتراک:
${sub}

📊 سهمیه امروز:
${quota}`;
  return tgSendMessage(env, chatId, txt, mainMenuKeyboard(env));
}

/* ========================== REQUEST TO ADMINS/OWNERS ========================== */
async function requestToAdmins(env, st, message){
  const ids = adminUserIdTargets(env);
  if(!ids.length) return;
const payload = `${message}\n\nUser: ${st.profileName||"-"} | ID:${st.userId} | @${st.username||"-"}`;
  for(const id of ids){ await tgSendMessage(env, id, payload).catch(()=>{}); }
}

/* ========================== SUBSCRIPTION / REDEEM ========================== */
function extendIsoDate(curIso, addDays){
  const now = Date.now();
  const cur = Date.parse(curIso||"");
  const base = Number.isFinite(cur) && cur > now ? cur : now;
  return new Date(base + Number(addDays)*24*60*60*1000).toISOString();
}
async function redeemPointsForSubscription(env, chatId, from, st){
  if(!env.BOT_KV) return tgSendMessage(env, chatId, "KV فعال نیست. این قابلیت در این محیط کار نمی‌کند.", mainMenuKeyboard(env));
  const pts = st.points || 0;
  if(pts < REF_POINTS_FOR_FREE_SUB){
    return tgSendMessage(env, chatId, `امتیاز کافی نیست.\nامتیاز فعلی: ${pts}\nحداقل برای اشتراک رایگان: ${REF_POINTS_FOR_FREE_SUB}`, mainMenuKeyboard(env));
  }
  const days = toInt(env.FREE_SUB_DAYS_PER_REDEEM, 30);
  st.points = pts - REF_POINTS_FOR_FREE_SUB;
  st.freeSubRedeemed = (st.freeSubRedeemed||0) + 1;
  st.subActiveUntil = extendIsoDate(st.subActiveUntil, days);
  await saveUser(st.userId, st, env);
  return tgSendMessage(env, chatId, `✅ اشتراک رایگان فعال شد.\nمدت: ${days} روز\nتا تاریخ: ${st.subActiveUntil}\nامتیاز باقی‌مانده: ${st.points}`, mainMenuKeyboard(env));
}

/* ========================== REFERRAL INFO ========================== */
async function sendReferralInfo(env, chatId, from, st){
  const stats =
`🎁 دعوت دوستان

📌 قوانین پذیرش:
- فقط زمانی معرفی ثبت می‌شود که کاربر دعوت‌شده «Share Contact» بزند.
- شماره باید جدید باشد (قبلاً در سیستم ثبت نشده باشد).

✅ پاداش:
- هر معرفی موفق: ${REF_POINTS_PER_SUCCESS} امتیاز
- هر ${REF_POINTS_FOR_FREE_SUB} امتیاز: یک اشتراک رایگان (/redeem)

📊 آمار شما:
invites=${st.successfulInvites} | points=${st.points}`;

  // Referral links are visible ONLY to admins (per request)
  if(!isAdmin(from, env)){
    return tgSendMessage(
      env,
      chatId,
      stats + `

🔒 لینک‌های اختصاصی دعوت فقط برای مدیریت نمایش داده می‌شود.
اگر نیاز به لینک دعوت داری، به پشتیبانی پیام بده.`,
      mainMenuKeyboard(env)
    );
  }

  const commission = toInt(env.REF_COMMISSION_PCT, 30);
  const botUsername = (env.BOT_USERNAME||"").toString().replace(/^@/,"").trim();
  const codes = (st.refCodes||[]).slice(0, REF_CODES_PER_USER);
  const links = codes.map((c,i)=>{
    const link = botUsername ? `https://t.me/${botUsername}?start=${c}` : `start param: ${c}`;
    return `${i+1}) ${link}`;
  });

  const txt =
`${stats}

💰 سهم کمیسیون رفرال از خرید اشتراک: ${commission}%

🔗 لینک‌های اختصاصی (${REF_CODES_PER_USER} عدد):
${links.join("\n")}`;

  return tgSendMessage(env, chatId, txt, mainMenuKeyboard(env));
}

/* ========================== TEXTS ========================== */
async function sendSettingsSummary(env, chatId, st, from){
  const quota = await quotaText(st, from, env);
  const sub = isSubscribed(st) ? `✅ فعال تا ${st.subActiveUntil}` : "—";
  const w = await getWallet(env);
  const txt =
`⚙️ تنظیمات:

⏱ تایم‌فریم: ${st.timeframe}
🎯 سبک: ${st.style}
⚠️ ریسک: ${st.risk}
📰 خبر: ${st.newsEnabled ? "روشن ✅" : "خاموش ❌"}

🧪 سطح: ${st.level || "-"}
🎯 بازار پیشنهادی: ${st.suggestedMarket || "-"}

💳 اشتراک: ${sub}
💳 ولت: ${w ? w : "—"}

📊 سهمیه امروز: ${quota}

📌 نکته: پرامپت‌های تحلیل فقط توسط ادمین/اونر تعیین می‌شوند.`;
  return tgSendMessage(env, chatId, txt, settingsMenuKeyboard(env));
}

async function profileText(st, from, env){
  const quota = await quotaText(st, from, env);
  const roleTag = isPrivileged(from, env) ? "🛡️ مدیریت" : "👤 کاربر";
  const sub = isSubscribed(st) ? `✅ تا ${st.subActiveUntil}` : "—";
  const canRedeem = (st.points||0) >= REF_POINTS_FOR_FREE_SUB ? "✅ دارد" : "—";
  const botUsername = (env.BOT_USERNAME || "").toString().replace(/^@/, "").trim();
  const code = Array.isArray(st.refCodes) && st.refCodes.length ? st.refCodes[0] : "";
  const refLink = (botUsername && code) ? `https://t.me/${botUsername}?start=${code}` : (code || "—");
  return `👤 پروفایل MarketiQ

وضعیت: ${roleTag}
نام: ${st.profileName || "-"}
یوزرنیم: @${st.username || "-"}
🆔 ID: ${st.userId}
📱 شماره: ${st.phone ? st.phone : "—"}
📅 امروز(Kyiv): ${kyivDateString()}
📊 سهمیه امروز: ${quota}

🔗 لینک رفرال شما: ${refLink}

🎁 رفرال: invites=${st.successfulInvites} | points=${st.points} | redeem=${canRedeem}
💰 کمیسیون رفرال: ${Number(st.refCommissionTotal||0).toFixed(2)} ${await getSubCurrency(env)}
💳 اشتراک: ${sub}

🏦 کیف پول:
موجودی: ${Number(st.walletBalance||0).toFixed(2)}
درخواست‌های واریز: ${st.walletDepositRequests||0}
درخواست‌های برداشت: ${st.walletWithdrawRequests||0}
آدرس BEP20: ${st.bep20Address ? "`"+st.bep20Address+"`" : "— (برای برداشت لازم است)"}`;
}

/* ========================== LEVELING ========================== */
async function startLeveling(env, chatId, from, st){
  if(!st.profileName || !st.phone){
    await tgSendMessage(env, chatId, "برای تعیین سطح، ابتدا نام و شماره را تکمیل کن ✅", mainMenuKeyboard(env));
    await startOnboardingIfNeeded(env, chatId, from, st);
    return;
  }
  st.quiz={active:false, idx:0, answers:[]};
  st.state="onboard_experience";
  await saveUser(st.userId, st, env);
  await tgSendMessage(env, chatId, "🧪 تعیین سطح MarketiQ\n\nسطح تجربه‌ات در بازار چقدر است؟", optionsKeyboard(["مبتدی","متوسط","حرفه‌ای"]));
}
async function startQuiz(env, chatId, st){
  st.quiz={ active:true, idx:0, answers:[] };
  st.state="idle";
  await saveUser(st.userId, st, env);
  const q = QUIZ[0];
  await tgSendMessage(env, chatId, "🧪 تست تعیین سطح شروع شد.\n\n"+q.q, quizKeyboard(q));
}

async function sendBuyInfo(env, chatId, from, st){
  // Keep user-facing texts friendly (no technical errors)
  if(!isOnboardComplete(st)){
    await tgSendMessage(env, chatId, "برای خرید/فعال‌سازی اشتراک، ابتدا پروفایل را کامل کن (نام + شماره).", mainMenuKeyboard(env));
    return;
  }

  const wallet = await getWallet(env);
  const price = await getSubPrice(env);
  const currency = await getSubCurrency(env);
  const days = await getSubDays(env);
  const payUrl = paymentPageUrl(env);
  const support = env.SUPPORT_HANDLE || "@support";

  let msg = `💳 خرید اشتراک ${BRAND}\n\n`;
  msg += (price && price > 0) ? `مبلغ: *${price} ${currency}* | مدت: *${days} روز*\n\n` : `مبلغ: —\n\n`;
  msg += wallet ? `آدرس ولت:\n\`${wallet}\`\n\n` : `آدرس ولت هنوز تنظیم نشده است.\n\n`;
  msg += `بعد از پرداخت، TxID را در همین بات ثبت کن:\n/tx YOUR_TXID\n\nاگر مشکلی بود به پشتیبانی پیام بده: ${support}\n`;
  if(payUrl) msg += `\n🔗 صفحه پرداخت:\n${payUrl}`;

  await tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));

  // Send QR as image (optional)
  if(wallet){
    const qr = `https://quickchart.io/qr?text=${encodeURIComponent(wallet)}&size=512&margin=1`;
    await tgSendPhotoByUrl(env, chatId, qr, "QR Code ولت").catch(()=>{});
  }
}

async function handleSetPrice(env, chatId, argRaw){
  const parts = String(argRaw||"").trim().split(/\s+/).filter(Boolean);
  if(!parts.length){
    return tgSendMessage(env, chatId, "فرمت درست:\n/setprice 10 USDT 30\n\n(مقدار، واحد، مدت روز)", mainMenuKeyboard(env));
  }
  const amount = parts[0];
  const cur = parts[1];
  const days = parts[2];

  try{
    const p = await setSubPrice(env, amount);
    let c = await getSubCurrency(env);
    let d = await getSubDays(env);
    if(cur) c = await setSubCurrency(env, cur);
    if(days) d = await setSubDays(env, days);

    return tgSendMessage(env, chatId, `✅ قیمت اشتراک تنظیم شد:\n${p} ${c} | مدت: ${d} روز`, mainMenuKeyboard(env));
  }catch(_e){
    return tgSendMessage(env, chatId, "⚠️ ذخیره قیمت ناموفق بود. مقدار را بررسی کن.", mainMenuKeyboard(env));
  }
}

/* ========================== FLOWS ========================== */
async function runSignalTextFlow(env, chatId, from, st, symbol, userPrompt){
  symbol = normalizeSymbol(symbol);
  const tf = (st.timeframe || "H4");

  // quick feedback
  await tgSendChatAction(env, chatId, "typing").catch(()=>{});

  try{
    const md = await getMarketCandlesWithFallbackMeta(env, symbol, tf);
    const candles = md?.candles || [];
    if(!candles || candles.length < 60){
      const tried = (md?.tried || []).filter(x=>x && x.provider && x.provider!=="kv" && x.provider!=="cache");
      const triedTxt = tried.length ? ("\n\nمنابع تست‌شده: " + tried.map(x=>x.provider + (x.ok? "✅":"❌")).join("، ")) : "";
      await tgSendMessage(env, chatId, "فعلاً دادهٔ کافی برای این نماد ندارم. لطفاً کمی بعد دوباره امتحان کنید." + triedTxt);
      return false;
    }

    const snap = computeSnapshot(candles);
    const ohlc = candlesToCompactCSV(candles, 80);

    // Optional Binance ticker snapshot (for crypto)
    let binanceBlock = "";
    if(symbol.endsWith("USDT")){
      try{
        const t = await fetchBinanceTicker24h(symbol, toInt(env.MARKET_TIMEOUT_MS, 8000), toInt(env.BINANCE_TICKER_CACHE_TTL_SEC, 60));
        if(t && Number.isFinite(t.last)){
          binanceBlock = `BINANCE_24H: last=${t.last} change%=${t.changePct} high=${t.high} low=${t.low} vol=${t.vol}`;
        }
      }catch(_e){}
    }

    // Optional news headlines (newsdata.io)
    let headlines = [];
    if(st.newsEnabled){
      headlines = await fetchNewsHeadlines(env, symbol, tf);
    }
    const newsBlock = st.newsEnabled ? formatNewsForPrompt(headlines, 5) : "NEWS_HEADLINES: (disabled)";

    const marketBlock =
      `lastPrice=${snap?.lastPrice}
`+
      `changePct=${snap?.changePct}%
`+
      `range50={lo:${snap?.range50?.lo},hi:${snap?.range50?.hi}}
`+
      `trend50=${snap?.trend50}
`+
      `volatility50=${snap?.volatility50}
`+
      (binanceBlock ? `${binanceBlock}
` : "")+
      `${newsBlock}

`+
      `OHLC_CSV (${tf}) last ${Math.min(candles.length, 80)}:
${ohlc}`;

    const prompt = await buildTextPromptForSymbol(env, symbol, userPrompt, st, marketBlock);
    let draft;
    try {
      draft = await runTextProviders(prompt, env, st.textOrder);
    } catch (e) {
      console.log("text providers failed:", e?.message || e);
      draft = heuristicAnalysisText(symbol, tf, snap, headlines, st);
    }

    let polished = draft;
    try {
      polished = await runPolishProviders(draft, env, st.polishOrder);
    } catch (e) {
      console.log("polish providers failed:", e?.message || e);
    }

    // Chart rendering (candlestick + zones/levels)
    if((env.RENDER_CHART || "1") !== "0"){
      try{
        const plan = await extractRenderPlan(env, polished, candles, st);
        const cfg = buildQuickChartCandlestickConfig(symbol, tf, candles, plan);
        const imgUrl = await buildQuickChartImageUrl(env, cfg);
        if(imgUrl){
          await tgSendPhoto(env, chatId, imgUrl, `📊 ${symbol} · ${tf}`);
        }
      }catch(e){
        console.error("chart render failed:", e?.message || e);
      }
    }

    // Send analysis in chunks
    for(const part of chunkText(polished, 3500)){
      await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));
    }

    // Send headlines as short add-on (optional)
    if(st.newsEnabled && Array.isArray(headlines) && headlines.length){
      const list = headlines.slice(0, 5).map(h => `- ${h.source ? "["+h.source+"] " : ""}${h.title}`).join("\n");
      await tgSendMessage(env, chatId, `📰 تیترهای خبری مرتبط:
${list}`, mainMenuKeyboard(env));
    }

  }catch(e){
    console.error("runSignalTextFlow error:", e?.message || e);
    // Do not show raw errors to user
    const msg = isPrivileged(from, env)
      ? `⚠️ خطا در تحلیل: ${e?.message || e}`
      : "متأسفانه الان نمی‌تونم تحلیل رو انجام بدم. لطفاً چند دقیقه دیگه دوباره تلاش کنید.";
    await tgSendMessage(env, chatId, msg, mainMenuKeyboard(env));
  }
}

async function handleVisionFlow(env, chatId, from, userId, st, fileId){
  if(env.BOT_KV && !(await canAnalyzeToday(st, from, env))){
    const lim = await dailyLimitForUser(st, from, env);
    await tgSendMessage(env, chatId, `⛔️ سهمیه امروزت تموم شده (${Number.isFinite(lim)?lim:"∞"} تحلیل در روز).`, mainMenuKeyboard(env));
    return;
  }
  await tgSendMessage(env, chatId, "🖼️ عکس دریافت شد… در حال تحلیل ویژن 🔍", kb([[BTN.HOME]]));
  const t = stopToken();
  const typingTask = typingLoop(env, chatId, t);
  try{
    const filePath = await tgGetFilePath(env, fileId);
    if(!filePath) throw new Error("no_file_path");
    const imageUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;

    const vPrompt = await buildVisionPrompt(env, st);
    const visionRaw = await runVisionProviders(imageUrl, vPrompt, env, st.visionOrder);

    const tf = st.timeframe || "H4";
    const base = await buildBasePrompt(env, tf);
    const finalPrompt =
      `${base}\n\nورودی ویژن (مشاهدات تصویر):\n${visionRaw}\n\n`+
      `وظیفه: بر اساس همین مشاهده‌ها خروجی دقیق ۱ تا ۵ بده. سطح‌ها را مشخص کن.\n`+
      `قوانین: فقط فارسی، لحن افشاگر، خیال‌بافی نکن.\n`;

    const draft = await runTextProviders(finalPrompt, env, st.textOrder);
    const polished = await runPolishProviders(draft, env, st.polishOrder);

    t.stop=true;
    await Promise.race([typingTask, sleep(10)]).catch(()=>{});

    for(const part of chunkText(polished, 3500)) await tgSendMessage(env, chatId, part, mainMenuKeyboard(env));

    if(env.BOT_KV && !isPrivileged(from, env)) { await consumeDaily(st, from, env); await saveUser(userId, st, env); }
} catch(e){
    console.error("handleVisionFlow error:", e);
    t.stop=true;
    await tgSendMessage(env, chatId, "⚠️ فعلاً امکان تحلیل تصویر نیست. لطفاً کمی بعد دوباره تلاش کن.", mainMenuKeyboard(env));
  }
}

/* ========================== Mini App helper APIs ========================== */

function heuristicAnalysisText(symbol, tf, snap, headlines, st){
  const last = Number(snap?.lastPrice);
  const lo = Number(snap?.range50?.lo);
  const hi = Number(snap?.range50?.hi);
  const trend = (snap?.trend50 || "FLAT").toUpperCase();
  const vol = (snap?.volatility50 || "MED").toUpperCase();

  const hasNums = Number.isFinite(last) && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
  if(!hasNums){
    return `📌 تحلیل خودکار (بدون AI)

نماد: ${symbol}
تایم‌فریم: ${tf}

داده کافی برای تحلیل دقیق موجود نیست. لطفاً دوباره تلاش کن یا تایم‌فریم را تغییر بده.`;
  }

  const range = hi - lo;
  const lvl38 = lo + range * 0.382;
  const lvl62 = lo + range * 0.618;

  const riskPct = (vol === "HIGH") ? 0.02 : (vol === "LOW" ? 0.01 : 0.015);
  const stop = Math.max(0, last * (1 - riskPct));
  const t1 = (trend === "DOWN") ? Math.max(0, last * (1 + riskPct)) : lvl62;
  const t2 = (trend === "DOWN") ? lvl62 : hi;

  const bias =
    trend === "UP" ? "صعودی" :
    trend === "DOWN" ? "نزولی" : "خنثی";

  const noteNews = (st?.newsEnabled && Array.isArray(headlines) && headlines.length)
    ? `

📰 خبرهای مرتبط فعال است؛ در تصمیم‌گیری حتماً نوسانات خبری را در نظر بگیر.`
    : "";

  return (
`📌 تحلیل خودکار (بدون AI)

`+
`نماد: ${symbol}
`+
`تایم‌فریم: ${tf}

`+
`🧭 جهت کلی: ${bias}
`+
`🌊 نوسان: ${vol}

`+
`📍 سطوح کلیدی:
`+
`- حمایت: ${lo}
`+
`- میانه (38%): ${Number(lvl38.toFixed(6))}
`+
`- میانه (62%): ${Number(lvl62.toFixed(6))}
`+
`- مقاومت: ${hi}

`+
`🧠 سناریوها:
`+
`1) اگر قیمت بالای ${Number(lvl62.toFixed(6))} تثبیت شود → ادامه حرکت تا ${hi}
`+
`2) اگر قیمت زیر ${Number(lvl38.toFixed(6))} برگردد → احتمال برگشت به ${lo}

`+
`🎯 پلن پیشنهادی (آموزشی):
`+
`- ورود پله‌ای نزدیک حمایت/بریک‌اوت معتبر
`+
`- حدضرر تقریبی: ${Number(stop.toFixed(6))}
`+
`- تارگت ۱: ${Number(t1.toFixed(6))}
`+
`- تارگت ۲: ${Number(t2.toFixed(6))}

`+
`⚠️ این خروجی صرفاً آموزشی است و توصیه مالی نیست.`+
noteNews
  );
}


async function runSignalTextFlowReturnText(env, from, st, symbol, userPrompt){
  symbol = normalizeSymbol(symbol);
  const tf = (st.timeframe || "H4");

  let md;
  try{
    md = await getMarketCandlesWithFallbackMeta(env, symbol, tf);
  }catch(e){
    const tried = (e?.tried || []).filter(x=>x && x.provider);
    const triedTxt = tried.length ? ("منابع تست‌شده: " + tried.map(x=>x.provider + (x.ok? "✅":"❌")).join("، ")) : "";
    return { ok:false, text: "دریافت داده برای این نماد ناموفق بود. " + (triedTxt || ""), chartUrl: "", headlines: [], dataProvider: "" };
  }
  const candles = md?.candles || [];
  if(!candles || candles.length < 60) return { ok:false, text: "فعلاً دادهٔ کافی برای این نماد ندارم.", chartUrl: "", headlines: [], dataProvider: md?.provider || "" };

  const snap = computeSnapshot(candles);
  const ohlc = candlesToCompactCSV(candles, 80);

  // Optional Binance ticker snapshot (for crypto)
  let binanceBlock = "";
  if(symbol.endsWith("USDT")){
    try{
      const t = await fetchBinanceTicker24h(symbol, toInt(env.MARKET_TIMEOUT_MS, 8000), toInt(env.BINANCE_TICKER_CACHE_TTL_SEC, 60));
      if(t && Number.isFinite(t.last)){
        binanceBlock = `BINANCE_24H: last=${t.last} change%=${t.changePct} high=${t.high} low=${t.low} vol=${t.vol}`;
      }
    }catch(_e){}
  }

  // Optional news headlines
  let headlines = [];
  if(st.newsEnabled){
    headlines = await fetchNewsHeadlines(env, symbol, tf);
  }
  const newsBlock = st.newsEnabled ? formatNewsForPrompt(headlines, 5) : "NEWS_HEADLINES: (disabled)";

  const marketBlock =
    `lastPrice=${snap.lastPrice}
`+
    `changePct=${snap.changePct}%
`+
    `range50={lo:${snap.range50.lo},hi:${snap.range50.hi}}
`+
    `trend50=${snap.trend50}
`+
    `volatility50=${snap.volatility50}
`+
    (binanceBlock ? `${binanceBlock}
` : "")+
    `${newsBlock}

`+
    `OHLC_CSV (${tf}) last ${Math.min(candles.length, 80)}:
${ohlc}`;

  const prompt = await buildTextPromptForSymbol(env, symbol, userPrompt, st, marketBlock);
    let draft;
    try {
      draft = await runTextProviders(prompt, env, st.textOrder);
    } catch (e) {
      console.log("text providers failed:", e?.message || e);
      draft = heuristicAnalysisText(symbol, tf, snap, headlines, st);
    }

    let polished = draft;
    try {
      polished = await runPolishProviders(draft, env, st.polishOrder);
    } catch (e) {
      console.log("polish providers failed:", e?.message || e);
    }

  // Chart URL + extracted plan (for mini-app)
  let chartUrl = "";
  let plan = null;
  if((env.RENDER_CHART || "1") !== "0"){
    try{
      plan = await extractRenderPlan(env, polished, candles, st);
      const cfg = buildQuickChartCandlestickConfig(symbol, tf, candles, plan || {zones:[], lines:[]});
      chartUrl = await buildQuickChartImageUrl(env, cfg);
    }catch(e){
      console.error("chart render (miniapp) failed:", e?.message || e);
      chartUrl = "";
      plan = null;
    }
  }

  return { ok:true, text: polished, chartUrl, headlines, plan };
}

/* ========================== TELEGRAM MINI APP INITDATA VERIFY ========================== */

async function authMiniApp(body, env) {
  // Dev-mode bypass for local/browser testing (ONLY if DEV_MODE=1).
  // Use ?dev=1 in the Mini App URL; the frontend will send {dev:true,userId:"..."}.
  if (body && body.dev === true && String(env.DEV_MODE || "") === "1") {
    const uid = String(body.userId || "999000").trim() || "999000";
    return { ok: true, userId: uid, fromLike: { username: "dev" }, dev: true };
  }
  const ttl = Number(env.TELEGRAM_INITDATA_TTL_SEC || 21600);
  return verifyTelegramInitData(body?.initData, env.TELEGRAM_BOT_TOKEN, ttl);
}

async function verifyTelegramInitData(initData, botToken, ttlSec){
  if(!initData || typeof initData !== "string") return { ok:false, reason:"initData_missing" };
  if(!botToken) return { ok:false, reason:"bot_token_missing" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if(!hash) return { ok:false, reason:"hash_missing" };
  params.delete("hash");

  const authDate = Number(params.get("auth_date") || "0");
  if(!Number.isFinite(authDate) || authDate <= 0) return { ok:false, reason:"auth_date_invalid" };
  const now = Math.floor(Date.now()/1000);
  const ttl = Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 21600;
  if(now - authDate > ttl) return { ok:false, reason:"initData_expired" };

  const pairs=[];
  for(const [k,v] of params.entries()) pairs.push([k,v]);
  pairs.sort((a,b)=>a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([k,v])=>`${k}=${v}`).join("\n");

  const secretKey = await hmacSha256Raw(utf8("WebAppData"), utf8(botToken));
  const sigHex = await hmacSha256Hex(secretKey, utf8(dataCheckString));

  if(!timingSafeEqualHex(sigHex, hash)) return { ok:false, reason:"hash_mismatch" };

  const user = safeJsonParse(params.get("user") || "") || {};
  const userId = user?.id;
  if(!userId) return { ok:false, reason:"user_missing" };
  const fromLike = { username: user?.username || "", id: userId };
  return { ok:true, userId, fromLike };
}
function utf8(s){ return new TextEncoder().encode(String(s)); }
async function hmacSha256Raw(keyBytes, msgBytes){
  const key = await crypto.subtle.importKey("raw", keyBytes, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}
async function hmacSha256Hex(keyBytes, msgBytes){
  const key = await crypto.subtle.importKey("raw", keyBytes, { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return toHex(new Uint8Array(sig));
}
function toHex(u8){ let out=""; for(const b of u8) out += b.toString(16).padStart(2,"0"); return out; }
function timingSafeEqualHex(a,b){
  a=String(a||"").toLowerCase(); b=String(b||"").toLowerCase();
  if(a.length !== b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff===0;
}

/* ========================== WORKER RESPONSE HELPERS ========================== */
function escapeHtml(s){
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function buildPaymentPageHtml({ brand, wallet, price, currency, days, support }){
  const amount = price || 0;
  const cur = currency || "USDT";
  const dur = days || 30;

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${brand} | پرداخت</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:16px; color:#111; background:#fafafa}
    .card{background:#fff; border:1px solid #e6e6e6; border-radius:16px; padding:14px; margin-bottom:12px}
    .row{display:flex; gap:12px; flex-wrap:wrap}
    .col{flex:1 1 280px}
    .muted{color:#666; font-size:12px; line-height:1.6}
    code{background:#f2f2f2; padding:4px 8px; border-radius:10px}
    input,button{width:100%; padding:12px; border-radius:12px; border:1px solid #d0d0d0; margin-top:8px; font-size:15px}
    button{cursor:pointer; background:#111; color:#fff; border:none}
    button.secondary{background:#fff; color:#111; border:1px solid #d0d0d0}
    #msg{margin-top:10px; font-size:13px}
    .ok{color:#0a7}
    .bad{color:#c00}
    img{max-width:100%; height:auto; border-radius:14px; border:1px solid #eee}
    .title{margin:0 0 6px 0}
  </style>
</head>
<body>
  <div class="card">
    <h2 class="title">💳 خرید اشتراک ${brand}</h2>
    <div class="muted">۱) پرداخت را انجام بده. ۲) TxID را ثبت کن (اینجا یا داخل بات با <code>/tx</code>). ۳) بعد از تایید مدیریت، اشتراک فعال می‌شود.</div>
  </div>

  <div class="card">
    <div><b>قیمت:</b> ${amount} ${cur}</div>
    <div><b>مدت:</b> ${dur} روز</div>
    <div style="margin-top:10px"><b>آدرس ولت (فقط همین):</b></div>
    <div style="word-break:break-all"><code id="wallet">${wallet || "—"}</code></div>
    <div class="muted" style="margin-top:6px">روی آدرس بزن تا کپی شود.</div>
  </div>

  <div class="card">
    <div class="row">
      <div class="col">
        <h3 class="title">📷 QR Code</h3>
        <div id="qrWrap">${wallet ? `<img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(wallet)}"/>` : "—"}</div>
        <div class="muted" style="margin-top:8px">QR فقط آدرس ولت را نشان می‌دهد.</div>
      </div>
      <div class="col">
        <h3 class="title">🧾 ثبت TxID</h3>
        <input id="txid" placeholder="TxID / Hash تراکنش را وارد کن" />
        <button id="submitBtn">ثبت TxID</button>
        <div id="msg" class="muted"></div>
        <div class="muted" style="margin-top:10px">
          اگر این صفحه خارج از تلگرام باز شده باشد، دکمه ثبت کار نمی‌کند؛ از بات استفاده کن.<br/>
          پشتیبانی: <b>${support || ""}</b>
        </div>
        <button id="closeBtn" class="secondary" style="margin-top:10px">بستن</button>
      </div>
    </div>
  </div>

  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <script>
    const tg = window.Telegram?.WebApp;
    try{ tg?.ready(); }catch(e){}

    const msg = document.getElementById("msg");
    const txInput = document.getElementById("txid");
    const walletEl = document.getElementById("wallet");

    walletEl?.addEventListener("click", async ()=>{
      try{
        await navigator.clipboard.writeText(walletEl.textContent.trim());
        msg.textContent = "✅ آدرس کپی شد";
        msg.className = "ok";
      }catch(e){ /* ignore */ }
    });

    document.getElementById("submitBtn").addEventListener("click", async ()=>{
      const txid = (txInput.value||"").trim();
      if(!txid){
        msg.textContent = "TxID را وارد کن.";
        msg.className = "bad";
        return;
      }
      if(!tg?.initData){
        msg.textContent = "این صفحه باید داخل تلگرام باز شود. (یا از /tx در بات استفاده کن)";
        msg.className = "bad";
        return;
      }

      msg.textContent = "در حال ثبت...";
      msg.className = "muted";
      try{
        const r = await fetch("/api/payment/submit", {
          method:"POST",
          headers:{"content-type":"application/json"},
          body: JSON.stringify({ initData: tg.initData, txid })
        });
        const j = await r.json().catch(()=>null);
        if(j?.ok){
          msg.textContent = "✅ ثبت شد. بعد از تایید مدیریت، اشتراک فعال می‌شود.";
          msg.className = "ok";
          txInput.value = "";
        }else{
          msg.textContent = "ثبت انجام نشد. لطفاً دوباره چک کن یا از /tx استفاده کن.";
          msg.className = "bad";
        }
      }catch(e){
        msg.textContent = "ثبت انجام نشد. لطفاً بعداً تلاش کن.";
        msg.className = "bad";
      }
    });

    document.getElementById("closeBtn").addEventListener("click", ()=> {
      try{ tg?.close(); }catch(e){ window.close(); }
    });
  </script>
</body>
</html>`;
}

/* ========================== MINI APP ASSETS (SMALL) ========================== */
const ADMIN_APP_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <title>MarketiQ Admin</title>
  <meta name="color-scheme" content="dark light" />
  <style>
    :root{
      --bg:#0B0F17; --card:rgba(255,255,255,.06); --text:rgba(255,255,255,.92);
      --muted:rgba(255,255,255,.62); --good:#2FE3A5; --warn:#FFB020; --bad:#FF4D4D;
      --shadow:0 10px 30px rgba(0,0,0,.35); --radius:18px;
      --font: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, "Noto Sans";
    }
    *{box-sizing:border-box}
    body{margin:0; font-family:var(--font); color:var(--text);
      background: radial-gradient(900px 500px at 25% -10%, rgba(109,94,246,.35), transparent 60%),
                 radial-gradient(800px 500px at 90% 0%, rgba(0,209,255,.20), transparent 60%),
                 linear-gradient(180deg,#070A10 0%, #0B0F17 60%, #090D14 100%);
      padding:14px 14px calc(14px + env(safe-area-inset-bottom));
    }
    .shell{max-width:1000px;margin:0 auto}
    .top{display:flex;gap:10px;align-items:center;justify-content:space-between;
      padding:12px;border-radius:20px;border:1px solid rgba(255,255,255,.08);
      background:rgba(11,15,23,.65);backdrop-filter: blur(10px);box-shadow:var(--shadow);position:sticky;top:0;z-index:10;
    }
    .brand{display:flex;gap:10px;align-items:center;min-width:0}
    .logo{width:38px;height:38px;border-radius:14px;background:linear-gradient(135deg, rgba(109,94,246,1), rgba(0,209,255,1));
      display:flex;align-items:center;justify-content:center;font-weight:900}
    .title{font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .muted{color:var(--muted)}
    .card{margin-top:12px; padding:14px;border-radius:var(--radius);border:1px solid rgba(255,255,255,.08);background:var(--card);box-shadow:var(--shadow)}
    .row{display:flex;gap:10px;flex-wrap:wrap}
    .col{flex:1;min-width:220px}
    label{display:block;font-size:12px;color:var(--muted);margin:4px 0}
    input,select,textarea{width:100%;padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.12);
      background:rgba(0,0,0,.25);color:var(--text);outline:none}
    textarea{min-height:120px;resize:vertical}
    button{border:0;border-radius:14px;padding:10px 12px;background:rgba(255,255,255,.10);color:var(--text);cursor:pointer}
    button.primary{background:linear-gradient(135deg, rgba(109,94,246,1), rgba(0,209,255,1));font-weight:900}
    button.ok{background:rgba(47,227,165,.18);border:1px solid rgba(47,227,165,.35)}
    button.danger{background:rgba(255,77,77,.15);border:1px solid rgba(255,77,77,.35)}
    .hr{height:1px;background:rgba(255,255,255,.08);margin:12px 0}
    .pill{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.20)}
    .toast{position:fixed;left:14px;right:14px;bottom:14px;max-width:1000px;margin:0 auto;
      padding:12px 14px;border-radius:18px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.55);backdrop-filter: blur(10px);
      box-shadow:var(--shadow);display:none}
    .toast.show{display:block}
    .mono{font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace}
    .preview{width:100%;max-height:220px;object-fit:cover;border-radius:14px;border:1px solid rgba(255,255,255,.12)}
  
    /* Mobile-friendly */
    @media (max-width: 720px){
      body{padding:10px 10px calc(10px + env(safe-area-inset-bottom));}
      .top{flex-direction:column; align-items:stretch; gap:8px; padding:10px;}
      .brand{width:100%}
      .actions{width:100%; display:grid; grid-template-columns: 1fr 1fr; gap:8px;}
      .actions .btn{width:100%}
      .grid{grid-template-columns:1fr !important;}
      .row{grid-template-columns:1fr !important;}
      .tabs{overflow:auto; -webkit-overflow-scrolling:touch;}
      table{display:block; overflow:auto; width:100%;}
      th,td{white-space:nowrap;}
      .card{padding:12px;}
      input,select,textarea{font-size:16px;} /* iOS zoom fix */
    }

</style>
</head>
<body>
  <div class="shell">
    <div class="top">
      <div class="brand">
        <div class="logo">M</div>
        <div style="min-width:0">
          <div class="title">MarketiQ Admin</div>
          <div class="muted" id="status">Offline</div>
        </div>
      </div>
      <div class="pill">
        <span class="muted">Token</span>
        <input id="token" class="mono" placeholder="ADMIN_TOKEN" style="width:240px;padding:8px 10px;border-radius:999px" />
        <button id="saveToken" class="primary">ورود</button>
      </div>
    </div>

    <div class="card" id="bootstrapCard">
      <div class="row">
        <div class="col">
          <div class="title" style="font-size:14px">تنظیمات اشتراک و محدودیت‌ها</div>
          <div class="muted">داده‌ها در D1 ذخیره می‌شوند و KV فقط کش/فالبک است.</div>
        </div>
      </div>

      <div class="hr"></div>

      <div class="row">
        <div class="col"><label>قیمت</label><input id="price" /></div>
        <div class="col"><label>واحد</label><input id="currency" /></div>
        <div class="col"><label>روز</label><input id="days" /></div>
      </div>

      <div class="row" style="margin-top:10px">
        <div class="col"><label>سقف روزانه رایگان</label><input id="freeLimit" /></div>
        <div class="col"><label>سقف روزانه اشتراک</label><input id="subLimit" /></div>
        <div class="col"><label>سقف ماهانه</label><input id="monthlyLimit" /></div>
      </div>

      <div style="margin-top:10px">
        <button id="saveCfg" class="ok">ذخیره</button>
        <span class="muted" id="cfgMsg" style="margin-right:10px"></span>
      </div>
    </div>

    <div class="card">
      <div class="title" style="font-size:14px">🧠 مدیریت سبک‌ها (CRUD کامل)</div>
      <div class="muted">هر سبک: key + label + prompt. Mini App از همین لیست ساخته می‌شود.</div>

      <div class="hr"></div>

      <div class="row">
        <div class="col">
          <label>انتخاب سبک</label>
          <select id="stylePick"></select>
        </div>
        <div class="col">
          <label>کلید (key)</label>
          <input id="styleKey" class="mono" placeholder="مثلاً ict" />
        </div>
        <div class="col">
          <label>نام نمایشی (label)</label>
          <input id="styleLabel" placeholder="مثلاً ICT" />
        </div>
        <div class="col">
          <label>مرتب‌سازی (sort)</label>
          <input id="styleSort" placeholder="مثلاً 10" />
        </div>
        <div class="col">
          <label>وضعیت</label>
          <select id="styleEnabled"><option value="1">فعال</option><option value="0">غیرفعال</option></select>
        </div>
      </div>

      <div style="margin-top:10px">
        <label>Prompt</label>
        <textarea id="stylePrompt" placeholder="پرامپت این سبک"></textarea>
      </div>

      <div style="margin-top:10px">
        <button id="styleSave" class="primary">ذخیره/ایجاد</button>
        <button id="styleDelete" class="danger">حذف</button>
        <span class="muted" id="styleMsg" style="margin-right:10px"></span>
      </div>
    </div>

    <div class="card">
      <div class="title" style="font-size:14px">🖼️ بنر داخل اپ (R2)</div>
      <div class="muted">آپلود با URL → ذخیره در R2 → انتخاب بنر فعال</div>

      <div class="hr"></div>

      <div class="row">
        <div class="col"><label>URL تصویر</label><input id="bannerUrl" placeholder="https://.../banner.jpg" /></div>
        <div class="col"><label>کلید (اختیاری)</label><input id="bannerKey" class="mono" placeholder="مثلاً offer_1" /></div>
        <div class="col" style="min-width:180px"><label>&nbsp;</label><button id="bannerUpload" class="primary">آپلود به R2</button></div>
      </div>

      <div style="margin-top:10px" class="row">
        <div class="col">
          <label>بنرهای موجود</label>
          <select id="bannerPick"></select>
        </div>
        <div class="col" style="min-width:180px">
          <label>&nbsp;</label>
          <button id="bannerActivate" class="ok">فعال کن</button>
        </div>
      </div>

      <div style="margin-top:10px">
        <img id="bannerPreview" class="preview" alt="preview" />
        <div class="muted" style="margin-top:8px">آدرس سرو: <span id="bannerServe" class="mono"></span></div>
      </div>
    </div>

    <div class="card">
      <div class="title" style="font-size:14px">💸 کمیسیون رفرال (بر اساس code یا username)</div>
      <div class="muted">برای بعضی لینک‌ها درصد متفاوت می‌گذاریم. اولویت: override روی code → override روی user → نرخ پیش‌فرض.</div>

      <div class="hr"></div>

      <div class="row">
        <div class="col"><label>Referral Code (start=...)</label><input id="commCode" class="mono" placeholder="mqxxxx" /></div>
        <div class="col"><label>یا Username</label><input id="commUser" class="mono" placeholder="@username یا username" /></div>
        <div class="col"><label>درصد (0..100) / خالی = حذف</label><input id="commPct" placeholder="مثلاً 12.5" /></div>
        <div class="col" style="min-width:180px"><label>&nbsp;</label><button id="commSave" class="primary">ذخیره</button></div>
      </div>
      <div class="muted" id="commMsg" style="margin-top:8px"></div>
    </div>
  </div>

  <div id="toast" class="toast"></div>
  <script src="/admin.js"></script>
</body>
</html>`;
const ADMIN_APP_JS = `const $ = (id)=>document.getElementById(id);
const toastEl = $("toast");

function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(()=>toastEl.classList.remove("show"), 2600);
}

function getToken(){
  return (localStorage.getItem("admin_token") || $("token").value || "").trim();
}
function setToken(t){
  localStorage.setItem("admin_token", t);
  $("token").value = t;
}

async function api(path, payload, method="POST"){
  const token = getToken();
  const r = await fetch(path, {
    method,
    headers: {
      "content-type":"application/json",
      "x-admin-token": token,
    },
    body: method === "GET" ? undefined : JSON.stringify(payload || {}),
  });
  const j = await r.json().catch(()=>null);
  return { ok: r.ok, status: r.status, j };
}

function setStatus(txt, ok){
  $("status").textContent = txt;
  $("status").style.color = ok ? "var(--good)" : "var(--muted)";
}

function normKey(s){
  return String(s||"").trim().toLowerCase().replace(/[^a-z0-9_]/g,"");
}

let styles = [];
let banners = [];

function fillStyles(){
  const sel = $("stylePick");
  sel.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "— جدید —";
  sel.appendChild(opt0);

  styles.forEach(st=>{
    const o = document.createElement("option");
    o.value = st.key;
    o.textContent = st.label + " (" + st.key + ")" + (st.enabled ? "" : " [OFF]");
    sel.appendChild(o);
  });
}

function pickStyle(key){
  const s = styles.find(x=>x.key===key);
  if(!s){
    $("styleKey").value = "";
    $("styleLabel").value = "";
    $("styleSort").value = "10";
    $("styleEnabled").value = "1";
    $("stylePrompt").value = "";
    return;
  }
  $("styleKey").value = s.key;
  $("styleLabel").value = s.label;
  $("styleSort").value = String(s.sort ?? 10);
  $("styleEnabled").value = s.enabled ? "1" : "0";
  $("stylePrompt").value = s.prompt || "";
}

function fillBanners(){
  const sel = $("bannerPick");
  sel.innerHTML = "";
  banners.forEach(b=>{
    const o = document.createElement("option");
    o.value = b.key;
    o.textContent = b.key + (b.active ? " (ACTIVE)" : "");
    sel.appendChild(o);
  });
  if(banners.length){
    sel.value = banners.find(b=>b.active)?.key || banners[0].key;
    updateBannerPreview();
  }
}

function updateBannerPreview(){
  const key = $("bannerPick").value;
  const b = banners.find(x=>x.key===key);
  const url = b?.serveUrl || "";
  $("bannerPreview").src = url || "";
  $("bannerServe").textContent = url || "—";
}

async function bootstrap(){
  const token = getToken();
  if(!token){
    setStatus("Token لازم است", false);
    return;
  }
  setStatus("در حال اتصال…", false);
  const r = await api("/api/admin2/bootstrap", {});
  if(!r.j?.ok){
    setStatus("ورود ناموفق", false);
    toast(r.j?.error || "auth_failed");
    return;
  }
  setStatus("Online", true);

  const c = r.j.config || {};
  $("price").value = c.price ?? "";
  $("currency").value = c.currency ?? "";
  $("days").value = c.days ?? "";
  $("freeLimit").value = c.freeLimit ?? "";
  $("subLimit").value = c.subLimit ?? "";
  $("monthlyLimit").value = c.monthlyLimit ?? "";

  styles = Array.isArray(r.j.styles) ? r.j.styles : [];
  banners = Array.isArray(r.j.banners) ? r.j.banners : [];

  fillStyles();
  fillBanners();
  pickStyle($("stylePick").value);

  toast("✅ وارد شدی");
}

$("saveToken").addEventListener("click", ()=>{
  const t = $("token").value.trim();
  if(!t){ toast("توکن را وارد کن"); return; }
  setToken(t);
  bootstrap();
});

$("stylePick").addEventListener("change", ()=> pickStyle($("stylePick").value));

$("styleSave").addEventListener("click", async ()=>{
  const key = normKey($("styleKey").value);
  const label = String($("styleLabel").value||"").trim();
  const prompt = String($("stylePrompt").value||"");
  const sort = Number($("styleSort").value||"10");
  const enabled = $("styleEnabled").value === "1";
  if(!key || !label){
    toast("key و label لازم است");
    return;
  }
  $("styleMsg").textContent = "در حال ذخیره…";
  const r = await api("/api/admin2/style/upsert", { key, label, prompt, sort, enabled });
  if(r.j?.ok){
    $("styleMsg").textContent = "✅ ذخیره شد";
    await bootstrap();
  }else{
    $("styleMsg").textContent = "❌ خطا";
    toast(r.j?.error || "try_again");
  }
});

$("styleDelete").addEventListener("click", async ()=>{
  const key = normKey($("styleKey").value);
  if(!key){ toast("key لازم است"); return; }
  if(!confirm("حذف شود؟")) return;
  $("styleMsg").textContent = "در حال حذف…";
  const r = await api("/api/admin2/style/delete", { key });
  if(r.j?.ok){
    $("styleMsg").textContent = "✅ حذف شد";
    await bootstrap();
  }else{
    $("styleMsg").textContent = "❌ خطا";
    toast(r.j?.error || "try_again");
  }
});

$("saveCfg").addEventListener("click", async ()=>{
  $("cfgMsg").textContent = "در حال ذخیره…";
  const payload = {
    price: $("price").value,
    currency: $("currency").value,
    days: $("days").value,
    freeLimit: $("freeLimit").value,
    subLimit: $("subLimit").value,
    monthlyLimit: $("monthlyLimit").value,
  };
  const r = await api("/api/admin2/config/set", payload);
  if(r.j?.ok){
    $("cfgMsg").textContent = "✅ ذخیره شد";
    toast("ذخیره شد");
  }else{
    $("cfgMsg").textContent = "❌ خطا";
    toast(r.j?.error || "try_again");
  }
});

$("bannerPick").addEventListener("change", updateBannerPreview);

$("bannerUpload").addEventListener("click", async ()=>{
  const url = String($("bannerUrl").value||"").trim();
  const key = normKey($("bannerKey").value) || "";
  if(!url){ toast("URL لازم است"); return; }
  const r = await api("/api/admin2/banner/upload", { url, key });
  if(r.j?.ok){
    toast("آپلود شد");
    $("bannerUrl").value = "";
    $("bannerKey").value = "";
    await bootstrap();
  }else{
    toast(r.j?.error || "upload_failed");
  }
});

$("bannerActivate").addEventListener("click", async ()=>{
  const key = $("bannerPick").value;
  if(!key){ toast("بنری انتخاب نشده"); return; }
  const r = await api("/api/admin2/banner/activate", { key });
  if(r.j?.ok){
    toast("فعال شد");
    await bootstrap();
  }else{
    toast(r.j?.error || "try_again");
  }
});

$("commSave").addEventListener("click", async ()=>{
  const code = String($("commCode").value||"").trim();
  const username = String($("commUser").value||"").trim().replace(/^@/,"");
  const pctRaw = String($("commPct").value||"").trim();
  const pct = pctRaw === "" ? null : Number(pctRaw);
  if(!code && !username){
    toast("کد یا یوزرنیم لازم است");
    return;
  }
  if(pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)){
    toast("درصد نامعتبر است");
    return;
  }
  $("commMsg").textContent = "در حال ذخیره…";
  const r = await api("/api/admin2/commission/set", { code: code || null, username: username || null, pct });
  if(r.j?.ok){
    $("commMsg").textContent = "✅ ذخیره شد";
    toast("ذخیره شد");
  }else{
    $("commMsg").textContent = "❌ خطا";
    toast(r.j?.error || "try_again");
  }
});

(function init(){
  const t = localStorage.getItem("admin_token") || "";
  if(t) $("token").value = t;
  bootstrap();
})();`;


/* ========================== SIMPLE MINI APP (NEW UI) ========================== */
// Mini App payloads are base64-encoded to avoid editor/paste corruption issues.
const MINI_APP_HTML_B64 = "PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImZhIiBkaXI9InJ0bCI+CjxoZWFkPgogIDxtZXRhIGNoYXJzZXQ9InV0Zi04IiAvPgogIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsaW5pdGlhbC1zY2FsZT0xLHZpZXdwb3J0LWZpdD1jb3ZlciIgLz4KICA8dGl0bGU+TWFya2V0aVEgTWluaSBBcHA8L3RpdGxlPgogIDxtZXRhIG5hbWU9ImNvbG9yLXNjaGVtZSIgY29udGVudD0iZGFyayBsaWdodCIgLz4KICA8c3R5bGU+Cjpyb290ey0tdGctYmc6IHZhcigtLXRnLXRoZW1lLWJnLWNvbG9yLCAjMGIxMjIwKTsgLS10Zy10ZXh0OiB2YXIoLS10Zy10aGVtZS10ZXh0LWNvbG9yLCAjZTllZWY5KTsgLS10Zy1oaW50OiB2YXIoLS10Zy10aGVtZS1oaW50LWNvbG9yLCByZ2JhKDIzMywyMzgsMjQ5LC43KSk7IC0tdGctc2Vjb25kYXJ5OiB2YXIoLS10Zy10aGVtZS1zZWNvbmRhcnktYmctY29sb3IsIHJnYmEoMjU1LDI1NSwyNTUsLjA2KSk7fQpib2R5e2JhY2tncm91bmQ6dmFyKC0tdGctYmcpIWltcG9ydGFudDtjb2xvcjp2YXIoLS10Zy10ZXh0KSFpbXBvcnRhbnQ7fQppbnB1dCxzZWxlY3QsdGV4dGFyZWF7YmFja2dyb3VuZDp2YXIoLS10Zy1zZWNvbmRhcnkpIWltcG9ydGFudDtjb2xvcjp2YXIoLS10Zy10ZXh0KSFpbXBvcnRhbnQ7fQo6OnBsYWNlaG9sZGVye2NvbG9yOnZhcigtLXRnLWhpbnQpIWltcG9ydGFudDt9CgogICAgOnJvb3R7CiAgICAgIC0tYmc6ICMwQjBGMTc7CiAgICAgIC0tY2FyZDogcmdiYSgyNTUsMjU1LDI1NSwuMDYpOwogICAgICAtLXRleHQ6IHJnYmEoMjU1LDI1NSwyNTUsLjkyKTsKICAgICAgLS1tdXRlZDogcmdiYSgyNTUsMjU1LDI1NSwuNjIpOwogICAgICAtLWdvb2Q6IzJGRTNBNTsKICAgICAgLS13YXJuOiNGRkIwMjA7CiAgICAgIC0tYmFkOiNGRjRENEQ7CiAgICAgIC0tc2hhZG93OiAwIDEwcHggMzBweCByZ2JhKDAsMCwwLC4zNSk7CiAgICAgIC0tcmFkaXVzOiAxOHB4OwogICAgICAtLWZvbnQ6IHVpLXNhbnMtc2VyaWYsIHN5c3RlbS11aSwgLWFwcGxlLXN5c3RlbSwgU2Vnb2UgVUksIFJvYm90bywgIkhlbHZldGljYSBOZXVlIiwgQXJpYWwsICJOb3RvIFNhbnMiOwogICAgfQogICAgKnsgYm94LXNpemluZzpib3JkZXItYm94OyB9CiAgICBib2R5ewogICAgICBtYXJnaW46MDsKICAgICAgZm9udC1mYW1pbHk6IHZhcigtLWZvbnQpOwogICAgICBjb2xvcjogdmFyKC0tdGV4dCk7CiAgICAgIGJhY2tncm91bmQ6CiAgICAgICAgcmFkaWFsLWdyYWRpZW50KDkwMHB4IDUwMHB4IGF0IDI1JSAtMTAlLCByZ2JhKDEwOSw5NCwyNDYsLjM1KSwgdHJhbnNwYXJlbnQgNjAlKSwKICAgICAgICByYWRpYWwtZ3JhZGllbnQoODAwcHggNTAwcHggYXQgOTAlIDAlLCByZ2JhKDAsMjA5LDI1NSwuMjApLCB0cmFuc3BhcmVudCA2MCUpLAogICAgICAgIGxpbmVhci1ncmFkaWVudCgxODBkZWcsICMwNzBBMTAgMCUsICMwQjBGMTcgNjAlLCAjMDkwRDE0IDEwMCUpOwogICAgICBwYWRkaW5nOiAxMnB4IDEycHggY2FsYygxNHB4ICsgZW52KHNhZmUtYXJlYS1pbnNldC1ib3R0b20pKTsKICAgIH0KICAgIC5zaGVsbHsgbWF4LXdpZHRoOiA3NjBweDsgbWFyZ2luOiAwIGF1dG87IH0KICAgIC50b3BiYXJ7CiAgICAgIHBvc2l0aW9uOiBzdGlja3k7IHRvcDogMDsgei1pbmRleDogNTA7CiAgICAgIGJhY2tkcm9wLWZpbHRlcjogYmx1cigxMHB4KTsKICAgICAgYmFja2dyb3VuZDogcmdiYSgxMSwxNSwyMywuNjUpOwogICAgICBib3JkZXI6IDFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4wOCk7CiAgICAgIGJvcmRlci1yYWRpdXM6IDIwcHg7CiAgICAgIHBhZGRpbmc6IDEycHg7CiAgICAgIGJveC1zaGFkb3c6IHZhcigtLXNoYWRvdyk7CiAgICAgIGRpc3BsYXk6ZmxleDsgYWxpZ24taXRlbXM6Y2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6c3BhY2UtYmV0d2VlbjsKICAgICAgZ2FwOiAxMHB4OwogICAgICBtYXJnaW4tYm90dG9tOiAxMnB4OwogICAgfQogICAgLmJyYW5keyBkaXNwbGF5OmZsZXg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgZ2FwOjEwcHg7IG1pbi13aWR0aDogMDsgfQogICAgLmxvZ297CiAgICAgIHdpZHRoOiAzOHB4OyBoZWlnaHQ6IDM4cHg7IGJvcmRlci1yYWRpdXM6IDE0cHg7CiAgICAgIGJhY2tncm91bmQ6IGxpbmVhci1ncmFkaWVudCgxMzVkZWcsIHJnYmEoMTA5LDk0LDI0NiwxKSwgcmdiYSgwLDIwOSwyNTUsMSkpOwogICAgICBib3gtc2hhZG93OiAwIDEwcHggMjJweCByZ2JhKDEwOSw5NCwyNDYsLjI1KTsKICAgICAgZGlzcGxheTpmbGV4OyBhbGlnbi1pdGVtczpjZW50ZXI7IGp1c3RpZnktY29udGVudDpjZW50ZXI7CiAgICAgIGZvbnQtd2VpZ2h0OiA5MDA7CiAgICB9CiAgICAudGl0bGV3cmFweyBtaW4td2lkdGg6IDA7IH0KICAgIC50aXRsZXsgZm9udC1zaXplOiAxNXB4OyBmb250LXdlaWdodDogOTAwOyB3aGl0ZS1zcGFjZTogbm93cmFwOyBvdmVyZmxvdzpoaWRkZW47IHRleHQtb3ZlcmZsb3c6IGVsbGlwc2lzOyB9CiAgICAuc3VidGl0bGV7IGZvbnQtc2l6ZTogMTJweDsgY29sb3I6IHZhcigtLW11dGVkKTsgd2hpdGUtc3BhY2U6IG5vd3JhcDsgb3ZlcmZsb3c6aGlkZGVuOyB0ZXh0LW92ZXJmbG93OiBlbGxpcHNpczsgfQogICAgLnBpbGx7CiAgICAgIGRpc3BsYXk6aW5saW5lLWZsZXg7IGFsaWduLWl0ZW1zOmNlbnRlcjsgZ2FwOjdweDsKICAgICAgcGFkZGluZzogOXB4IDEwcHg7CiAgICAgIGJvcmRlci1yYWRpdXM6IDk5OXB4OwogICAgICBib3JkZXI6IDFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4xMCk7CiAgICAgIGJhY2tncm91bmQ6IHJnYmEoMjU1LDI1NSwyNTUsLjA2KTsKICAgICAgY29sb3I6IHZhcigtLW11dGVkKTsKICAgICAgZm9udC1zaXplOiAxMnB4OwogICAgICB3aGl0ZS1zcGFjZTogbm93cmFwOwogICAgfQogICAgLmRvdHsgd2lkdGg6IDhweDsgaGVpZ2h0OiA4cHg7IGJvcmRlci1yYWRpdXM6IDk5cHg7IGJhY2tncm91bmQ6IHZhcigtLWdvb2QpOyBib3gtc2hhZG93OiAwIDAgMCAzcHggcmdiYSg0NywyMjcsMTY1LC4xMik7IH0KICAgIC5ncmlkeyBkaXNwbGF5OmdyaWQ7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogMWZyOyBnYXA6IDEycHg7IH0KLmNhcmRzeyBkaXNwbGF5OmdyaWQ7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogMWZyIDFmcjsgZ2FwOiAxMHB4OyB9CkBtZWRpYShtaW4td2lkdGg6NjgwcHgpeyAuY2FyZHN7IGdyaWQtdGVtcGxhdGUtY29sdW1uczogMWZyIDFmciAxZnI7IH0gfQouc0NhcmR7IGN1cnNvcjpwb2ludGVyOyB1c2VyLXNlbGVjdDpub25lOyBwYWRkaW5nOjEycHg7IGJvcmRlci1yYWRpdXM6MTZweDsgYm9yZGVyOjFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4xMCk7IGJhY2tncm91bmQ6IHJnYmEoMjU1LDI1NSwyNTUsLjA1KTsgZGlzcGxheTpmbGV4OyBnYXA6MTBweDsgYWxpZ24taXRlbXM6Y2VudGVyOyB0cmFuc2l0aW9uOiB0cmFuc2Zvcm0gLjA4cyBlYXNlLCBib3JkZXItY29sb3IgLjEycyBlYXNlLCBiYWNrZ3JvdW5kIC4xMnMgZWFzZTsgfQouc0NhcmQ6aG92ZXJ7IHRyYW5zZm9ybTogdHJhbnNsYXRlWSgtMXB4KTsgYm9yZGVyLWNvbG9yOiByZ2JhKDI1NSwyNTUsMjU1LC4xOCk7IGJhY2tncm91bmQ6IHJnYmEoMjU1LDI1NSwyNTUsLjA3KTsgfQouc0ljb257IHdpZHRoOjM2cHg7IGhlaWdodDozNnB4OyBib3JkZXItcmFkaXVzOjE0cHg7IGRpc3BsYXk6ZmxleDsgYWxpZ24taXRlbXM6Y2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyOyBmb250LXdlaWdodDo5MDA7IGJhY2tncm91bmQ6IHJnYmEoMTA5LDk0LDI0NiwuMzApOyBib3JkZXI6MXB4IHNvbGlkIHJnYmEoMTA5LDk0LDI0NiwuMzUpOyB9Ci5zTWV0YXsgbWluLXdpZHRoOjA7IH0KLnNOYW1leyBmb250LXdlaWdodDo5MDA7IGZvbnQtc2l6ZToxM3B4OyB3aGl0ZS1zcGFjZTpub3dyYXA7IG92ZXJmbG93OmhpZGRlbjsgdGV4dC1vdmVyZmxvdzplbGxpcHNpczsgfQouc0tleXsgZm9udC1zaXplOjExcHg7IGNvbG9yOiB2YXIoLS1tdXRlZCk7IGRpcmVjdGlvbjpsdHI7IHRleHQtYWxpZ246cmlnaHQ7IH0KLnNDYXJkLm9ueyBib3JkZXItY29sb3I6IHJnYmEoNDcsMjI3LDE2NSwuNTUpOyBiYWNrZ3JvdW5kOiByZ2JhKDQ3LDIyNywxNjUsLjA4KTsgfQouc0NhcmQub24gLnNJY29ueyBiYWNrZ3JvdW5kOiByZ2JhKDQ3LDIyNywxNjUsLjE4KTsgYm9yZGVyLWNvbG9yOiByZ2JhKDQ3LDIyNywxNjUsLjM1KTsgfQogICAgLmNhcmR7CiAgICAgIGJhY2tncm91bmQ6IHZhcigtLWNhcmQpOwogICAgICBib3JkZXI6IDFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4xMCk7CiAgICAgIGJvcmRlci1yYWRpdXM6IHZhcigtLXJhZGl1cyk7CiAgICAgIGJveC1zaGFkb3c6IHZhcigtLXNoYWRvdyk7CiAgICAgIG92ZXJmbG93OmhpZGRlbjsKICAgIH0KICAgIC5jYXJkLWh7CiAgICAgIHBhZGRpbmc6IDEycHggMTRweDsKICAgICAgZGlzcGxheTpmbGV4OwogICAgICBhbGlnbi1pdGVtczpjZW50ZXI7CiAgICAgIGp1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuOwogICAgICBib3JkZXItYm90dG9tOiAxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMDgpOwogICAgICBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwyNTUsMjU1LC4wMyk7CiAgICB9CiAgICAuY2FyZC1oIHN0cm9uZ3sgZm9udC1zaXplOiAxM3B4OyB9CiAgICAuY2FyZC1oIHNwYW57IGZvbnQtc2l6ZTogMTJweDsgY29sb3I6IHZhcigtLW11dGVkKTsgfQogICAgLmNhcmQtYnsgcGFkZGluZzogMTRweDsgfQogICAgLnJvd3sgZGlzcGxheTpmbGV4OyBnYXA6MTBweDsgZmxleC13cmFwOiB3cmFwOyBhbGlnbi1pdGVtczpjZW50ZXI7IH0KICAgIC5maWVsZHsgZGlzcGxheTpmbGV4OyBmbGV4LWRpcmVjdGlvbjogY29sdW1uOyBnYXA6OHB4OyBtaW4td2lkdGg6IDE0MHB4OyBmbGV4OjE7IH0KICAgIC5sYWJlbHsgZm9udC1zaXplOiAxMnB4OyBjb2xvcjogdmFyKC0tbXV0ZWQpOyB9CiAgICAuY29udHJvbHsKICAgICAgd2lkdGg6MTAwJTsKICAgICAgYm9yZGVyLXJhZGl1czogMTRweDsKICAgICAgYm9yZGVyOiAxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMTIpOwogICAgICBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwyNTUsMjU1LC4wNik7CiAgICAgIGNvbG9yOiB2YXIoLS10ZXh0KTsKICAgICAgcGFkZGluZzogMTJweCAxMnB4OwogICAgICBmb250LXNpemU6IDE0cHg7CiAgICAgIG91dGxpbmU6bm9uZTsKICAgIH0KICAgIC5jaGlwc3sgZGlzcGxheTpmbGV4OyBnYXA6OHB4OyBmbGV4LXdyYXA6IHdyYXA7IH0KICAgIC5jaGlwewogICAgICBib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjEyKTsKICAgICAgYmFja2dyb3VuZDogcmdiYSgyNTUsMjU1LDI1NSwuMDYpOwogICAgICBjb2xvcjogdmFyKC0tbXV0ZWQpOwogICAgICBwYWRkaW5nOiA5cHggMTJweDsKICAgICAgYm9yZGVyLXJhZGl1czogOTk5cHg7CiAgICAgIGZvbnQtc2l6ZTogMTNweDsKICAgICAgY3Vyc29yOnBvaW50ZXI7CiAgICAgIHVzZXItc2VsZWN0Om5vbmU7CiAgICB9CiAgICAuY2hpcC5vbnsKICAgICAgY29sb3I6IHJnYmEoMjU1LDI1NSwyNTUsLjkyKTsKICAgICAgYm9yZGVyLWNvbG9yOiByZ2JhKDEwOSw5NCwyNDYsLjU1KTsKICAgICAgYmFja2dyb3VuZDogcmdiYSgxMDksOTQsMjQ2LC4xNik7CiAgICAgIGJveC1zaGFkb3c6IDAgOHB4IDIwcHggcmdiYSgxMDksOTQsMjQ2LC4xNSk7CiAgICB9CiAgICAuYWN0aW9uc3sgZGlzcGxheTpmbGV4OyBnYXA6MTBweDsgZmxleC13cmFwOndyYXA7IH0KICAgIC5idG57CiAgICAgIGJvcmRlcjogMXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjEyKTsKICAgICAgYmFja2dyb3VuZDogcmdiYSgyNTUsMjU1LDI1NSwuMDYpOwogICAgICBjb2xvcjogdmFyKC0tdGV4dCk7CiAgICAgIHBhZGRpbmc6IDEycHggMTJweDsKICAgICAgYm9yZGVyLXJhZGl1czogMTZweDsKICAgICAgZm9udC1zaXplOiAxNHB4OwogICAgICBjdXJzb3I6cG9pbnRlcjsKICAgICAgZGlzcGxheTppbmxpbmUtZmxleDsgYWxpZ24taXRlbXM6Y2VudGVyOyBqdXN0aWZ5LWNvbnRlbnQ6Y2VudGVyOyBnYXA6OHB4OwogICAgICBtaW4td2lkdGg6IDEyMHB4OwogICAgICBmbGV4OiAxOwogICAgfQogICAgLmJ0bi5wcmltYXJ5ewogICAgICBib3JkZXItY29sb3I6IHJnYmEoMTA5LDk0LDI0NiwuNjUpOwogICAgICBiYWNrZ3JvdW5kOiBsaW5lYXItZ3JhZGllbnQoMTM1ZGVnLCByZ2JhKDEwOSw5NCwyNDYsLjkyKSwgcmdiYSgwLDIwOSwyNTUsLjU1KSk7CiAgICAgIGJveC1zaGFkb3c6IDAgMTJweCAzMHB4IHJnYmEoMTA5LDk0LDI0NiwuMjApOwogICAgICBmb250LXdlaWdodDogOTAwOwogICAgfQogICAgLmJ0bi5naG9zdHsgY29sb3I6IHZhcigtLW11dGVkKTsgfQogICAgLm91dHsKICAgICAgcGFkZGluZzogMTRweDsKICAgICAgZm9udC1mYW1pbHk6IHVpLW1vbm9zcGFjZSwgU0ZNb25vLVJlZ3VsYXIsIE1lbmxvLCBNb25hY28sIENvbnNvbGFzLCAiTGliZXJhdGlvbiBNb25vIiwiQ291cmllciBOZXciLCBtb25vc3BhY2U7CiAgICAgIGZvbnQtc2l6ZTogMTNweDsKICAgICAgbGluZS1oZWlnaHQ6IDEuNzU7CiAgICAgIHdoaXRlLXNwYWNlOiBwcmUtd3JhcDsKICAgICAgYmFja2dyb3VuZDogcmdiYSgwLDAsMCwuMjApOwogICAgICBib3JkZXItdG9wOiAxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMDgpOwogICAgICBtaW4taGVpZ2h0OiAyNDBweDsKICAgIH0KICAgIC50b2FzdHsKICAgICAgcG9zaXRpb246IGZpeGVkOwogICAgICBsZWZ0OiAxMnB4OyByaWdodDogMTJweDsKICAgICAgYm90dG9tOiBjYWxjKDEycHggKyBlbnYoc2FmZS1hcmVhLWluc2V0LWJvdHRvbSkpOwogICAgICBtYXgtd2lkdGg6IDc2MHB4OwogICAgICBtYXJnaW46IDAgYXV0bzsKICAgICAgYmFja2dyb3VuZDogcmdiYSgyMCwyNSwzNiwuOTIpOwogICAgICBib3JkZXI6IDFweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4xMik7CiAgICAgIGJvcmRlci1yYWRpdXM6IDE2cHg7CiAgICAgIHBhZGRpbmc6IDEycHggMTJweDsKICAgICAgYm94LXNoYWRvdzogdmFyKC0tc2hhZG93KTsKICAgICAgZGlzcGxheTpub25lOwogICAgICBnYXA6IDEwcHg7CiAgICAgIGFsaWduLWl0ZW1zOiBjZW50ZXI7CiAgICAgIHotaW5kZXg6IDEwMDsKICAgIH0KICAgIC50b2FzdC5zaG93eyBkaXNwbGF5OmZsZXg7IH0KICAgIC50b2FzdCAudHsgZm9udC1zaXplOiAxM3B4OyBjb2xvcjogdmFyKC0tdGV4dCk7IH0KICAgIC50b2FzdCAuc3sgZm9udC1zaXplOiAxMnB4OyBjb2xvcjogdmFyKC0tbXV0ZWQpOyB9CiAgICAudG9hc3QgLmJhZGdlewogICAgICBwYWRkaW5nOiA2cHggMTBweDsKICAgICAgYm9yZGVyLXJhZGl1czogOTk5cHg7CiAgICAgIGZvbnQtc2l6ZTogMTJweDsKICAgICAgYm9yZGVyOiAxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMTApOwogICAgICBiYWNrZ3JvdW5kOiByZ2JhKDI1NSwyNTUsMjU1LC4wNik7CiAgICAgIGNvbG9yOiB2YXIoLS1tdXRlZCk7CiAgICAgIHdoaXRlLXNwYWNlOiBub3dyYXA7CiAgICB9CiAgICAuc3BpbnsKICAgICAgd2lkdGg6IDE2cHg7IGhlaWdodDogMTZweDsKICAgICAgYm9yZGVyLXJhZGl1czogNTAlOwogICAgICBib3JkZXI6IDJweCBzb2xpZCByZ2JhKDI1NSwyNTUsMjU1LC4yNSk7CiAgICAgIGJvcmRlci10b3AtY29sb3I6IHJnYmEoMjU1LDI1NSwyNTUsLjg1KTsKICAgICAgYW5pbWF0aW9uOiBzcGluIC44cyBsaW5lYXIgaW5maW5pdGU7CiAgICB9CiAgICBAa2V5ZnJhbWVzIHNwaW57IHRvIHsgdHJhbnNmb3JtOiByb3RhdGUoMzYwZGVnKTsgfSB9CiAgICAubXV0ZWR7IGNvbG9yOiB2YXIoLS1tdXRlZCk7IH0KICA8L3N0eWxlPgo8L2hlYWQ+Cjxib2R5PgogIDxkaXYgY2xhc3M9InNoZWxsIj4KICAgIDxkaXYgaWQ9ImJhbm5lcldyYXAiIGNsYXNzPSJjYXJkIiBzdHlsZT0iZGlzcGxheTpub25lOyBtYXJnaW4tYm90dG9tOjEycHg7IHBhZGRpbmc6MDsgb3ZlcmZsb3c6aGlkZGVuOyI+CiAgICAgIDxpbWcgaWQ9ImJhbm5lckltZyIgYWx0PSJiYW5uZXIiIHN0eWxlPSJ3aWR0aDoxMDAlOyBoZWlnaHQ6YXV0bzsgZGlzcGxheTpibG9jazsiIC8+CiAgICA8L2Rpdj4KICAgIDxkaXYgaWQ9Im9mZmVyV3JhcCIgY2xhc3M9ImNhcmQiIHN0eWxlPSJkaXNwbGF5Om5vbmU7IG1hcmdpbi1ib3R0b206MTJweDsiPgogICAgICA8ZGl2IGNsYXNzPSJjYXJkLWIiIHN0eWxlPSJwYWRkaW5nOjEycHggMTRweDsgZGlzcGxheTpmbGV4OyBhbGlnbi1pdGVtczpjZW50ZXI7IGp1c3RpZnktY29udGVudDpzcGFjZS1iZXR3ZWVuOyBnYXA6MTBweDsiPgogICAgICAgIDxkaXYgc3R5bGU9Im1pbi13aWR0aDowIj4KICAgICAgICAgIDxkaXYgc3R5bGU9ImZvbnQtd2VpZ2h0OjkwMDsgZm9udC1zaXplOjEzcHg7Ij7DsMKfwo7CgSDDmMKiw5nCgcOYwrEgw5nCiMObwozDmsKYw5nChzwvZGl2PgogICAgICAgICAgPGRpdiBjbGFzcz0ibXV0ZWQiIGlkPSJvZmZlclRleHQiIHN0eWxlPSJtYXJnaW4tdG9wOjRweDsgZm9udC1zaXplOjEycHg7IHdoaXRlLXNwYWNlOm5vd3JhcDsgb3ZlcmZsb3c6aGlkZGVuOyB0ZXh0LW92ZXJmbG93OmVsbGlwc2lzOyI+PC9kaXY+CiAgICAgICAgICA8aW1nIGlkPSJvZmZlckltZyIgYWx0PSJvZmZlciIgc3R5bGU9ImRpc3BsYXk6bm9uZTsgbWFyZ2luLXRvcDoxMHB4OyB3aWR0aDoxMDAlOyBtYXgtaGVpZ2h0OjE2MHB4OyBvYmplY3QtZml0OmNvdmVyOyBib3JkZXItcmFkaXVzOjEycHg7IGJvcmRlcjoxcHggc29saWQgcmdiYSgyNTUsMjU1LDI1NSwuMTIpOyIvPgogICAgICAgIDwvZGl2PgogICAgICAgIDxidXR0b24gaWQ9Im9mZmVyQnRuIiBjbGFzcz0iYnRuIiBzdHlsZT0ibWluLXdpZHRoOjEyMHB4OyBmbGV4OjA7Ij7DmcKFw5jCtMOYwqfDmcKHw5jCr8OZwoc8L2J1dHRvbj4KICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KCiAgICA8ZGl2IGNsYXNzPSJ0b3BiYXIiPgogICAgICA8ZGl2IGNsYXNzPSJicmFuZCI+CiAgICAgICAgPGRpdiBjbGFzcz0ibG9nbyI+TVE8L2Rpdj4KICAgICAgICA8ZGl2IGNsYXNzPSJ0aXRsZXdyYXAiPgogICAgICAgICAgPGRpdiBjbGFzcz0idGl0bGUiPk1hcmtldGlRIE1pbmkgQXBwPC9kaXY+CiAgICAgICAgICA8ZGl2IGNsYXNzPSJzdWJ0aXRsZSIgaWQ9InN1YiI+w5jCp8OYwqrDmMK1w5jCp8OZwoTDosKAwqY8L2Rpdj4KICAgICAgICA8L2Rpdj4KICAgICAgPC9kaXY+CiAgICAgIDxkaXYgY2xhc3M9InBpbGwiPjxzcGFuIGNsYXNzPSJkb3QiPjwvc3Bhbj48c3BhbiBpZD0icGlsbFR4dCI+T25saW5lPC9zcGFuPjwvZGl2PgogICAgPC9kaXY+CgogICAgPGRpdiBpZD0iZW5lcmd5V3JhcCIgY2xhc3M9ImNhcmQiIHN0eWxlPSJtYXJnaW4tYm90dG9tOjEycHg7Ij4KICAgICAgPGRpdiBjbGFzcz0iY2FyZC1iIiBzdHlsZT0icGFkZGluZzoxMnB4IDE0cHg7Ij4KICAgICAgICA8ZGl2IHN0eWxlPSJkaXNwbGF5OmZsZXg7IGFsaWduLWl0ZW1zOmNlbnRlcjsganVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47IGdhcDoxMHB4OyI+CiAgICAgICAgICA8ZGl2IHN0eWxlPSJmb250LXdlaWdodDo5MDA7IGZvbnQtc2l6ZToxM3B4OyI+w6LCmsKhIMOYwqfDmcKGw5jCscOawpjDm8KMPC9kaXY+CiAgICAgICAgICA8ZGl2IGNsYXNzPSJtdXRlZCIgaWQ9ImVuZXJneVR4dCIgc3R5bGU9ImZvbnQtc2l6ZToxMnB4OyI+w6LCgMKUPC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdiBzdHlsZT0iaGVpZ2h0OjEwcHgiPjwvZGl2PgogICAgICAgIDxkaXYgc3R5bGU9ImJhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMDgpOyBib3JkZXI6MXB4IHNvbGlkIHJnYmEoMjU1LDI1NSwyNTUsLjEwKTsgYm9yZGVyLXJhZGl1czo5OTlweDsgb3ZlcmZsb3c6aGlkZGVuOyBoZWlnaHQ6MTJweDsiPgogICAgICAgICAgPGRpdiBpZD0iZW5lcmd5QmFyIiBzdHlsZT0iaGVpZ2h0OjEycHg7IHdpZHRoOjAlOyBiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCg5MGRlZywgcmdiYSg0NywyMjcsMTY1LC45NSksIHJnYmEoMTA5LDk0LDI0NiwuOSkpOyI+PC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdiBzdHlsZT0iaGVpZ2h0OjhweCI+PC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0ibXV0ZWQiIGlkPSJlbmVyZ3lTdWIiIHN0eWxlPSJmb250LXNpemU6MTJweDsgbGluZS1oZWlnaHQ6MS42OyI+w6LCgMKUPC9kaXY+CiAgICAgIDwvZGl2PgogICAgPC9kaXY+CgogICAgPGRpdiBjbGFzcz0iZ3JpZCI+CiAgICAgIDxkaXYgY2xhc3M9ImNhcmQiPgogICAgICAgIDxkaXYgY2xhc3M9ImNhcmQtaCI+CiAgICAgICAgICA8c3Ryb25nPsOYwqrDmMKtw5nChMObwozDmcKEIMOYwrPDmMKxw5vCjMOYwrk8L3N0cm9uZz4KICAgICAgICAgIDxzcGFuIGlkPSJtZXRhIj7DosKAwpQ8L3NwYW4+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iY2FyZC1iIj4KICAgICAgICAgIDxkaXYgY2xhc3M9InJvdyI+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImZpZWxkIiBzdHlsZT0iZmxleDoxLjQiPgogICAgICAgICAgICAgIDxkaXYgY2xhc3M9ImxhYmVsIj7DmMKsw5jCs8OYwqrDmMKsw5nCiMObwowgw5nChsOZwoXDmMKnw5jCrzwvZGl2PgogICAgICAgICAgICAgIDxpbnB1dCBpZD0icSIgY2xhc3M9ImNvbnRyb2wiIHBsYWNlaG9sZGVyPSLDmcKFw5jCq8OZwoTDmMKnw5nCiyBCVEMgw5vCjMOYwqcgRVVSIMObwozDmMKnIFhBVcOiwoDCpiIgLz4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImZpZWxkIiBzdHlsZT0iZmxleDoxIj4KICAgICAgICAgICAgICA8ZGl2IGNsYXNzPSJsYWJlbCI+w5nChsOZwoXDmMKnw5jCrzwvZGl2PgogICAgICAgICAgICAgIDxzZWxlY3QgaWQ9InN5bWJvbCIgY2xhc3M9ImNvbnRyb2wiPjwvc2VsZWN0PgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgIDxkaXYgc3R5bGU9ImhlaWdodDoxMHB4Ij48L2Rpdj4KCiAgICAgICAgICA8ZGl2IGNsYXNzPSJyb3ciPgogICAgICAgICAgICA8ZGl2IGNsYXNzPSJmaWVsZCI+CiAgICAgICAgICAgICAgPGRpdiBjbGFzcz0ibGFiZWwiPsOYwqrDmMKnw5vCjMOZwoXDosKAwozDmcKBw5jCscObwozDmcKFPC9kaXY+CiAgICAgICAgICAgICAgPGRpdiBjbGFzcz0iY2hpcHMiIGlkPSJ0ZkNoaXBzIj4KICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9ImNoaXAiIGRhdGEtdGY9Ik0xNSI+TTE1PC9kaXY+CiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPSJjaGlwIiBkYXRhLXRmPSJIMSI+SDE8L2Rpdj4KICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9ImNoaXAgb24iIGRhdGEtdGY9Ikg0Ij5INDwvZGl2PgogICAgICAgICAgICAgICAgPGRpdiBjbGFzcz0iY2hpcCIgZGF0YS10Zj0iRDEiPkQxPC9kaXY+CiAgICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgICAgPHNlbGVjdCBpZD0idGltZWZyYW1lIiBjbGFzcz0iY29udHJvbCIgc3R5bGU9ImRpc3BsYXk6bm9uZSI+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJNMTUiPk0xNTwvb3B0aW9uPgogICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT0iSDEiPkgxPC9vcHRpb24+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJINCIgc2VsZWN0ZWQ+SDQ8L29wdGlvbj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9IkQxIj5EMTwvb3B0aW9uPgogICAgICAgICAgICAgIDwvc2VsZWN0PgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPGRpdiBjbGFzcz0iZmllbGQiPgogIDxkaXYgY2xhc3M9ImxhYmVsIj7DmMKzw5jCqMOawqk8L2Rpdj4KICA8ZGl2IGNsYXNzPSJtdXRlZCIgc3R5bGU9ImZvbnQtc2l6ZToxMnB4OyBtYXJnaW4tYm90dG9tOjhweDsiPsOYwqjDmMKxw5jCp8Obwowgw5jCp8OZwobDmMKqw5jCrsOYwqfDmMKow5jCjCDDmMKxw5nCiMObwowgw5rCqcOYwqfDmMKxw5jCqiDDmMKzw5jCqMOawqkgw5jCqMOYwrLDmcKGw5vCjMOYwq8uPC9kaXY+CiAgPGRpdiBpZD0ic3R5bGVDYXJkcyIgY2xhc3M9ImNhcmRzIj48L2Rpdj4KICA8c2VsZWN0IGlkPSJzdHlsZSIgY2xhc3M9ImNvbnRyb2wiIHN0eWxlPSJkaXNwbGF5Om5vbmUiPjwvc2VsZWN0Pgo8L2Rpdj4KICAgICAgICAgICAgPGRpdiBjbGFzcz0iZmllbGQiPgogICAgICAgICAgICAgIDxkaXYgY2xhc3M9ImxhYmVsIj7DmMKxw5vCjMOYwrPDmsKpPC9kaXY+CiAgICAgICAgICAgICAgPHNlbGVjdCBpZD0icmlzayIgY2xhc3M9ImNvbnRyb2wiPgogICAgICAgICAgICAgICAgPG9wdGlvbiB2YWx1ZT0iw5rCqcOZwoUiPsOawqnDmcKFPC9vcHRpb24+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSLDmcKFw5jCqsOZwojDmMKzw5jCtyIgc2VsZWN0ZWQ+w5nChcOYwqrDmcKIw5jCs8OYwrc8L29wdGlvbj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9IsOYwrLDm8KMw5jCp8OYwq8iPsOYwrLDm8KMw5jCp8OYwq88L29wdGlvbj4KICAgICAgICAgICAgICA8L3NlbGVjdD4KICAgICAgICAgICAgPC9kaXY+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9ImZpZWxkIj4KICAgICAgICAgICAgICA8ZGl2IGNsYXNzPSJsYWJlbCI+w5jCrsOYwqjDmMKxPC9kaXY+CiAgICAgICAgICAgICAgPHNlbGVjdCBpZD0ibmV3c0VuYWJsZWQiIGNsYXNzPSJjb250cm9sIj4KICAgICAgICAgICAgICAgIDxvcHRpb24gdmFsdWU9InRydWUiIHNlbGVjdGVkPsOYwrHDmcKIw5jCtMOZwoYgw6LCnMKFPC9vcHRpb24+CiAgICAgICAgICAgICAgICA8b3B0aW9uIHZhbHVlPSJmYWxzZSI+w5jCrsOYwqfDmcKFw5nCiMOYwrQgw6LCncKMPC9vcHRpb24+CiAgICAgICAgICAgICAgPC9zZWxlY3Q+CiAgICAgICAgICAgIDwvZGl2PgogICAgICAgICAgPC9kaXY+CgogICAgICAgICAgPGRpdiBzdHlsZT0iaGVpZ2h0OjEycHgiPjwvZGl2PgoKICAgICAgICAgIDxkaXYgY2xhc3M9ImFjdGlvbnMiPgogICAgICAgICAgICA8YnV0dG9uIGlkPSJzYXZlIiBjbGFzcz0iYnRuIj7DsMKfwpLCviDDmMKww5jCrsObwozDmMKxw5nChzwvYnV0dG9uPgogICAgICAgICAgICA8YnV0dG9uIGlkPSJhbmFseXplIiBjbGFzcz0iYnRuIHByaW1hcnkiPsOiwprCoSDDmMKqw5jCrcOZwoTDm8KMw5nChDwvYnV0dG9uPgogICAgICAgICAgICA8YnV0dG9uIGlkPSJjbG9zZSIgY2xhc3M9ImJ0biBnaG9zdCI+w6LCnMKWIMOYwqjDmMKzw5jCqsOZwoY8L2J1dHRvbj4KICAgICAgICAgIDwvZGl2PgoKICAgICAgICAgIDxkaXYgc3R5bGU9ImhlaWdodDoxMHB4Ij48L2Rpdj4KICAgICAgICAgIDxkaXYgY2xhc3M9Im11dGVkIiBzdHlsZT0iZm9udC1zaXplOjEycHg7IGxpbmUtaGVpZ2h0OjEuNjsiIGlkPSJ3ZWxjb21lIj48L2Rpdj4KICAgICAgICA8L2Rpdj4KCiAgICAgICAgPGRpdiBjbGFzcz0ib3V0IiBpZD0ib3V0Ij7DmMKiw5nChcOYwqfDmMKvw5nCh8OiwoDCpjwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImNhcmQiIGlkPSJjaGFydENhcmQiIHN0eWxlPSJtYXJnaW4tdG9wOjEycHgiPgogICAgICAgICAgPGRpdiBjbGFzcz0iY2FyZC1oIj48c3Ryb25nPsOawobDmMKnw5jCscOYwqogw5nCiCDDmMKyw5nCiMOZwobDosKAwozDmcKHw5jCpzwvc3Ryb25nPjxzcGFuIGNsYXNzPSJtdXRlZCIgaWQ9ImNoYXJ0TWV0YSI+w6LCgMKUPC9zcGFuPjwvZGl2PgogICAgICAgICAgPGRpdiBjbGFzcz0iY2FyZC1iIj4KICAgICAgICAgICAgPGltZyBpZD0iY2hhcnRJbWciIGFsdD0iY2hhcnQiIHN0eWxlPSJ3aWR0aDoxMDAlOyBib3JkZXItcmFkaXVzOjE2cHg7IGRpc3BsYXk6bm9uZSIgLz4KICAgICAgICAgICAgPGRpdiBzdHlsZT0iaGVpZ2h0OjEwcHgiPjwvZGl2PgogICAgICAgICAgICA8dGV4dGFyZWEgaWQ9Impzb25PdXQiIGNsYXNzPSJjb250cm9sIiBzdHlsZT0ibWluLWhlaWdodDoxNDBweDsgZm9udC1mYW1pbHk6dWktbW9ub3NwYWNlLFNGTW9uby1SZWd1bGFyLE1lbmxvLE1vbmFjbyxDb25zb2xhcyxtb25vc3BhY2U7IGRpcmVjdGlvbjpsdHI7IGRpc3BsYXk6bm9uZSIgcmVhZG9ubHk+PC90ZXh0YXJlYT4KICAgICAgICAgIDwvZGl2PgogICAgICAgIDwvZGl2PgoKICAgICAgPC9kaXY+CiAgICA8L2Rpdj4KCiAgICA8ZGl2IGNsYXNzPSJjYXJkIiBpZD0icHJvZmlsZUNhcmQiPgogICAgICA8ZGl2IGNsYXNzPSJjYXJkLWgiPjxzdHJvbmc+w5jCrcOYwrPDmMKnw5jCqCDDmsKpw5jCp8OYwrHDmMKow5jCscObwow8L3N0cm9uZz48c3BhbiBpZD0icHJvZmlsZU1ldGEiPsOiwoDClDwvc3Bhbj48L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0iY2FyZC1iIj4KICAgICAgICA8ZGl2IGNsYXNzPSJtdXRlZCIgc3R5bGU9ImZvbnQtc2l6ZToxMnB4OyBsaW5lLWhlaWdodDoxLjciIGlkPSJwcm9maWxlT3V0Ij7DosKAwpQ8L2Rpdj4KICAgICAgICA8ZGl2IHN0eWxlPSJoZWlnaHQ6MTJweCI+PC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0icm93Ij4KICAgICAgICAgIDxkaXYgY2xhc3M9ImZpZWxkIiBzdHlsZT0iZmxleDoxLjIiPgogICAgICAgICAgICA8ZGl2IGNsYXNzPSJsYWJlbCI+w5jCosOYwq/DmMKxw5jCsyDDmMKow5jCscOYwq/DmMKnw5jCtMOYwqogKEJFUDIwKTwvZGl2PgogICAgICAgICAgICA8aW5wdXQgaWQ9ImJlcDIwIiBjbGFzcz0iY29udHJvbCIgcGxhY2Vob2xkZXI9IsOYwqLDmMKvw5jCscOYwrMgQkVQMjAgw5jCrsOZwojDmMKvIMOYwrHDmMKnIMOZwojDmMKnw5jCscOYwq8gw5rCqcOZwobDm8KMw5jCryIgLz4KICAgICAgICAgIDwvZGl2PgogICAgICAgICAgPGRpdiBjbGFzcz0iZmllbGQiIHN0eWxlPSJmbGV4Oi44Ij4KICAgICAgICAgICAgPGRpdiBjbGFzcz0ibGFiZWwiPiZuYnNwOzwvZGl2PgogICAgICAgICAgICA8YnV0dG9uIGlkPSJzYXZlQmVwMjAiIGNsYXNzPSJidG4iPsOwwp/CksK+IMOYwqvDmMKow5jCqiBCRVAyMDwvYnV0dG9uPgogICAgICAgICAgPC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgICAgPGRpdiBzdHlsZT0iaGVpZ2h0OjEwcHgiPjwvZGl2PgogICAgICAgIDxkaXYgY2xhc3M9ImFjdGlvbnMiPgogICAgICAgICAgPGJ1dHRvbiBpZD0icmVxRGVwb3NpdCIgY2xhc3M9ImJ0biI+w6LCnsKVIMOYwq/DmMKxw5jCrsOZwojDmMKnw5jCs8OYwqogw5nCiMOYwqfDmMKxw5vCjMOYwrI8L2J1dHRvbj4KICAgICAgICAgIDxidXR0b24gaWQ9InJlcVdpdGhkcmF3IiBjbGFzcz0iYnRuIj7DosKewpYgw5jCr8OYwrHDmMKuw5nCiMOYwqfDmMKzw5jCqiDDmMKow5jCscOYwq/DmMKnw5jCtMOYwqo8L2J1dHRvbj4KICAgICAgICA8L2Rpdj4KICAgICAgICA8ZGl2IHN0eWxlPSJoZWlnaHQ6MTJweCI+PC9kaXY+CiAgICAgICAgPGRpdiBjbGFzcz0iY2FyZCIgc3R5bGU9ImJhY2tncm91bmQ6cmdiYSgyNTUsMjU1LDI1NSwuMDQpOyBib3JkZXItcmFkaXVzOjE2cHg7Ij4KICAgICAgICAgIDxkaXYgY2xhc3M9ImNhcmQtYiIgc3R5bGU9InBhZGRpbmc6MTJweCAxNHB4OyI+CiAgICAgICAgICAgIDxkaXYgc3R5bGU9ImZvbnQtd2VpZ2h0OjkwMDsgZm9udC1zaXplOjEzcHg7Ij7DsMKfwqfCqSDDmcK+w5jCscOYwqfDmcKFw5nCvsOYwqogw5jCp8OYwq7DmMKqw5jCtcOYwqfDmMK1w5vCjDwvZGl2PgogICAgICAgICAgICA8ZGl2IGNsYXNzPSJtdXRlZCIgc3R5bGU9Im1hcmdpbi10b3A6NnB4OyBmb250LXNpemU6MTJweDsgbGluZS1oZWlnaHQ6MS43IiBpZD0iY3BJbmZvIj7DosKAwpQ8L2Rpdj4KICAgICAgICAgICAgPGRpdiBzdHlsZT0iaGVpZ2h0OjEwcHgiPjwvZGl2PgogICAgICAgICAgICA8dGV4dGFyZWEgaWQ9ImNwRGVzYyIgY2xhc3M9ImNvbnRyb2wiIHBsYWNlaG9sZGVyPSLDmMKnw5jCs8OYwqrDmMKxw5jCp8OYwqrDmsKYw5vCjC/DmMKzw5jCqMOawqkgw5jCrsOZwojDmMKvIMOYwrHDmMKnIMOYwqrDmcKIw5jCtsObwozDmMKtIMOYwq/DmcKHw5vCjMOYwq/DosKAwqYiIHN0eWxlPSJtaW4taGVpZ2h0OjkwcHgiPjwvdGV4dGFyZWE+CiAgICAgICAgICAgIDxkaXYgc3R5bGU9ImhlaWdodDoxMHB4Ij48L2Rpdj4KICAgICAgICAgICAgPGRpdiBjbGFzcz0iYWN0aW9ucyI+CiAgICAgICAgICAgICAgPGJ1dHRvbiBpZD0iY3BSZXEiIGNsYXNzPSJidG4gcHJpbWFyeSI+w5jCp8OYwrHDmMKzw5jCp8OZwoQgw5jCr8OYwrHDmMKuw5nCiMOYwqfDmMKzw5jCqjwvYnV0dG9uPgogICAgICAgICAgICA8L2Rpdj4KICAgICAgICAgICAgPGRpdiBzdHlsZT0iaGVpZ2h0OjhweCI+PC9kaXY+CiAgICAgICAgICAgIDxkaXYgY2xhc3M9Im11dGVkIiBpZD0iY3BTdGF0dXMiIHN0eWxlPSJmb250LXNpemU6MTJweDsiPsOiwoDClDwvZGl2PgogICAgICAgICAgPC9kaXY+CiAgICAgICAgPC9kaXY+CiAgICAgIDwvZGl2PgogICAgPC9kaXY+CiAgPC9kaXY+CgogIDxkaXYgY2xhc3M9InRvYXN0IiBpZD0idG9hc3QiPgogICAgPGRpdiBjbGFzcz0ic3BpbiIgaWQ9InNwaW4iIHN0eWxlPSJkaXNwbGF5Om5vbmUiPjwvZGl2PgogICAgPGRpdiBzdHlsZT0ibWluLXdpZHRoOjAiPgogICAgICA8ZGl2IGNsYXNzPSJ0IiBpZD0idG9hc3RUIj7DosKAwqY8L2Rpdj4KICAgICAgPGRpdiBjbGFzcz0icyIgaWQ9InRvYXN0UyI+PC9kaXY+CiAgICA8L2Rpdj4KICAgIDxkaXYgY2xhc3M9ImJhZGdlIiBpZD0idG9hc3RCIj48L2Rpdj4KICA8L2Rpdj4KCiAgPHNjcmlwdCBzcmM9Imh0dHBzOi8vdGVsZWdyYW0ub3JnL2pzL3RlbGVncmFtLXdlYi1hcHAuanMiPjwvc2NyaXB0PgogIDxzY3JpcHQgc3JjPSIvYXBwLmpzIj48L3NjcmlwdD4KPC9ib2R5Pgo8L2h0bWw+";
const MINI_APP_JS_B64 = "Y29uc3QgdGcgPSB3aW5kb3cuVGVsZWdyYW0/LldlYkFwcDsKaWYgKHRnKSB0Zy5yZWFkeSgpOwoKY29uc3Qgb3V0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoIm91dCIpOwpjb25zdCBtZXRhID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoIm1ldGEiKTsKY29uc3Qgc3ViID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInN1YiIpOwpjb25zdCBwaWxsVHh0ID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoInBpbGxUeHQiKTsKY29uc3Qgd2VsY29tZSA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCJ3ZWxjb21lIik7CgpmdW5jdGlvbiBlbChpZCl7IHJldHVybiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChpZCk7IH0KZnVuY3Rpb24gdmFsKGlkKXsgcmV0dXJuIGVsKGlkKS52YWx1ZTsgfQpmdW5jdGlvbiBzZXRWYWwoaWQsIHYpeyBlbChpZCkudmFsdWUgPSB2OyB9Cgpjb25zdCB0b2FzdCA9IGVsKCJ0b2FzdCIpOwpjb25zdCB0b2FzdFQgPSBlbCgidG9hc3RUIik7CmNvbnN0IHRvYXN0UyA9IGVsKCJ0b2FzdFMiKTsKY29uc3QgdG9hc3RCID0gZWwoInRvYXN0QiIpOwpjb25zdCBzcGluID0gZWwoInNwaW4iKTsKCmxldCBBTExfU1lNQk9MUyA9IFtdOwoKZnVuY3Rpb24gc2hvd1RvYXN0KHRpdGxlLCBzdWJsaW5lID0gIiIsIGJhZGdlID0gIiIsIGxvYWRpbmcgPSBmYWxzZSl7CiAgdG9hc3RULnRleHRDb250ZW50ID0gdGl0bGUgfHwgIiI7CiAgdG9hc3RTLnRleHRDb250ZW50ID0gc3VibGluZSB8fCAiIjsKICB0b2FzdEIudGV4dENvbnRlbnQgPSBiYWRnZSB8fCAiIjsKICBzcGluLnN0eWxlLmRpc3BsYXkgPSBsb2FkaW5nID8gImlubGluZS1ibG9jayIgOiAibm9uZSI7CiAgdG9hc3QuY2xhc3NMaXN0LmFkZCgic2hvdyIpOwp9CmZ1bmN0aW9uIGhpZGVUb2FzdCgpeyB0b2FzdC5jbGFzc0xpc3QucmVtb3ZlKCJzaG93Iik7IH0KCmZ1bmN0aW9uIGZpbGxTeW1ib2xzKGxpc3QpewogIEFMTF9TWU1CT0xTID0gQXJyYXkuaXNBcnJheShsaXN0KSA/IGxpc3Quc2xpY2UoKSA6IFtdOwogIGNvbnN0IHNlbCA9IGVsKCJzeW1ib2wiKTsKICBjb25zdCBjdXIgPSBzZWwudmFsdWU7CiAgc2VsLmlubmVySFRNTCA9ICIiOwogIGZvciAoY29uc3QgcyBvZiBBTExfU1lNQk9MUykgewogICAgY29uc3Qgb3B0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgib3B0aW9uIik7CiAgICBvcHQudmFsdWUgPSBzOwogICAgb3B0LnRleHRDb250ZW50ID0gczsKICAgIHNlbC5hcHBlbmRDaGlsZChvcHQpOwogIH0KICBpZiAoY3VyICYmIEFMTF9TWU1CT0xTLmluY2x1ZGVzKGN1cikpIHNlbC52YWx1ZSA9IGN1cjsKfQoKZnVuY3Rpb24gZmlsbFN0eWxlcyhsaXN0LCBzZWxlY3RlZEtleU9yTGFiZWwpewogIGNvbnN0IHNlbCA9IGVsKCJzdHlsZSIpOwogIGlmKCFzZWwpIHJldHVybjsKICBjb25zdCBpdGVtcyA9IEFycmF5LmlzQXJyYXkobGlzdCkgPyBsaXN0LmZpbHRlcih4PT54ICYmIHgua2V5ICYmIHgubGFiZWwpIDogW107CiAgaWYoIWl0ZW1zLmxlbmd0aCkgcmV0dXJuOwoKICBjb25zdCBjdXIgPSBzZWwudmFsdWU7CiAgc2VsLmlubmVySFRNTCA9ICIiOwogIGZvcihjb25zdCBpdCBvZiBpdGVtcyl7CiAgICBjb25zdCBvID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgib3B0aW9uIik7CiAgICBvLnZhbHVlID0gaXQua2V5OwogICAgby50ZXh0Q29udGVudCA9IGl0LmxhYmVsOwogICAgc2VsLmFwcGVuZENoaWxkKG8pOwogIH0KCiAgLy8gUHJlZmVyIHNlcnZlci1wcm92aWRlZCBzdHlsZUtleSwgb3RoZXJ3aXNlIGtlZXAgY3VycmVudCwgb3RoZXJ3aXNlIHRyeSBtYXRjaCBieSBsYWJlbAogIGNvbnN0IHByZWZlciA9IChzZWxlY3RlZEtleU9yTGFiZWwgfHwgIiIpLnRvU3RyaW5nKCkudHJpbSgpOwogIGlmKHByZWZlciAmJiBpdGVtcy5zb21lKHg9Pngua2V5PT09cHJlZmVyKSkgc2VsLnZhbHVlID0gcHJlZmVyOwogIGVsc2UgaWYoY3VyICYmIGl0ZW1zLnNvbWUoeD0+eC5rZXk9PT1jdXIpKSBzZWwudmFsdWUgPSBjdXI7CiAgZWxzZSB7CiAgICBjb25zdCBieUxhYmVsID0gaXRlbXMuZmluZCh4PT54LmxhYmVsPT09cHJlZmVyKTsKICAgIGlmKGJ5TGFiZWwpIHNlbC52YWx1ZSA9IGJ5TGFiZWwua2V5OwogIH0KfQoKZnVuY3Rpb24gcmVuZGVyU3R5bGVDYXJkcyhsaXN0LCBzZWxlY3RlZEtleSl7CiAgY29uc3Qgd3JhcCA9IGVsKCJzdHlsZUNhcmRzIik7CiAgY29uc3Qgc2VsID0gZWwoInN0eWxlIik7CiAgaWYoIXdyYXAgfHwgIXNlbCkgcmV0dXJuOwoKICBjb25zdCBpdGVtcyA9IEFycmF5LmlzQXJyYXkobGlzdCkgPyBsaXN0LmZpbHRlcih4PT54ICYmIHgua2V5ICYmIHgubGFiZWwpIDogW107CiAgd3JhcC5pbm5lckhUTUwgPSAiIjsKICBpZighaXRlbXMubGVuZ3RoKSByZXR1cm47CgogIGNvbnN0IGN1ciA9IChzZWxlY3RlZEtleSB8fCBzZWwudmFsdWUgfHwgIiIpLnRvU3RyaW5nKCk7CiAgZm9yKGNvbnN0IGl0IG9mIGl0ZW1zKXsKICAgIGNvbnN0IGNhcmQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIGNhcmQuY2xhc3NOYW1lID0gInNDYXJkIiArIChpdC5rZXkgPT09IGN1ciA/ICIgb24iIDogIiIpOwogICAgY2FyZC5kYXRhc2V0LmtleSA9IGl0LmtleTsKCiAgICBjb25zdCBpYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgaWMuY2xhc3NOYW1lID0gInNJY29uIjsKICAgIGNvbnN0IGNoID0gKGl0LmxhYmVsIHx8IGl0LmtleSB8fCAiPyIpLnRvU3RyaW5nKCkudHJpbSgpLmNoYXJBdCgwKSB8fCAiPyI7CiAgICBpYy50ZXh0Q29udGVudCA9IGNoOwoKICAgIGNvbnN0IG1ldGEgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIG1ldGEuY2xhc3NOYW1lID0gInNNZXRhIjsKCiAgICBjb25zdCBubSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoImRpdiIpOwogICAgbm0uY2xhc3NOYW1lID0gInNOYW1lIjsKICAgIG5tLnRleHRDb250ZW50ID0gaXQubGFiZWw7CgogICAgY29uc3Qga3kgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCJkaXYiKTsKICAgIGt5LmNsYXNzTmFtZSA9ICJzS2V5IjsKICAgIGt5LnRleHRDb250ZW50ID0gaXQua2V5OwoKICAgIG1ldGEuYXBwZW5kQ2hpbGQobm0pOwogICAgbWV0YS5hcHBlbmRDaGlsZChreSk7CgogICAgY2FyZC5hcHBlbmRDaGlsZChpYyk7CiAgICBjYXJkLmFwcGVuZENoaWxkKG1ldGEpOwoKICAgIGNhcmQuYWRkRXZlbnRMaXN0ZW5lcigiY2xpY2siLCAoKSA9PiB7CiAgICAgIHNlbC52YWx1ZSA9IGl0LmtleTsKICAgICAgY29uc3QgYWxsID0gd3JhcC5xdWVyeVNlbGVjdG9yQWxsKCIuc0NhcmQiKTsKICAgICAgZm9yKGNvbnN0IG4gb2YgYWxsKSBuLmNsYXNzTGlzdC5yZW1vdmUoIm9uIik7CiAgICAgIGNhcmQuY2xhc3NMaXN0LmFkZCgib24iKTsKICAgIH0pOwoKICAgIHdyYXAuYXBwZW5kQ2hpbGQoY2FyZCk7CiAgfQp9CgpmdW5jdGlvbiByZW5kZXJCYW5uZXIodXJsKXsKICBjb25zdCB3cmFwID0gZWwoImJhbm5lcldyYXAiKTsKICBjb25zdCBpbWcgPSBlbCgiYmFubmVySW1nIik7CiAgaWYoIXdyYXAgfHwgIWltZykgcmV0dXJuOwogIGlmKHVybCl7CiAgICBpbWcuc3JjID0gdXJsOwogICAgd3JhcC5zdHlsZS5kaXNwbGF5ID0gImJsb2NrIjsKICB9ZWxzZXsKICAgIHdyYXAuc3R5bGUuZGlzcGxheSA9ICJub25lIjsKICB9Cn0KCmZ1bmN0aW9uIGZpbHRlclN5bWJvbHMocSl7CiAgcSA9IChxIHx8ICIiKS50cmltKCkudG9VcHBlckNhc2UoKTsKICBjb25zdCBzZWwgPSBlbCgic3ltYm9sIik7CiAgY29uc3QgY3VyID0gc2VsLnZhbHVlOwogIHNlbC5pbm5lckhUTUwgPSAiIjsKCiAgY29uc3QgbGlzdCA9ICFxID8gQUxMX1NZTUJPTFMgOiBBTExfU1lNQk9MUy5maWx0ZXIocyA9PiBzLmluY2x1ZGVzKHEpKTsKICBmb3IgKGNvbnN0IHMgb2YgbGlzdCkgewogICAgY29uc3Qgb3B0ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgib3B0aW9uIik7CiAgICBvcHQudmFsdWUgPSBzOwogICAgb3B0LnRleHRDb250ZW50ID0gczsKICAgIHNlbC5hcHBlbmRDaGlsZChvcHQpOwogIH0KICBpZiAoY3VyICYmIGxpc3QuaW5jbHVkZXMoY3VyKSkgc2VsLnZhbHVlID0gY3VyOwp9CgpmdW5jdGlvbiBzZXRUZih0Zil7CiAgc2V0VmFsKCJ0aW1lZnJhbWUiLCB0Zik7CiAgY29uc3QgY2hpcHMgPSBlbCgidGZDaGlwcyIpPy5xdWVyeVNlbGVjdG9yQWxsKCIuY2hpcCIpIHx8IFtdOwogIGZvciAoY29uc3QgYyBvZiBjaGlwcykgYy5jbGFzc0xpc3QudG9nZ2xlKCJvbiIsIGMuZGF0YXNldC50ZiA9PT0gdGYpOwp9Cgphc3luYyBmdW5jdGlvbiBhcGkocGF0aCwgYm9keSl7CiAgY29uc3QgciA9IGF3YWl0IGZldGNoKHBhdGgsIHsKICAgIG1ldGhvZDogIlBPU1QiLAogICAgaGVhZGVyczogeyJjb250ZW50LXR5cGUiOiJhcHBsaWNhdGlvbi9qc29uIn0sCiAgICBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSwKICB9KTsKICBjb25zdCBqID0gYXdhaXQgci5qc29uKCkuY2F0Y2goKCkgPT4gbnVsbCk7CiAgcmV0dXJuIHsgc3RhdHVzOiByLnN0YXR1cywganNvbjogaiB9Owp9CgpmdW5jdGlvbiBwcmV0dHlFcnIoaiwgc3RhdHVzKXsKICBjb25zdCBlID0gaj8uZXJyb3IgfHwgIsOZwobDmMKnw5nChcOYwrTDmMKuw5jCtSI7CiAgaWYgKFN0cmluZyhlKSA9PT0gImF1dGhfZmFpbGVkIikgcmV0dXJuICLDmMKnw5vCjMOZwoYgw5nChcObwozDmcKGw5vCjMOiwoDCjMOYwqfDmcK+IMOZwoHDmcKCw5jCtyDDmMKvw5jCp8OYwq7DmcKEIMOYwqrDmcKEw5rCr8OYwrHDmMKnw5nChSDDmsKpw5jCp8OYwrEgw5nChcObwozDosKAwozDmsKpw5nChsOYwq8uIjsKICBpZiAoc3RhdHVzID09PSA0MjkgJiYgU3RyaW5nKGUpLnN0YXJ0c1dpdGgoInF1b3RhX2V4Y2VlZGVkIikpIHJldHVybiAiw5jCs8OZwofDmcKFw5vCjMOZwocgw5jCp8OZwoXDmMKxw5nCiMOYwrIgw5jCqsOZwoXDmMKnw5nChSDDmMK0w5jCry4iOwogIGlmIChzdGF0dXMgPT09IDQwMyAmJiAoU3RyaW5nKGUpID09PSAib25ib2FyZGluZ19yZXF1aXJlZCIgfHwgU3RyaW5nKGUpID09PSAib25ib2FyZGluZ19uZWVkZWQiKSkgcmV0dXJuICLDmMKnw5jCqMOYwqrDmMKvw5jCpyDDmcKGw5jCp8OZwoUgw5nCiCDDmMK0w5nChcOYwqfDmMKxw5nChyDDmMKxw5jCpyDDmMKvw5jCp8OYwq7DmcKEIMOYwrHDmMKow5jCp8OYwqogw5jCq8OYwqjDmMKqIMOawqnDmcKGw5vCjMOYwq8uIjsKICBpZiAoc3RhdHVzID09PSA0MDEpIHJldHVybiAiw5jCp8OYwq3DmMKxw5jCp8OYwrIgw5nCh8OZwojDm8KMw5jCqiDDmMKqw5nChMOawq/DmMKxw5jCp8OZwoUgw5nChsOYwqfDmcKFw5nCiMOZwoHDmcKCIMOYwqfDmMKzw5jCqi4gw5nChMOYwrfDmcKBw5jCp8OZwosgw5nChcObwozDmcKGw5vCjMOiwoDCjMOYwqfDmcK+IMOYwrHDmMKnIMOYwq/DmMKnw5jCrsOZwoQgw5jCqsOZwoTDmsKvw5jCscOYwqfDmcKFIMOYwqjDmMKnw5jCsiDDmsKpw5nChsObwozDmMKvLiI7CiAgcmV0dXJuICLDmcKFw5jCtMOawqnDmcKEw5vCjCDDmcK+w5vCjMOYwrQgw5jCosOZwoXDmMKvLiDDmcKEw5jCt8OZwoHDmMKnw5nCiyDDmMKvw5nCiMOYwqjDmMKnw5jCscOZwocgw5jCqsOZwoTDmMKnw5jCtCDDmsKpw5nChsObwozDmMKvLiI7Cn0KCmZ1bmN0aW9uIHVwZGF0ZU1ldGEoc3RhdGUsIHF1b3RhKXsKICBtZXRhLnRleHRDb250ZW50ID0gIsOYwrPDmcKHw5nChcObwozDmcKHOiAiICsgKHF1b3RhIHx8ICItIik7CiAgc3ViLnRleHRDb250ZW50ID0gIklEOiAiICsgKHN0YXRlPy51c2VySWQgfHwgIi0iKSArICIgfCDDmMKnw5nChcOYwrHDmcKIw5jCsihLeWl2KTogIiArIChzdGF0ZT8uZGFpbHlEYXRlIHx8ICItIik7Cn0KCmZ1bmN0aW9uIHVwZGF0ZUVuZXJneShlbmVyZ3kpewogIGNvbnN0IGJhciA9IGVsKCJlbmVyZ3lCYXIiKTsKICBjb25zdCB0eHQgPSBlbCgiZW5lcmd5VHh0Iik7CiAgY29uc3Qgc3VibCA9IGVsKCJlbmVyZ3lTdWIiKTsKICBpZighZW5lcmd5IHx8ICFiYXIgfHwgIXR4dCB8fCAhc3VibCkgcmV0dXJuOwoKICBjb25zdCBkID0gZW5lcmd5LmRhaWx5IHx8IHt9OwogIGNvbnN0IG0gPSBlbmVyZ3kubW9udGhseSB8fCB7fTsKICBjb25zdCBkTGltID0gTnVtYmVyLmlzRmluaXRlKGQubGltaXQpID8gZC5saW1pdCA6IG51bGw7CiAgY29uc3QgbUxpbSA9IE51bWJlci5pc0Zpbml0ZShtLmxpbWl0KSA/IG0ubGltaXQgOiBudWxsOwoKICAvLyBzaG93IHByaW1hcnkgYXMgZGFpbHksIGZhbGxiYWNrIHRvIG1vbnRobHkKICBjb25zdCB1c2VkID0gTnVtYmVyKGQudXNlZHx8MCk7CiAgY29uc3QgbGltID0gZExpbSB8fCBtTGltIHx8IDE7CiAgY29uc3QgcGN0ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAwLCBNYXRoLnJvdW5kKCh1c2VkL2xpbSkqMTAwKSkpOwogIGJhci5zdHlsZS53aWR0aCA9IHBjdCArICIlIjsKCiAgdHh0LnRleHRDb250ZW50ID0gXGDDmMKxw5nCiMOYwrI6IFwke2QudXNlZHx8MH0vXCR7ZExpbSA/PyAiw6LCiMKeIn0gfCDDmcKFw5jCp8OZwoc6IFwke20udXNlZHx8MH0vXCR7bUxpbSA/PyAiw6LCiMKeIn1cJHttLnVzZWR8fDB9LyR7bUxpbSA/PyAi4oieIn1gOwogIHN1YmwudGV4dENvbnRlbnQgPSBg2KjYp9mC24zigIzZhdin2YbYr9mHINix2YjYsjogJHtkLnJlbWFpbmluZyA/PyAi4oieIn0gfCDYqNin2YLbjOKAjNmF2KfZhtiv2Ycg2YXYp9mHOiAke20ucmVtYWluaW5nID8/ICLiiJ4ifWA7Cn0K";
function b64dec(b64){
  // atob exists in Workers; decode to UTF-8 safely
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
const MINI_APP_HTML = b64dec(MINI_APP_HTML_B64);
const MINI_APP_JS = b64dec(MINI_APP_JS_B64);


function renderOffer(offer){
  const wrap = el("offerWrap");
  const text = el("offerText");
  const btn = el("offerBtn");
  const img = el("offerImg");
  if(!wrap || !text || !btn) return;
  if(!offer || !offer.enabled || (!offer.text && !offer.image)){
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "block";
  text.textContent = offer.text || "";
  if(img){
    if(offer.image){
      img.src = offer.image;
      img.style.display = "block";
      img.onclick = ()=>{
        if(offer.url){
          try{ if(tg && typeof tg.openLink==="function") tg.openLink(offer.url); else window.open(offer.url, "_blank"); }catch(e){}
        }
      };
    } else {
      img.style.display = "none";
    }
  }
  if(offer.url){
    btn.style.display = "inline-flex";
    btn.onclick = ()=>{
      try{ if(tg && typeof tg.openLink==="function") tg.openLink(offer.url); else window.open(offer.url, "_blank"); }catch(e){}
    };
  } else {
    btn.style.display = "none";
  }
}

function renderProfile(profile){
  const box = el("profileOut");
  const metaEl = el("profileMeta");
  if(!box) return;
  const ref = profile?.refLink ? `\n🔗 رفرال: \${profile.refLink}\` : "";
  box.textContent = \`⭐ امتیاز: \${profile?.points ?? 0}\n🎁 دعوت موفق: \${profile?.invites ?? 0}\${ref}\n💰 موجودی: \${profile?.balance ?? 0}\n➕ درخواست واریز: \${profile?.depositRequests ?? 0}\n➖ درخواست برداشت: \${profile?.withdrawRequests ?? 0}\n🏦 BEP20: \${profile?.bep20Address ? profile.bep20Address : "—"}\`;
  if(metaEl) metaEl.textContent = "Profile";
  if(el("bep20") && profile?.bep20Address) el("bep20").value = profile.bep20Address;
}

async function boot(){
  // If opened outside Telegram, don't hang on "connecting"
  if(!tg || !tg.initData){
    el("conn").textContent = "برای استفاده، مینی‌اپ را داخل تلگرام باز کنید.";
    el("connDot").className = "dot off";
    // still allow basic UI (no API calls)
    return;
  }

  out.textContent = "⏳ در حال آماده‌سازی…";
  pillTxt.textContent = "Connecting…";
  showToast("در حال اتصال…", "دریافت پروفایل و تنظیمات", "API", true);

  if (!tg && !DEV) {
    hideToast();
    pillTxt.textContent = "Offline";
    out.textContent = "این مینی‌اپ فقط داخل تلگرام کار می‌کند. از داخل ربات روی «🧩 مینی‌اپ» بزن.";
    showToast("فقط داخل تلگرام", "از داخل ربات باز کن", "TG", false);
    return;
  }

  const initData = tg?.initData || "";
  const {status, json} = await api("/api/user", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined });

  if (!json?.ok) {
    hideToast();
    pillTxt.textContent = "Offline";
    const msg = prettyErr(json, status);
    out.textContent = "⚠️ " + msg;
    showToast("خطا", msg, "API", false);
    return;
  }

  welcome.textContent = json.welcome || "";
  fillSymbols(json.symbols || []);
  fillStyles(json.styles || [], (json.styleKey || (json.state && json.state.style) || ""));
  renderStyleCards(json.styles || [], el("style").value);

  // live refresh catalogs when admin changes (version bump)
  try{
    window.__stylesVer = String(json.stylesVersion || "0");
    window.__bannersVer = String(json.bannersVersion || "0");
    if(!window.__catalogPoll){
      window.__catalogPoll = setInterval(async ()=>{
        try{
          const u = await api("/api/user", { initData: STATE.initData });
          if(!u || !u.ok) return;

          const nv = String(u.stylesVersion || "0");
          if(nv && nv !== window.__stylesVer){
            window.__stylesVer = nv;
            fillStyles(u.styles || []);
            renderStyleCards(u.styles || [], el("style").value);
          }

          const bv = String(u.bannersVersion || "0");
          if(bv && bv !== window.__bannersVer){
            window.__bannersVer = bv;
            renderBanner(u.bannerUrl || "");
          }
        }catch(_e){}
      }, 45000);
    }
  }catch(_e){}

  renderBanner(json.bannerUrl || "");
  renderOffer(json.offer);
  updateEnergy(json.energy);
  renderProfile(json.profile);
  if(el("cpInfo")) el("cpInfo").textContent = json.infoText || "";
  if(el("cpStatus")) el("cpStatus").textContent = "وضعیت: " + (json.customPrompt?.status || "none");
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
    dev: DEV,
    userId: DEV ? DEV_UID : undefined,
    timeframe: val("timeframe"),
    style: val("style"),
    risk: val("risk"),
    newsEnabled: val("newsEnabled") === "true",
  };

  const {status, json} = await api("/api/settings", payload);
  if (!json?.ok) {
    const msg = prettyErr(json, status);
    out.textContent = "⚠️ " + msg;
    showToast("خطا", msg, "SET", false);
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
  const payload = { initData, dev: DEV, userId: DEV ? DEV_UID : undefined, symbol: val("symbol"), userPrompt: "" };

  const {status, json} = await api("/api/analyze", payload);
  if (!json?.ok) {
    const msg = prettyErr(json, status);
    out.textContent = "⚠️ " + msg;
    showToast("خطا", msg, status === 429 ? "Quota" : "AI", false);
    return;
  }

  out.textContent = json.result || "⚠️ بدون خروجی";
  // Render chart image (QuickChart) + structured JSON (zones/levels)
  try{
    const img = el("chartImg");
    const meta = el("chartMeta");
    const jbox = el("jsonOut");
    if(meta) meta.textContent = (val("symbol") || "").toUpperCase();
    if(img){
      if(json.chartUrl){ img.src = json.chartUrl; img.style.display = "block"; }
      else { img.style.display = "none"; }
    }
    if(jbox){
      if(json.modelJson){ jbox.value = JSON.stringify(json.modelJson, null, 2); jbox.style.display = "block"; }
      else { jbox.style.display = "none"; }
    }
  }catch(_e){}
  updateMeta(json.state, json.quota);
  showToast("آماده ✅", "خروجی دریافت شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("close").addEventListener("click", () => tg?.close());

// Wallet + custom prompt actions
el("saveBep20")?.addEventListener("click", async ()=>{
  showToast("در حال ثبت…", "ذخیره آدرس BEP20", "WAL", true);
  const initData = tg?.initData || "";
  const address = val("bep20");
  const {status, json} = await api("/api/wallet/set_bep20", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined, address });
  if(!json?.ok){
    const msg = (json?.error === "invalid_bep20") ? "آدرس نامعتبر است." : prettyErr(json, status);
    showToast("خطا", msg, "WAL", false);
    out.textContent = "⚠️ " + msg;
    return;
  }
  showToast("ثبت شد ✅", "آدرس BEP20 ذخیره شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("reqDeposit")?.addEventListener("click", async ()=>{
  showToast("ثبت درخواست…", "درخواست واریز ارسال می‌شود", "DEP", true);
  const initData = tg?.initData || "";
  const {status, json} = await api("/api/wallet/request_deposit", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined });
  if(!json?.ok){
    const msg = prettyErr(json, status);
    showToast("خطا", msg, "DEP", false);
    return;
  }
  showToast("ارسال شد ✅", "درخواست واریز ثبت شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("reqWithdraw")?.addEventListener("click", async ()=>{
  showToast("ثبت درخواست…", "درخواست برداشت بررسی می‌شود", "WD", true);
  const initData = tg?.initData || "";
  const {status, json} = await api("/api/wallet/request_withdraw", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined });
  if(!json?.ok){
    const msg = (json?.error === "bep20_required") ? "برای برداشت ابتدا آدرس BEP20 را ثبت کن." : prettyErr(json, status);
    showToast("خطا", msg, "WD", false);
    out.textContent = "⚠️ " + msg;
    return;
  }
  showToast("ارسال شد ✅", "درخواست برداشت ثبت شد", "OK", false);
  setTimeout(hideToast, 1200);
});

el("cpReq")?.addEventListener("click", async ()=>{
  const desc = (el("cpDesc")?.value || "").trim();
  if(desc.length < 10){
    showToast("توضیح کوتاه است", "لطفاً جزئیات بیشتری بنویس", "CP", false);
    return;
  }
  showToast("در حال ارسال…", "پرامپت شما ساخته می‌شود", "CP", true);
  const initData = tg?.initData || "";
  const {status, json} = await api("/api/custom_prompt/request", { initData, dev: DEV, userId: DEV ? DEV_UID : undefined, desc });
  if(!json?.ok){
    const msg = (json?.error === "desc_too_short") ? (json?.info || "توضیح کوتاه است") : prettyErr(json, status);
    showToast("خطا", msg, "CP", false);
    return;
  }
  if(el("cpStatus")) el("cpStatus").textContent = "وضعیت: pending | آماده پس از: " + (json.readyAt || "—");
  showToast("ثبت شد ✅", "۲ ساعت بعد ارسال می‌شود", "OK", false);
  setTimeout(hideToast, 1400);
});

boot();
`;
/* ========================== SUPPORT TICKETS ========================== */
function uuid(){
  return (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2)));
}
async function createTicket(env, {userId, chatId, message}){
  if(!hasD1(env)) return {ok:false, error:"d1_required"};
  await ensureD1Schema(env);
  const id = "t_" + uuid();
  const now = new Date().toISOString();
  await env.BOT_DB.prepare(`
    INSERT INTO tickets (id, user_id, chat_id, status, message, created_at, updated_at)
    VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?5)
  `).bind(id, String(userId), String(chatId), String(message||""), now).run();
  return {ok:true, id, status:"open", createdAt:now};
}
async function listTickets(env, {userId, limit=10}){
  if(!hasD1(env)) return {ok:false, error:"d1_required"};
  await ensureD1Schema(env);
  const res = await env.BOT_DB.prepare(`
    SELECT id, status, message, created_at, updated_at
    FROM tickets
    WHERE user_id=?1
    ORDER BY created_at DESC
    LIMIT ?2
  `).bind(String(userId), Number(limit)||10).all();
  return {ok:true, items: (res.results||[]).map(r=>({
    id:r.id, status:r.status, message:r.message, createdAt:r.created_at, updatedAt:r.updated_at
  }))};
}

};