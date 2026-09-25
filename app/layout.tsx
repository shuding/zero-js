import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "css-lang — a C-like language compiled to CSS",
  description: "A C-like language that compiles to standalone HTML and CSS, with calculations, drawing, and animation powered by CSS.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={geistMono.variable}><body>{children}</body></html>;
}
