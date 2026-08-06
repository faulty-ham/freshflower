-- ============================================================
-- Flower Tracker — Supabase Schema (VaporTrails project)
-- All objects in the `flower` schema — isolated from VaporTrails.
-- Run this entire file in the SQL Editor, then click Run.
-- ============================================================

create schema if not exists flower;

-- ── Products ──────────────────────────────────────────────────
-- One row per product variant (brand + strain + weight combo).

create table if not exists flower.products (
  id                bigserial    primary key,
  jane_product_id   text         not null unique,
  product_base_id   text,                           -- groups variants of same product
  source            text         not null,          -- 'cakehouse' | 'harborside-sj'
  brand             text,
  strain            text,
  lineage           text,
  weight_grams      numeric(7,3),
  weight_label      text,
  price             numeric(8,2),
  thc_pct           numeric(5,2),
  cbd_pct           numeric(5,2),
  product_url       text,
  image_url         text,
  is_available      boolean      not null default true,
  first_seen_at     timestamptz  not null default now(),
  last_seen_at      timestamptz  not null default now()
);

create index if not exists products_brand_idx   on flower.products (lower(brand));
create index if not exists products_lineage_idx on flower.products (lower(lineage));
create index if not exists products_avail_idx   on flower.products (is_available);
create index if not exists products_source_idx  on flower.products (source);
create index if not exists products_weight_idx  on flower.products (weight_grams);
create index if not exists products_base_idx    on flower.products (product_base_id);

-- ── Search groups ────────────────────────────────────────────
-- Each row is one pre-filtered store URL the scraper visits directly
-- (e.g. "Cake House - Fig Farms - 3.5g"), instead of scraping the whole
-- catalog and filtering after the fact. Title always follows the
-- "Store - Brand - Weight" format so it can be split for filtering.

create table if not exists flower.search_groups (
  id            bigserial    primary key,
  title         text         not null unique,   -- "Cake House - Fig Farms - 3.5g"
  url           text         not null,
  store         text         not null,
  brand         text         not null,
  weight_label  text         not null,
  created_at    timestamptz  not null default now()
);

alter table flower.products
  add column if not exists search_group_id bigint references flower.search_groups (id);

create index if not exists products_search_group_idx on flower.products (search_group_id);

-- ── Availability log ──────────────────────────────────────────

create table if not exists flower.availability_log (
  id                bigserial    primary key,
  jane_product_id   text         not null references flower.products (jane_product_id) on delete cascade,
  is_available      boolean      not null,
  price             numeric(8,2),
  scraped_at        timestamptz  not null default now()
);

create index if not exists avail_log_product_idx on flower.availability_log (jane_product_id, scraped_at desc);
create index if not exists avail_log_time_idx    on flower.availability_log (scraped_at desc);

-- ── Favorites ─────────────────────────────────────────────────
-- Stores both brand-level and product-level favorites.
-- brand_only = true  → favorite an entire brand
-- brand_only = false → favorite a specific product_base_id

create table if not exists flower.favorites (
  id              bigserial    primary key,
  type            text         not null check (type in ('brand', 'product')),
  brand           text,                    -- set for both types
  product_base_id text,                    -- set only for type='product'
  strain          text,                    -- denormalized for display
  alert_enabled   boolean      not null default true,
  created_at      timestamptz  not null default now(),
  -- prevent duplicate favorites
  unique nulls not distinct (type, brand, product_base_id)
);

create index if not exists favorites_type_idx on flower.favorites (type);

-- ── Strain match confirmations ───────────────────────────────
-- Ties a FreshFlower (brand, strain) pair to a VaporTrails strain id, once
-- confirmed or manually corrected via the dashboard's thumbs-up/down widget.
-- vt_strain_id is null when status='no_match' (user confirmed no VT
-- counterpart exists, so stop suggesting one).
create table if not exists flower.strain_matches (
  id            bigserial    primary key,
  ff_brand      text         not null,
  ff_strain     text         not null,
  vt_strain_id  bigint,
  status        text         not null check (status in ('confirmed', 'no_match')),
  created_at    timestamptz  not null default now(),
  unique (ff_brand, ff_strain)
);
create index if not exists favorites_brand_idx on flower.favorites (brand);

-- ── Views ─────────────────────────────────────────────────────

create or replace view flower.current_inventory as
select
  p.id, p.jane_product_id, p.product_base_id,
  p.source, p.brand, p.strain, p.lineage,
  p.weight_grams, p.weight_label, p.price,
  p.thc_pct, p.cbd_pct, p.product_url, p.image_url,
  p.first_seen_at, p.last_seen_at,
  -- flag if brand is favorited
  exists (
    select 1 from flower.favorites f
    where f.type = 'brand' and lower(f.brand) = lower(p.brand)
  ) as brand_favorited,
  -- flag if this specific product is favorited
  exists (
    select 1 from flower.favorites f
    where f.type = 'product' and f.product_base_id = p.product_base_id
  ) as product_favorited,
  -- new columns must go last: CREATE OR REPLACE VIEW can only append, not reorder
  p.search_group_id,
  sg.title        as search_group_title,
  sg.url          as search_group_url,
  sg.store        as search_group_store,
  sg.brand        as search_group_brand,
  sg.weight_label as search_group_weight
from flower.products p
left join flower.search_groups sg on sg.id = p.search_group_id
where p.is_available = true
order by sg.title, p.brand, p.strain, p.weight_grams;

-- ── Row-Level Security ────────────────────────────────────────

alter table flower.products         enable row level security;
alter table flower.availability_log enable row level security;
alter table flower.favorites        enable row level security;
alter table flower.search_groups    enable row level security;
alter table flower.strain_matches   enable row level security;

-- Public read on products and log
drop policy if exists "public can read products" on flower.products;
create policy "public can read products"
  on flower.products for select using (true);

drop policy if exists "public can read availability_log" on flower.availability_log;
create policy "public can read availability_log"
  on flower.availability_log for select using (true);

drop policy if exists "public can read search_groups" on flower.search_groups;
create policy "public can read search_groups"
  on flower.search_groups for select using (true);

-- Favorites: public can read, insert, update, delete
-- (single-user personal tool — no auth needed)
drop policy if exists "public can read favorites" on flower.favorites;
create policy "public can read favorites"
  on flower.favorites for select using (true);

drop policy if exists "public can insert favorites" on flower.favorites;
create policy "public can insert favorites"
  on flower.favorites for insert with check (true);

drop policy if exists "public can update favorites" on flower.favorites;
create policy "public can update favorites"
  on flower.favorites for update using (true);

drop policy if exists "public can delete favorites" on flower.favorites;
create policy "public can delete favorites"
  on flower.favorites for delete using (true);

drop policy if exists "public can read strain_matches" on flower.strain_matches;
create policy "public can read strain_matches"
  on flower.strain_matches for select using (true);

drop policy if exists "public can insert strain_matches" on flower.strain_matches;
create policy "public can insert strain_matches"
  on flower.strain_matches for insert with check (true);

drop policy if exists "public can update strain_matches" on flower.strain_matches;
create policy "public can update strain_matches"
  on flower.strain_matches for update using (true);

drop policy if exists "public can delete strain_matches" on flower.strain_matches;
create policy "public can delete strain_matches"
  on flower.strain_matches for delete using (true);

-- Grant flower schema access to API roles
grant usage on schema flower to anon, authenticated, service_role;
grant select on all tables in schema flower to anon, authenticated;
grant insert, update, delete on flower.favorites to anon, authenticated;
grant insert, update, delete on flower.strain_matches to anon, authenticated;
-- service_role (used by the scraper's service key) needs full read/write on
-- everything, not just favorites — existing tables happened to already have
-- this from an earlier setup step, but search_groups didn't inherit it.
grant select, insert, update, delete on all tables in schema flower to service_role;
grant usage, select on all sequences in schema flower to service_role;
alter default privileges in schema flower
  grant select on tables to anon, authenticated;
alter default privileges in schema flower
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema flower
  grant usage, select on sequences to service_role;
