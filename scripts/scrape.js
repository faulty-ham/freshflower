// scrape.js — FreshFlower multi-dispensary tracker
// Scrapes rendered DOM since both sites load products via client-side JS.

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

// ── ① Cake House San Jose — DOM scraping ──────────────────────────────────────

async function scrapeJane(browser) {
  console.log("\n[Jane] Scraping Cake House San Jose (store 6524)…");
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Also intercept — belt and suspenders approach
  const rawFromNetwork = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("iheartjane.com") && url.includes("search/products")) {
      try {
        const json = await response.json();
        const items = json?.data ?? json?.products ?? json?.hits ?? [];
        if (items.length) {
          rawFromNetwork.push(...items);
          console.log(`  [Jane/net] +${items.length}`);
        }
      } catch (_) {}
    }
  });

  await page.goto(
    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower",
    { waitUntil: "domcontentloaded", timeout: 60000 }
  );

  // Wait for product cards to appear in the DOM
  console.log("  [Jane] Waiting for product cards…");
  try {
    await page.waitForSelector('[data-testid="product-card"], .product-card, [class*="ProductCard"], [class*="product-card"]', { timeout: 20000 });
    console.log("  [Jane] Product cards found in DOM");
  } catch (_) {
    console.log("  [Jane] No product card selector matched, waiting longer…");
    await sleep(8000);
  }

  // Scroll to load all products
  let lastCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(800);
    const count = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/products/"]').length
    );
    if (i % 5 === 0) console.log(`  [Jane] Product links visible: ${count}`);
    if (count > 0 && count === lastCount && i > 8) break;
    lastCount = count;
  }
  await sleep(2000);

  // Extract data from the page's JS state (window.__store__ or similar)
  // and also from window.__JANE_DATA__ or React component props
  const extracted = await page.evaluate(() => {
    // Try to find Jane's data in window globals
    const janeKeys = Object.keys(window).filter(k =>
      k.toLowerCase().includes('jane') ||
      k.toLowerCase().includes('store') ||
      k.toLowerCase().includes('redux') ||
      k.toLowerCase().includes('__data')
    );

    // Try React fiber / Redux store
    const root = document.getElementById('root') || document.getElementById('__next');
    let fiberData = null;
    if (root) {
      const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fiberKey) {
        // Walk fiber tree looking for products array
        function walkFiber(node, depth = 0) {
          if (!node || depth > 30) return null;
          const props = node.memoizedProps || node.pendingProps || {};
          if (props?.products?.length > 0) return props.products;
          if (props?.items?.length > 0 && props.items[0]?.brand) return props.items;
          const fromChild = walkFiber(node.child, depth + 1);
          if (fromChild) return fromChild;
          const fromSibling = walkFiber(node.sibling, depth + 1);
          if (fromSibling) return fromSibling;
          return null;
        }
        fiberData = walkFiber(root[fiberKey]);
      }
    }

    // Also grab product links and names from DOM as fallback
    const productLinks = Array.from(document.querySelectorAll('a[href*="/products/"]')).map(a => ({
      href: a.href,
      text: a.textContent?.trim().slice(0, 100),
    })).filter(l => l.href.includes('/products/'));

    return { janeKeys, fiberData, productLinks: productLinks.slice(0, 5), url: window.location.href };
  });

  console.log(`  [Jane] Window keys: ${extracted.janeKeys?.slice(0, 10).join(', ')}`);
  console.log(`  [Jane] Fiber products: ${extracted.fiberData?.length ?? 'none'}`);
  console.log(`  [Jane] Product links found: ${extracted.productLinks?.length}`);
  console.log(`  [Jane] Sample links: ${JSON.stringify(extracted.productLinks?.slice(0, 2))}`);
  console.log(`  [Jane] Current URL: ${extracted.url}`);
  console.log(`  [Jane] Network captured: ${rawFromNetwork.length}`);

  await context.close();

  if (rawFromNetwork.length > 0) {
    console.log(`[Jane] Using ${rawFromNetwork.length} network-captured products`);
    const seen = new Set();
    return rawFromNetwork.filter(p => {
      const id = String(p.id ?? p.product_id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    }).flatMap(p => {
      const variants = Array.isArray(p.prices) && p.prices.length
        ? p.prices : [{ option: null, price: p.price }];
      return variants.map(v => {
        const option  = v.weight ?? v.option ?? v.label ?? null;
        const weightG = parseWeightGrams(String(option ?? ""));
        const price   = (v.price ?? v.priceRec) != null ? (v.price ?? v.priceRec) / 100 : null;
        return {
          source: "cakehouse-sj",
          jane_product_id: `jane-${p.id ?? p.product_id}-${option ?? "default"}`,
          product_base_id: String(p.id ?? p.product_id ?? ""),
          brand: p.brand ?? p.brand_name ?? "", strain: p.name ?? p.product_name ?? "",
          lineage: p.kind ?? p.lineage ?? "", weight_grams: weightG,
          weight_label: option, price, thc_pct: p.percent_thc ?? null,
          cbd_pct: p.percent_cbd ?? null,
          product_url: `https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/products/${p.id}/${p.slug ?? ""}`,
          image_url: p.image ?? p.photo ?? null,
        };
      });
    });
  }

  console.log("[Jane] 0 products — check logs above for debugging info");
  return [];
}

// ── ② Harborside San Jose — DOM scraping ──────────────────────────────────────

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

  console.log("  [Dutchie] Waiting for products…");
  try {
    await page.waitForSelector('[class*="product"], [data-testid*="product"], article, .menu-item', { timeout: 20000 });
    console.log("  [Dutchie] Product elements found");
  } catch (_) {
    console.log("  [Dutchie] No product selector matched, waiting longer…");
    await sleep(8000);
  }

  let lastCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await sleep(800);
    const count = await page.evaluate(() =>
      document.querySelectorAll('a[href*="/products/"]').length
    );
    if (i % 5 === 0) console.log(`  [Dutchie] Product links visible: ${count}`);
    if (count > 0 && count === lastCount && i > 8) break;
    lastCount = count;
  }
  await sleep(2000);

  // Extract from React state
  const extracted = await page.evaluate(() => {
    const root = document.getElementById('__next') || document.getElementById('root');
    let fiberProducts = null;
    if (root) {
      const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (fiberKey) {
        function walkFiber(node, depth = 0) {
          if (!node || depth > 40) return null;
          const props = node.memoizedProps || node.pendingProps || {};
          if (Array.isArray(props?.products) && props.products.length > 0 && props.products[0]?.id) return props.products;
          if (Array.isArray(props?.items) && props.items.length > 0 && props.items[0]?.brand) return props.items;
          const s = node.memoizedState;
          if (s?.memoizedState?.products?.length > 0) return s.memoizedState.products;
          return walkFiber(node.child, depth + 1) ?? walkFiber(node.sibling, depth + 1);
        }
        fiberProducts = walkFiber(root[fiberKey]);
      }
    }
    const productLinks = Array.from(document.querySelectorAll('a[href*="/products/"]')).map(a => ({
      href: a.href, text: a.textContent?.trim().slice(0, 80),
    })).filter(l => l.href.includes('/products/')).slice(0, 5);

    return { fiberProducts, productLinks, url: window.location.href };
  });

  console.log(`  [Dutchie] Fiber products: ${extracted.fiberProducts?.length ?? 'none'}`);
  console.log(`  [Dutchie] Product links: ${extracted.productLinks?.length}`);
  console.log(`  [Dutchie] Sample: ${JSON.stringify(extracted.productLinks?.slice(0, 2))}`);
  console.log(`  [Dutchie] Network captured: ${rawFromNetwork.length}`);

  await context.close();

  const rawProducts = rawFromNetwork.length > 0
    ? rawFromNetwork
    : (extracted.fiberProducts ?? []);

  if (!rawProducts.length) {
    console.log("[Dutchie] 0 products — check logs above");
    return [];
  }

  const seen = new Set();
  const unique = rawProducts.filter(p => {
    const id = String(p.id ?? "");
    if (!id || seen.has(id)) return false;
    seen.add(id); return true;
  });
  console.log(`[Dutchie] ${unique.length} unique products`);

  return unique.flatMap(p =>
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
