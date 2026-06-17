// scrape.js — FreshFlower multi-dispensary tracker
// Parses product data directly from rendered DOM elements.

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { db: { schema: "flower" } }
);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseWeightGrams(option = "") {
  if (!option) return null;
  const s = option.toLowerCase().trim();
  const gMatch = s.match(/^([\d.]+)\s*g(?:ram)?s?$/);
  if (gMatch) return parseFloat(gMatch[1]);
  const wordOz = {
    "half oz": 14, "half ounce": 14, "quarter oz": 7, "quarter ounce": 7,
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

// ── ① Cake House San Jose — parse product links from Jane DOM ─────────────────

async function scrapeJane(browser) {
  console.log("\n[Jane] Scraping Cake House San Jose…");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(
    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower",
    { waitUntil: "domcontentloaded", timeout: 60000 }
  );

  // Wait for product cards
  await page.waitForSelector('a[href*="/products/"]', { timeout: 20000 });
  await sleep(3000);

  // Scroll until no new products appear
  let prevCount = 0;
  let stableRounds = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(700);
    const count = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/products/"]').length
    );
    if (count === prevCount) {
      stableRounds++;
      if (stableRounds >= 4) break; // stable for 4 rounds = done loading
    } else {
      stableRounds = 0;
      prevCount = count;
    }
    if (i % 5 === 0) console.log(`  [Jane] ${count} product links visible`);
  }
  await sleep(1000);

  // Extract all product data from the DOM
  const products = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/products/"]'));
    const results = [];

    for (const link of links) {
      const href = link.href;
      // URL pattern: /stores/6524/.../products/{id}/{slug}
      const match = href.match(/\/products\/(\d+)\/([^/?#]+)/);
      if (!match) continue;
      const productId = match[1];
      const slug      = match[2];

      // The full text content of the card contains all info
      const text = link.textContent?.trim() ?? "";

      // Extract lineage (first word if it's a known type)
      const lineageMatch = text.match(/^(Indica|Sativa|Hybrid|CBD|CBN)/i);
      const lineage = lineageMatch ? lineageMatch[1] : "";

      // Extract strain name and brand — they appear after lineage
      // Format: "Lineage\nStrain\nBrand\nFlower\n(Weight)..."
      const lines = text.split(/\n|\r/).map(l => l.trim()).filter(Boolean);

      // Find weight — looks like "(3.5G)" or "(1oz)"
		const weightMatch = text.match(/\(([\d.]+\s*[gG](?:rams?)?)\)/i) ??
                    text.match(/\(([\d./]+\s*(?:oz|ounce)s?)\)/i);
		const weightStr   = weightMatch ? weightMatch[1].trim() : null;

      // Find price — looks like "$19.99" or "$11.99/3.5g"
	const allPrices = [...text.matchAll(/\$([\d.]+)/g)];
	const price     = allPrices.length > 0
	  ? parseFloat(allPrices[allPrices.length - 1][1])
	  : null;

      // THC %
      const thcMatch  = text.match(/THC\s*([\d.]+)%/i);
      const thc       = thcMatch ? parseFloat(thcMatch[1]) : null;

      // Extract image
      const img = link.querySelector('img');
      const imageUrl = img?.src ?? null;

      // Find strain and brand from lines (skip lineage, weight, price, THC/CBD lines)
      const skipPatterns = [/^(Indica|Sativa|Hybrid|CBD|CBN)$/i, /THC|CBD/, /^\$/, /^\(/, /^Flower$/i, /^Pre-roll$/i];
      const nameParts = lines.filter(l => !skipPatterns.some(p => p.test(l)));

      results.push({
        id:        productId,
        slug,
        href,
        lineage,
        weight:    weightStr,
        price,
        thc,
        imageUrl,
        nameParts,
        rawText:   text.slice(0, 200),
      });
    }

    return results;
  });

  console.log(`[Jane] ${products.length} products extracted from DOM`);
  if (products.length > 0) {
    console.log("  [Jane] Sample:", JSON.stringify(products[0]).slice(0, 200));
  }

  await context.close();

  // Deduplicate by product ID
  const seen = new Set();
  return products.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id); return true;
  }).map(p => {
    // nameParts[0] = strain, nameParts[1] = brand (typical Jane layout)
    const strain = p.nameParts[0] ?? p.slug.replace(/-/g, " ");
    const brand  = p.nameParts[1] ?? "";
    const weightG = parseWeightGrams(p.weight);
    return {
      source:          "cakehouse-sj",
      jane_product_id: `jane-${p.id}-${p.weight ?? "default"}`,
      product_base_id: p.id,
      brand,
      strain,
      lineage:         p.lineage,
      weight_grams:    weightG,
      weight_label:    p.weight,
      price:           p.price,
      thc_pct:         p.thc,
      cbd_pct:         null,
      product_url:     p.href,
      image_url:       p.imageUrl,
    };
  });
}

// ── ② Harborside San Jose — wait longer for Dutchie to hydrate ────────────────

async function scrapeDutchie(browser) {
  console.log("\n[Dutchie] Scraping Harborside San Jose…");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  const rawFromNetwork = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("dutchie.com") && url.includes("graphql")) {
      try {
        const json = await response.json();
        const products =
          json?.data?.filteredProducts?.products ??
          json?.data?.menu?.products ??
          json?.data?.products ?? null;
        if (products?.length) {
          rawFromNetwork.push(...products);
          console.log(`  [Dutchie/net] +${products.length}`);
        } else if (json?.data) {
          console.log("  [Dutchie/net] GQL keys:", Object.keys(json.data).join(", "));
        }
      } catch (_) {}
    }
  });

  await page.goto(
    "https://shopharborside.com/stores/san-jose-10th-street/products/flower",
    { waitUntil: "domcontentloaded", timeout: 60000 }
  );

  await sleep(5000);

  // Try to find product cards — Dutchie renders as article or div elements
  const products = await page.evaluate(() => {
    // Look for any element with product-like data attributes or class names
    const allLinks = Array.from(document.querySelectorAll('a[href*="/products/"]'));
    const productLinks = allLinks.filter(a =>
      !a.href.includes('/products/flower') &&
      !a.href.includes('/products/vape') &&
      a.href.match(/\/products\/[^/]+$/)
    );

    return productLinks.map(a => {
      const text   = a.textContent?.trim() ?? "";
      const href   = a.href;
      const idMatch = href.match(/\/([^/]+)$/);
      return {
        id:   idMatch?.[1] ?? href,
        href,
        text: text.slice(0, 300),
      };
    }).slice(0, 5); // just sample first 5 for debugging
  });

  const linkCount = await page.evaluate(() =>
    document.querySelectorAll('a[href*="/products/"]').length
  );

  console.log(`  [Dutchie] Total product links: ${linkCount}`);
  console.log(`  [Dutchie] Sample products: ${JSON.stringify(products)}`);
  console.log(`  [Dutchie] Network captured: ${rawFromNetwork.length}`);

  // Scroll and check again
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(1000);
  }
  await sleep(2000);

  const finalCount = await page.evaluate(() =>
    document.querySelectorAll('a[href*="/products/"]').length
  );
  console.log(`  [Dutchie] After scroll: ${finalCount} product links`);

  await context.close();

  if (rawFromNetwork.length === 0 && finalCount === 0) {
    console.log("[Dutchie] 0 products");
    return [];
  }

  // Process network results if available
  if (rawFromNetwork.length > 0) {
    const seen = new Set();
    return rawFromNetwork.filter(p => {
      const id = String(p.id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    }).flatMap(p =>
      (p.variants ?? [{ id: p.id, priceRec: null, option: null }]).map(v => {
        const weightG = parseWeightGrams(String(v.option ?? ""));
        return {
          source: "harborside-sj",
          jane_product_id: `dutchie-${p.id}-${v.id ?? v.option ?? "default"}`,
          product_base_id: `dutchie-${p.id}`,
          brand: p.brand?.name ?? "", strain: p.name ?? "", lineage: p.strainType ?? "",
          weight_grams: weightG, weight_label: v.option ?? null, price: v.priceRec ?? null,
          thc_pct: null, cbd_pct: null,
          product_url: `https://shopharborside.com/stores/san-jose-10th-street/products/products/${p.id}`,
          image_url: p.image ?? null,
        };
      })
    );
  }

  return [];
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
    console.log(`  ✗ Gone: [${p.brand}] ${p.strain}`);
  }
  return gone;
}

async function sendAlert(restockedProducts) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !ALERT_TO) {
    console.log("  (email not configured)"); return;
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
    console.log(`\n  ${all.length} total variants`);
    const restockedAndNew = await findRestockedAndNew(all);
    console.log(`  🆕 ${restockedAndNew.length} new/restocked`);
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
