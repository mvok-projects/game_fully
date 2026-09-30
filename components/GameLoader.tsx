"use client";

import { useEffect } from "react";

const GAME_SRC = "/game/game.js";

// O'yin skripti gidratatsiyadan keyin, faqat bir marta yuklanadi.
export default function GameLoader() {
  useEffect(() => {
    if (document.querySelector(`script[src="${GAME_SRC}"]`)) {
      return;
    }
    const script = document.createElement("script");
    script.src = GAME_SRC;
    script.async = true;
    document.head.appendChild(script);
  }, []);

  return null;
}
