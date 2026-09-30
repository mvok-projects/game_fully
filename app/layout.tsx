import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Territorial.io",
  description: "Territorial.io - Bosib olish sanʼati",
};

export const viewport: Viewport = {
  width: "device-width",
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
