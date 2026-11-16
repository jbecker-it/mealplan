"use client";

export default function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth", { method: "DELETE" });
        window.location.href = "/login";
      }}
      className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:bg-card hover:text-foreground"
    >
      Logout
    </button>
  );
}
