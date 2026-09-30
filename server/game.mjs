// Lockstep o'yin sessiyasi.
// Dvigatel har 7 tikda (7 × 56 ms) bitta "turn" kutadi va turn kelmaguncha simulyatsiyani to'xtatib turadi.
// Server o'yinchilardan kelgan harakatlarni yig'ib, har turnda hammaga bir xil tartibda yuboradi,
// shuning uchun har bir brauzerdagi simulyatsiya bir xil bo'lib qoladi.

export const TURN_MS = 7 * 56;
const START_DELAY_MS = 1500;
const MAX_ACTIONS_PER_TURN = 40;
const MAX_PLAYERS = 512;
// Uzilgan o'yinchi shu vaqt ichida qaytmasa, "o'yindan chiqdi" deb e'lon qilinadi.
export const RECONNECT_GRACE_MS = 30000;

// Harakat turi → argument bitlari (mijoz paketi va turn yozuvida bir xil).
const ACTION_ARG_BITS = { 0: 22, 1: 20, 2: 19, 3: 37, 4: 26, 5: 10, 6: 10, 7: 1, 8: 0, 10: 42 };
const ACTION_PLAYER_LEFT = 9;
const MSG_EMOJI = 15;
const MSG_PING = 14;
const MSG_SUGGEST_ATTACK = 13;

class BitReader {
    constructor(bytes) {
        this.bytes = bytes;
        this.pos = 0;
        this.size = bytes.length * 8;
    }
    remaining() {
        return this.size - this.pos;
    }
    read(bits) {
        let v = 0;
        for (let i = 0; i < bits; i++) {
            const p = this.pos++;
            v = v * 2 + ((this.bytes[p >> 3] >> (7 - (p & 7))) & 1);
        }
        return v;
    }
    bit() {
        const p = this.pos++;
        return (this.bytes[p >> 3] >> (7 - (p & 7))) & 1;
    }
}

class BitWriter {
    constructor() {
        this.bits = [];
    }
    write(bits, value) {
        for (let i = bits - 1; i >= 0; i--) {
            this.bits.push(Math.floor(value / 2 ** i) % 2);
        }
    }
    push(bitArray) {
        for (const b of bitArray) {
            this.bits.push(b);
        }
    }
    bytes() {
        const out = new Uint8Array(Math.ceil(this.bits.length / 8));
        this.bits.forEach((b, i) => {
            if (b) {
                out[i >> 3] |= 128 >> (i & 7);
            }
        });
        return out;
    }
}

export class GameSession {
    // members: [{ ws, index, playerId }] — index o'yinchining o'yindagi raqami (0..n-1).
    // room — o'yin boshlangan paytdagi xona ma'lumoti (qayta ulanganda mijozga beriladi).
    constructor(room, members, onEnd) {
        this.code = room.code;
        this.room = room;
        this.members = members;
        this.byWs = new Map(members.map((m) => [m.ws, m]));
        this.onEnd = onEnd;
        this.turnLog = [];
        this.entries = [];
        this.counts = new Map();
        this.turn = 0;
        this.timer = null;
        this.ended = false;
        for (const m of members) {
            m.connected = true;
            m.gone = false;
            m.graceTimer = null;
            m.ws.game = this;
        }
        this.startTimer = setTimeout(() => {
            this.timer = setInterval(() => this.flush(), TURN_MS);
        }, START_DELAY_MS);
    }

    handlePacket(ws, data) {
        const member = this.byWs.get(ws);
        if (!member || !member.connected || !data.length) {
            return;
        }
        const r = new BitReader(data);
        if (r.bit() !== 1 || r.remaining() < 4) {
            return;
        }
        const id = r.read(4);
        if (id in ACTION_ARG_BITS) {
            this.queueAction(member, id, r);
        } else if (id === MSG_EMOJI || id === MSG_PING || id === MSG_SUGGEST_ATTACK) {
            this.relay(member, id, r);
        }
    }

    queueAction(member, id, r) {
        const argBits = ACTION_ARG_BITS[id];
        if (r.remaining() < argBits) {
            return;
        }
        const count = this.counts.get(member.index) || 0;
        if (count >= MAX_ACTIONS_PER_TURN) {
            return;
        }
        this.counts.set(member.index, count + 1);
        const args = [];
        for (let i = 0; i < argBits; i++) {
            args.push(r.bit());
        }
        this.entries.push({ id, player: member.index, args });
    }

    relay(member, id, r) {
        const w = new BitWriter();
        w.write(1, 1);
        w.write(1, 1);
        let targets = [];
        if (id === MSG_EMOJI && r.remaining() >= 19) {
            targets = [r.read(9)];
            const emoji = r.read(10);
            w.write(2, 0);
            w.write(9, member.index);
            w.write(10, emoji);
        } else if (id === MSG_PING && r.remaining() >= 9) {
            targets = [r.read(9)];
            w.write(2, 1);
            w.write(9, member.index);
        } else if (id === MSG_SUGGEST_ATTACK && r.remaining() >= 9) {
            const target = r.read(9);
            while (r.remaining() >= 9 && targets.length < MAX_PLAYERS) {
                targets.push(r.read(9));
            }
            w.write(2, 2);
            w.write(9, member.index);
            w.write(9, target);
        } else {
            return;
        }
        const packet = w.bytes();
        for (const t of new Set(targets)) {
            const m = this.members.find((x) => x.index === t && x.connected);
            if (m && m !== member) {
                this.send(m.ws, packet);
            }
        }
    }

    flush() {
        const w = new BitWriter();
        w.write(1, 1);
        w.write(1, 0);
        for (const e of this.entries) {
            w.write(4, e.id);
            w.write(9, e.player);
            w.push(e.args);
        }
        this.entries = [];
        this.counts.clear();
        this.turn++;
        const packet = w.bytes();
        this.turnLog.push(packet);
        for (const m of this.members) {
            if (m.connected) {
                this.send(m.ws, packet);
            }
        }
    }

    send(ws, packet) {
        if (ws.readyState === ws.OPEN) {
            ws.send(packet, { binary: true });
        }
    }

    hasMember(playerId) {
        return this.members.some((m) => m.playerId === playerId && !m.gone);
    }

    // Aloqa uzildi (masalan sahifa yangilandi): o'rin RECONNECT_GRACE_MS davomida saqlanadi.
    disconnect(ws) {
        const member = this.byWs.get(ws);
        if (!member || !member.connected) {
            return;
        }
        this.detach(member);
        member.graceTimer = setTimeout(() => this.drop(member), RECONNECT_GRACE_MS);
    }

    // O'yinchi o'zi chiqdi: darhol "o'yindan chiqdi".
    leave(ws) {
        const member = this.byWs.get(ws);
        if (!member || !member.connected) {
            return;
        }
        this.detach(member);
        this.drop(member);
    }

    detach(member) {
        member.connected = false;
        this.byWs.delete(member.ws);
        if (member.ws.game === this) {
            member.ws.game = null;
        }
    }

    drop(member) {
        clearTimeout(member.graceTimer);
        if (member.gone) {
            return;
        }
        member.gone = true;
        this.entries.push({ id: ACTION_PLAYER_LEFT, player: member.index, args: [] });
        if (this.members.every((m) => m.gone)) {
            this.stop();
        }
    }

    // Qayta ulangan o'yinchini o'z o'rniga qaytaradi. Qaytgan funksiya o'tgan barcha turnlarni yuboradi
    // (javobdan keyin chaqiriladi, shunda mijoz avval o'yinni boshlab oladi).
    reattach(playerId, ws) {
        const member = this.members.find((m) => m.playerId === playerId && !m.gone);
        if (!member) {
            return null;
        }
        clearTimeout(member.graceTimer);
        if (member.connected && member.ws !== ws) {
            this.detach(member);
        }
        member.ws = ws;
        member.connected = true;
        this.byWs.set(ws, member);
        ws.game = this;
        return () => {
            for (const packet of this.turnLog) {
                this.send(ws, packet);
            }
        };
    }

    stop() {
        if (this.ended) {
            return;
        }
        this.ended = true;
        clearTimeout(this.startTimer);
        clearInterval(this.timer);
        for (const m of this.members) {
            clearTimeout(m.graceTimer);
            if (m.ws.game === this) {
                m.ws.game = null;
            }
        }
        this.onEnd(this);
    }
}
