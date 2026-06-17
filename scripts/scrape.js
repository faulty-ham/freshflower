// scrape.js — FreshFlower multi-dispensary tracker
// Saves ALL brands. Alerts only for favorited products that restock.
//
// Sources:
//   • Cake House Hemet    → Weedmaps public API
//   • Harborside San Jose → Dutchie Plus GraphQL API

import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

// ── ① Weedmaps — Cake House Hemet ─────────────────────────────────────────────

const WEEDMAPS_SLUG = "the-cake-house-hemet";

async function scrapeWeedmaps(slug, sourceKey) {
  console.log(`\n[Weedmaps] Fetching "${slug}"…`);
  const products = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = `https://api-g.weedmaps.com/wm/v2/listings/${slug}/menu_items` +
      `?include_unpublished=false&sort_by=name&sort_dir=asc` +
      `&category_filter=flower&size=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      headers: {
        "Accept":     "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Origin":     "https://weedmaps.com",
        "Referer":    "https://weedmaps.com/",
      },
    });
    if (!res.ok) throw new Error(`Weedmaps API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();

    const items = json?.data?.menu_items ?? [];
    if (!items.length) break;
    products.push(...items);

    const total = json?.meta?.total_count ?? json?.data?.total_count ?? null;
    console.log(`[Weedmaps] offset ${offset}: ${items.length} items (${products.length}${total ? "/" + total : ""} total)`);
    if (total !== null && products.length >= total) break;
    if (items.length < limit) break;
    offset += limit;
    await sleep(500);
  }

  console.log(`[Weedmaps] ${products.length} flower products`);

  return products.flatMap(p => {
    const variants = Array.isArray(p.variants) && p.variants.length
      ? p.variants
      : [{ price: p.price, option: null }];

    return variants.map(v => {
      const option  = v.option ?? v.size ?? null;
      const weightG = parseWeightGrams(String(option ?? ""));
      return {
        source:          sourceKey,
        jane_product_id: `wm-${p.id}-${option ?? "default"}`,
        product_base_id: `wm-${p.id}`,
        brand:           p.brand?.name ?? p.brand_name ?? "",
        strain:          p.name ?? "",
        lineage:         p.strain_classification ?? p.category ?? "",
        weight_grams:    weightG,
        weight_label:    option,
        price:           v.price != null ? parseFloat(v.price) : null,
        thc_pct:         p.percent_thc ? parseFloat(p.percent_thc) : null,
        cbd_pct:         p.percent_cbd ? parseFloat(p.percent_cbd) : null,
        product_url:     `https://weedmaps.com/dispensaries/${slug}/menu/${p.slug ?? p.id}`,
        image_url:       p.photos?.[0]?.original_url ?? p.avatar_image?.original_url ?? null,
      };
    });
  });
}

// ── ② Dutchie Plus GraphQL — Harborside SJ ────────────────────────────────────

const DUTCHIE_GQL     = "https://plus.dutchie.com/plus/2021-07/graphql";
const HARBORSIDE_SLUG = "san-jose-10th-street";

const RETAILER_QUERY = `
  query Retailer($slug: String!) {
    retailer(slug: $slug) { id name }
  }
`;

const PRODUCTS_QUERY = `
  query FilteredProducts($retailerId: ID!, $filter: ProductFilter, $pagination: PaginationInput) {
    filteredProducts(retailerId: $retailerId, filter: $filter, pagination: $pagination) {
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
  console.log(`\n[Dutchie] Fetching retailer "${slug}"…`);

  const retailerData = await dutchieGql(RETAILER_QUERY, { slug });
  const retailerId   = retailerData?.retailer?.id;
  if (!retailerId) throw new Error(`Could not resolve Dutchie retailer ID for "${slug}"`);
  console.log(`[Dutchie] Retailer ID: ${retailerId}`);

  const raw      = [];
  const pageSize = 100;
  let offset     = 0;

  while (true) {
    const data  = await dutchieGql(PRODUCTS_QUERY, {
      retailerId,
      filter:     { category: "Flower" },
      pagination: { limit: pageSize, offset },
    });
    const page  = data?.filteredProducts?.products ?? [];
    const total = data?.filteredProducts?.totalCount ?? 0;
    raw.push(...page);
    console.log(`[Dutchie] offset ${offset}: ${page.length} (${raw.length}/${total})`);
    if (!page.length || raw.length >= total) break;
    offset += pageSize;
    await sleep(500);
  }

  console.log(`[Dutchie] ${raw.length} flower products`);

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

// ── Alert: only for favorited products that restocked ─────────────────────────

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

  const favBaseIds  = new Set(favProducts.map(f => f.product_base_id).filter(Boolean));
  const alertItems  = restockedProducts.filter(p => favBaseIds.has(p.product_base_id));
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

  const storeLabel = { "cakehouse": "Cake House", "harborside-sj": "Harborside SJ" };

  let html = `<h2>🌿 FreshFlower — Favorited Products Back In Stock</h2>
<p>The following products you favorited are now available:</p><ul>`;

  for (const p of alertItems) {
    const store = storeLabel[p.source] ?? p.source;
    const wt    = p.weight_label ? ` — ${p.weight_label}` : "";
    const price = p.price != null ? ` — $${p.price.toFixed(2)}` : "";
    html += `<li><strong>${p.brand}</strong> — ${p.strain} (${p.lineage || "??"})${wt}${price} — ${store}`;
    if (p.product_url) html += ` — <a href="${p.product_url}">View</a>`;
    html += `</li>`;
  }

  html += `</ul><p><small>Manage alerts in your <a href="https://faulty-ham.github.io/freshflower/">FreshFlower dashboard</a>.</small></p>`;

  await transporter.sendMail({
    from:    `"FreshFlower" <${SMTP_USER}>`,
    to:      ALERT_TO,
    subject: `🌿 ${alertItems.length} favorited product${alertItems.length !== 1 ? "s" : ""} back in stock — FreshFlower`,
    html,
  });
  console.log(`  📧 Alert sent: ${alertItems.length} favorited product(s) restocked`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌿 FreshFlower scrape — ${new Date().toISOString()}`);

  const [wmProducts, dutchieProducts] = await Promise.all([
    scrapeWeedmaps(WEEDMAPS_SLUG, "cakehouse"),
    scrapeDutchie(
      HARBORSIDE_SLUG,
      "harborside-sj",
      "https://shopharborside.com/stores/san-jose-10th-street/products"
    ),
  ]);

  const all = [...wmProducts, ...dutchieProducts];
  console.log(`\n  ${all.length} total variants across both stores`);

  const restockedAndNew = await findRestockedAndNew(all);
  if (restockedAndNew.length) {
    console.log(`  🆕 ${restockedAndNew.length} new/restocked variants`);
  } else {
    console.log("  No new or restocked products this run.");
  }

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