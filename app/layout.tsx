import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  title: "zero-js — a C-like language that compiles to zero-JavaScript HTML and CSS",
  description: "A C-like language that compiles to plain HTML and CSS. Calculations, drawing, input and animation run with zero bytes of JavaScript.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={geistMono.variable}><body>{children}</body></html>;
}
