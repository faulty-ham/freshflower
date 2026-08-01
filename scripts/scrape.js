// scrape.js — FreshFlower multi-dispensary tracker
// Parses product data directly from rendered DOM elements.

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Only these brands get scraped/stored for Cake House. Matching is case-insensitive
// and fuzzy (substring either direction), so "CAM" matches "CAM Private Reserve" and
// "UpNorth" matches "UpNorth Humboldt" without needing exact spelling.
const FAVORITE_BRANDS = [
  "A Golden State",
  "Blueprint",
  "CAM Private Reserve",
  "Cream of the Crop",
  "Fig Farms",
  "Green Dragon",
  "Lumpy's",
  "No Till Kings",
  "Pure Beauty",
  "Snowtill",
  "Team Elite Genetics",
  "Top Shelf Cultivation",
  "Wizard Trees",
  "UpNorth",
  "Wonderbrett",
];

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

// Extraction logic run inside the page at each scroll checkpoint.

// innerText's line-break behavior depends on the browser actually computing visual
// layout, which can behave inconsistently in headless mode for flex/grid card
// layouts. This instead walks real DOM text nodes and groups consecutive nodes
// that share the same immediate parent element into one "line" — a structural
// stand-in for line breaks that doesn't depend on rendered layout at all.
function getTextLines(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
  const groups = [];
  let node, lastParent = null, current = "";
  while ((node = walker.nextNode())) {
    const t = node.textContent.trim();
    if (!t) continue;
    const parent = node.parentElement;
    if (parent === lastParent) {
      current += " " + t;
    } else {
      if (current) groups.push(current.trim());
      current = t;
      lastParent = parent;
    }
  }
  if (current) groups.push(current.trim());
  return groups;
}

function extractJaneCards() {
  const links = Array.from(document.querySelectorAll('a[href*="/products/"]'));
  const results = [];

  for (const link of links) {
    const href = link.href;
    const match = href.match(/\/products\/(\d+)\/([^/?#]+)/);
    if (!match) continue;
    const productId = match[1];
    const slug      = match[2];

    const lines = getTextLines(link);
    const text  = lines.join(" \n ");   // flattened form for whole-string regex matching below

    const lineageMatch = text.match(/^(Indica|Sativa|Hybrid|CBD|CBN)/i);
    const lineage = lineageMatch ? lineageMatch[1] : "";

    // Price/weight appear as "$26.99/14g" (never in parentheses).
    // Takes the FIRST such pair — the sale price when there's a discount,
    // since the original/crossed-out price line renders after it.
    const priceWeightMatch = text.match(/\$([\d,.]+)\s*\/\s*([\d.]+)\s*(g|oz)/i);
    let weightStr = null;
    let price = null;
    if (priceWeightMatch) {
      price     = parseFloat(priceWeightMatch[1].replace(/,/g, ""));
      weightStr = `${priceWeightMatch[2]}${priceWeightMatch[3].toLowerCase()}`;
    } else {
      // Fallback: a flat price with no "/weight" suffix.
      const allPrices = [...text.matchAll(/\$([\d,.]+)/g)];
      price = allPrices.length > 0 ? parseFloat(allPrices[0][1].replace(/,/g, "")) : null;
    }

    const thcMatch  = text.match(/THC\s*([\d.]+)%/i);
    const thc       = thcMatch ? parseFloat(thcMatch[1]) : null;

    const img = link.querySelector('img');
    const imageUrl = img?.src ?? null;

    // Brand/strain: scan backward from the price/weight line (or the CTA button
    // if no price line matched) and take the nearest two lines that aren't

    // discount badges, "Sponsored"/rating noise, lineage+type lines, THC/CBD,
    // or another price line. Nearest = brand, next-nearest = strain — this
    // matches the card layout: Title / Type / [Sponsored] / Title / Brand / ...
    const noisePatterns = [
      /^\d+%\s*off$/i, /^sponsored$/i, /^[\d.]+\s*\(\d+\)$/,
      /^(indica|sativa|hybrid|cbd|cbn)(\s*flower)?$/i,
      /^flower$/i,
      /^(select weight|add to bag)$/i,
      /THC/i, /CBD/i, /^\$/,
    ];
    let anchorIdx = lines.findIndex(l => /\$[\d,.]+\s*\/\s*[\d.]+\s*(g|oz)/i.test(l));
    if (anchorIdx === -1) {
      anchorIdx = lines.findIndex(l => /^(select weight|add to bag)$/i.test(l));
    }
    const nameParts = [];
    if (anchorIdx > 0) {
      for (let k = anchorIdx - 1; k >= 0 && nameParts.length < 2; k--) {
        const l = lines[k];
        if (!l || noisePatterns.some(p => p.test(l))) continue;
        nameParts.push(l);
      }
    }
    // nameParts[0] = brand (nearest to price), nameParts[1] = strain (dup title line)

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
      lines,
      rawText:   text.slice(0, 200),
    });
  }

  return results;
}

async function scrapeJane(browser) {
  console.log("\n[Jane] Scraping Cake House San Jose\u2026");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(
    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower",
    { waitUntil: "domcontentloaded", timeout: 60000 }
  );

  await page.waitForSelector('a[href*="/products/"]', { timeout: 20000 });
  await sleep(3000);

  // The list is virtualized \u2014 cards scrolled out of view get removed from the DOM
  // entirely, not just hidden. So we extract at EVERY scroll checkpoint and merge
  // by product id, rather than waiting for a final "stable" render and grabbing once.
  const collected = new Map();
  function mergeBatch(batch) {
    for (const item of batch) collected.set(item.id, item);
  }

  mergeBatch(await page.evaluate(extractJaneCards));

  // The product grid may scroll inside its own nested container rather than the
  // page itself (common with virtualized lists) \u2014 scrolling the page in that case
  // does little or nothing, which is the likely cause of premature plateaus.
  // Detect the real scrollable container: the overflow:auto/scroll element that
  // actually contains the most product links, falling back to the page itself.
  const scrollInfo = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("*")).filter(el => {
      const cs = getComputedStyle(el);
      return (cs.overflowY === "auto" || cs.overflowY === "scroll") &&
             el.scrollHeight > el.clientHeight + 50;
    });
    let bestIdx = -1, bestCount = 0;
    candidates.forEach((el, i) => {
      const count = el.querySelectorAll('a[href*="/products/"]').length;
      if (count > bestCount) { bestCount = count; bestIdx = i; }
    });
    if (bestIdx === -1) return { usesContainer: false };
    const el = candidates[bestIdx];
    el.setAttribute("data-ff-scroll-target", "1");
    return { usesContainer: true, productCount: bestCount, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  });
  console.log(`  [Jane] scroll target: ${scrollInfo.usesContainer ? `nested container (${scrollInfo.productCount} links, ${scrollInfo.scrollHeight}px)` : "page (no nested scroll container found)"}`);

  const viewportHeight = scrollInfo.usesContainer ? scrollInfo.clientHeight : await page.evaluate(() => window.innerHeight);
  const step = Math.max(200, Math.round(viewportHeight * 0.6));
  let maxScroll = scrollInfo.usesContainer ? scrollInfo.scrollHeight : await page.evaluate(() => document.scrollingElement.scrollHeight);
  let pos = 0;
  let iterations = 0;
  const maxIterations = 400;

  const scrollTo = async (y) => {
    if (scrollInfo.usesContainer) {
      await page.evaluate((y) => {
        document.querySelector('[data-ff-scroll-target="1"]').scrollTop = y;
      }, y);
    } else {
      await page.evaluate((y) => window.scrollTo(0, y), y);
    }
  };
  const currentMaxScroll = async () => {
    if (scrollInfo.usesContainer) {
      return page.evaluate(() => document.querySelector('[data-ff-scroll-target="1"]').scrollHeight);
    }
    return page.evaluate(() => document.scrollingElement.scrollHeight);
  };

  while (pos <= maxScroll && iterations < maxIterations) {
    await scrollTo(pos);
    await sleep(500);
    mergeBatch(await page.evaluate(extractJaneCards));
    maxScroll = Math.max(maxScroll, await currentMaxScroll());
    pos += step;
    iterations++;
    if (iterations % 15 === 0) console.log(`  [Jane] step ${iterations}, ${collected.size} unique so far`);
  }

  const products = Array.from(collected.values());
  console.log(`[Jane] ${products.length} unique products extracted from DOM across ${iterations} scroll steps`);
  if (products.length > 0) {
    console.log("  [Jane] Sample:", JSON.stringify(products[0]).slice(0, 200));
    console.log("  [Jane] --- debug: lines[] for first 3 products ---");
    products.slice(0, 3).forEach((p, i) => {
      console.log(`  [Jane] #${i} lines:`, JSON.stringify(p.lines));
      console.log(`  [Jane] #${i} nameParts:`, JSON.stringify(p.nameParts));
    });
  }

  await context.close();

  // Only keep favorite brands \u2014 fuzzy, case-insensitive, substring-in-either-direction
  // match (so "CAM" matches "CAM Private Reserve", "UpNorth" matches "UpNorth Humboldt").
  const norm = s => (s ?? "").toLowerCase().trim();
  const favBrandsNorm = FAVORITE_BRANDS.map(norm);
  const matchesFavoriteBrand = brand => {
    const b = norm(brand);
    if (!b) return false;
    return favBrandsNorm.some(fav => b.includes(fav) || fav.includes(b));
  };

  const filtered = products.filter(p => {
    const brand = p.nameParts[0] ?? "";
    return matchesFavoriteBrand(brand);
  });
  console.log(`[Jane] ${filtered.length} of ${products.length} match favorite brands`);

  return filtered.map(p => {
    const brand  = p.nameParts[0] ?? "";
    const strain = p.nameParts[1] ?? p.slug.replace(/-/g, " ");
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
  const { error } = await supabase.schema("flower").from("products").upsert({
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
  const { error } = await supabase.schema("flower").from("availability_log").insert({
    jane_product_id: janeProductId, is_available: isAvailable,
    price: isAvailable ? price : null, scraped_at: new Date().toISOString(),
  });
  if (error) console.error("  log error:", error.message);
}

async function findRestockedAndNew(products) {
  if (!products.length) return [];
  const ids = products.map(p => p.jane_product_id);
  const { data: existing } = await supabase
    .schema("flower").from("products").select("jane_product_id, is_available").in("jane_product_id", ids);
  const map = new Map((existing ?? []).map(e => [e.jane_product_id, e.is_available]));
  return products.filter(p => {
    const prev = map.get(p.jane_product_id);
    return prev === undefined || prev === false;
  });
}

async function markMissing(seenIds) {
  const { data: current, error } = await supabase
    .schema("flower").from("products").select("jane_product_id, brand, strain, weight_label").eq("is_available", true);
  if (error) { console.error("markMissing error:", error.message); return []; }
  const gone = (current ?? []).filter(p => !seenIds.has(p.jane_product_id));
  for (const p of gone) {
    await supabase.schema("flower").from("products")
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
  const { data: favs } = await supabase.schema("flower").from("favorites")
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
