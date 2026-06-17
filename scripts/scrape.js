// scrape.js — FreshFlower multi-dispensary tracker
// Uses Playwright to scrape both stores.

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { chromium } from "playwright";

// ── Supabase — must use schema option for non-public schemas ──────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { db: { schema: "flower" } }   // ← tells the client to use the flower schema
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
    "1/4 oz": 7,  "1/4oz": 7,
    "1/2 oz": 14, "1/2oz": 14,
    "1 oz": 28,   "1oz": 28, "ounce": 28,
  };
  for (const [k, v] of Object.entries(wordOz)) {
    if (s === k || s.startsWith(k)) return v;
  }
  const ozMatch = s.match(/^([\d.]+)\s*oz(?:ounce)?s?$/);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.3495;
  return null;
}

// ── ① Cake House San Jose — Jane API called directly from inside browser ───────

async function scrapeJane(browser) {
  console.log("\n[Jane] Fetching Cake House San Jose (store 6524)…");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // First visit the site to get cookies/headers that satisfy Cloudflare
  await page.goto("https://cakehousecannabis.com/order-weed/flower", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await sleep(4000);

  // Now call the Jane API directly from within the browser context
  // This uses the browser's cookies and headers, bypassing Cloudflare
  const rawProducts = await page.evaluate(async () => {
    const storeId = 6524;
    const allProducts = [];
    let page = 1;

    while (true) {
      const url = `https://api.iheartjane.com/v1/stores/${storeId}/search/products?category=flower&page=${page}&per_page=96&sort=popular`;
      const res = await fetch(url, {
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Origin": "https://cakehousecannabis.com",
          "Referer": "https://cakehousecannabis.com/order-weed/flower",
        },
        credentials: "include",
      });
      if (!res.ok) {
        console.error("Jane API error:", res.status);
        break;
      }
      const json = await res.json();
      const items = json?.data ?? json?.products ?? json?.hits ?? [];
      if (!items.length) break;
      allProducts.push(...items);
      const total = json?.meta?.total ?? json?.total ?? null;
      if (total !== null && allProducts.length >= total) break;
      if (items.length < 96) break;
      page++;
      await new Promise(r => setTimeout(r, 500));
    }
    return allProducts;
  });

  await context.close();
  console.log(`[Jane] ${rawProducts.length} flower products`);

  return rawProducts.flatMap(p => {
    const variants = Array.isArray(p.prices) && p.prices.length
      ? p.prices : [{ option: null, price: p.price }];
    return variants.map(v => {
      const option = v.weight ?? v.option ?? v.label ?? null;
      const weightG = parseWeightGrams(String(option ?? ""));
      const price = (v.price ?? v.priceRec) != null ? (v.price ?? v.priceRec) / 100 : null;
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

// ── ② Harborside San Jose — Dutchie GraphQL called from inside browser ─────────

async function scrapeDutchie(browser) {
  console.log("\n[Dutchie] Fetching Harborside San Jose…");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Visit the Harborside site first to establish session
  await page.goto("https://shopharborside.com/stores/san-jose-10th-street/products/flower", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await sleep(4000);

  // Execute GraphQL queries from inside the browser context
  const rawProducts = await page.evaluate(async () => {
    const GQL_URL = "https://plus.dutchie.com/plus/2021-07/graphql";
    const SLUG    = "san-jose-10th-street";

    // First introspect to find the right query name
    const introRes = await fetch(GQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: "{ __schema { queryType { fields { name } } } }" }),
    });
    const introJson = await introRes.json();
    const queryNames = (introJson?.data?.__schema?.queryType?.fields ?? []).map(f => f.name);
    console.log("Dutchie queries:", queryNames.join(", "));

    // Try queries in order of likelihood
    const queries = [
      // retailer slug approach
      {
        query: `query($s:String!){filteredProducts(retailerSlug:$s,filter:{category:"Flower"},pagination:{limit:100,offset:0}){products{id name image brand{name} strainType variants{id priceRec option}}totalCount}}`,
        vars: { s: SLUG },
        path: d => d?.filteredProducts?.products,
      },
      {
        query: `query($s:String!){menu(retailerSlug:$s){products(filter:{category:"Flower"}){id name image brand{name} strainType variants{id priceRec option}}}}`,
        vars: { s: SLUG },
        path: d => d?.menu?.products,
      },
      {
        query: `query($s:String!){retailer(slug:$s){id}}`,
        vars: { s: SLUG },
        path: d => null, // just to get retailer ID
      },
    ];

    for (const { query, vars, path } of queries) {
      try {
        const res = await fetch(GQL_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Origin": "https://shopharborside.com",
            "Referer": "https://shopharborside.com/",
          },
          body: JSON.stringify({ query, variables: vars }),
        });
        const json = await res.json();
        if (json.errors) {
          console.log("Query errors:", JSON.stringify(json.errors[0]?.message));
          continue;
        }
        const products = path(json.data);
        if (products?.length) {
          console.log("Got products via query:", query.slice(0, 40));
          return products;
        }
      } catch (e) {
        console.log("Query failed:", e.message);
      }
    }
    return [];
  });

  await context.close();
  console.log(`[Dutchie] ${rawProducts.length} flower products`);

  return rawProducts.flatMap(p =>
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

// ── Database — all table names are relative to the flower schema ───────────────

async function upsertProduct(p) {
  const { error } = await supabase
    .from("products")   // no schema prefix — supabase client handles it
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
    .from("availability_log")
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
    .from("products")
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
    .from("products")
    .select("jane_product_id, brand, strain, weight_label")
    .eq("is_available", true);
  if (error) { console.error("markMissing error:", error.message); return []; }
  const gone = (current ?? []).filter(p => !seenIds.has(p.jane_product_id));
  for (const p of gone) {
    await supabase
      .from("products")
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
  const { data: favs } = await supabase
    .from("favorites")
    .select("product_base_id")
    .eq("type", "product")
    .eq("alert_enabled", true);
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
