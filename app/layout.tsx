import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Classroom Live — One question. Everyone together.",
  description: "Host-controlled live classroom quizzes.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
