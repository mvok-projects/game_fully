# Territorial (Next.js)

Territorial.io o'yinining o'zbekcha, offline single-player versiyasi va xonalar tizimi.

## Tuzilishi

| Yo'l | Vazifasi |
|---|---|
| `app/layout.tsx`, `app/page.tsx` | Sahifa: `body` ichida faqat `<canvas id="canvasA">` |
| `components/GameLoader.tsx` | O'yin skriptini gidratatsiyadan keyin bir marta yuklaydi |
| `public/game/game.js` | O'yin dvigateli (obfuskatsiya qilingan, tarmoqsiz, o'zbekcha) |
| `server.mjs` | Custom server: Next.js + xonalar WebSocket'i (`/ws`) bitta portda |
| `server/rooms.mjs` | Xona amallari: create / find / join / leave / start |
| `server/db.mjs` | Neon PostgreSQL: `rooms`, `room_players` jadvallari |

## Ishga tushirish

```bash
cp .env.example .env   # DATABASE_URL ni kiriting
npm install
npm run dev            # http://localhost:3000
```

Production:

```bash
npm run build
npm start
```

## Joylash (Vercel + Railway)

Vercel serverless bo'lgani uchun doimiy WebSocket'ni ushlab turmaydi, shuning uchun:

| Joy | Nima ishlaydi | O'zgaruvchilar |
|---|---|---|
| **Railway** | `npm run build` → `npm start` (xonalar + o'yin serveri, `/ws`) | `DATABASE_URL`, `ALLOWED_ORIGINS=https://game-fully.vercel.app` |
| **Vercel** | Sayt (frontend) | `NEXT_PUBLIC_ROOMS_WS_URL=wss://<railway-domen>/ws` |

- `NEXT_PUBLIC_ROOMS_WS_URL` build vaqtida kodga yoziladi — o'zgartirgandan keyin Vercel'da **Redeploy** qiling.
- Railway'da replikalar soni **1** bo'lsin: o'yin sessiyalari server xotirasida turadi.

## Eslatmalar

- O'yin dvigateli `body` ning to'g'ridan-to'g'ri bolalarini o'zi boshqaradi, shuning uchun `page.tsx` da canvas hech qanday o'rovchi elementga olinmaydi.
- `.env` git'ga qo'shilmaydi.
