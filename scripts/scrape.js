// scrape.js — FreshFlower multi-dispensary tracker
// Uses Playwright to scrape both stores.

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

// ── Supabase ───────────────────────────────────────────────────────────────────
// NOTE: After running this, go to Supabase → Settings → API → Exposed schemas
// and add "flower" to the list, then save.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { db: { schema: "flower" } }
);

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
    "1/4 oz": 7, "1/4oz": 7, "1/2 oz": 14, "1/2oz": 14,
    "1 oz": 28, "1oz": 28, "ounce": 28,
  };
  for (const [k, v] of Object.entries(wordOz)) {
    if (s === k || s.startsWith(k)) return v;
  }
  const ozMatch = s.match(/^([\d.]+)\s*oz(?:ounce)?s?$/);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.3495;
  return null;
}

// ── ① Cake House San Jose — intercept Jane API responses ──────────────────────
// Strategy: set up response interception BEFORE navigating, capture all
// api.iheartjane.com calls as the page loads and scrolls.

async function scrapeJane(browser) {
  console.log("\n[Jane] Fetching Cake House San Jose (store 6524)…");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const page = await context.newPage();
  const rawProducts = [];
  const capturedUrls = new Set();

  // Attach listener BEFORE navigation
  page.on("response", async (response) => {
    const url = response.url();
    if (
      url.includes("iheartjane.com") &&
      url.includes("search/products") &&
      !capturedUrls.has(url)
    ) {
      capturedUrls.add(url);
      try {
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const json = await response.json();
        const items = json?.data ?? json?.products ?? json?.hits ?? [];
        if (items.length) {
          rawProducts.push(...items);
          console.log(`  [Jane] +${items.length} products (total: ${rawProducts.length})`);
        }
      } catch (e) {
        console.log("  [Jane] Response parse error:", e.message);
      }
    }
  });

  // Navigate — Jane fires API calls as page renders
  console.log("  [Jane] Navigating to Cake House San Jose…");
  await page.goto("https://cakehousecannabis.com/order-weed/flower", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Wait for initial API calls
  await sleep(6000);
  console.log(`  [Jane] After initial load: ${rawProducts.length} products`);

  // Scroll to trigger pagination/lazy loading
  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(1000);
  }

  await sleep(3000);
  console.log(`  [Jane] After scrolling: ${rawProducts.length} products`);

  // Log page title and URL to confirm we're on the right page
  const title = await page.title();
  const url   = page.url();
  console.log(`  [Jane] Page: "${title}" @ ${url}`);

  await context.close();

  // Deduplicate by product ID
  const seen = new Set();
  const unique = rawProducts.filter(p => {
    const id = String(p.id ?? p.product_id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });

  console.log(`[Jane] ${unique.length} unique flower products`);

  return unique.flatMap(p => {
    const variants = Array.isArray(p.prices) && p.prices.length
      ? p.prices : [{ option: null, price: p.price }];
    return variants.map(v => {
      const option  = v.weight ?? v.option ?? v.label ?? null;
      const weightG = parseWeightGrams(String(option ?? ""));
      const price   = (v.price ?? v.priceRec) != null ? (v.price ?? v.priceRec) / 100 : null;
      return {
        source:          "cakehouse-sj",
        jane_product_id: `jane-${p.id ?? p.product_id}-${option ?? "default"}`,
        product_base_id: String(p.id ?? p.product_id ?? ""),
        brand:           p.brand ?? p.brand_name ?? "",
        strain:          p.name ?? p.product_name ?? "",
        lineage:         p.kind ?? p.lineage ?? "",
        weight_grams:    weightG,
        weight_label:    option,
        price,
        thc_pct:         p.percent_thc ?? null,
        cbd_pct:         p.percent_cbd ?? null,
        product_url:     `https://cakehousecannabis.com/order-weed/products/${p.id}/${p.slug ?? ""}`,
        image_url:       p.image ?? p.photo ?? null,
      };
    });
  });
}

// ── ② Harborside San Jose — intercept Dutchie GraphQL responses ───────────────

async function scrapeDutchie(browser) {
  console.log("\n[Dutchie] Fetching Harborside San Jose…");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  const rawProducts = [];

  // Attach listener BEFORE navigation
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("dutchie.com") && url.includes("graphql")) {
      try {
        const ct = response.headers()["content-type"] ?? "";
        if (!ct.includes("json")) return;
        const json = await response.json();
        // Try all known product paths in the response
        const products =
          json?.data?.filteredProducts?.products ??
          json?.data?.menu?.products ??
          json?.data?.products ??
          json?.data?.retailerMenu?.products ??
          null;
        if (products?.length) {
          rawProducts.push(...products);
          console.log(`  [Dutchie] +${products.length} products (total: ${rawProducts.length})`);
        } else if (json?.data) {
          // Log what keys we actually got so we can see the schema
          console.log("  [Dutchie] GraphQL data keys:", Object.keys(json.data).join(", "));
        }
      } catch (e) {
        console.log("  [Dutchie] Response parse error:", e.message);
      }
    }
  });

  console.log("  [Dutchie] Navigating to Harborside SJ flower page…");
  await page.goto(
    "https://shopharborside.com/stores/san-jose-10th-street/products/flower",
    { waitUntil: "domcontentloaded", timeout: 60000 }
  );

  await sleep(6000);
  console.log(`  [Dutchie] After initial load: ${rawProducts.length} products`);

  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(1000);
  }

  await sleep(3000);

  const title = await page.title();
  const url   = page.url();
  console.log(`  [Dutchie] Page: "${title}" @ ${url}`);

  await context.close();

  const seen = new Set();
  const unique = rawProducts.filter(p => {
    const id = String(p.id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });

  console.log(`[Dutchie] ${unique.length} unique flower products`);

  return unique.flatMap(p =>
    (p.variants ?? [{ id: p.id, priceRec: null, option: null }]).map(v => {
      const weightG = parseWeightGrams(String(v.option ?? ""));
      return {
        source:          "harborside-sj",
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
        product_url:     `https://shopharborside.com/stores/san-jose-10th-street/products/products/${p.id}`,
        image_url:       p.image ?? null,
      };
    })
  );
}

// ── Database ───────────────────────────────────────────────────────────────────

async function upsertProduct(p) {
  const { error } = await supabase.from("products").upsert({
    jane_product_id: p.jane_product_id, product_base_id: p.product_base_id,
    source: p.source, brand: p.brand, strain: p.strain, lineage: p.lineage,
    weight_grams: p.weight_grams, weight_label: p.weight_label, price: p.price,
    thc_pct: p.thc_pct, cbd_pct: p.cbd_pct,
    product_url: p.product_url, image_url: p.image_url,
    is_available: true, last_seen_at: new Date().toISOString(),
  }, { onConflict: "jane_product_id", ignoreDuplicates: false });
  if (error) console.error("  upsert error:", error.message);
}

async function logAvailability(janeProductId, isAvailable, price) {
  const { error } = await supabase.from("availability_log").insert({
    jane_product_id: janeProductId, is_available: isAvailable,
    price: isAvailable ? price : null, scraped_at: new Date().toISOString(),
  });
  if (error) console.error("  log error:", error.message);
}

async function findRestockedAndNew(products) {
  if (!products.length) return [];
  const ids = products.map(p => p.jane_product_id);
  const { data: existing } = await supabase
    .from("products").select("jane_product_id, is_available").in("jane_product_id", ids);
  const map = new Map((existing ?? []).map(e => [e.jane_product_id, e.is_available]));
  return products.filter(p => {
    const prev = map.get(p.jane_product_id);
    return prev === undefined || prev === false;
  });
}

async function markMissing(seenIds) {
  const { data: current, error } = await supabase
    .from("products").select("jane_product_id, brand, strain, weight_label").eq("is_available", true);
  if (error) { console.error("markMissing error:", error.message); return []; }
  const gone = (current ?? []).filter(p => !seenIds.has(p.jane_product_id));
  for (const p of gone) {
    await supabase.from("products")
      .update({ is_available: false, last_seen_at: new Date().toISOString() })
      .eq("jane_product_id", p.jane_product_id);
    await logAvailability(p.jane_product_id, false, null);
    console.log(`  ✗ Gone: [${p.brand}] ${p.strain} ${p.weight_label ?? ""}`);
  }
  return gone;
}

async function sendAlert(restockedProducts) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_TO) {
    console.log("  (email not configured — skipping alert)"); return;
  }
  const { data: favs } = await supabase.from("favorites")
    .select("product_base_id").eq("type", "product").eq("alert_enabled", true);
  if (!favs?.length) { console.log("  (no alert favorites set)"); return; }
  const favIds     = new Set(favs.map(f => f.product_base_id).filter(Boolean));
  const alertItems = restockedProducts.filter(p => favIds.has(p.product_base_id));
  if (!alertItems.length) { console.log("  No favorited products restocked."); return; }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const storeLabel = { "cakehouse-sj": "Cake House SJ", "harborside-sj": "Harborside SJ" };
  let html = `<h2>🌿 FreshFlower — Favorited Products Back In Stock</h2><ul>`;
  for (const p of alertItems) {
    const wt = p.weight_label ? ` — ${p.weight_label}` : "";
    const pr = p.price != null ? ` — $${p.price.toFixed(2)}` : "";
    html += `<li><strong>${p.brand}</strong> — ${p.strain}${wt}${pr} — ${storeLabel[p.source] ?? p.source}`;
    if (p.product_url) html += ` — <a href="${p.product_url}">View</a>`;
    html += `</li>`;
  }
  html += `</ul>`;
  await transporter.sendMail({
    from: `"FreshFlower" <${SMTP_USER}>`, to: ALERT_TO,
    subject: `🌿 ${alertItems.length} favorited product${alertItems.length !== 1 ? "s" : ""} back in stock`,
    html,
  });
  console.log(`  📧 Alert sent: ${alertItems.length} restocked`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌿 FreshFlower scrape — ${new Date().toISOString()}`);
  const browser = await chromium.launch({ headless: true });
  try {
    const janeProducts    = await scrapeJane(browser);
    const dutchieProducts = await scrapeDutchie(browser);
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
  } finally {
    await browser.close();
  }
  console.log("\n✅ Done.\n");
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
