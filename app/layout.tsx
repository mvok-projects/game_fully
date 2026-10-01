import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Silkscreen } from "next/font/google";
import PwaSupport from "@/components/PwaSupport";
import "./globals.css";

// Bosh menyu shriftlari (build vaqtida yuklanib, saytning o'zidan beriladi — oflayn ham ishlaydi).
const silkscreen = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-silkscreen" });
const chakraPetch = Chakra_Petch({ weight: ["400", "500", "600", "700"], subsets: ["latin"], variable: "--font-chakra" });

export const metadata: Metadata = {
  title: "Territorial.io",
  description: "Territorial.io - Bosib olish sanʼati",
  appleWebApp: {
    capable: true,
    title: "Territorial",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="uz" className={`${silkscreen.variable} ${chakraPetch.variable}`}>
      <body>
        {children}
        <PwaSupport />
      </body>
    </html>
  );
}
