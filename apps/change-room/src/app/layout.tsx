import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Urbanist } from "next/font/google";
import "./globals.css";
import WebMCP from "@/components/WebMCP";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
const urbanist = Urbanist({ subsets: ["latin"], weight: ["100", "200", "300"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "Change Room",
  description:
    "Where humans and AI decide change together. A shared human + AI operational control room for the Medusa e-commerce sandbox.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrains.variable} ${urbanist.variable}`}>
        <WebMCP />
        {children}
      </body>
    </html>
  );
}