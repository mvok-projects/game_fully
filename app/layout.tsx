import type { Metadata, Viewport } from "next";
import PwaSupport from "@/components/PwaSupport";
import "./globals.css";

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
    <html lang="uz">
      <body>
        {children}
        <PwaSupport />
      </body>
    </html>
  );
}
