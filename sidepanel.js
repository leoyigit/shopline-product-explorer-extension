"use strict";

let allProducts = [];
let currentStoreUrl = null;
let currentPlatform = null; // "shopline" | "shopify"

const $ = (id) => document.getElementById(id);

const els = {
  emptyState: $("emptyState"),
  loadingState: $("loadingState"),
  loadingText: $("loadingText"),
  errorState: $("errorState"),
  errorMsg: $("errorMsg"),
  mainContent: $("mainContent"),
  storeInfo: $("storeInfo"),
  customDomain: $("customDomain"),
  storeUrl: $("storeUrl"),
  storeText: $("storeText"),
  productCount: $("productCount"),
  downloadBar: $("downloadBar"),
  downloadJson: $("downloadJson"),
  downloadCsv: $("downloadCsv"),
  refreshBtn: $("refreshBtn"),
  searchInput: $("searchInput"),
  sortSelect: $("sortSelect"),
  filterType: $("filterType"),
  filterVendor: $("filterVendor"),
  filterAvail: $("filterAvail"),
  resultsBar: $("resultsBar"),
  productList: $("productList"),
};

function showState(state) {
  ["emptyState", "loadingState", "errorState", "mainContent"].forEach((s) =>
    els[s].classList.add("hidden")
  );
  els[state].classList.remove("hidden");
}

function isValidWebUrl(url) {
  try {
    const u = new URL(url);
    return ["http:", "https:"].includes(u.protocol) && u.hostname.length > 0;
  } catch {
    return false;
  }
}

// ─── Platform detection ───────────────────────────────────────────────────────

async function detectShoplineStore(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 1. Global Shopline object — the only fully reliable source for the handle
        const handle =
          window.Shopline?.handle ||
          window.Shopline?.shop?.handle ||
          window.Shopline?.store?.handle ||
          window.ShoplineAnalytics?.shopHandle;
        if (handle) return handle;

        // 2. Canonical / og:url that points directly to a myshopline.com subdomain
        for (const sel of ['link[rel="canonical"]', 'meta[property="og:url"]']) {
          const el = document.querySelector(sel);
          const val = el?.href || el?.content || "";
          const m = val.match(/(?:https?:\/\/)([\w-]+)\.myshopline\.com\//);
          if (m) return m[1];
        }

        // 3. Confirm it's a Shopline store via script sources (detection only — never use subdomain as handle)
        const hasShoplineScripts = [...document.querySelectorAll("script[src]")]
          .some((el) => el.src.includes(".myshopline.com"));
        if (window.Shopline || hasShoplineScripts) return "__shopline__";

        return null;
      },
    });
    return results?.[0]?.result ?? null;
  } catch {
    return null;
  }
}

async function detectShopifyStore(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const html = document.documentElement.innerHTML;
        const m = html.match(/["'`\s(]([\w-]+\.myshopify\.com)[/"'`\s)]/);
        return m ? m[1] : null;
      },
    });
    return results?.[0]?.result ?? null;
  } catch {
    return null;
  }
}

// ─── Shopline scraper ─────────────────────────────────────────────────────────

async function fetchShoplineProducts(tabId, origin) {
  // Try /products.json first (works on many Shopline stores)
  const testData = await fetchPageViaTab(tabId, `${origin}/products.json?limit=1`);
  if (!testData.error && Array.isArray(testData.products)) {
    return fetchShopifyProducts(tabId, origin);
  }

  // Scrape one page of /collections/all, returns { products, totalCount }
  async function scrapePage(pageNum) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: async (url) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          const html = await r.text();
          const doc = new DOMParser().parseFromString(html, "text/html");

          const totalCount = parseInt(
            doc.querySelector("[data-products-count]")?.dataset.productsCount || "0"
          );

          // Strategy 1: <product-card :product="..."> (Vue-based Shopline themes)
          const vueCards = [...doc.querySelectorAll("product-card")].filter(
            (el) => el.hasAttribute(":product")
          );
          if (vueCards.length > 0) {
            const products = vueCards.map((el) => {
              let p;
              try { p = JSON.parse(el.getAttribute(":product")); } catch { return null; }
              return {
                id: p.id,
                title: p.title || "",
                handle: p.handle || "",
                product_type: p.type || "",
                vendor: p.brand || p.vendor || "",
                tags: p.tags || [],
                body_html: p.description || "",
                created_at: p.created_at || "",
                images: (p.images || []).map((img) => ({ src: img.src, alt: img.alt || "" })),
                variants: (p.variants || []).map((v) => ({
                  id: v.id,
                  title: v.title || "Default",
                  price: ((v.price || 0) / 100).toFixed(2),
                  compare_at_price: v.compare_at_price ? (v.compare_at_price / 100).toFixed(2) : null,
                  sku: v.sku || "",
                  available: v.available ?? p.available ?? false,
                  option1: v.option1 || null, option2: v.option2 || null, option3: v.option3 || null,
                })),
              };
            }).filter(Boolean);
            return { products, totalCount };
          }

          // Strategy 2: <product-card product-id="..." title="..." price="..."> (flat-attribute theme)
          const flatCards = [...doc.querySelectorAll("product-card[product-id]")];
          if (flatCards.length > 0) {
            const products = flatCards.map((el) => {
              const priceRaw = parseInt(el.getAttribute("price") || "0");
              const compareRaw = parseInt(el.getAttribute("compare-at-price") || "0");
              const imgSrc = el.getAttribute("image") || "";
              return {
                id: el.getAttribute("product-id") || "",
                title: el.getAttribute("title") || "",
                handle: el.getAttribute("handle") || "",
                product_type: el.getAttribute("product-type") || "",
                vendor: el.getAttribute("vendor") || "",
                tags: [],
                body_html: "",
                created_at: "",
                images: imgSrc ? [{ src: imgSrc }] : [],
                variants: [{
                  id: el.getAttribute("variant-id") || "",
                  title: "Default",
                  price: (priceRaw / 100).toFixed(2),
                  compare_at_price: compareRaw > 0 ? (compareRaw / 100).toFixed(2) : null,
                  sku: el.getAttribute("sku") || "",
                  available: el.getAttribute(":available") !== "false",
                  option1: null, option2: null, option3: null,
                }],
              };
            });
            return { products, totalCount };
          }

          // Strategy 3: [data-product-id] / [data-product-handle] (classic Shopline themes)
          const seen = new Set();
          const cards = [
            ...doc.querySelectorAll("[data-product-id]"),
            ...doc.querySelectorAll("[data-product-handle]"),
          ].filter((el) => {
            const key = el.dataset.productId || el.dataset.productHandle;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          if (cards.length === 0) return { products: [], totalCount };
          const products = cards.map((el) => {
            const imgEl = el.querySelector("img");
            const imgSrc = imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazySrc || imgEl?.dataset?.original || "";
            const priceRaw = parseInt(el.dataset.productFirstAvailableVariantPrice || el.dataset.productPrice || el.dataset.price || "0");
            const compareRaw = parseInt(el.dataset.productFirstAvailableVariantCompareAtPrice || el.dataset.compareAtPrice || "0");
            return {
              id: el.dataset.productId || el.dataset.productHandle || "",
              title: el.dataset.productTitle || el.dataset.title || el.querySelector(".product-title, .card-title, h2, h3")?.textContent?.trim() || "",
              handle: el.dataset.productHandle || "",
              product_type: el.dataset.productType || el.dataset.productCategoryName || el.dataset.category || "",
              vendor: el.dataset.productVendor || el.dataset.vendor || "",
              tags: [], body_html: "",
              images: imgSrc ? [{ src: imgSrc }] : [],
              variants: [{
                id: el.dataset.productFirstAvailableVariantId || el.dataset.variantId || el.dataset.productId || "",
                title: "Default",
                price: (priceRaw / 100).toFixed(2),
                compare_at_price: compareRaw > 0 ? (compareRaw / 100).toFixed(2) : null,
                sku: el.dataset.productFirstAvailableVariantSku || el.dataset.sku || "",
                available: !!(el.dataset.productFirstAvailableVariantId || el.dataset.available !== "false"),
                option1: null, option2: null, option3: null,
              }],
            };
          });
          return { products, totalCount };
        } catch {
          return null;
        }
      },
      args: [`${origin}/collections/all?page_num=${pageNum}`],
    });
    return results?.[0]?.result ?? null;
  }

  // Fetch page 1 to learn page size and total count
  els.loadingText.textContent = "Fetching products…";
  const page1 = await scrapePage(1);
  if (!page1 || page1.products.length === 0) return [];

  const pageSize = page1.products.length;
  const totalCount = page1.totalCount || pageSize;
  const totalPages = Math.ceil(totalCount / pageSize);
  const allProducts = [...page1.products];

  els.loadingText.textContent = `Fetched ${allProducts.length} of ${totalCount}…`;

  if (totalPages <= 1) return allProducts;

  // Fetch remaining pages in parallel batches of 6
  const BATCH = 6;
  for (let start = 2; start <= totalPages; start += BATCH) {
    const batch = [];
    for (let p = start; p < start + BATCH && p <= totalPages; p++) batch.push(p);

    const results = await Promise.all(batch.map((p) => scrapePage(p)));
    for (const r of results) {
      if (r?.products?.length) allProducts.push(...r.products);
    }
    els.loadingText.textContent = `Fetched ${allProducts.length} of ${totalCount}…`;
  }

  return allProducts;
}

// ─── Shopify fetcher ──────────────────────────────────────────────────────────

async function fetchPageViaTab(tabId, url) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (fetchUrl) => {
      try {
        const res = await fetch(fetchUrl);
        if (!res.ok) return { error: res.status };
        return await res.json();
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [url],
  });
  return results?.[0]?.result ?? { error: "no result" };
}

async function fetchShopifyProducts(tabId, origin) {
  const products = [];
  let page = 1;
  const limit = 250;

  while (true) {
    els.loadingText.textContent = `Fetching page ${page}…`;
    const data = await fetchPageViaTab(tabId, `${origin}/products.json?limit=${limit}&page=${page}`);
    if (data.error) {
      if (page === 1) throw new Error(`HTTP error ${data.error}`);
      break;
    }
    if (!data.products || data.products.length === 0) break;
    products.push(...data.products);
    if (data.products.length < limit) break;
    page++;
  }

  return products;
}

// ─── Main load logic ──────────────────────────────────────────────────────────

async function loadProducts(tabUrl, tabId) {
  if (!isValidWebUrl(tabUrl)) { showState("emptyState"); return; }

  try {
    if (currentStoreUrl && allProducts.length > 0 &&
        new URL(tabUrl).origin === currentStoreUrl) return;
  } catch { /* ignore */ }

  showState("loadingState");
  els.loadingText.textContent = "Detecting store…";
  els.storeInfo.classList.add("hidden");
  els.downloadBar.classList.add("hidden");
  els.refreshBtn.classList.add("spinning");

  try {
    const origin = new URL(tabUrl).origin;

    // 1. Try Shopline first
    const shoplineHandle = await detectShoplineStore(tabId);
    if (shoplineHandle) {
      currentPlatform = "shopline";
      currentStoreUrl = origin;
      allProducts = await fetchShoplineProducts(tabId, origin);

      if (allProducts.length === 0) {
        throw new Error("Shopline store found but no public products could be loaded.");
      }

      populateFilters();
      renderProducts();

      els.customDomain.textContent = new URL(origin).hostname;
      els.storeText.textContent = shoplineHandle === "__shopline__"
        ? new URL(origin).hostname
        : `${shoplineHandle}.myshopline.com`;
      els.productCount.textContent = `${allProducts.length} products`;
      els.storeInfo.classList.remove("hidden");
      els.downloadBar.classList.remove("hidden");
      showState("mainContent");
      return;
    }

    // 2. Fall back to Shopify /products.json
    els.loadingText.textContent = "Checking for products…";
    const testData = await fetchPageViaTab(tabId, `${origin}/products.json?limit=1`);
    if (testData.error || !Array.isArray(testData.products)) {
      showState("emptyState");
      return;
    }

    currentPlatform = "shopify";
    currentStoreUrl = origin;
    allProducts = await fetchShopifyProducts(tabId, origin);

    if (allProducts.length === 0) {
      throw new Error("Store found but no public products. It may be password-protected.");
    }

    populateFilters();
    renderProducts();

    els.customDomain.textContent = new URL(origin).hostname;
    detectShopifyStore(tabId).then((h) => {
      els.storeText.textContent = h || new URL(origin).hostname;
    });
    els.productCount.textContent = `${allProducts.length} products`;
    els.storeInfo.classList.remove("hidden");
    els.downloadBar.classList.remove("hidden");
    showState("mainContent");

  } catch (err) {
    els.errorMsg.textContent = err.message || "Failed to fetch products.";
    showState("errorState");
  } finally {
    els.refreshBtn.classList.remove("spinning");
  }
}

// ─── Filters & rendering ──────────────────────────────────────────────────────

function populateFilters() {
  const types = [...new Set(allProducts.map((p) => p.product_type).filter(Boolean))].sort();
  const vendors = [...new Set(allProducts.map((p) => p.vendor).filter(Boolean))].sort();

  const makeOptions = (select, items, placeholder) => {
    select.innerHTML = `<option value="">${placeholder}</option>`;
    items.forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      select.appendChild(o);
    });
  };

  makeOptions(els.filterType, types, "All Types");
  makeOptions(els.filterVendor, vendors, "All Vendors");
}

function getMinPrice(product) {
  const prices = product.variants.map((v) => parseFloat(v.price) || 0);
  return Math.min(...prices);
}

function getMaxPrice(product) {
  const prices = product.variants.map((v) => parseFloat(v.price) || 0);
  return Math.max(...prices);
}

function isAvailable(product) {
  return product.variants.some((v) => v.available);
}

function filteredAndSorted() {
  const search = els.searchInput.value.trim().toLowerCase();
  const sort = els.sortSelect.value;
  const typeFilter = els.filterType.value;
  const vendorFilter = els.filterVendor.value;
  const availFilter = els.filterAvail.value;

  let list = allProducts.filter((p) => {
    if (typeFilter && p.product_type !== typeFilter) return false;
    if (vendorFilter && p.vendor !== vendorFilter) return false;
    if (availFilter === "available" && !isAvailable(p)) return false;
    if (availFilter === "unavailable" && isAvailable(p)) return false;
    if (search) {
      const haystack = [p.title, p.vendor, p.product_type, ...(p.tags || []),
        ...p.variants.map((v) => v.title + " " + v.sku)].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  list.sort((a, b) => {
    switch (sort) {
      case "title-asc":   return a.title.localeCompare(b.title);
      case "title-desc":  return b.title.localeCompare(a.title);
      case "price-asc":   return getMinPrice(a) - getMinPrice(b);
      case "price-desc":  return getMaxPrice(b) - getMaxPrice(a);
      case "date-desc":   return new Date(b.created_at) - new Date(a.created_at);
      case "date-asc":    return new Date(a.created_at) - new Date(b.created_at);
      case "vendor-asc":  return (a.vendor || "").localeCompare(b.vendor || "");
      case "type-asc":    return (a.product_type || "").localeCompare(b.product_type || "");
      default:            return 0;
    }
  });

  return list;
}

function formatPrice(price) {
  const n = parseFloat(price);
  return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function buildCard(product) {
  const available = isAvailable(product);
  const minPrice = getMinPrice(product);
  const maxPrice = getMaxPrice(product);
  const priceStr = minPrice === maxPrice
    ? formatPrice(minPrice)
    : `${formatPrice(minPrice)} – ${formatPrice(maxPrice)}`;

  const comparePrice = product.variants[0]?.compare_at_price;
  const hasDiscount = comparePrice && parseFloat(comparePrice) > minPrice;
  const thumb = product.images?.[0]?.src;

  const card = document.createElement("div");
  card.className = "product-card";
  card.dataset.id = product.id;

  const variantRows = product.variants.map((v) => {
    const dot = `<span class="avail-dot ${v.available ? "yes" : "no"}"></span>`;
    const compare = v.compare_at_price && parseFloat(v.compare_at_price) > parseFloat(v.price)
      ? `<span class="compare">${formatPrice(v.compare_at_price)}</span> ` : "";
    return `<tr>
      <td>${escHtml(v.title)}</td>
      <td class="price-cell">${compare}${formatPrice(v.price)}</td>
      <td>${escHtml(v.sku || "—")}</td>
      <td>${dot}</td>
    </tr>`;
  }).join("");

  const tags = product.tags && product.tags.length
    ? `<div class="info-section">
        <div class="info-label">Tags</div>
        <div class="tags-list">${product.tags.map((t) => `<span class="tag">${escHtml(t)}</span>`).join("")}</div>
       </div>` : "";

  const extraImages = product.images?.length > 1
    ? `<div class="image-gallery">${product.images.map((img) =>
        `<img class="gallery-img" src="${img.src}" alt="${escHtml(img.alt || product.title)}" loading="lazy" />`
      ).join("")}</div>` : "";

  const desc = product.body_html
    ? `<div class="info-section"><div class="info-label">Description</div><div class="description">${product.body_html}</div></div>` : "";

  const productUrl = currentStoreUrl + "/products/" + product.handle;

  card.innerHTML = `
    <div class="card-header">
      ${thumb
        ? `<img class="card-thumb" src="${thumb}" alt="${escHtml(product.title)}" loading="lazy" />`
        : `<div class="card-thumb-placeholder"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>`}
      <div class="card-meta">
        <div class="card-title">${escHtml(product.title)}</div>
        <div class="card-sub">
          ${product.vendor ? `<span>${escHtml(product.vendor)}</span>` : ""}
          ${product.product_type ? `<span>· ${escHtml(product.product_type)}</span>` : ""}
          ${product.created_at ? `<span>· ${formatDate(product.created_at)}</span>` : ""}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px;">
          <span class="card-price">
            ${hasDiscount ? `<span class="compare">${formatPrice(comparePrice)}</span> ` : ""}
            ${priceStr}
          </span>
          <span class="badge ${available ? "badge-available" : "badge-sold-out"}">${available ? "In Stock" : "Sold Out"}</span>
        </div>
      </div>
      <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
    <div class="card-body">
      ${extraImages}
      <div class="info-section">
        <div class="info-label">Variants (${product.variants.length})</div>
        <table class="variants-table">
          <thead><tr><th>Variant</th><th>Price</th><th>SKU</th><th>Avail</th></tr></thead>
          <tbody>${variantRows}</tbody>
        </table>
      </div>
      ${tags}
      ${desc}
      <a class="view-link" href="${productUrl}" target="_blank">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        View on Store
      </a>
    </div>
  `;

  card.querySelector(".card-header").addEventListener("click", () => {
    card.classList.toggle("expanded");
  });

  return card;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderProducts() {
  const list = filteredAndSorted();
  els.resultsBar.textContent = `Showing ${list.length} of ${allProducts.length} products`;
  els.productList.innerHTML = "";
  list.forEach((p) => els.productList.appendChild(buildCard(p)));
}

// ─── Copy store ID button ─────────────────────────────────────────────────────

els.storeUrl.addEventListener("click", () => {
  const text = els.storeText.textContent;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const copyIcon = els.storeUrl.querySelector(".copy-icon");
    const checkIcon = els.storeUrl.querySelector(".check-icon");
    copyIcon.classList.add("hidden");
    checkIcon.classList.remove("hidden");
    setTimeout(() => {
      copyIcon.classList.remove("hidden");
      checkIcon.classList.add("hidden");
    }, 1800);
  });
});

// ─── Downloads ────────────────────────────────────────────────────────────────

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function storeSlug() {
  const host = els.storeText.textContent || els.customDomain.textContent || "products";
  return host.replace(/\.(myshopify|myshopline)\.com$/, "").replace(/\..+$/, "");
}

function downloadJson() {
  triggerDownload(JSON.stringify({ products: allProducts }, null, 2), `${storeSlug()}-products.json`, "application/json");
}

function downloadCsv() {
  const CSV_COLS = [
    "Product ID", "Title", "Handle", "Vendor", "Product Type", "Tags",
    "Published At", "Created At", "Updated At",
    "Variant ID", "Variant Title", "Price", "Compare At Price",
    "SKU", "Available", "Option1 Name", "Option1 Value",
    "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value",
    "Image URL", "Product URL",
  ];

  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [CSV_COLS.join(",")];

  allProducts.forEach((p) => {
    const opt = p.options || [];
    const tags = Array.isArray(p.tags) ? p.tags.join(", ") : (p.tags || "");
    const productUrl = `${currentStoreUrl}/products/${p.handle}`;

    p.variants.forEach((v) => {
      rows.push([
        p.id, p.title, p.handle, p.vendor, p.product_type, tags,
        p.published_at, p.created_at, p.updated_at,
        v.id, v.title, v.price, v.compare_at_price || "",
        v.sku || "", v.available,
        opt[0]?.name || "", v.option1 || "",
        opt[1]?.name || "", v.option2 || "",
        opt[2]?.name || "", v.option3 || "",
        p.images?.[0]?.src || "", productUrl,
      ].map(esc).join(","));
    });
  });

  triggerDownload(rows.join("\n"), `${storeSlug()}-products.csv`, "text/csv");
}

els.downloadJson.addEventListener("click", downloadJson);
els.downloadCsv.addEventListener("click", downloadCsv);

// ─── Controls ─────────────────────────────────────────────────────────────────

els.refreshBtn.addEventListener("click", () => {
  currentStoreUrl = null; // force re-fetch
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.url) loadProducts(tab.url, tab.id);
  });
});

els.searchInput.addEventListener("input", renderProducts);
els.sortSelect.addEventListener("change", renderProducts);
els.filterType.addEventListener("change", renderProducts);
els.filterVendor.addEventListener("change", renderProducts);
els.filterAvail.addEventListener("change", renderProducts);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TAB_CHANGED" && msg.url) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.url) loadProducts(tab.url, tab.id);
    });
  }
});

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (tab?.url) loadProducts(tab.url, tab.id);
});
