import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Media Generator",
  description: "Generate images and videos through configured AI models.",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
