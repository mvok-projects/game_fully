// Xona/o'yin ichidagi matnli chat. Xabarlar xona kodi bo'yicha server xotirasida saqlanadi
// (oxirgi HISTORY_SIZE ta), shunda keyin qo'shilgan yoki sahifani yangilagan o'yinchi ham ko'radi.

const MAX_LENGTH = 200;
const HISTORY_SIZE = 50;
// Spamga qarshi: har bir ulanish WINDOW_MS ichida ko'pi bilan WINDOW_LIMIT ta xabar yubora oladi.
const WINDOW_MS = 10000;
const WINDOW_LIMIT = 6;
const MIN_INTERVAL_MS = 400;
const HISTORY_TTL_MS = 1000 * 60 * 60 * 3;

// Haqoratli so'zlar yulduzcha bilan yopiladi. Faqat butun so'z moslashadi —
// "shitirlash" kabi zararsiz so'zlar ichidagi bo'laklar tegilmaydi. Katta-kichik harf farqsiz.
const BAD_WORDS = [
    "jalab", "jalablar", "qanjiq", "itvachcha", "haromi", "dalbayob", "dalbayoblar", "sikay", "sikaman",
    "blyat", "blya", "suka", "pidor", "pidoras", "nahuy", "xuy", "huy", "yebat",
    "fuck", "fucking", "shit", "bitch", "asshole", "cunt", "nigger", "faggot",
];
const BAD_RE = new RegExp(`(^|[^\\p{L}])(${BAD_WORDS.join("|")})(?![\\p{L}])`, "giu");

export class ChatError extends Error {}

export function cleanText(raw) {
    const text = String(raw ?? "")
        .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_LENGTH);
    return text.replace(BAD_RE, (match, lead) => lead + "*".repeat([...match].length - [...lead].length));
}

export class ChatRooms {
    constructor() {
        this.rooms = new Map();
        this.nextId = 1;
    }

    // ws.session.chat — ulanishning so'nggi xabar vaqtlari (spam cheklovi uchun).
    post(ws, code, author, raw) {
        const text = cleanText(raw);
        if (!text) {
            throw new ChatError("Xabar boʻsh");
        }
        const now = Date.now();
        const times = (ws.session.chat ||= []).filter((t) => now - t < WINDOW_MS);
        ws.session.chat = times;
        if (times.length >= WINDOW_LIMIT || (times.length && now - times[times.length - 1] < MIN_INTERVAL_MS)) {
            throw new ChatError("Juda tez yozyapsiz, biroz kuting");
        }
        times.push(now);
        const message = { id: this.nextId++, playerId: author.id, name: author.name, color: author.color, text, at: now };
        let room = this.rooms.get(code);
        if (!room) {
            room = { messages: [], updatedAt: now };
            this.rooms.set(code, room);
        }
        room.messages.push(message);
        if (room.messages.length > HISTORY_SIZE) {
            room.messages.splice(0, room.messages.length - HISTORY_SIZE);
        }
        room.updatedAt = now;
        return message;
    }

    history(code) {
        return this.rooms.get(code)?.messages.slice() || [];
    }

    drop(code) {
        this.rooms.delete(code);
    }

    prune() {
        const now = Date.now();
        for (const [code, room] of this.rooms) {
            if (now - room.updatedAt > HISTORY_TTL_MS) {
                this.rooms.delete(code);
            }
        }
    }
}
