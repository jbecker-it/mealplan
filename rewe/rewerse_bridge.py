#!/usr/bin/env python3
"""rewerse-Brücke für mealplan: REWE-Live-Daten (Preise, Angebote, Vegan-Check)
in JSON. Der mealplan-Server ruft dieses Skript auf (child_process) — so bleibt
der Kern ohne Python-Abhängigkeit lauffähig (Cache in SQLite).

Aufruf:  python3 rewe/rewerse_bridge.py <befehl> '<json-argumente>'
Befehle: status    {}
         markets   {"query":"Dortmund"}
         search    {"market":"123","query":"hafer","vegan":true,"n":20,"page":1,"service":"PICKUP"}
         product   {"market":"123","id":"157910","service":"PICKUP"}
         discounts {"market":"123"}
         shop_overview {"market":"123","plz":"35418"}
         categorize {"market":"123","queries":["Haferflocken","Tofu"],"n":5}
service weggelassen → automatisch PICKUP, dann DELIVERY (erster Treffer gewinnt).

Ausgabe:  JSON auf stdout. Fehler: JSON auf stderr, Exit-Code != 0.
"""
import json
import os
import sys
from typing import NoReturn

HERE = os.path.dirname(os.path.abspath(__file__))
CERT = os.path.join(HERE, "certificate.pem")
KEY = os.path.join(HERE, "private.key")


def die(msg: str, code: int = 1) -> NoReturn:
    json.dump({"error": msg}, sys.stderr, ensure_ascii=False)
    sys.exit(code)


def out(obj) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


def load_client():
    if not (os.path.isfile(CERT) and os.path.isfile(KEY)):
        die(f"mTLS-Zertifikat fehlt: {CERT} / {KEY}", 3)
    try:
        from rewerse import Rewerse
    except ImportError as e:
        die(f"rewerse nicht installiert ({e}). Install: python3 -m pip install rewerse", 2)
    try:
        return Rewerse(cert=CERT, key=KEY)
    except Exception as e:  # noqa: BLE001
        die(f"rewerse-Initialisierung fehlgeschlagen: {e}", 2)


def with_services(market: str, service: str | None, fn):
    """fn(service) aufrufen; ohne explizite Wahl: PICKUP, dann DELIVERY."""
    order = [service] if service else ["PICKUP", "DELIVERY"]
    last = None
    for st in order:
        try:
            return fn(st), st
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


def cmd_status(_args):
    out({"ok": True, "cert": os.path.isfile(CERT) and os.path.isfile(KEY)})


def cmd_markets(args):
    client = load_client()
    q = args.get("query") or args.get("q") or ""
    if not q:
        die("query fehlt")
    markets = client.market_search(q)
    out([
        {
            "wwIdent": m.get("wwIdent"),
            "name": m.get("name"),
            "city": m.get("city"),
            "plz": m.get("zipCode"),
            "street": m.get("street"),
            "hasPickup": bool((m.get("serviceFlags") or {}).get("hasPickup")),
            "hasDelivery": bool((m.get("serviceFlags") or {}).get("hasDelivery")),
        }
        for m in markets[:30]
    ])


def slim_product(p: dict) -> dict:
    listing = p.get("listing") or {}
    attrs = p.get("attributes") or {}
    return {
        "productId": p.get("productId"),
        "title": p.get("title"),
        "brand": p.get("brand"),
        "articleId": p.get("articleId"),
        "imageURL": p.get("imageURL"),
        "grammage": listing.get("grammage"),
        "priceCents": listing.get("currentRetailPrice"),
        "discount": listing.get("discount"),
        "loyaltyBonus": listing.get("loyaltyBonus"),
        "isVegan": bool(attrs.get("isVegan")),
        "isVegetarian": bool(attrs.get("isVegetarian")),
        "isOrganic": bool(attrs.get("isOrganic")),
        "description": p.get("description"),
        "nutritionFacts": p.get("nutritionFacts"),
        "categories": p.get("categories") or [],
    }


def cmd_search(args):
    client = load_client()
    from rewerse._ffi import call  # Python-Wrapper setzt ServiceType nicht
    market = args.get("market")
    q = args.get("query") or args.get("q") or ""
    if not market or not q:
        die("market und query fehlen")
    n = int(args.get("n") or 20)
    page = int(args.get("page") or 1)
    vegan = bool(args.get("vegan"))

    def run(service: str):
        filters = ["attribute=vegan"] if vegan else None
        opts = json.dumps({
            "Page": page,
            "ObjectsPerPage": n,
            "ServiceType": service,
            "Filters": filters,
        })
        res = call("GetProducts", market, q, opts)
        return res

    res, _service = with_services(market, args.get("service"), run)
    out({
        "searchTerm": res.get("searchTerm"),
        "pagination": res.get("pagination"),
        "products": [slim_product(p) for p in res.get("products") or []],
    })


def cmd_product(args):
    client = load_client()
    market = args.get("market")
    pid = args.get("id")
    if not market or not pid:
        die("market und id fehlen")

    def run(service: str):
        # GetProductByID nutzt intern immer PICKUP-Header (Go-Festlegung) —
        # funktioniert daher nur in Pickup-Märkten; sonst klarer Fehler.
        return client.get_product_by_id(market, pid)

    try:
        detail, _service = with_services(market, args.get("service"), run)
    except Exception as e:  # noqa: BLE001
        die(f"Produktdetail für Markt {market} nicht abrufbar (nur Pickup-Märkte): {e}", 4)
    out(slim_product(detail))


def cmd_discounts(args):
    client = load_client()
    market = args.get("market")
    if not market:
        die("market fehlt")
    d = client.get_discounts(market)
    # Angebote flach aus den Kategorien. Felder laut rewerse (Go-Struct
    # Discount): price = Euro als float (nicht Cent!), images = Liste von
    # URLs, articleNo, manufacturer, subtitle; Kategorie heißt "title".
    # Dasselbe Angebot steht oft in mehreren Kategorien → per Artikel dedupen.
    offers = []
    seen = set()
    for cat in d.get("categories") or []:
        for o in cat.get("offers") or []:
            key = o.get("articleNo") or (o.get("title"), o.get("priceRaw"))
            if key in seen:
                continue
            seen.add(key)
            price = o.get("price")
            price_cents = (
                None
                if o.get("priceParseFail") or not isinstance(price, (int, float))
                else round(price * 100)
            )
            images = o.get("images") or []
            bonus = o.get("loyaltyBonus")
            offers.append({
                "title": o.get("title"),
                "subtitle": o.get("subtitle") or None,
                "brand": o.get("manufacturer") or None,
                "priceCents": price_cents,
                "priceRaw": o.get("priceRaw") or None,
                "articleNumber": o.get("articleNo") or None,
                "imageURL": images[0] if images else None,
                "loyaltyBonusCents": round(bonus * 100) if bonus else None,
                "category": cat.get("title"),
            })
    out({"market": market, "count": len(offers), "offers": offers})


def cmd_refresh(args):
    """Preise aller gemappten Produkte parallel aktualisieren (4 Worker).
    Strategie pro Produkt: 1) Produktdetail (Pickup-Märkte), 2) Suche nach
    Titel + productId-Treffer. Funktioniert dadurch in beiden Markttypen."""
    client = load_client()
    market = args.get("market")
    products = args.get("products") or []
    if not market or not products:
        die("market und products fehlen")
    from concurrent.futures import ThreadPoolExecutor

    def one(p):
        pid, title = p.get("id"), p.get("title")
        # 1) Detail
        try:
            d = client.get_product_by_id(market, pid)
            return {"id": pid, "ok": True, "product": slim_product(d), "source": "detail"}
        except Exception:  # noqa: BLE001
            pass
        # 2) Suche (funktioniert auch in Delivery-Märkten)
        try:
            res = _bridge_search(client, market, title or "", 5, 1, False)
            for sp in res.get("products") or []:
                if sp["productId"] == pid:
                    return {"id": pid, "ok": True, "product": sp, "source": "search"}
            best = (res.get("products") or [None])[0]
            if best:
                return {"id": pid, "ok": True, "product": best, "source": "search-best"}
        except Exception:  # noqa: BLE001
            pass
        return {"id": pid, "ok": False}

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(one, products))
    out({
        "total": len(results),
        "updated": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    })


def _slim_category(c: dict, depth: int = 0) -> dict:
    kids = (c.get("childCategories") or []) if depth < 10 else []
    return {
        "id": c.get("id"),
        "name": c.get("name"),
        "slug": c.get("slug"),
        "tags": c.get("categoryTags") or [],
        "children": [_slim_category(k, depth + 1) for k in kids],
    }


def cmd_shop_overview(args):
    """Kategorienbaum (Marktabteilungen) des Online-Shops eines Markts.
    Erst PICKUP, dann DELIVERY (braucht PLZ)."""
    client = load_client()
    market = args.get("market")
    if not market:
        die("market fehlt")
    plz = args.get("plz") or ""
    last = None
    for st in ("PICKUP", "DELIVERY"):
        try:
            if st == "PICKUP":
                ov = client.get_shop_overview(market, zip_code=plz) if plz else client.get_shop_overview(market)
            else:
                ov = client.get_shop_overview(market, service_type="DELIVERY", zip_code=plz or "67065")
            cats = (ov or {}).get("productCategories") or (ov or {}).get("categories") or []
            if cats:
                out({"service": st, "categories": [_slim_category(c) for c in cats]})
                return
        except Exception as e:  # noqa: BLE001
            last = e
    die(f"Shop-Übersicht für Markt {market} nicht abrufbar: {last or 'keine Kategorien'}", 4)


def cmd_categorize(args):
    """Für jede Suchanfrage die Top-n-Produkte samt REWE-Kategorien liefern.
    Die Zuordnung zur Marktabteilung macht der Server (Cache des Baums)."""
    client = load_client()
    market = args.get("market")
    queries = args.get("queries") or []
    n = int(args.get("n") or 5)
    if not market or not queries:
        die("market und queries fehlen")
    from concurrent.futures import ThreadPoolExecutor

    def one(q):
        try:
            res = _bridge_search(client, market, q, n, 1, False)
            prods = [
                {"title": p.get("title"), "categories": p.get("categories") or []}
                for p in (res.get("products") or [])[:n]
            ]
            return {"query": q, "ok": True, "products": prods}
        except Exception as e:  # noqa: BLE001
            return {"query": q, "ok": False, "error": str(e), "products": []}

    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(one, queries))
    out({"results": results})


def _bridge_search(client, market, query, n, page, vegan):
    """Suche direkt via FFI (ServiceType-Tipp PICKUP→DELIVERY)."""
    from rewerse._ffi import call

    def run(service: str):
        opts = json.dumps({
            "Page": page,
            "ObjectsPerPage": n,
            "ServiceType": service,
            "Filters": ["attribute=vegan"] if vegan else None,
        })
        return call("GetProducts", market, query, opts)

    res, _ = with_services(market, None, run)
    return res


def main() -> None:
    if len(sys.argv) < 2:
        die("Befehl fehlt (status|markets|search|product|discounts)", 3)
    cmd = sys.argv[1]
    args: dict = {}
    if len(sys.argv) >= 3:
        try:
            args = json.loads(sys.argv[2])
        except json.JSONDecodeError as e:
            die(f"Argumente sind kein gültiges JSON: {e}", 3)
    handlers = {
        "status": cmd_status,
        "markets": cmd_markets,
        "search": cmd_search,
        "product": cmd_product,
        "discounts": cmd_discounts,
        "refresh": cmd_refresh,
        "shop_overview": cmd_shop_overview,
        "categorize": cmd_categorize,
    }
    fn = handlers.get(cmd)
    if not fn:
        die(f"Unbekannter Befehl: {cmd}", 3)
    fn(args)


if __name__ == "__main__":
    main()
