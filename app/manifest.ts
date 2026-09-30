import type { MetadataRoute } from "next";

// Telefon ekraniga o'rnatiladigan ilova (PWA) ma'lumotlari.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Territorial.io",
    short_name: "Territorial",
    description: "Territorial.io - Bosib olish sanʼati",
    lang: "uz",
    start_url: "/",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["games"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
