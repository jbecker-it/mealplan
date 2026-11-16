// Erst-Seed: Zutat-Entitäten, 12 Beispielrezepte, 2 Profile, Tags
import type Database from "better-sqlite3";

type IngDef = [string, string, string]; // name, category, unit

const INGREDIENTS: IngDef[] = [
  ["Nudeln", "Trockenwaren", "g"],
  ["Fusilli", "Trockenwaren", "g"],
  ["Reis", "Trockenwaren", "g"],
  ["Haferflocken", "Trockenwaren", "g"],
  ["Hefeflocken", "Trockenwaren", "g"],
  ["Sesam", "Trockenwaren", "g"],
  ["Cornflakes", "Trockenwaren", "g"],
  ["Kokosraspeln", "Trockenwaren", "g"],
  ["Vollkornbrot", "Trockenwaren", "Scheibe"],
  ["Kichererbsen", "Trockenwaren", "g"],
  ["Haferproteinpulver", "Trockenwaren", "g"],
  ["Ahornsirup", "Trockenwaren", "ml"],
  ["Rapsöl", "Trockenwaren", "ml"],
  ["Kokosöl", "Trockenwaren", "ml"],
  ["Tempeh", "Kühlregal", "g"],
  ["Tofu", "Kühlregal", "g"],
  ["Sojajoghurt", "Kühlregal", "g"],
  ["Sojasoße", "Kühlregal", "ml"],
  ["Kokosmilch", "Kühlregal", "ml"],
  ["Currypaste", "Kühlregal", "ml"],
  ["Tahini", "Kühlregal", "ml"],
  ["Falafel", "Kühlregal", "Stück"],
  ["Edamame", "Kühlregal", "g"],
  ["Haferdrink", "Kühlregal", "ml"],
  ["Tomaten", "Obst & Gemüse", "g"],
  ["Paprika", "Obst & Gemüse", "Stück"],
  ["Banane", "Obst & Gemüse", "Stück"],
  ["Kartoffeln", "Obst & Gemüse", "g"],
  ["Möhren", "Obst & Gemüse", "g"],
  ["Stangensellerie", "Obst & Gemüse", "Stück"],
  ["Gurke", "Obst & Gemüse", "Stück"],
  ["Basilikum", "Obst & Gemüse", "Bund"],
];

type RecIng = [string, number, string]; // entityName, amount, unit

interface RecDef {
  title: string;
  K: number;
  P: number;
  C: number;
  F: number;
  Su?: number; // Zucker (g)
  Sa?: number; // Salz (g)
  tags: string[];
  ings: RecIng[];
  steps: string[];
  desc?: string;
}

const RECIPES: RecDef[] = [
  {
    title: "Asia Nudeln mit Tempeh",
    K: 620, P: 54, C: 49, F: 19, Su: 8, Sa: 2.5,
    tags: ["high-protein", "schnell"],
    ings: [
      ["Nudeln", 200, "g"],
      ["Tempeh", 150, "g"],
      ["Sojasoße", 30, "ml"],
      ["Paprika", 1, "Stück"],
      ["Rapsöl", 15, "ml"],
    ],
    steps: [
      "Nudeln nach Packung anbraten.",
      "Tempeh würfeln, in Rapsöl anbraten.",
      "Paprika in Streifen, alles mischen, Sojasoße unterrühren.",
    ],
  },
  {
    title: "Fusilli al Forno",
    K: 820, P: 65, C: 80, F: 32, Su: 12, Sa: 1.6,
    tags: ["high-protein", "backofen"],
    ings: [
      ["Fusilli", 250, "g"],
      ["Kichererbsen", 150, "g"],
      ["Tomaten", 200, "g"],
      ["Sojajoghurt", 100, "g"],
      ["Hefeflocken", 30, "g"],
      ["Basilikum", 1, "Bund"],
    ],
    steps: [
      "Fusilli al dente kochen und abgießen.",
      "Mit Kichererbsen, Tomaten und Sojajoghurt mischen.",
      "Hefeflocken darüber, 15 Min bei 200 °C backen.",
    ],
  },
  {
    title: "Hafer-Proteinshake",
    K: 160, P: 25, C: 15, F: 3, Su: 4, Sa: 0.1,
    tags: ["schnell", "high-protein"],
    ings: [
      ["Haferdrink", 250, "ml"],
      ["Haferproteinpulver", 30, "g"],
      ["Banane", 0.5, "Stück"],
    ],
    steps: ["Alles in den Mixer geben und 30 Sekunden mixen."],
  },
  {
    title: "Tofu-Spieße mit Reis",
    K: 350, P: 28, C: 18, F: 19, Su: 1.5, Sa: 1.8,
    tags: ["schnell", "high-protein"],
    ings: [
      ["Tofu", 150, "g"],
      ["Reis", 100, "g"],
      ["Sojasoße", 15, "ml"],
      ["Sesam", 5, "g"],
      ["Möhren", 70, "g"],
    ],
    steps: [
      "Tofu in Spalten schneiden und mit Sojasoße marinieren.",
      "Möhren in Stifte schneiden, aufspießen und braten.",
      "Mit Sesam bestreuen, Reis dazu.",
    ],
  },
  {
    title: "Vegane Kartoffelsuppe",
    K: 420, P: 18, C: 55, F: 15, Su: 4, Sa: 1.2,
    tags: ["comfort"],
    ings: [
      ["Kartoffeln", 400, "g"],
      ["Möhren", 150, "g"],
      ["Stangensellerie", 1, "Stück"],
      ["Haferdrink", 200, "ml"],
      ["Rapsöl", 15, "ml"],
    ],
    steps: [
      "Gemüse würfeln, in Rapsöl anschwitzen.",
      "Mit Haferdrink aufgießen, 20 Min köcheln.",
      "Pürieren und abschmecken.",
    ],
  },
  {
    title: "Tempeh-Bowl mit Edamame",
    K: 640, P: 38, C: 62, F: 24, Su: 3, Sa: 1.6,
    tags: ["high-protein"],
    ings: [
      ["Reis", 150, "g"],
      ["Tempeh", 120, "g"],
      ["Edamame", 80, "g"],
      ["Sojasoße", 15, "ml"],
      ["Rapsöl", 15, "ml"],
    ],
    steps: [
      "Reis kochen.",
      "Tempeh würfeln und in Rapsöl anbraten.",
      "Bowl anrichten, Sojasoße dazu.",
    ],
  },
  {
    title: "Falafel-Salat",
    K: 380, P: 16, C: 30, F: 22, Su: 5, Sa: 1.8,
    tags: ["schnell"],
    ings: [
      ["Tomaten", 150, "g"],
      ["Gurke", 1, "Stück"],
      ["Falafel", 8, "Stück"],
      ["Tahini", 20, "ml"],
    ],
    steps: [
      "Tomaten und Gurke schneiden, Falafel dazugeben.",
      "Mit Tahini und etwas Zitrone marinieren.",
    ],
  },
  {
    title: "Hefeflocken-Porridge",
    K: 400, P: 22, C: 52, F: 12, Su: 12, Sa: 0.3,
    tags: ["schnell"],
    ings: [
      ["Haferflocken", 80, "g"],
      ["Haferdrink", 250, "ml"],
      ["Hefeflocken", 15, "g"],
      ["Ahornsirup", 20, "ml"],
    ],
    steps: [
      "Haferflocken mit Haferdrink aufkochen und 5 Min quellen lassen.",
      "Hefeflocken und Ahornsirup unterrühren.",
    ],
  },
  {
    title: "Protein-Pancakes",
    K: 450, P: 35, C: 50, F: 12, Su: 15, Sa: 0.4,
    tags: ["high-protein"],
    ings: [
      ["Haferflocken", 70, "g"],
      ["Haferproteinpulver", 30, "g"],
      ["Haferdrink", 200, "ml"],
      ["Banane", 0.5, "Stück"],
      ["Ahornsirup", 20, "ml"],
    ],
    steps: [
      "Zutaten mixen, Teig 5 Min ruhen lassen.",
      "Pancakes braten und mit Ahornsirup servieren.",
    ],
  },
  {
    title: "Crunchy Tofu",
    K: 300, P: 18, C: 12, F: 21, Su: 2, Sa: 1.5,
    tags: ["schnell", "high-protein"],
    ings: [
      ["Tofu", 150, "g"],
      ["Cornflakes", 40, "g"],
      ["Sojasoße", 15, "ml"],
      ["Rapsöl", 30, "ml"],
    ],
    steps: [
      "Tofu in Würfel schneiden, in Sojasoße wenden.",
      "Cornflakes zerbröseln, Tofu darin wälzen.",
      "Bei 200 °C knusprig backen.",
    ],
  },
  {
    title: "Tofu-Curry mit Reis",
    K: 680, P: 42, C: 60, F: 28, Su: 6, Sa: 2.2,
    tags: ["high-protein", "comfort"],
    ings: [
      ["Tofu", 150, "g"],
      ["Kokosmilch", 200, "ml"],
      ["Currypaste", 20, "ml"],
      ["Reis", 120, "g"],
      ["Vollkornbrot", 2, "Scheibe"],
    ],
    steps: [
      "Tofu anbraten, Currypaste und Kokosmilch zugeben, 10 Min köcheln.",
      "Reis kochen, Brot dazu.",
    ],
  },
  {
    title: "Overnight Oats",
    K: 620, P: 38, C: 55, F: 28, Su: 18, Sa: 0.4,
    tags: ["overnight"],
    ings: [
      ["Haferflocken", 60, "g"],
      ["Haferdrink", 250, "ml"],
      ["Kokosraspeln", 15, "g"],
      ["Kokosöl", 15, "ml"],
      ["Banane", 1, "Stück"],
    ],
    steps: [
      "Zutaten mischen und über Nacht kühlen.",
      "Banane obendrauf.",
    ],
  },
];

const TAGS = ["high-protein", "schnell", "backofen", "comfort", "overnight"];

export function ensureSeed(d: Database.Database): void {
  const n = d.prepare("SELECT COUNT(*) AS c FROM profile").get() as {
    c: number;
  };
  if (n.c > 0) return;

  const run = d.transaction(() => {
    const insIng = d.prepare(
      "INSERT INTO ingredient(name, category, unit_default) VALUES (?,?,?)"
    );
    for (const [name, cat, unit] of INGREDIENTS) insIng.run(name, cat, unit);

    const insTag = d.prepare("INSERT INTO tag(name) VALUES (?)");
    for (const t of TAGS) insTag.run(t);

    const insRec = d.prepare(
      "INSERT INTO recipe(title, description, kcal, protein_g, carbs_g, fat_g, sugar_g, salt_g, favorite) VALUES (?,?,?,?,?,?,?,? ,0)"
    );
    const insRI = d.prepare(
      "INSERT INTO recipe_ingredient(recipe_id, ingredient_id, amount, unit, sort) VALUES (?,?,?,?,?)"
    );
    const insStep = d.prepare(
      "INSERT INTO step(recipe_id, text, sort) VALUES (?,?,?)"
    );
    const ingId = (name: string) =>
      (d.prepare("SELECT id FROM ingredient WHERE name = ?").get(name) as {
        id: number;
      }).id;
    const tagId = (name: string) =>
      (d.prepare("SELECT id FROM tag WHERE name = ?").get(name) as {
        id: number;
      }).id;
    const insRT = d.prepare("INSERT OR IGNORE INTO recipe_tag(recipe_id, tag_id) VALUES (?,?)");

    for (const r of RECIPES) {
      const id = insRec.run(r.title, r.desc ?? null, r.K, r.P, r.C, r.F, r.Su ?? null, r.Sa ?? null).lastInsertRowid;
      r.ings.forEach(([iname, amount, unit], i) =>
        insRI.run(id, ingId(iname), amount, unit, i)
      );
      r.steps.forEach((s, i) => insStep.run(id, s, i));
      for (const t of r.tags) insRT.run(id, tagId(t));
    }

    const insProf = d.prepare(
      "INSERT INTO profile(name, kcal_target, p_target, c_target, f_target, sugar_target, salt_target, slot_split) VALUES (?,?,?,?,?,?,?,?)"
    );
    insProf.run("Johannes", 2660, 180, 326, 71, 40, 5, JSON.stringify({ B: 670, M: 930, A: 800, S: 270 }));
    insProf.run("Partnerin", 2000, 120, 260, 65, 35, 4.5, JSON.stringify({ B: 500, M: 700, A: 600, S: 200 }));

    // Aliase: bekannte Namensvarianten → kanonische Entität
    const insAlias = d.prepare(
      "INSERT OR IGNORE INTO alias(from_name, ingredient_id) VALUES (?,?)"
    );
    insAlias.run("Karotte", ingId("Möhren"));
    insAlias.run("Karotten", ingId("Möhren"));
  });
  run();
}
