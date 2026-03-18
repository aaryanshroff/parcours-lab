import type { Metadata } from "next";
import { Young_Serif, Rubik } from "next/font/google";
import "./globals.css";

const youngSerif = Young_Serif({
  variable: "--font-young-serif",
  subsets: ["latin"],
  weight: "400",
});

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ParcoursLab",
  description: "Your AI-powered learning path",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${youngSerif.variable} ${rubik.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
