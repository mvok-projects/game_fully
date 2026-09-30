"use client";

import { useEffect } from "react";

// PWA: service worker'ni ro'yxatdan o'tkazadi (faqat production'da — dev'da HMR'ga xalaqit bermasin)
// va sahifa ochiq turganda telefon ekrani o'chib qolmasligi uchun Wake Lock so'raydi.
export default function PwaSupport() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }

    if (!("wakeLock" in navigator)) {
      return;
    }
    let lock: WakeLockSentinel | null = null;
    let pending = false;
    let disposed = false;
    const acquire = async () => {
      if (disposed || lock || pending || document.visibilityState !== "visible") {
        return;
      }
      pending = true;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (disposed) {
          sentinel.release().catch(() => {});
          return;
        }
        lock = sentinel;
        sentinel.addEventListener("release", () => {
          lock = null;
        });
      } catch {
        // Quvvatni tejash rejimi yoki ruxsat yo'q — jim o'tkazib yuboramiz.
      } finally {
        pending = false;
      }
    };
    // Sahifa boshqa ilovadan qaytganda qulf avtomatik bo'shaydi — qaytadan olamiz.
    // Ba'zi brauzerlar foydalanuvchi bosishini talab qiladi, shuning uchun birinchi teginishda ham urinamiz.
    document.addEventListener("visibilitychange", acquire);
    document.addEventListener("pointerdown", acquire);
    acquire();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", acquire);
      document.removeEventListener("pointerdown", acquire);
      lock?.release().catch(() => {});
    };
  }, []);

  return null;
}
