import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import WebMCP from "@/components/WebMCP";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Change Room",
  description: "Shared human + AI operational control room for the Medusa e-commerce sandbox.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <WebMCP />
        {children}
      </body>
    </html>
  );
}
