import type { Metadata } from "next";
import { Archivo, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Kudira Indigo — three families (design/INDIGO_TOKENS.md §2):
//   Instrument Serif  display and headings
//   Archivo           body, UI, labels
//   JetBrains Mono    EVERY figure, label, eyebrow (tabular-nums)
// Self-hosted by next/font — no runtime external request.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Kudira — compliance-native BNPL",
  description:
    "Buy now, pay later underwritten against a bank-verified A-Pass credential. Settled on Base.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${archivo.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
