import type { Metadata, Viewport } from "next";
import "./globals.css";
import WebMCP from "@/components/WebMCP";

export const metadata: Metadata = {
  title: "Change Room",
  description: "Shared human + AI operational control room for the Medusa e-commerce sandbox.",
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WebMCP />
        {children}
      </body>
    </html>
  );
}
