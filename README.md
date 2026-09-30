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

## Eslatmalar

- O'yin dvigateli `body` ning to'g'ridan-to'g'ri bolalarini o'zi boshqaradi, shuning uchun `page.tsx` da canvas hech qanday o'rovchi elementga olinmaydi.
- Custom server ishlatilgani uchun loyiha Vercel serverless'ga emas, Node.js serverga (VPS, Railway, Render, Fly.io) joylanadi.
- `.env` git'ga qo'shilmaydi.
