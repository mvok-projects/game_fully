import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { migrate, cleanup, getRoom, createRoom, joinRoom, leaveRoom, startRoom, normalizeCode, RoomError } from "./db.mjs";
import { GameSession } from "./game.mjs";
import { ChatRooms, ChatError } from "./chat.mjs";

const WS_PATH = "/ws";
// Vergul bilan ajratilgan ruxsat etilgan saytlar, masalan: https://game-fully.vercel.app
// Bo'sh bo'lsa, istalgan sayt ulanishi mumkin.
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_PLAYER_OPTIONS = [2, 4, 8, 16];
// Xonada (o'yin boshlanmagan) aloqa uzilsa, o'rin shu vaqt saqlanadi — sahifani yangilash uchun.
const ROOM_GRACE_MS = 20000;
const TOKEN_TTL_MS = 1000 * 60 * 60 * 3;

// Xonalar WebSocket serverini mavjud HTTP serverga ulaydi.
// Faqat /ws yo'lidagi upgrade so'rovlarini oladi, qolganlari (masalan Next HMR) o'zgarishsiz qoladi.
export async function attachRooms(httpServer) {
    await migrate();
    await cleanup({ dropWaiting: true });

    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    const watchers = new Map();
    const games = new Map();
    // Qayta ulanish tokenlari: token → { playerId, createdAt }. Token faqat o'yinchining o'ziga beriladi.
    const tokens = new Map();
    const pendingLeaves = new Map();
    const chat = new ChatRooms();

    function issueToken(ws) {
        if (!ws.session.token) {
            ws.session.token = crypto.randomUUID();
            tokens.set(ws.session.token, { playerId: ws.session.playerId, createdAt: Date.now() });
        }
        return ws.session.token;
    }

    function cancelPendingLeave(playerId) {
        clearTimeout(pendingLeaves.get(playerId));
        pendingLeaves.delete(playerId);
    }

    httpServer.on("upgrade", (req, socket, head) => {
        const { pathname } = new URL(req.url, "http://localhost");
        if (pathname !== WS_PATH) {
            return;
        }
        if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(req.headers.origin)) {
            socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    });

    function watch(ws, code) {
        unwatch(ws);
        ws.session.code = code;
        if (!watchers.has(code)) {
            watchers.set(code, new Set());
        }
        watchers.get(code).add(ws);
    }

    function unwatch(ws) {
        const code = ws.session.code;
        if (code && watchers.has(code)) {
            watchers.get(code).delete(ws);
            if (!watchers.get(code).size) {
                watchers.delete(code);
            }
        }
        ws.session.code = null;
    }

    function publish(code, room) {
        const set = watchers.get(code);
        if (!set) {
            return;
        }
        const data = JSON.stringify(room ? { type: "room", room } : { type: "room_closed", code });
        for (const client of set) {
            if (client.readyState === client.OPEN) {
                client.send(data);
            }
            if (!room) {
                client.session.code = null;
            }
        }
        if (!room) {
            watchers.delete(code);
            chat.drop(code);
        }
    }

    // Chat xabari xonani kuzatayotganlarga (lobbi) va o'yin qatnashchilariga boradi.
    function broadcastChat(code, message) {
        const targets = new Set(watchers.get(code));
        for (const m of games.get(code)?.members || []) {
            if (m.connected) {
                targets.add(m.ws);
            }
        }
        const data = JSON.stringify({ type: "chat", code, message });
        for (const client of targets) {
            if (client.readyState === client.OPEN) {
                client.send(data);
            }
        }
    }

    function chatCode(ws) {
        return ws.game?.code || ws.session.code;
    }

    function setAuthor(ws, player) {
        ws.session.author = { id: ws.session.playerId, name: player.name, color: player.color };
    }

    function cleanPlayer(msg) {
        const name = String(msg.name || "").trim().slice(0, 20) || "Oʻyinchi";
        const color = /^rgb\(\d{1,3},\s?\d{1,3},\s?\d{1,3}\)$/.test(String(msg.color)) ? String(msg.color) : "rgb(120,120,255)";
        const colorCode = Number.isInteger(msg.colorCode) && msg.colorCode >= 0 && msg.colorCode < 262144 ? msg.colorCode : 0;
        return { name, color, colorCode };
    }

    function int(value, min, max) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max) {
            throw new RoomError("Notoʻgʻri maʼlumot");
        }
        return n;
    }

    async function leaveCurrent(ws) {
        if (ws.game) {
            ws.game.leave(ws);
        }
        const { code, playerId } = ws.session;
        if (!code) {
            return;
        }
        cancelPendingLeave(playerId);
        unwatch(ws);
        publish(code, await leaveRoom(code, playerId));
    }

    // Aloqa uzilganda darhol chiqarib yubormaymiz: sahifa yangilanishi mumkin.
    function disconnect(ws) {
        if (ws.game) {
            ws.game.disconnect(ws);
        }
        const { code, playerId } = ws.session;
        if (!code) {
            return;
        }
        unwatch(ws);
        cancelPendingLeave(playerId);
        pendingLeaves.set(playerId, setTimeout(() => {
            pendingLeaves.delete(playerId);
            leaveRoom(code, playerId).then((room) => publish(code, room)).catch((e) => console.error("[rooms:grace leave]", e));
        }, ROOM_GRACE_MS));
    }

    const actions = {
        async create(ws, msg) {
            await leaveCurrent(ws);
            const maxPlayers = int(msg.maxPlayers, 2, 16);
            if (!MAX_PLAYER_OPTIONS.includes(maxPlayers)) {
                throw new RoomError("Notoʻgʻri maʼlumot");
            }
            const player = cleanPlayer(msg);
            const room = await createRoom({ id: ws.session.playerId, ...player }, {
                mapIndex: int(msg.mapIndex, 0, 63),
                mapName: String(msg.mapName || "").slice(0, 40),
                maxPlayers,
                botCount: int(msg.botCount, 0, 511)
            });
            watch(ws, room.code);
            setAuthor(ws, player);
            return { room, playerId: ws.session.playerId, token: issueToken(ws) };
        },
        async find(ws, msg) {
            const room = await getRoom(msg.code);
            if (!room) {
                throw new RoomError("Xona topilmadi");
            }
            return room;
        },
        async join(ws, msg) {
            await leaveCurrent(ws);
            const player = cleanPlayer(msg);
            const room = await joinRoom(msg.code, { id: ws.session.playerId, ...player });
            watch(ws, room.code);
            setAuthor(ws, player);
            publish(room.code, room);
            return { room, playerId: ws.session.playerId, token: issueToken(ws) };
        },
        async resume(ws, msg) {
            const entry = tokens.get(String(msg.token || ""));
            if (!entry) {
                throw new RoomError("Sessiya topilmadi");
            }
            const code = normalizeCode(msg.code);
            const { playerId } = entry;
            const game = games.get(code);
            const room = await getRoom(code);
            const inRoom = !!room && room.players.some((p) => p.id === playerId);
            const inGame = !!game && game.hasMember(playerId);
            if (!inRoom && !inGame) {
                throw new RoomError("Xona topilmadi");
            }
            await leaveCurrent(ws);
            cancelPendingLeave(playerId);
            ws.session.playerId = playerId;
            ws.session.token = msg.token;
            if (inRoom) {
                watch(ws, code);
            }
            if (inGame) {
                ws.afterReply = game.reattach(playerId, ws);
            }
            const current = inGame ? game.room : room;
            const me = current.players.find((p) => p.id === playerId);
            if (me) {
                setAuthor(ws, me);
            }
            return { room: current, playerId, inGame };
        },
        async leave(ws) {
            await leaveCurrent(ws);
            return null;
        },
        async start(ws) {
            const { code, playerId } = ws.session;
            if (!code) {
                throw new RoomError("Siz xonada emassiz");
            }
            const wasWaiting = (await getRoom(code))?.status === "waiting";
            const room = await startRoom(code, playerId);
            if (wasWaiting && room.players.length > 1) {
                startGame(room);
            }
            publish(code, room);
            return room;
        },
        async chat(ws, msg) {
            const code = chatCode(ws);
            if (!code || !ws.session.author) {
                throw new RoomError("Siz xonada emassiz");
            }
            let message;
            try {
                message = chat.post(ws, code, ws.session.author, msg.text);
            } catch (e) {
                throw e instanceof ChatError ? new RoomError(e.message) : e;
            }
            broadcastChat(code, message);
            return null;
        },
        async chatHistory(ws) {
            const code = chatCode(ws);
            return code ? { code, messages: chat.history(code) } : { code: null, messages: [] };
        }
    };

    // O'yinchilar indeksi xonaga qo'shilish tartibida (0..n-1), mijozlar ham xuddi shu tartibdan foydalanadi.
    function startGame(room) {
        const sockets = watchers.get(room.code) || new Set();
        const members = [];
        room.players.forEach((p, index) => {
            for (const ws of sockets) {
                if (ws.session.playerId === p.id) {
                    members.push({ ws, index, playerId: p.id });
                }
            }
        });
        const session = new GameSession(room, members, (s) => {
            if (games.get(s.code) === s) {
                games.delete(s.code);
                chat.drop(s.code);
            }
        });
        games.set(room.code, session);
    }

    wss.on("connection", (ws) => {
        ws.session = { playerId: crypto.randomUUID(), code: null };
        ws.isAlive = true;
        ws.on("pong", () => {
            ws.isAlive = true;
        });
        ws.on("message", async (raw, isBinary) => {
            if (isBinary) {
                if (ws.game) {
                    ws.game.handlePacket(ws, new Uint8Array(raw));
                }
                return;
            }
            let msg;
            try {
                msg = JSON.parse(raw);
            } catch {
                return;
            }
            const reply = (body) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ id: msg.id, ...body }));
            const action = actions[msg.action];
            if (!action) {
                reply({ ok: false, error: "Nomaʼlum amal" });
                return;
            }
            try {
                reply({ ok: true, data: await action(ws, msg) });
                if (ws.afterReply) {
                    const after = ws.afterReply;
                    ws.afterReply = null;
                    after();
                }
            } catch (e) {
                if (!(e instanceof RoomError)) {
                    console.error(`[rooms:${msg.action}]`, e);
                }
                reply({ ok: false, error: e instanceof RoomError ? e.message : "Server xatosi" });
            }
        });
        ws.on("close", () => {
            disconnect(ws);
        });
    });

    const heartbeat = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, 30000);

    const janitor = setInterval(() => {
        const now = Date.now();
        for (const [token, entry] of tokens) {
            if (now - entry.createdAt > TOKEN_TTL_MS) {
                tokens.delete(token);
            }
        }
        chat.prune();
        cleanup().catch((e) => console.error("[rooms:cleanup]", e));
    }, 10 * 60 * 1000);

    return function close() {
        clearInterval(heartbeat);
        clearInterval(janitor);
        for (const game of games.values()) {
            game.stop();
        }
        for (const timer of pendingLeaves.values()) {
            clearTimeout(timer);
        }
        for (const ws of wss.clients) {
            ws.terminate();
        }
        wss.close();
    };
}
