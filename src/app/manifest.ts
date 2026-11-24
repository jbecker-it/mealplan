import type { MetadataRoute } from "next";

// Web-App-Manifest: macht Mealplan auf Android/iOS „installierbar“
// (Startbildschirm-Icon, Vollbild ohne Browserleiste).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mealplan",
    short_name: "Mealplan",
    description: "Vegane Meal-Prep-Planung",
    lang: "de",
    start_url: "/plan",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0e1512",
    theme_color: "#0e1512",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Einkaufsliste", url: "/list" },
      { name: "Rezepte", url: "/recipes" },
    ],
  };
}
