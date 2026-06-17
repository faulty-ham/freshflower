// scrape.js — FreshFlower multi-dispensary tracker
// Saves ALL brands. Alerts only for favorited products that restock.
//
// Sources:
//   • Cake House San Jose → iHeartJane via Playwright (bypasses Cloudflare)
//   • Harborside San Jose → Dutchie Plus GraphQL API

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase    = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseWeightGrams(option = "") {
  if (!option) return null;
  const s = option.toLowerCase().trim();
  const gMatch = s.match(/^([\d.]+)\s*g(?:ram)?s?$/);
  if (gMatch) return parseFloat(gMatch[1]);
  const wordOz = {
    "half oz": 14, "half ounce": 14,
    "quarter oz": 7, "quarter ounce": 7,
    "eighth oz": 3.5, "eighth ounce": 3.5, "1/8 oz": 3.5, "1/8oz": 3.5,
    "1/4 oz": 7, "1/4oz": 7,
    "1/2 oz": 14, "1/2oz": 14,
    "1 oz": 28, "1oz": 28, "ounce": 28,
  };
  for (const [k, v] of Object.entries(wordOz)) {
    if (s === k || s.startsWith(k)) return v;
  }
  const ozMatch = s.match(/^([\d.]+)\s*oz(?:ounce)?s?$/);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.3495;
  return null;
}

// ── ① iHeartJane via Playwright — Cake House San Jose (store 6524) ─────────────
// Uses a real headless browser to bypass Cloudflare bot detection.

async function scrapeJane(storeId, sourceKey) {
  console.log(`\n[Jane/Playwright] Fetching store ${storeId}…`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const products = [];

  // Intercept the Jane API calls the page makes and collect the JSON
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes(`/stores/${storeId}/search/products`) && url.includes("category=flower")) {
      try {
        const json = await response.json();
        const items = json?.data ?? json?.products ?? json?.hits ?? [];
        products.push(...items);
        console.log(`  [Jane] Captured ${items.length} products from network response`);
      } catch (e) {
        // not JSON, skip
      }
    }
  });

// Load the flower page and wait for it to render
  await page.goto(`https://cakehousecannabis.com/order-weed/flower`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Give Jane time to fire its initial API calls
  await sleep(5000);

  // Scroll down to trigger lazy loading of more products
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(2000);
  }

  // Final wait to catch any trailing requests
  await sleep(3000);

  await browser.close();

  console.log(`[Jane] ${products.length} flower products captured`);

  // Deduplicate by product ID (scrolling may capture some pages twice)
  const seen = new Set();
  const unique = products.filter(p => {
    const id = String(p.id ?? p.product_id ?? "");
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return unique.flatMap(p => {
    const variants = Array.isArray(p.prices) && p.prices.length
      ? p.prices
      : [{ option: null, price: p.price }];

    return variants.map(v => {
      const option      = v.weight ?? v.option ?? v.label ?? null;
      const weightG     = parseWeightGrams(String(option ?? ""));
      const priceDollars = (v.price ?? v.priceRec) != null
        ? (v.price ?? v.priceRec) / 100
        : null;
      return {
        source:          sourceKey,
        jane_product_id: `${p.id ?? p.product_id}-${option ?? "default"}`,
        product_base_id: String(p.id ?? p.product_id ?? ""),
        brand:           p.brand ?? p.brand_name ?? "",
        strain:          p.name ?? p.product_name ?? "",
        lineage:         p.kind ?? p.lineage ?? "",
        weight_grams:    weightG,
        weight_label:    option,
        price:           priceDollars,
        thc_pct:         p.percent_thc ?? null,
        cbd_pct:         p.percent_cbd ?? null,
        product_url:     `https://cakehousecannabis.com/order-weed/products/${p.id}/${p.slug ?? ""}`,
        image_url:       p.image ?? p.photo ?? null,
      };
    });
  });
}

// ── ② Dutchie Plus GraphQL — Harborside SJ ────────────────────────────────────

const DUTCHIE_GQL     = "https://plus.dutchie.com/plus/2021-07/graphql";
const HARBORSIDE_SLUG = "san-jose-10th-street";

const PRODUCTS_QUERY = `
  query FilteredProducts($retailerSlug: String!) {
    filteredProducts(
      retailerSlug: $retailerSlug
      filter: { category: "Flower" }
      pagination: { limit: 100, offset: 0 }
    ) {
      products {
        id name image
        brand { name }
        strainType
        variants { id priceRec option }
      }
      totalCount
    }
  }
`;

async function dutchieGql(query, variables) {
  const res = await fetch(DUTCHIE_GQL, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept":       "application/json",
      "Origin":       "https://shopharborside.com",
      "Referer":      "https://shopharborside.com/",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Dutchie GQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Dutchie GQL errors: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function scrapeDutchie(slug, sourceKey, siteBase) {
  console.log(`\n[Dutchie] Fetching "${slug}"…`);
  const data  = await dutchieGql(PRODUCTS_QUERY, { retailerSlug: slug });
  const raw   = data?.filteredProducts?.products ?? [];
  const total = data?.filteredProducts?.totalCount ?? 0;
  console.log(`[Dutchie] ${raw.length} of ${total} flower products`);

  return raw.flatMap(p =>
    (p.variants ?? [{ id: p.id, priceRec: null, option: null }]).map(v => {
      const weightG = parseWeightGrams(String(v.option ?? ""));
      return {
        source:          sourceKey,
        jane_product_id: `dutchie-${p.id}-${v.id ?? v.option ?? "default"}`,
        product_base_id: `dutchie-${p.id}`,
        brand:           p.brand?.name ?? "",
        strain:          p.name ?? "",
        lineage:         p.strainType ?? "",
        weight_grams:    weightG,
        weight_label:    v.option ?? null,
        price:           v.priceRec ?? null,
        thc_pct:         null,
        cbd_pct:         null,
        product_url:     `${siteBase}/products/${p.id}`,
        image_url:       p.image ?? null,
      };
    })
  );
}

// ── Database ───────────────────────────────────────────────────────────────────

async function upsertProduct(p) {
  const { error } = await supabase
    .from("flower.products")
    .upsert({
      jane_product_id: p.jane_product_id,
      product_base_id: p.product_base_id,
      source:          p.source,
      brand:           p.brand,
      strain:          p.strain,
      lineage:         p.lineage,
      weight_grams:    p.weight_grams,
      weight_label:    p.weight_label,
      price:           p.price,
      thc_pct:         p.thc_pct,
      cbd_pct:         p.cbd_pct,
      product_url:     p.product_url,
      image_url:       p.image_url,
      is_available:    true,
      last_seen_at:    new Date().toISOString(),
    }, { onConflict: "jane_product_id", ignoreDuplicates: false });
  if (error) console.error("  upsert error:", error.message);
}

async function logAvailability(janeProductId, isAvailable, price) {
  const { error } = await supabase
    .from("flower.availability_log")
    .insert({
      jane_product_id: janeProductId,
      is_available:    isAvailable,
      price:           isAvailable ? price : null,
      scraped_at:      new Date().toISOString(),
    });
  if (error) console.error("  log error:", error.message);
}

async function findRestockedAndNew(products) {
  if (!products.length) return [];
  const ids = products.map(p => p.jane_product_id);
  const { data: existing } = await supabase
    .from("flower.products")
    .select("jane_product_id, is_available")
    .in("jane_product_id", ids);
  const map = new Map((existing ?? []).map(e => [e.jane_product_id, e.is_available]));
  return products.filter(p => {
    const prev = map.get(p.jane_product_id);
    return prev === undefined || prev === false;
  });
}

async function markMissing(seenIds) {
  const { data: current, error } = await supabase
    .from("flower.products")
    .select("jane_product_id, brand, strain, weight_label")
    .eq("is_available", true);
  if (error) { console.error("markMissing error:", error.message); return []; }

  const gone = (current ?? []).filter(p => !seenIds.has(p.jane_product_id));
  for (const p of gone) {
    await supabase
      .from("flower.products")
      .update({ is_available: false, last_seen_at: new Date().toISOString() })
      .eq("jane_product_id", p.jane_product_id);
    await logAvailability(p.jane_product_id, false, null);
    console.log(`  ✗ Gone: [${p.brand}] ${p.strain} ${p.weight_label ?? ""}`);
  }
  return gone;
}

// ── Alert ──────────────────────────────────────────────────────────────────────

async function loadFavoritedProducts() {
  const { data, error } = await supabase
    .from("flower.favorites")
    .select("product_base_id, brand, strain")
    .eq("type", "product")
    .eq("alert_enabled", true);
  if (error) { console.error("loadFavorites error:", error.message); return []; }
  return data ?? [];
}

async function sendAlert(restockedProducts) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_TO) {
    console.log("  (email not configured — skipping alert)");
    return;
  }

  const favProducts = await loadFavoritedProducts();
  if (!favProducts.length) {
    console.log("  (no favorited products with alerts — skipping email)");
    return;
  }

  const favBaseIds = new Set(favProducts.map(f => f.product_base_id).filter(Boolean));
  const alertItems = restockedProducts.filter(p => favBaseIds.has(p.product_base_id));
  if (!alertItems.length) {
    console.log("  No favorited products restocked — no email sent.");
    return;
  }

  const transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
  });

  const storeLabel = { "cakehouse-sj": "Cake House SJ", "harborside-sj": "Harborside SJ" };
  let html = `<h2>🌿 FreshFlower — Favorited Products Back In Stock</h2><ul>`;
  for (const p of alertItems) {
    const wt    = p.weight_label ? ` — ${p.weight_label}` : "";
    const price = p.price != null ? ` — $${p.price.toFixed(2)}` : "";
    const store = storeLabel[p.source] ?? p.source;
    html += `<li><strong>${p.brand}</strong> — ${p.strain} (${p.lineage || "??"})${wt}${price} — ${store}`;
    if (p.product_url) html += ` — <a href="${p.product_url}">View</a>`;
    html += `</li>`;
  }
  html += `</ul><p><small>Manage alerts at <a href="https://faulty-ham.github.io/freshflower/">FreshFlower</a>.</small></p>`;

  await transporter.sendMail({
    from:    `"FreshFlower" <${SMTP_USER}>`,
    to:      ALERT_TO,
    subject: `🌿 ${alertItems.length} favorited product${alertItems.length !== 1 ? "s" : ""} back in stock — FreshFlower`,
    html,
  });
  console.log(`  📧 Alert sent: ${alertItems.length} product(s) restocked`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌿 FreshFlower scrape — ${new Date().toISOString()}`);

  // Run sequentially — Playwright needs browser resources
  const janeProducts    = await scrapeJane(6524, "cakehouse-sj");
  const dutchieProducts = await scrapeDutchie(
    HARBORSIDE_SLUG,
    "harborside-sj",
    "https://shopharborside.com/stores/san-jose-10th-street/products"
  );

  const all = [...janeProducts, ...dutchieProducts];
  console.log(`\n  ${all.length} total variants across both stores`);

  const restockedAndNew = await findRestockedAndNew(all);
  console.log(`  🆕 ${restockedAndNew.length} new/restocked variants`);

  const seenIds = new Set(all.map(p => p.jane_product_id));
  for (const p of all) {
    await upsertProduct(p);
    await logAvailability(p.jane_product_id, true, p.price);
  }

  await markMissing(seenIds);
  await sendAlert(restockedAndNew);

  console.log("\n✅ Done.\n");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
