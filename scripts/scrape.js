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

// Each entry is a pre-filtered store URL scraped directly, instead of scraping
// the whole catalog and filtering after the fact. Title must always follow the
// "Store - Brand - Weight" format — the dashboard splits on " - " to filter by
// those three fields.
const SEARCH_GROUPS = [
  {
    title:  "Cake House - Fig Farms - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bbrand%5D%5B%5D=Fig%20Farms&filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce",
    store:  "Cake House", brand: "Fig Farms", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - 3C Farms - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=3C%20Farms",
    store:  "Cake House", brand: "3C Farms", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Cam - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=CAM",
    store:  "Cake House", brand: "Cam", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Cam - 7g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=quarter%20ounce&filters%5Bbrand%5D%5B%5D=CAM",
    store:  "Cake House", brand: "Cam", weight: "7g", platform: "jane",
  },
  {
    title:  "Cake House - Cam - 14g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=half%20ounce&filters%5Bbrand%5D%5B%5D=CAM",
    store:  "Cake House", brand: "Cam", weight: "14g", platform: "jane",
  },
  {
    title:  "Cake House - Cream of the Crop - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Cream%20of%20the%20Crop",
    store:  "Cake House", brand: "Cream of the Crop", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Green Dragon - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Green%20Dragon",
    store:  "Cake House", brand: "Green Dragon", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Maven - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Maven",
    store:  "Cake House", brand: "Maven", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Pure Beauty - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Pure%20Beauty",
    store:  "Cake House", brand: "Pure Beauty", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Seed Junky Genetics - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Seed%20Junky%20Genetics",
    store:  "Cake House", brand: "Seed Junky Genetics", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Seed Junky Genetics - 7g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bbrand%5D%5B%5D=Seed%20Junky%20Genetics&filters%5Bavailable_weights%5D%5B%5D=quarter%20ounce",
    store:  "Cake House", brand: "Seed Junky Genetics", weight: "7g", platform: "jane",
  },
  {
    title:  "Cake House - Seed Junky Genetics - 14g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bbrand%5D%5B%5D=Seed%20Junky%20Genetics&filters%5Bavailable_weights%5D%5B%5D=half%20ounce",
    store:  "Cake House", brand: "Seed Junky Genetics", weight: "14g", platform: "jane",
  },
  {
    title:  "Cake House - Snowtill - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Snowtill",
    store:  "Cake House", brand: "Snowtill", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Team Elite Genetics - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Team%20Elite%20Genetics",
    store:  "Cake House", brand: "Team Elite Genetics", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - UpNorth - 3.5g",
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=UpNorth%20Humboldt",
    store:  "Cake House", brand: "UpNorth", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Cake House - Wizard Trees - 3.5g",
    // Using the iheartjane.com store-id URL rather than the cakehousecannabis.com
    // one also given — the latter relies on a store-selection cookie a headless
    // browser never has, which silently loaded the wrong location before.
    url:    "https://www.iheartjane.com/stores/6524/the-cake-house-san-jose/menu/flower?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Wizard%20Trees",
    store:  "Cake House", brand: "Wizard Trees", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Exotix - No Till Kings - 3.5g",
    // Exotix runs on the Meadow platform (note "meadowQuery=" in the URL), not
    // iHeartJane — different site, different card markup, needs its own extractor.
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=categories%3D13532%26brands%3DNo%2BTill%2BKings&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "No Till Kings", weight: "3.5g", platform: "meadow",
  },
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
// getTextLines is nested inside extractJaneCards (rather than a sibling function)
// because page.evaluate() only serializes the exact function passed to it — any
// other top-level function it calls does NOT travel across into the browser context.
function extractJaneCards() {
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

    // Brand/strain: strip every known noise line (lineage badge, rating, discount
    // badge, "Sponsored", THC/CBD, price, weight-in-parens, weight-suffix, CTA
    // button text) wherever it occurs, then take the first two lines left over.
    // Robust to both observed layouts: "[lineage] strain brand ...noise..." and
    // "[lineage] strain brand packaging-descriptor ...noise...".
    const noiseRe = [
      /^(indica|sativa|hybrid|cbd|cbn)(\s*flower)?$/i,
      /^\d+(\.\d+)?\s*\(\d+\)$/,      // rating, e.g. "5.0 (5)"
      /^\d+%\s*off$/i,               // discount badge
      /^sponsored$/i,
      /^\$[\d,.]+$/,                 // standalone price
      /^\(\s*[\d.]+\s*[a-zA-Z]+\s*\)$/, // "( 14G )"
      /^\/\s*[\d.]+\s*(g|oz)$/i,     // "/ 14g"
      /^THC/i, /^CBD/i,
      /^(select weight|add to bag)$/i,
    ];
    const contentLines = lines.filter(l => !noiseRe.some(re => re.test(l)));
    const strainVal = contentLines[0] ?? "";
    const brandVal  = contentLines[1] ?? "";
    const nameParts = [brandVal, strainVal];
    // nameParts[0] = brand, nameParts[1] = strain

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

async function upsertSearchGroup(group) {
  const { data, error } = await supabase.schema("flower").from("search_groups")
    .upsert({
      title: group.title, url: group.url,
      store: group.store, brand: group.brand, weight_label: group.weight,
    }, { onConflict: "title" })
    .select("id")
    .single();
  if (error) { console.error("  search_group upsert error:", error.message); return null; }
  return data.id;
}

async function scrapeSearchGroup(browser, group) {
  console.log(`\n[SearchGroup] ${group.title}`);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const foundProductSelector = await page.waitForSelector('a[href*="/products/"]', { timeout: 20000 })
    .then(() => true).catch(() => false);
  await sleep(2500);

  // Diagnostics — if this comes back empty, these tell us what actually happened
  // (wrong domain/redirect, page needing JS interaction, different link pattern, etc.)
  const diag = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    totalAnchors: document.querySelectorAll("a").length,
    productAnchors: document.querySelectorAll('a[href*="/products/"]').length,
    bodyTextSample: document.body.innerText.slice(0, 500),
  }));
  console.log(`  [SearchGroup] page title: ${JSON.stringify(diag.title)}`);
  console.log(`  [SearchGroup] final URL: ${diag.url}`);
  console.log(`  [SearchGroup] waitForSelector found product link before timeout: ${foundProductSelector}`);
  console.log(`  [SearchGroup] total <a> tags: ${diag.totalAnchors}, tags matching /products/: ${diag.productAnchors}`);
  console.log(`  [SearchGroup] body text sample:`, JSON.stringify(diag.bodyTextSample));

  // The site itself states the true result count (e.g. "7 products") — use it
  // both to know when we've captured everything and to trim off the unrelated
  // "Flower For You" recommendations that get appended after the real results.
  const declaredCount = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s+products?\b/i);
    return m ? parseInt(m[1], 10) : null;
  });
  console.log(`  [SearchGroup] declared count on page: ${declaredCount ?? "not found"}`);

  const collected = new Map();
  function mergeBatch(batch) { for (const item of batch) collected.set(item.id, item); }
  mergeBatch(await page.evaluate(extractJaneCards));

  // Sponsored ads for other brands get mixed into the results even with a brand
  // filter active, so raw card count reaching the declared count doesn't mean
  // we've actually found that many *matching* products yet — keep scrolling
  // until the verified-match count catches up (or we run out of page/iterations).
  const norm = s => (s ?? "").toLowerCase().trim();
  const targetBrand = norm(group.brand);
  const brandMatches = b => {
    const nb = norm(b);
    return !!nb && (nb.includes(targetBrand) || targetBrand.includes(nb));
  };
  const matchedCount = () =>
    [...collected.values()].filter(p => brandMatches(p.nameParts[0])).length;

  // Small, pre-filtered result sets shouldn't need much scrolling, but do a
  // modest pass in case of any lazy loading.
  let pos = 0;
  const step = 700;
  let maxScroll = await page.evaluate(() => document.scrollingElement.scrollHeight);
  let iterations = 0;
  const maxIterations = 40;
  while (pos <= maxScroll && iterations < maxIterations &&
         (declaredCount == null || matchedCount() < declaredCount)) {
    await page.evaluate((y) => window.scrollTo(0, y), pos);
    await sleep(500);
    mergeBatch(await page.evaluate(extractJaneCards));
    maxScroll = Math.max(maxScroll, await page.evaluate(() => document.scrollingElement.scrollHeight));
    pos += step;
    iterations++;
  }

  const allExtracted = Array.from(collected.values());
  console.log(`  [SearchGroup] ${allExtracted.length} product cards found in DOM across ${iterations} scroll steps`);

  let products = allExtracted.filter(p => brandMatches(p.nameParts[0]));
  const rejectedBrands = [...new Set(
    allExtracted.filter(p => !brandMatches(p.nameParts[0])).map(p => p.nameParts[0] || "(empty)")
  )];
  if (rejectedBrands.length > 0) {
    console.log(`  [SearchGroup] excluded ${allExtracted.length - products.length} card(s) with non-matching brand: ${JSON.stringify(rejectedBrands)}`);
  }

  const seenKey = new Set();
  const beforeDedupe = products.length;
  products = products.filter(p => {
    const key = `${norm(p.nameParts[0])}|${norm(p.nameParts[1])}|${norm(p.weight)}`;
    if (seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });
  if (beforeDedupe !== products.length) {
    console.log(`  [SearchGroup] removed ${beforeDedupe - products.length} duplicate listing(s) of the same product`);
  }

  console.log(`  [SearchGroup] ${products.length} confirmed "${group.brand}" products after filtering + de-duping`);
  if (declaredCount != null && products.length !== declaredCount) {
    console.log(`  [SearchGroup] NOTE: brand-matched count (${products.length}) differs from page's declared count (${declaredCount}) — declared count may include sponsored items from other brands, or more scrolling may be needed`);
  }

  if (products.length > 0) {
    console.log("  [SearchGroup] --- debug: lines[] for first 3 products ---");
    products.slice(0, 3).forEach((p, i) => {
      console.log(`  [SearchGroup] #${i} lines:`, JSON.stringify(p.lines));
      console.log(`  [SearchGroup] #${i} nameParts:`, JSON.stringify(p.nameParts));
    });
  }

  await context.close();

  return products.map(p => {
    const brand  = p.nameParts[0] || group.brand;
    const strain = p.nameParts[1] ?? p.slug.replace(/-/g, " ");
    const weightG = parseWeightGrams(p.weight) ?? parseWeightGrams(group.weight);
    return {
      source:          "cakehouse-sj",
      jane_product_id: `jane-${p.id}-${p.weight ?? "default"}`,
      product_base_id: p.id,
      brand,
      strain,
      lineage:         p.lineage,
      weight_grams:    weightG,
      weight_label:    p.weight ?? group.weight,
      price:           p.price,
      thc_pct:         p.thc,
      cbd_pct:         null,
      product_url:     p.href,
      image_url:       p.imageUrl,
      search_group_title: group.title,
    };
  });
}

// ── Meadow platform (e.g. Exotix) ──────────────────────────────────────────
// Card structure, confirmed from real pasted Meadow menu text earlier:
//   "{FULL NAME} - {BRAND}"      (sometimes absent)
//   "$ORIGINAL"
//   "$SALE"
//   "XX% off"                    (only if discounted)
//   "Gram" | "Item" | "N grams"  <- anchor: reliably present on every card
//   "{BRAND}"
//   "{FULL NAME}"                (includes weight + often an abbreviated brand suffix)
//   ["THC ", "XX.XX%", "CBD ", "XX.XX%"]  (optional)
// Each product card is wrapped in its own <a href>, but the URL scheme is
// unknown up front, so anchors are identified by content (containing the
// Gram/Item/weight-unit line) rather than by href pattern.
function extractMeadowCards() {
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

  function stripTrailingBrand(name, brand) {
    let nameWords = name.trim().split(/\s+/).filter(Boolean);
    let brandWords = brand.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.,]/g, "").toUpperCase());
    let idx = brandWords.length - 1;
    while (nameWords.length && idx >= 0) {
      const lastWord = nameWords[nameWords.length - 1].replace(/[.,]/g, "").toUpperCase();
      const brandWord = brandWords[idx];
      if (!lastWord || !brandWord) break;
      if (lastWord === brandWord || brandWord.startsWith(lastWord) || lastWord.startsWith(brandWord)) {
        nameWords.pop();
        idx--;
      } else {
        break;
      }
    }
    return nameWords.join(" ");
  }

  const anchorRe = /^(Gram|Item|Eighth|Half Ounce|Ounce|Pre-?Roll|\d+(\.\d+)?\s*grams?)$/i;
  const links = Array.from(document.querySelectorAll("a[href]"));
  const results = [];

  for (const link of links) {
    const lines = getTextLines(link);
    const anchorIdx = lines.findIndex(l => anchorRe.test(l));
    if (anchorIdx === -1) continue; // not a product card — nav/category/other link

    const brand    = lines[anchorIdx + 1] ? lines[anchorIdx + 1].trim() : "";
    const fullName = lines[anchorIdx + 2] ? lines[anchorIdx + 2].trim() : "";
    if (!brand || !fullName) continue;

    // Price: nearest $ line scanning backward from the anchor, skipping blanks
    // and "% off" lines — this lands on the sale price when discounted, or the
    // only price otherwise (same rule validated against real Meadow text earlier).
    let price = null;
    for (let j = anchorIdx - 1; j >= Math.max(0, anchorIdx - 6); j--) {
      const l = lines[j];
      if (!l) continue;
      if (/%\s*off$/i.test(l)) continue;
      const m = l.match(/^\$([\d,.]+)/);
      if (m) { price = parseFloat(m[1].replace(/,/g, "")); break; }
      break;
    }

    const weightMatch = fullName.match(/(\d+(\.\d+)?)\s*(g|mg|oz)\b/i);
    let weight = null;
    let strainSource = fullName;
    if (weightMatch) {
      weight = weightMatch[1] + weightMatch[3].toLowerCase();
      strainSource = fullName.replace(weightMatch[0], " ");
    }
    let strain = stripTrailingBrand(strainSource, brand).replace(/\s+/g, " ").trim();
    if (!strain) strain = strainSource.trim();

    const thcMatch = lines.join(" ").match(/THC\s*([\d.]+)%/i);
    const thc = thcMatch ? parseFloat(thcMatch[1]) : null;

    const img = link.querySelector("img");
    const imageUrl = img?.src ?? null;
    const href = link.href;
    const idMatch = href.match(/(\d{4,})/); // best-effort numeric id from the URL
    const id = idMatch ? idMatch[1] : href.split("/").filter(Boolean).pop() || strain;

    results.push({ id, href, brand, strain, weight, price, thc, imageUrl, lines });
  }

  return results;
}

async function scrapeMeadowGroup(browser, group) {
  console.log(`\n[Meadow] ${group.title}`);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);

  const diag = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    totalAnchors: document.querySelectorAll("a").length,
    bodyTextSample: document.body.innerText.slice(0, 500),
  }));
  console.log(`  [Meadow] page title: ${JSON.stringify(diag.title)}`);
  console.log(`  [Meadow] final URL: ${diag.url}`);
  console.log(`  [Meadow] total <a> tags: ${diag.totalAnchors}`);
  console.log(`  [Meadow] body text sample:`, JSON.stringify(diag.bodyTextSample));

  const declaredCount = await page.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s+(products?|results?|items?)\b/i);
    return m ? parseInt(m[1], 10) : null;
  });
  console.log(`  [Meadow] declared count on page: ${declaredCount ?? "not found"}`);

  const norm = s => (s ?? "").toLowerCase().trim();
  const targetBrand = norm(group.brand);
  const brandMatches = b => {
    const nb = norm(b);
    return !!nb && (nb.includes(targetBrand) || targetBrand.includes(nb));
  };

  const collected = new Map();
  function mergeBatch(batch) { for (const item of batch) collected.set(item.id, item); }
  const matchedCount = () =>
    [...collected.values()].filter(p => brandMatches(p.brand)).length;

  mergeBatch(await page.evaluate(extractMeadowCards));

  let pos = 0;
  const step = 700;
  let maxScroll = await page.evaluate(() => document.scrollingElement.scrollHeight);
  let iterations = 0;
  const maxIterations = 40;
  while (pos <= maxScroll && iterations < maxIterations &&
         (declaredCount == null || matchedCount() < declaredCount)) {
    await page.evaluate((y) => window.scrollTo(0, y), pos);
    await sleep(500);
    mergeBatch(await page.evaluate(extractMeadowCards));
    maxScroll = Math.max(maxScroll, await page.evaluate(() => document.scrollingElement.scrollHeight));
    pos += step;
    iterations++;
  }

  const allExtracted = Array.from(collected.values());
  console.log(`  [Meadow] ${allExtracted.length} product cards found in DOM across ${iterations} scroll steps`);

  let products = allExtracted.filter(p => brandMatches(p.brand));
  const rejectedBrands = [...new Set(
    allExtracted.filter(p => !brandMatches(p.brand)).map(p => p.brand || "(empty)")
  )];
  if (rejectedBrands.length > 0) {
    console.log(`  [Meadow] excluded ${allExtracted.length - products.length} card(s) with non-matching brand: ${JSON.stringify(rejectedBrands)}`);
  }

  const seenKey = new Set();
  const beforeDedupe = products.length;
  products = products.filter(p => {
    const key = `${norm(p.brand)}|${norm(p.strain)}|${norm(p.weight)}`;
    if (seenKey.has(key)) return false;
    seenKey.add(key);
    return true;
  });
  if (beforeDedupe !== products.length) {
    console.log(`  [Meadow] removed ${beforeDedupe - products.length} duplicate listing(s) of the same product`);
  }

  console.log(`  [Meadow] ${products.length} confirmed "${group.brand}" products after filtering + de-duping`);
  if (declaredCount != null && products.length !== declaredCount) {
    console.log(`  [Meadow] NOTE: matched count (${products.length}) differs from declared count (${declaredCount})`);
  }

  if (products.length > 0) {
    console.log("  [Meadow] --- debug: first 3 products ---");
    products.slice(0, 3).forEach((p, i) => {
      console.log(`  [Meadow] #${i} lines:`, JSON.stringify(p.lines));
      console.log(`  [Meadow] #${i} brand/strain/weight/price:`, p.brand, "|", p.strain, "|", p.weight, "|", p.price);
    });
  }

  await context.close();

  return products.map(p => {
    const weightG = parseWeightGrams(p.weight) ?? parseWeightGrams(group.weight);
    return {
      source:          "exotix-sj",
      jane_product_id: `meadow-${p.id}-${p.weight ?? "default"}`,
      product_base_id: p.id,
      brand:           p.brand,
      strain:          p.strain,
      lineage:         "",
      weight_grams:    weightG,
      weight_label:    p.weight ?? group.weight,
      price:           p.price,
      thc_pct:         p.thc,
      cbd_pct:         null,
      product_url:     p.href,
      image_url:       p.imageUrl,
      search_group_title: group.title,
    };
  });
}

// ── ② Harborside

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
    search_group_id: p.search_group_id ?? null,
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
    let all = [];
    for (const group of SEARCH_GROUPS) {
      const groupId = await upsertSearchGroup(group);
      const scrapeFn = group.platform === "meadow" ? scrapeMeadowGroup : scrapeSearchGroup;
      const groupProducts = await scrapeFn(browser, group);
      for (const p of groupProducts) p.search_group_id = groupId;
      all = all.concat(groupProducts);
    }
    const dutchieProducts = await scrapeDutchie(browser);
    all = all.concat(dutchieProducts);
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
