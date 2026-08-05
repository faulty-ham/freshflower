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
  {
    title:  "Exotix - Wood Wide",
    // Exotix's site doesn't support filtering by weight (only brand/category),
    // so this one URL returns every weight variant mixed together. Instead of a
    // fixed weight, splitByWeight tells main() to bucket the results by each
    // product's own extracted weight and create one search group per bucket
    // dynamically (e.g. "Exotix - Wood Wide - 3.5g", "...- 7g", etc.) rather
    // than relying on a separate pre-filtered URL per weight.
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DWOOD%2BWIDE&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Wood Wide", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Maven",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DMaven&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Maven", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Moon Valley Organics",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DMoon%2BValley%2BOrganics&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Moon Valley Organics", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Seed Junky",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DSeed%2BJunky&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Seed Junky", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Snowtill Organics",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DSnowtill%2BOrganics&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Snowtill Organics", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Team Elite Genetics",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DTEAM%2BELITE%2BGENETICS&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Team Elite Genetics", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Top Shelf Cultivation",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DTOP%2BSHELF%2BCULTIVATION&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Top Shelf Cultivation", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Teds Budz",
    // Note: you wrote "Teds Buds" but the URL param (and presumably the
    // site's actual brand spelling) is "Teds Budz" — used that spelling here
    // so brand-matching against the real scraped data actually works.
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=brands%3DTeds%2BBudz&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Teds Budz", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Nameless Genetics",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=categories%3D13532%26brands%3DNAMELESS%2BGENETICS&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Nameless Genetics", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Exotix - Bosky",
    url:    "https://www.exotixflower.com/shopsj?meadowQuery=categories%3D13532%26brands%3DBOSKY&meadow-page=collections%2Fcategories%2F13532",
    store:  "Exotix", brand: "Bosky", platform: "meadow", splitByWeight: true,
  },
  {
    title:  "Haze - Fig Farms - 3.5g",
    // haze420.com turned out to gate the menu behind a location picker that
    // wasn't reliably click-through-able headlessly. Same fix as Cake House:
    // hit the underlying iheartjane.com platform directly with the store id
    // (26) baked into the path instead.
    url:    "https://www.iheartjane.com/stores/26/haze-dispensary-almaden-rd/menu?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Fig%20Farms",
    store:  "Haze", brand: "Fig Farms", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Haze - Lumpy's Flowers - 3.5g",
    url:    "https://www.iheartjane.com/stores/26/haze-dispensary-almaden-rd/menu?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Lumpy%27s%20Flowers",
    store:  "Haze", brand: "Lumpy's Flowers", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Haze - Moon Valley Cannabis - 3.5g",
    url:    "https://www.iheartjane.com/stores/26/haze-dispensary-almaden-rd/menu?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Moon%20Valley%20Cannabis",
    store:  "Haze", brand: "Moon Valley Cannabis", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Haze - Team Elite Genetics - 3.5g",
    url:    "https://www.iheartjane.com/stores/26/haze-dispensary-almaden-rd/menu?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Team%20Elite%20Genetics",
    store:  "Haze", brand: "Team Elite Genetics", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Haze - UpNorth Humboldt - 3.5g",
    url:    "https://www.iheartjane.com/stores/26/haze-dispensary-almaden-rd/menu?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=UpNorth%20Humboldt",
    store:  "Haze", brand: "UpNorth Humboldt", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Haze - Wood Wide - 3.5g",
    url:    "https://www.iheartjane.com/stores/26/haze-dispensary-almaden-rd/menu?filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Wood%20Wide",
    store:  "Haze", brand: "Wood Wide", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Haze - Bosky Genetics - 3.5g",
    // URL you gave was titled "Exotix - Bosky - 3.5g" but points to
    // haze-dispensary-almaden-rd (store 26) — same store as every other
    // Haze group, not Exotix. Renamed to keep the store filter accurate.
    url:    "https://www.iheartjane.com/stores/26/haze-dispensary-almaden-rd/menu?filters%5Broot_types%5D%5B%5D=flower&filters%5Bavailable_weights%5D%5B%5D=eighth%20ounce&filters%5Bbrand%5D%5B%5D=Bosky%20Genetics",
    store:  "Haze", brand: "Bosky Genetics", weight: "3.5g", platform: "jane",
  },
  {
    title:  "Harborside - Fig Farms - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=fig-farms&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "Fig Farms", weight: "3.5g", platform: "dutchie",
  },
  {
    title:  "Harborside - 3C Farms - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=3-c-farms&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "3C Farms", weight: "3.5g", platform: "dutchie",
  },
  {
    title:  "Harborside - Cam - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=cam&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "Cam", weight: "3.5g", platform: "dutchie",
  },
  {
    title:  "Harborside - Cam - 14g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=cam&sortby=relevance&weight=1-2oz",
    store:  "Harborside", brand: "Cam", weight: "14g", platform: "dutchie",
  },
  {
    title:  "Harborside - Green Dragon - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=green-dragon&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "Green Dragon", weight: "3.5g", platform: "dutchie",
  },
  {
    title:  "Harborside - Northern Harvest - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=northern-harvest&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "Northern Harvest", weight: "3.5g", platform: "dutchie",
  },
  {
    title:  "Harborside - Pure Beauty - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=pure-beauty&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "Pure Beauty", weight: "3.5g", platform: "dutchie",
  },
  {
    title:  "Harborside - Team Elite Genetics - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=team-elite-genetics&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "Team Elite Genetics", weight: "3.5g", platform: "dutchie",
  },
  {
    title:  "Harborside - UpNorth - 3.5g",
    url:    "https://shopharborside.com/stores/san-jose-10th-street/products/flower?brands=up-north&sortby=relevance&weight=1-8oz",
    store:  "Harborside", brand: "UpNorth", weight: "3.5g", platform: "dutchie",
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
    const strainVal = (contentLines[0] ?? "").replace(/\s*\[\s*[\d.]+\s*(g|oz|mg)\s*\]\s*$/i, "").trim();
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
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await sleep(2500);

  // Some sites (e.g. custom storefronts wrapping a Jane menu, same pattern as
  // Exotix wrapping Meadow) embed the actual menu in an iframe rather than
  // hosting it directly — in that case document.querySelectorAll on the main
  // page finds none of the real product links. Check every frame and target
  // whichever one actually has product links, falling back to the main page.
  const allFrames = page.frames();
  let target = page.mainFrame();
  let targetProductCount = await page.evaluate(() => document.querySelectorAll('a[href*="/products/"]').length).catch(() => 0);
  for (const frame of allFrames) {
    if (frame === page.mainFrame()) continue;
    try {
      const count = await frame.evaluate(() => document.querySelectorAll('a[href*="/products/"]').length);
      if (count > targetProductCount) { targetProductCount = count; target = frame; }
    } catch (e) { /* cross-origin or not ready — skip */ }
  }
  const usingIframe = target !== page.mainFrame();
  if (allFrames.length > 1) {
    console.log(`  [SearchGroup] page has ${allFrames.length} frame(s): ${JSON.stringify(allFrames.map(f => f.url()))}`);
    console.log(`  [SearchGroup] using ${usingIframe ? `iframe (${target.url()})` : "main page"} — ${targetProductCount} product link(s) found there`);
  }

  const foundProductSelector = await target.waitForSelector('a[href*="/products/"]', { timeout: 20000 })
    .then(() => true).catch(() => false);

  // Diagnostics — if this comes back empty, these tell us what actually happened
  // (wrong domain/redirect, page needing JS interaction, different link pattern, etc.)
  const diag = await target.evaluate(() => ({
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

  // If STILL no product links (even after checking frames), this might be a
  // location-confirmation prompt or a multi-location picker blocking the real
  // menu. Log every visible clickable element's text, and try clicking
  // anything that looks like a confirm/continue button — or, if the page
  // title names a specific location, a menu link matching it.
  if (diag.productAnchors === 0) {
    const clickableTexts = await target.evaluate(() => {
      const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
      const texts = els.map(el => el.textContent.trim()).filter(t => t && t.length < 40);
      return [...new Set(texts)].slice(0, 40);
    });
    console.log(`  [SearchGroup] no product links found — visible clickable text on page:`, JSON.stringify(clickableTexts));

    const titleLocationWord = (diag.title.match(/-\s*([A-Za-z]+)/) || [])[1];

    const confirmPatterns = [
      /^yes$/i, /confirm/i, /shop here/i, /^continue$/i,
      /i'?m shopping here/i, /this is my store/i, /^ok$/i, /^got it$/i, /^accept$/i,
      ...(titleLocationWord ? [new RegExp(`${titleLocationWord}.*menu`, "i")] : []),
      /\bmenu\b/i,
    ];
    let clickedText = null;
    for (const pattern of confirmPatterns) {
      const handle = await target.evaluateHandle(({ src, flags }) => {
        const re = new RegExp(src, flags);
        const els = Array.from(document.querySelectorAll('button, [role="button"], a'));
        // Only consider elements that are actually visible/clickable, not
        // hidden nav-dropdown items that exist in the DOM but can't be clicked.
        return els.find(el => {
          if (!re.test(el.textContent.trim())) return false;
          const r = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        }) || null;
      }, { src: pattern.source, flags: pattern.flags });
      const el = handle.asElement();
      if (el) {
        clickedText = await el.evaluate(e => e.textContent.trim());
        console.log(`  [SearchGroup] clicking element matching /${pattern.source}/${pattern.flags}: ${JSON.stringify(clickedText)}`);
        await el.click().catch(e => console.log(`  [SearchGroup] click failed: ${e.message}`));
        await sleep(2500);
        break;
      }
    }

    if (clickedText) {
      const diag2 = await target.evaluate(() => ({
        totalAnchors: document.querySelectorAll("a").length,
        productAnchors: document.querySelectorAll('a[href*="/products/"]').length,
        bodyTextSample: document.body.innerText.slice(0, 500),
      }));
      console.log(`  [SearchGroup] after click — total <a>: ${diag2.totalAnchors}, matching /products/: ${diag2.productAnchors}`);
      console.log(`  [SearchGroup] after click — body text sample:`, JSON.stringify(diag2.bodyTextSample));
    } else {
      console.log(`  [SearchGroup] no matching visible confirm/continue button found to click`);
    }
  }

  // The site itself states the true result count (e.g. "7 products") — use it
  // both to know when we've captured everything and to trim off the unrelated
  // "Flower For You" recommendations that get appended after the real results.
  const declaredCount = await target.evaluate(() => {
    const m = document.body.innerText.match(/(\d+)\s+products?\b/i);
    return m ? parseInt(m[1], 10) : null;
  });
  console.log(`  [SearchGroup] declared count on page: ${declaredCount ?? "not found"}`);

  const collected = new Map();
  function mergeBatch(batch) { for (const item of batch) collected.set(item.id, item); }
  mergeBatch(await target.evaluate(extractJaneCards));

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
  let maxScroll = await target.evaluate(() => document.scrollingElement.scrollHeight);
  let iterations = 0;
  const maxIterations = 40;
  while (pos <= maxScroll && iterations < maxIterations &&
         (declaredCount == null || matchedCount() < declaredCount)) {
    await target.evaluate((y) => window.scrollTo(0, y), pos);
    await sleep(500);
    mergeBatch(await target.evaluate(extractJaneCards));
    maxScroll = Math.max(maxScroll, await target.evaluate(() => document.scrollingElement.scrollHeight));
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

  // The card sometimes displays a different weight/price tier than what the
  // URL actually filtered for (e.g. a product available at both 3.5g and 14g
  // shows its 3.5g pricing by default even under a "?...=half ounce" URL).
  // Since price is weight-specific, silently keeping a mismatched item would
  // show the wrong price under the wrong group — exclude it instead. Only
  // applies to fixed-weight groups; splitByWeight groups bucket by whatever
  // weight is actually found, so there's no "wrong" weight to check against.
  if (!group.splitByWeight && group.weight) {
    const targetWeightG = parseWeightGrams(group.weight);
    const beforeWeightCheck = products.length;
    const mismatched = [];
    products = products.filter(p => {
      const g = parseWeightGrams(p.weight);
      const ok = targetWeightG == null || g == null || Math.abs(g - targetWeightG) < 0.01;
      if (!ok) mismatched.push(`${p.nameParts[1]} (${p.weight})`);
      return ok;
    });
    if (beforeWeightCheck !== products.length) {
      console.log(`  [SearchGroup] excluded ${beforeWeightCheck - products.length} product(s) whose card showed a different weight than "${group.weight}": ${JSON.stringify(mismatched)}`);
    }
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

  const source = group.store.toLowerCase().replace(/\s+/g, "") + "-sj";
  return products.map(p => {
    const brand  = p.nameParts[0] || group.brand;
    const strain = p.nameParts[1] ?? p.slug.replace(/-/g, " ");
    const weightG = parseWeightGrams(p.weight) ?? parseWeightGrams(group.weight);
    return {
      source,
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

  function stripLeadingBrand(name, brand) {
    let nameWords = name.trim().split(/\s+/).filter(Boolean);
    let brandWords = brand.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.,]/g, "").toUpperCase());
    let idx = 0;
    while (nameWords.length && idx < brandWords.length) {
      const firstWord = nameWords[0].replace(/[.,]/g, "").toUpperCase();
      const brandWord = brandWords[idx];
      if (!firstWord || !brandWord) break;
      if (firstWord === brandWord || brandWord.startsWith(firstWord) || firstWord.startsWith(brandWord)) {
        nameWords.shift();
        idx++;
      } else {
        break;
      }
    }
    return nameWords.join(" ");
  }

  // Brand mentions in titles are sometimes truncated to just the brand's
  // leading words (e.g. "Moon Valley" for the full brand "Moon Valley
  // Organics") rather than the whole thing. Tries matching the trailing N
  // words of the name against the first N words of the brand, largest N
  // first, so it catches both full and partial brand mentions in one pass.
  function stripTrailingBrandPartial(name, brand) {
    const nameWords = name.trim().split(/\s+/).filter(Boolean);
    const brandWords = brand.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.,]/g, "").toUpperCase());
    for (let n = Math.min(nameWords.length, brandWords.length); n >= 1; n--) {
      const tail = nameWords.slice(nameWords.length - n);
      const brandPrefix = brandWords.slice(0, n);
      const matches = tail.every((w, i) => {
        const wu = w.replace(/[.,]/g, "").toUpperCase();
        const bu = brandPrefix[i];
        return wu === bu || bu.startsWith(wu) || wu.startsWith(bu);
      });
      if (matches) return nameWords.slice(0, nameWords.length - n).join(" ");
    }
    return name;
  }

  // Handles: brand at the end, possibly truncated ("... Moon Valley" for
  // "Moon Valley Organics"); a cultivation/product-type descriptor phrase
  // wedged between strain and brand ("... Living Soil Moon Valley"); and
  // brand at the start ("Wood Wide Neonz"). Real inconsistency in the site's
  // own data, not one fixed pattern.
  function cleanStrainName(strainSource, brand) {
    const original = strainSource.trim();
    const wordCount = s => s.trim().split(/\s+/).filter(Boolean).length;
    const originalWords = wordCount(original);

    // 1) Try a trailing brand match first (before removing any descriptor),
    //    since brand may sit immediately after the strain name.
    let s = stripTrailingBrandPartial(original, brand);
    let brandFoundTrailing = wordCount(s) < originalWords;

    // 2) Strip a trailing cultivation/product-type descriptor phrase.
    const beforeDescriptor = s;
    s = s.replace(/\s*(living soil flower|living soil|flower)\s*$/i, "").trim();
    const descriptorRemoved = s !== beforeDescriptor;

    // 3) If a descriptor was removed, brand might be exposed underneath it —
    //    try trailing-brand-strip once more. Guard against a fuzzy single-word
    //    match wiping everything (e.g. "WOODZY" matching brand word "WOOD")
    //    by only accepting a strictly shorter, non-empty result.
    if (descriptorRemoved) {
      const beforeWords = wordCount(s);
      const secondPass = stripTrailingBrandPartial(s, brand).trim();
      if (secondPass.length > 0 && wordCount(secondPass) < beforeWords) {
        s = secondPass;
        brandFoundTrailing = true;
      }
    }

    // 4) Brand never found on the trailing side (regardless of whether a
    //    descriptor was removed) — try a leading mention instead, e.g.
    //    "Wood Wide Neonz" or "No Till Kings Gelato #41 Living Soil Flower"
    //    (descriptor strips first, leaving "No Till Kings Gelato #41" with
    //    the brand still sitting at the front).
    if (!brandFoundTrailing) {
      s = stripLeadingBrand(s, brand);
    }

    s = s.replace(/\s+/g, " ").trim();
    s = s.replace(/\s*\[\s*[\d.]+\s*(g|oz|mg)\s*\]\s*$/i, "").trim();
    return s || original;
  }

  // Look for a percentage value belonging to a "THC"/"CBD" label, whether it's
  // on the same line ("THC 26.66%") or the label and value are separate lines
  // ("THC", "19.1215%") — both formats have been seen on real Meadow pages.
  function findPercentAfterLabel(lines, label, fromIdx, maxLookahead) {
    const labelRe = new RegExp(`^${label}\\b`, "i");
    for (let k = fromIdx; k < Math.min(lines.length, fromIdx + maxLookahead); k++) {
      if (!labelRe.test(lines[k])) continue;
      const sameLine = lines[k].match(new RegExp(`${label}\\s*([\\d.]+)%`, "i"));
      if (sameLine) return parseFloat(sameLine[1]);
      const next = lines[k + 1];
      if (next && /^[\d.]+%$/.test(next)) return parseFloat(next);
    }
    return null;
  }

  // Not every product card is guaranteed to be wrapped in its own single <a>
  // element the way iHeartJane's are — some Meadow layouts only link a small
  // sub-element (image, "add to cart", etc.) rather than the whole card. So
  // instead of anchoring on individual links, this scans the WHOLE page's
  // flattened text as one continuous stream — matching exactly how the very
  // first pasted Meadow sample earlier in this project was parsed — and treats
  // each "Gram"/"Item"/weight-unit line as a product-block delimiter regardless
  // of which element it lives in.
  const anchorRe = /^(Gram|Item|Eighth|Half Ounce|Ounce|Pre-?Roll|\d+(\.\d+)?\s*grams?)$/i;
  const lines = getTextLines(document.body);
  const results = [];

  for (let i = 0; i < lines.length; i++) {
    if (!anchorRe.test(lines[i])) continue;

    const brand    = lines[i + 1] ? lines[i + 1].trim() : "";
    const fullName = lines[i + 2] ? lines[i + 2].trim() : "";
    if (!brand || !fullName) continue;
    if (/^\$|%\s*off$/i.test(brand) || /^\$|%\s*off$/i.test(fullName)) continue;

    // Price: nearest $ line scanning backward from the anchor, skipping blanks
    // and "% off" lines — lands on the sale price when discounted, the only
    // price otherwise. Allows whitespace between "$" and the amount since DOM
    // text-node grouping sometimes splits them into adjacent lines.
    let price = null;
    for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
      const l = lines[j];
      if (!l) continue;
      if (/%\s*off$/i.test(l)) continue;
      const m = l.match(/^\$\s*([\d,.]+)/);
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
    let strain = cleanStrainName(strainSource, brand).replace(/\s+/g, " ").trim();
    if (!strain) strain = strainSource.trim();

    const thc = findPercentAfterLabel(lines, "THC", i + 3, 6);

    // No reliable per-product href with this whole-page scanning approach —
    // caller falls back to the search group's own URL for product_url.
    const id = `${brand}-${strainSource}-${weight}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    results.push({ id, href: null, brand, strain, weight, price, thc, imageUrl: null, lines: lines.slice(Math.max(0, i - 4), i + 6) });
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
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await sleep(4000);

  // The menu content may be an embedded iframe (the URL's "meadowQuery"/
  // "meadow-page" params suggest a widget rather than a full page) rather than
  // part of the top-level document — if so, document.querySelectorAll on the
  // main page finds almost nothing. Check every frame and target whichever one
  // actually has content instead of assuming it's the main page.
  const allFrames = page.frames();
  console.log(`  [Meadow] page has ${allFrames.length} frame(s): ${JSON.stringify(allFrames.map(f => f.url()))}`);

  let target = page.mainFrame();
  let targetAnchorCount = await page.evaluate(() => document.querySelectorAll("a").length).catch(() => 0);
  for (const frame of allFrames) {
    if (frame === page.mainFrame()) continue;
    try {
      const count = await frame.evaluate(() => document.querySelectorAll("a").length);
      if (count > targetAnchorCount) { targetAnchorCount = count; target = frame; }
    } catch (e) { /* cross-origin or not ready — skip */ }
  }
  const usingIframe = target !== page.mainFrame();
  console.log(`  [Meadow] using ${usingIframe ? `iframe (${target.url()})` : "main page"} — ${targetAnchorCount} anchor(s) found there`);

  const diag = await target.evaluate(() => ({
    title: document.title,
    url: location.href,
    totalAnchors: document.querySelectorAll("a").length,
    bodyTextSample: document.body.innerText.slice(0, 500),
  }));
  console.log(`  [Meadow] page title: ${JSON.stringify(diag.title)}`);
  console.log(`  [Meadow] final URL: ${diag.url}`);
  console.log(`  [Meadow] total <a> tags: ${diag.totalAnchors}`);
  console.log(`  [Meadow] body text sample:`, JSON.stringify(diag.bodyTextSample));

  const declaredCount = await target.evaluate(() => {
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

  mergeBatch(await target.evaluate(extractMeadowCards));

  let pos = 0;
  const step = 700;
  let maxScroll = await target.evaluate(() => document.scrollingElement.scrollHeight);
  let iterations = 0;
  const maxIterations = 40;
  while (pos <= maxScroll && iterations < maxIterations &&
         (declaredCount == null || matchedCount() < declaredCount)) {
    await target.evaluate((y) => window.scrollTo(0, y), pos);
    await sleep(500);
    mergeBatch(await target.evaluate(extractMeadowCards));
    maxScroll = Math.max(maxScroll, await target.evaluate(() => document.scrollingElement.scrollHeight));
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
      product_url:     p.href || group.url,
      image_url:       p.imageUrl,
      search_group_title: group.title,
    };
  });
}

// ── ② Harborside

// ── ③ Harborside (Dutchie platform) ─────────────────────────────────────────
// Card structure, confirmed from real page text: the <a href="/product/..">
// only contains the title/brand/lineage/THC — price and weight live in the
// parent container one level up (climbing further would start pulling in a
// neighboring card, so this stops as soon as more than one product link
// appears in the container).
//   "{Brand} {Weight} Jar - {Strain}"   <- title, inside the <a>
//   "{Brand}"                            <- repeated
//   "Indica" | "Sativa" | "Hybrid"
//   "THC: XX.X%"
//   ...promo/deal badge text (ignored)...
//   "$XX.XX"                             <- price, only visible one level up
//   "- 1/8 oz"                           <- weight, only visible one level up
//   "Add to cart"
function extractDutchieCards() {
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

  const links = Array.from(document.querySelectorAll('a[href*="/product/"]'));
  const results = [];

  for (const link of links) {
    let container = link;
    let goodContainer = link;
    for (let i = 0; i < 4; i++) {
      if (!container.parentElement) break;
      container = container.parentElement;
      const linksInside = container.querySelectorAll('a[href*="/product/"]').length;
      if (linksInside > 1) break;
      goodContainer = container;
    }

    const lines = getTextLines(goodContainer);
    if (lines.length === 0) continue;

    const titleLine = lines[0] || "";
    const dashIdx = titleLine.lastIndexOf(" - ");
    const strain = (dashIdx >= 0 ? titleLine.slice(dashIdx + 3).trim() : titleLine.trim())
      .replace(/\s*\[\s*[\d.]+\s*(g|oz|mg)\s*\]\s*$/i, "").trim();

    const brand = lines[1] || "";
    const lineage = lines.find(l => /^(indica|sativa|hybrid|cbd|cbn)$/i.test(l)) || "";

    const thcMatch = lines.join(" ").match(/THC:?\s*([\d.]+)%/i);
    const thc = thcMatch ? parseFloat(thcMatch[1]) : null;

    const priceLine = lines.find(l => /^\$[\d,.]+$/.test(l));
    const price = priceLine ? parseFloat(priceLine.replace(/[$,]/g, "")) : null;

    const weightLine = lines.find(l => /^-?\s*[\d./]+\s*(oz|g|gram)/i.test(l));
    let weight = null;
    if (weightLine) {
      weight = weightLine.replace(/^-\s*/, "").trim();
    } else {
      const titleWeightMatch = titleLine.match(/(\d+(\.\d+)?\s*g)\b/i);
      if (titleWeightMatch) weight = titleWeightMatch[1];
    }

    const href = link.getAttribute("href");
    const idMatch = href ? href.match(/\/product\/([^/?#]+)/) : null;
    const id = idMatch ? idMatch[1] : (href || strain);

    results.push({ id, href, brand, strain, lineage, weight, price, thc, lines });
  }

  return results;
}

async function scrapeDutchieGroup(browser, group) {
  console.log(`\n[Dutchie] ${group.title}`);
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  // Dutchie menus are commonly powered by a GraphQL API under the hood —
  // capturing that response directly (if it fires) is far more reliable than
  // scraping rendered DOM cards, so try this first alongside the DOM fallback.
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
          console.log(`  [Dutchie] network capture: +${products.length} (total ${rawFromNetwork.length})`);
        }
      } catch (_) {}
    }
  });

  await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await sleep(4000);

  // Check for an embedded iframe, same pattern as Meadow/Haze — Dutchie menus
  // on a custom domain like shopharborside.com may or may not be native.
  const allFrames = page.frames();
  let target = page.mainFrame();
  let targetAnchorCount = await page.evaluate(() => document.querySelectorAll("a").length).catch(() => 0);
  for (const frame of allFrames) {
    if (frame === page.mainFrame()) continue;
    try {
      const count = await frame.evaluate(() => document.querySelectorAll("a").length);
      if (count > targetAnchorCount) { targetAnchorCount = count; target = frame; }
    } catch (e) { /* cross-origin or not ready — skip */ }
  }

  const norm = s => (s ?? "").toLowerCase().trim();
  const targetBrand = norm(group.brand);
  const brandMatches = b => {
    const nb = norm(b);
    return !!nb && (nb.includes(targetBrand) || targetBrand.includes(nb));
  };

  const collected = new Map();
  function mergeBatch(batch) { for (const item of batch) collected.set(item.id, item); }
  mergeBatch(await target.evaluate(extractDutchieCards));

  // Modest scroll pass in case of lazy loading.
  let pos = 0;
  const step = 800;
  let maxScroll = await target.evaluate(() => document.scrollingElement.scrollHeight);
  let iterations = 0;
  const maxIterations = 20;
  while (pos <= maxScroll && iterations < maxIterations) {
    await target.evaluate((y) => window.scrollTo(0, y), pos);
    await sleep(500);
    mergeBatch(await target.evaluate(extractDutchieCards));
    maxScroll = Math.max(maxScroll, await target.evaluate(() => document.scrollingElement.scrollHeight));
    pos += step;
    iterations++;
  }

  const allExtracted = Array.from(collected.values());
  console.log(`  [Dutchie] ${allExtracted.length} product cards found in DOM across ${iterations} scroll steps`);

  let products = allExtracted.filter(p => brandMatches(p.brand));
  const rejectedBrands = [...new Set(
    allExtracted.filter(p => !brandMatches(p.brand)).map(p => p.brand || "(empty)")
  )];
  if (rejectedBrands.length > 0) {
    console.log(`  [Dutchie] excluded ${allExtracted.length - products.length} card(s) with non-matching brand: ${JSON.stringify(rejectedBrands)}`);
  }

  // Same weight-mismatch issue as the Jane scraper — the card can show a
  // different weight/price tier than the URL actually filtered for. Since
  // price is weight-specific, exclude rather than trust it blindly.
  if (!group.splitByWeight && group.weight) {
    const targetWeightG = parseWeightGrams(group.weight);
    const beforeWeightCheck = products.length;
    const mismatched = [];
    products = products.filter(p => {
      const g = parseWeightGrams(p.weight);
      const ok = targetWeightG == null || g == null || Math.abs(g - targetWeightG) < 0.01;
      if (!ok) mismatched.push(`${p.strain} (${p.weight})`);
      return ok;
    });
    if (beforeWeightCheck !== products.length) {
      console.log(`  [Dutchie] excluded ${beforeWeightCheck - products.length} product(s) whose card showed a different weight than "${group.weight}": ${JSON.stringify(mismatched)}`);
    }
  }

  console.log(`  [Dutchie] ${products.length} confirmed "${group.brand}" products (network products captured: ${rawFromNetwork.length})`);

  if (products.length > 0) {
    console.log("  [Dutchie] --- debug: first 3 products ---");
    products.slice(0, 3).forEach((p, i) => {
      console.log(`  [Dutchie] #${i} brand/strain/weight/price/thc:`, p.brand, "|", p.strain, "|", p.weight, "|", p.price, "|", p.thc);
    });
  }

  await context.close();

  // Prefer network-captured GraphQL data when available — more reliable and
  // structured than anything parsed out of rendered DOM text.
  if (rawFromNetwork.length > 0) {
    const seen = new Set();
    const deduped = rawFromNetwork.filter(p => {
      const id = String(p.id ?? "");
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    });
    const matched = deduped.filter(p => brandMatches(p.brand?.name));
    console.log(`  [Dutchie] ${matched.length} of ${deduped.length} network products match brand "${group.brand}"`);

    return matched.flatMap(p =>
      (p.variants ?? [{ id: p.id, priceRec: null, option: null }]).map(v => {
        const weightG = parseWeightGrams(String(v.option ?? ""));
        return {
          source: "harborside-sj",
          jane_product_id: `dutchie-${p.id}-${v.id ?? v.option ?? "default"}`,
          product_base_id: `dutchie-${p.id}`,
          brand: p.brand?.name ?? group.brand, strain: p.name ?? "", lineage: p.strainType ?? "",
          weight_grams: weightG, weight_label: v.option ?? group.weight, price: v.priceRec ?? null,
          thc_pct: null, cbd_pct: null,
          product_url: `https://shopharborside.com/stores/san-jose-10th-street/products/products/${p.id}`,
          image_url: p.image ?? null,
          search_group_title: group.title,
        };
      })
    );
  }

  return products.map(p => {
    const weightG = parseWeightGrams(p.weight) ?? parseWeightGrams(group.weight);
    // Harborside displays weight in ounces ("1/8 oz") — normalize to grams
    // for consistency with every other store, which already shows grams.
    const weightLabel = weightG != null
      ? `${Number(weightG.toFixed(2))}g`
      : (p.weight || group.weight);
    return {
      source: "harborside-sj",
      jane_product_id: `dutchie-${p.id}`,
      product_base_id: p.id,
      brand: p.brand || group.brand,
      strain: p.strain,
      lineage: p.lineage,
      weight_grams: weightG,
      weight_label: weightLabel,
      price: p.price,
      thc_pct: p.thc,
      cbd_pct: null,
      product_url: p.href ? `https://shopharborside.com${p.href}` : null,
      image_url: null,
      search_group_title: group.title,
    };
  });
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
      const scrapeFn =
        group.platform === "meadow"  ? scrapeMeadowGroup :
        group.platform === "dutchie" ? scrapeDutchieGroup :
        scrapeSearchGroup;

      if (group.splitByWeight) {
        // No per-weight URL available — scrape everything matching the brand,
        // then bucket by each product's own extracted weight and create one
        // search group per weight found, rather than one group for the config.
        const rawProducts = await scrapeFn(browser, group);
        const byWeight = new Map();
        for (const p of rawProducts) {
          const w = p.weight_label || "unknown";
          if (!byWeight.has(w)) byWeight.set(w, []);
          byWeight.get(w).push(p);
        }
        console.log(`  [Split] "${group.title}" → ${byWeight.size} weight bucket(s): ${JSON.stringify([...byWeight.keys()])}`);
        for (const [weight, prods] of byWeight) {
          const subGroup = {
            title: `${group.store} - ${group.brand} - ${weight}`,
            url: group.url, store: group.store, brand: group.brand, weight,
          };
          const groupId = await upsertSearchGroup(subGroup);
          for (const p of prods) p.search_group_id = groupId;
          all = all.concat(prods);
        }
      } else {
        const groupId = await upsertSearchGroup(group);
        const groupProducts = await scrapeFn(browser, group);
        for (const p of groupProducts) p.search_group_id = groupId;
        all = all.concat(groupProducts);
      }
    }
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
