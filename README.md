# بات تلگرام سیگنال/تحلیل + مینی‌اپ + پنل ادمین (Cloudflare Worker)

این پروژه یک Cloudflare Worker + grammY است که:
- Webhook تلگرام را هندل می‌کند
- داده‌ها را در Cloudflare KV ذخیره می‌کند
- Cron هر ۵ دقیقه، custom prompt های موعددار را برای کاربر ارسال می‌کند
- یک Mini App ساده در `/app` و یک Admin Panel ساده در `/admin` دارد
- برای تحلیل از OpenAI Responses API یا Gemini استفاده می‌کند

> نکته: برای تولید تصویر چارت، از QuickChart استفاده شده (chartjs-chart-financial + annotation).

---

## 1) پیش‌نیازها
- Cloudflare Workers + Wrangler
- یک KV Namespace بسازید و ID را در `wrangler.toml` قرار دهید
- در BotFather توکن بگیرید

---

## 2) تنظیم Secrets
```bash
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET

# اگر استفاده می‌کنید:
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ALPHAVANTAGE_API_KEY
# ...
```

---

## 3) تنظیم BOT_INFO
1) در مرورگر:
`https://api.telegram.org/bot<BOT_TOKEN>/getMe`
2) مقدار `result` را بردارید و داخل `BOT_INFO` در `wrangler.toml` قرار دهید.

---

## 4) Deploy
```bash
npm i
npm run deploy
```

---

## 5) ست کردن Webhook
در تلگرام باید webhook روی URL Worker تنظیم شود.

### روش سریع (Browser)
```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<WORKER>.<SUBDOMAIN>.workers.dev/webhook&secret_token=<WEBHOOK_SECRET>
```

### روش اسکریپت
1) فایل `scripts/setWebhook.js` را ببینید
2) env های `BOT_TOKEN`, `WEBHOOK_SECRET`, `PUBLIC_BASE_URL` را ست کنید
3) سپس:
```bash
npm run set-webhook
```

---

## 6) GitHub Auto Deploy
در ریپوی GitHub:
- Secrets را بگذارید:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- هر push روی `main` -> deploy

---

## مسیرها
- `POST /webhook`  ورودی آپدیت‌های تلگرام
- `GET /app`       مینی‌اپ
- `GET /admin`     پنل ادمین (با توکن)
- `POST /api/*`    APIهای مینی‌اپ
- `POST /admin/api/*` APIهای پنل ادمین

---

## نکته‌های مهم
- برای اینکه Mini App بتواند کاربر را تشخیص دهد، از `initData` تلگرام استفاده می‌کند و Worker آن را verify می‌کند.
- برای مقیاس بالا، بهتر است پرداخت‌ها/لیست‌ها را به D1 یا Durable Object منتقل کنید. این نسخه KV-only است.



---

## Scale (Queue-first برای 100k کاربر)
مسیر تحلیل (/signals) به Queue منتقل شده تا webhook سریع جواب بدهد و از Timeout/هنگ جلوگیری شود.

### لازم است در Cloudflare بسازید:
- Queue: `valinaf25-jobs` (Binding: `JOBS`)
- (اختیاری) R2 bucket: `valinaf25-assets` (Binding: `ASSETS`)

> بعد از ساخت Queue و Deploy، /signals پیام «در حال پردازش…» می‌دهد و نتیجه با کمی تاخیر ارسال می‌شود.


### Cache تحلیل AI
برای کاهش هزینه و افزایش سرعت، خروجی AI برای هر (market/symbol/tf/style/risk/news) به مدت ~90 ثانیه در KV کش می‌شود.
کلید: `cache:analysis:...`


### کش تحلیل (AI Cache)
برای کاهش هزینه و افزایش سرعت، نتیجه تحلیل برای ترکیب (market/symbol/tf/style/risk/news) به مدت ~120 ثانیه در KV کش می‌شود.


### بررسی خودکار پرداخت (Auto-Verify)
برای فعال‌سازی:
- Secret: BSCSCAN_API_KEY
- Variable: AUTO_VERIFY=ON
- Wallet عمومی را با /setwallet یا config:wallet تنظیم کنید.


### Plans (KV)
- Admin: /admin → Subscription Plans (کلید config:plans)
- User: /buy shows plans, /tx TXID PLAN_ID chooses a plan.


### UX خرید (Inline Buttons)
در /buy و /pay پلن‌ها با دکمه‌های Inline نمایش داده می‌شوند و انتخاب پلن در پروفایل ذخیره می‌شود؛ سپس /tx فقط TxID می‌خواهد.


### دکمه «پرداخت کردم»
بعد از انتخاب پلن در /buy، دکمه «✅ پرداخت کردم» نمایش داده می‌شود تا کاربر بدون تایپ، راهنمای ارسال TxID را دریافت کند.
# dd
