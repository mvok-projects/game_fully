import pg from "pg";

const ALPHABET = "0123456789";
const ROOM_TTL_HOURS = 2;

export const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5
});

export class RoomError extends Error {}

export async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS rooms (
            code        CHAR(6)     PRIMARY KEY,
            host_id     TEXT        NOT NULL,
            status      TEXT        NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'started')),
            map_index   INTEGER     NOT NULL,
            map_name    TEXT        NOT NULL,
            max_players INTEGER     NOT NULL CHECK (max_players BETWEEN 2 AND 16),
            bot_count   INTEGER     NOT NULL CHECK (bot_count BETWEEN 0 AND 511),
            seed        INTEGER     NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            started_at  TIMESTAMPTZ
        );
        CREATE TABLE IF NOT EXISTS room_players (
            room_code CHAR(6)     NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
            player_id TEXT        NOT NULL,
            name      TEXT        NOT NULL,
            color     TEXT        NOT NULL,
            is_host   BOOLEAN     NOT NULL DEFAULT false,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (room_code, player_id)
        );
        ALTER TABLE room_players ADD COLUMN IF NOT EXISTS color_code INTEGER NOT NULL DEFAULT 0;
    `);
}

// Server qayta ishga tushganda ulanishlar yo'qoladi, shuning uchun kutayotgan xonalar yopiladi.
export async function cleanup({ dropWaiting = false } = {}) {
    await pool.query(`DELETE FROM rooms WHERE created_at < now() - make_interval(hours => $1)`, [ROOM_TTL_HOURS]);
    if (dropWaiting) {
        await pool.query(`DELETE FROM rooms WHERE status = 'waiting'`);
    }
}

function newCode() {
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return code;
}

export function normalizeCode(code) {
    return String(code || "").replace(/[^0-9]/g, "").slice(0, 6);
}

async function readRoom(client, code) {
    const r = await client.query(`SELECT * FROM rooms WHERE code = $1`, [code]);
    if (!r.rows.length) {
        return null;
    }
    const room = r.rows[0];
    const p = await client.query(
        `SELECT player_id, name, color, color_code, is_host FROM room_players WHERE room_code = $1 ORDER BY joined_at, player_id`,
        [code]
    );
    return {
        code: room.code,
        status: room.status,
        hostId: room.host_id,
        mapIndex: room.map_index,
        mapName: room.map_name,
        maxPlayers: room.max_players,
        botCount: room.bot_count,
        seed: room.seed,
        createdAt: room.created_at.getTime(),
        players: p.rows.map((row) => ({ id: row.player_id, name: row.name, color: row.color, colorCode: row.color_code, host: row.is_host }))
    };
}

async function tx(fn) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (e) {
        await client.query("ROLLBACK");
        throw e;
    } finally {
        client.release();
    }
}

export function getRoom(code) {
    return readRoom(pool, normalizeCode(code));
}

export async function createRoom(player, opts) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const code = newCode();
        try {
            return await tx(async (c) => {
                await c.query(
                    `INSERT INTO rooms (code, host_id, map_index, map_name, max_players, bot_count, seed)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [code, player.id, opts.mapIndex, opts.mapName, opts.maxPlayers, opts.botCount, Math.floor(Math.random() * 65536)]
                );
                await c.query(
                    `INSERT INTO room_players (room_code, player_id, name, color, color_code, is_host) VALUES ($1, $2, $3, $4, $5, true)`,
                    [code, player.id, player.name, player.color, player.colorCode]
                );
                return readRoom(c, code);
            });
        } catch (e) {
            if (e.code !== "23505") {
                throw e;
            }
        }
    }
    throw new RoomError("Xona kodi yaratib bo'lmadi, qaytadan urinib ko'ring");
}

export function joinRoom(code, player) {
    return tx(async (c) => {
        const r = await c.query(`SELECT status, max_players FROM rooms WHERE code = $1 FOR UPDATE`, [normalizeCode(code)]);
        if (!r.rows.length) {
            throw new RoomError("Xona topilmadi");
        }
        if (r.rows[0].status !== "waiting") {
            throw new RoomError("Bu xonada oʻyin allaqachon boshlangan");
        }
        const n = await c.query(`SELECT count(*)::int AS n FROM room_players WHERE room_code = $1`, [normalizeCode(code)]);
        if (n.rows[0].n >= r.rows[0].max_players) {
            throw new RoomError("Xona toʻla");
        }
        await c.query(
            `INSERT INTO room_players (room_code, player_id, name, color, color_code, is_host) VALUES ($1, $2, $3, $4, $5, false)`,
            [normalizeCode(code), player.id, player.name, player.color, player.colorCode]
        );
        return readRoom(c, normalizeCode(code));
    });
}

// Yaratuvchi chiqsa xona o'chiriladi (qaytadi: null), aks holda yangilangan xona qaytadi.
export function leaveRoom(code, playerId) {
    return tx(async (c) => {
        const r = await c.query(`SELECT host_id FROM rooms WHERE code = $1 FOR UPDATE`, [code]);
        if (!r.rows.length) {
            return null;
        }
        if (r.rows[0].host_id === playerId) {
            await c.query(`DELETE FROM rooms WHERE code = $1`, [code]);
            return null;
        }
        await c.query(`DELETE FROM room_players WHERE room_code = $1 AND player_id = $2`, [code, playerId]);
        return readRoom(c, code);
    });
}

export function startRoom(code, playerId) {
    return tx(async (c) => {
        const r = await c.query(`SELECT host_id, status FROM rooms WHERE code = $1 FOR UPDATE`, [code]);
        if (!r.rows.length) {
            throw new RoomError("Xona topilmadi");
        }
        if (r.rows[0].host_id !== playerId) {
            throw new RoomError("Oʻyinni faqat xona yaratuvchisi boshlay oladi");
        }
        if (r.rows[0].status === "waiting") {
            await c.query(`UPDATE rooms SET status = 'started', started_at = now() WHERE code = $1`, [code]);
        }
        return readRoom(c, code);
    });
}
