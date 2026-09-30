"use client";

import { useEffect } from "react";

const GAME_SRC = "/game/game.js";

// Xonalar/o'yin serverining WebSocket manzili (masalan Railway: wss://xxx.up.railway.app/ws).
// Berilmasa, o'yin shu saytning o'zidagi /ws ga ulanadi.
const ROOMS_WS_URL = process.env.NEXT_PUBLIC_ROOMS_WS_URL || "";

// O'yin skripti gidratatsiyadan keyin, faqat bir marta yuklanadi.
export default function GameLoader() {
  useEffect(() => {
    if (document.querySelector(`script[src="${GAME_SRC}"]`)) {
      return;
    }
    (window as Window & { __TT_ROOMS_URL?: string }).__TT_ROOMS_URL = ROOMS_WS_URL;
    const script = document.createElement("script");
    script.src = GAME_SRC;
    script.async = true;
    document.head.appendChild(script);
  }, []);

  return null;
}
