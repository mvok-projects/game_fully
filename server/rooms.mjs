import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { migrate, cleanup, getRoom, createRoom, joinRoom, leaveRoom, startRoom, RoomError } from "./db.mjs";

const WS_PATH = "/ws";
const MAX_PLAYER_OPTIONS = [2, 4, 8, 16];

// Xonalar WebSocket serverini mavjud HTTP serverga ulaydi.
// Faqat /ws yo'lidagi upgrade so'rovlarini oladi, qolganlari (masalan Next HMR) o'zgarishsiz qoladi.
export async function attachRooms(httpServer) {
    await migrate();
    await cleanup({ dropWaiting: true });

    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    const watchers = new Map();

    httpServer.on("upgrade", (req, socket, head) => {
        const { pathname } = new URL(req.url, "http://localhost");
        if (pathname !== WS_PATH) {
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
        }
    }

    function cleanPlayer(msg) {
        const name = String(msg.name || "").trim().slice(0, 20) || "Oʻyinchi";
        const color = /^rgb\(\d{1,3},\s?\d{1,3},\s?\d{1,3}\)$/.test(String(msg.color)) ? String(msg.color) : "rgb(120,120,255)";
        return { name, color };
    }

    function int(value, min, max) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max) {
            throw new RoomError("Notoʻgʻri maʼlumot");
        }
        return n;
    }

    async function leaveCurrent(ws) {
        const { code, playerId } = ws.session;
        if (!code) {
            return;
        }
        unwatch(ws);
        publish(code, await leaveRoom(code, playerId));
    }

    const actions = {
        async create(ws, msg) {
            await leaveCurrent(ws);
            const maxPlayers = int(msg.maxPlayers, 2, 16);
            if (!MAX_PLAYER_OPTIONS.includes(maxPlayers)) {
                throw new RoomError("Notoʻgʻri maʼlumot");
            }
            const room = await createRoom({ id: ws.session.playerId, ...cleanPlayer(msg) }, {
                mapIndex: int(msg.mapIndex, 0, 63),
                mapName: String(msg.mapName || "").slice(0, 40),
                maxPlayers,
                botCount: int(msg.botCount, 0, 511)
            });
            watch(ws, room.code);
            return { room, playerId: ws.session.playerId };
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
            const room = await joinRoom(msg.code, { id: ws.session.playerId, ...cleanPlayer(msg) });
            watch(ws, room.code);
            publish(room.code, room);
            return { room, playerId: ws.session.playerId };
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
            const room = await startRoom(code, playerId);
            publish(code, room);
            return room;
        }
    };

    wss.on("connection", (ws) => {
        ws.session = { playerId: crypto.randomUUID(), code: null };
        ws.isAlive = true;
        ws.on("pong", () => {
            ws.isAlive = true;
        });
        ws.on("message", async (raw) => {
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
            } catch (e) {
                if (!(e instanceof RoomError)) {
                    console.error(`[rooms:${msg.action}]`, e);
                }
                reply({ ok: false, error: e instanceof RoomError ? e.message : "Server xatosi" });
            }
        });
        ws.on("close", () => {
            leaveCurrent(ws).catch((e) => console.error("[rooms:leave on close]", e));
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
        cleanup().catch((e) => console.error("[rooms:cleanup]", e));
    }, 10 * 60 * 1000);

    return function close() {
        clearInterval(heartbeat);
        clearInterval(janitor);
        for (const ws of wss.clients) {
            ws.terminate();
        }
        wss.close();
    };
}
