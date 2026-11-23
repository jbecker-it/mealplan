"use client";

// Navigation: Desktop = eine Zeile oben (wie bisher).
// Mobil (< md) = schmale Kopfzeile + Tab-Leiste unten mit den 4 Alltags-
// Seiten und „Mehr“ (Sheet mit dem Rest). Daumen-erreichbar, kostet
// oben keinen Platz mehr.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import LogoutButton from "./LogoutButton";

const LINKS = [
  ["/plan", "Plan"],
  ["/list", "Einkaufsliste"],
  ["/rewe", "REWE"],
  ["/recipes", "Rezepte"],
  ["/ingredients", "Zutaten"],
  ["/vorlagen", "Vorlagen"],
  ["/import", "Import"],
  ["/profiles", "Profile"],
  ["/settings", "Einstellungen"],
] as const;

type IconName = "plan" | "list" | "recipes" | "rewe" | "more";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/plan", label: "Plan", icon: "plan" },
  { href: "/list", label: "Liste", icon: "list" },
  { href: "/recipes", label: "Rezepte", icon: "recipes" },
  { href: "/rewe", label: "REWE", icon: "rewe" },
];

const MORE = LINKS.filter(([href]) => !TABS.some((t) => t.href === href));

function isActive(path: string, href: string) {
  if (href === "/recipes") return path.startsWith("/recipes") || path.startsWith("/cook");
  return path === href || path.startsWith(href + "/");
}

function Icon({ name }: { name: IconName }) {
  const p = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "plan":
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      );
    case "list":
      return (
        <svg {...p}>
          <path d="M9 6h12M9 12h12M9 18h12" />
          <path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17" />
        </svg>
      );
    case "recipes":
      return (
        <svg {...p}>
          <path d="M4 19.5V5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2.5Z" />
          <path d="M4 19.5A2 2 0 0 0 6 21h14" />
        </svg>
      );
    case "rewe":
      return (
        <svg {...p}>
          <circle cx="9" cy="20" r="1.3" />
          <circle cx="18" cy="20" r="1.3" />
          <path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8a2 2 0 0 0 2-1.5L21 8H6" />
        </svg>
      );
    case "more":
      return (
        <svg {...p}>
          <circle cx="5" cy="12" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
          <circle cx="19" cy="12" r="1.2" />
        </svg>
      );
  }
}

export default function Nav() {
  const path = usePathname() || "/";
  const [moreOpen, setMoreOpen] = useState(false);

  // Sheet bei Navigation schließen
  useEffect(() => setMoreOpen(false), [path]);

  const current = LINKS.find(([href]) => isActive(path, href))?.[1] ?? "";
  const moreActive = MORE.some(([href]) => isActive(path, href));

  return (
    <>
      {/* Desktop */}
      <nav className="sticky top-0 z-40 hidden border-b border-line bg-background/95 backdrop-blur md:block">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 py-2">
          <span className="mr-2 font-bold text-accent">Mealplan</span>
          {LINKS.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-lg px-3 py-1.5 text-sm transition hover:bg-card hover:text-foreground ${
                isActive(path, href) ? "bg-card text-foreground" : "text-muted"
              }`}
            >
              {label}
            </Link>
          ))}
          <span className="flex-1" />
          <LogoutButton />
        </div>
      </nav>

      {/* Mobil: Kopfzeile */}
      <header className="pt-safe sticky top-0 z-40 border-b border-line bg-background/95 backdrop-blur md:hidden">
        <div className="flex h-11 items-center px-4">
          <span className="font-bold text-accent">Mealplan</span>
          {current && <span className="ml-2 truncate text-sm text-muted">· {current}</span>}
        </div>
      </header>

      {/* Mobil: Tab-Leiste unten */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-5">
          {TABS.map((t) => {
            const active = isActive(path, t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <Icon name={t.icon} />
                {t.label}
              </Link>
            );
          })}
          <button
            onClick={() => setMoreOpen((o) => !o)}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
              moreOpen || moreActive ? "text-accent" : "text-muted"
            }`}
            aria-expanded={moreOpen}
          >
            <Icon name="more" />
            Mehr
          </button>
        </div>
      </nav>

      {/* Mobil: „Mehr“-Sheet */}
      {moreOpen && (
        <div className="fixed inset-0 z-30 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="mb-tabbar absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-card p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {MORE.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`block rounded-lg px-4 py-3 ${
                  isActive(path, href) ? "bg-card2 text-foreground" : "text-foreground/90"
                }`}
              >
                {label}
              </Link>
            ))}
            <div className="mt-1 border-t border-line pt-1 [&>button]:w-full [&>button]:px-4 [&>button]:py-3 [&>button]:text-left [&>button]:text-base">
              <LogoutButton />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
