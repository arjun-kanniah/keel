import type { Metadata } from "next";
import "./mockup-base.css";
import "./app.css";

export const metadata: Metadata = {
  title: "Keel · an in-app agent that changes data safely",
  description:
    "Keel is the assistant inside Ratebook, a demo pricing app. It answers how-to questions and prepares changes the user previews, approves and can undo, with role checks enforced by the API.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
