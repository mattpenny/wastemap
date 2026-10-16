import "./globals.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Hong Kong Waste Management 3D Map | 香港廢物管理 3D 地圖",
  description:
    "Interactive 3D map of Hong Kong EPD waste management facilities — strategic landfills, refuse transfer stations, I·PARK, O·PARK and Y·PARK.",
  applicationName: "HK Waste 3D Map",
  keywords: [
    "Hong Kong",
    "waste management",
    "EPD",
    "landfill",
    "refuse transfer station",
    "I-PARK",
    "3D map",
    "deck.gl",
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // The map canvas is full-bleed; let it sit under the notch / home indicator.
  viewportFit: "cover",
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 font-sans antialiased">{children}</body>
    </html>
  );
}
