import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";
import { cookies } from "next/headers";
import { isAuthed, isSetup } from "@/lib/auth";
import AuthRedirect from "./AuthRedirect";
import LogoutButton from "./LogoutButton";
import "./globals.css";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Mealplan",
  description: "Vegane Meal-Prep-Planung",
};

const LINKS = [
  ["/plan", "Plan"],
  ["/list", "Einkaufsliste"],
  ["/recipes", "Rezepte"],
  ["/ingredients", "Zutaten"],
  ["/import", "Import"],
  ["/profiles", "Profile"],
  ["/settings", "Einstellungen"],
] as const;

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const store = await cookies();
  const authed = isSetup() && isAuthed(store.get("mp")?.value);

  return (
    <html lang="de">
      <body className={`${geist.className} min-h-screen bg-background text-foreground`}>
        {authed && (
          <nav className="sticky top-0 z-40 border-b border-line bg-background/95 backdrop-blur">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
              <span className="mr-2 font-bold text-accent">Mealplan</span>
              {LINKS.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-card hover:text-foreground"
                >
                  {label}
                </Link>
              ))}
              <span className="flex-1" />
              <LogoutButton />
            </div>
          </nav>
        )}
        <AuthRedirect />
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
