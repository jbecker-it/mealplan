import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { cookies } from "next/headers";
import { isAuthed, isSetup } from "@/lib/auth";
import AuthRedirect from "./AuthRedirect";
import Nav from "./Nav";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mealplan",
  description: "Vegane Meal-Prep-Planung",
  applicationName: "Mealplan",
  appleWebApp: { capable: true, title: "Mealplan", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e1512",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const store = await cookies();
  const authed = isSetup() && isAuthed(store.get("mp")?.value);

  return (
    <html lang="de">
      <body className={`${geist.className} min-h-screen bg-background text-foreground`}>
        {authed && <Nav />}
        <AuthRedirect />
        <main className={`mx-auto max-w-6xl px-4 py-4 md:py-6 ${authed ? "pb-tabbar md:pb-6" : ""}`}>{children}</main>
      </body>
    </html>
  );
}
