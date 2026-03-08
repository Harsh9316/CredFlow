import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CredFlow - NBFC Credit Underwriting",
  description: "B2B SaaS platform for SME loan underwriting and embedded lending decisioning",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
