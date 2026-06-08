# Shopline Product Explorer

A Chrome side panel extension to browse, sort, filter, and export every product from any Shopline store — instantly, no API keys needed.

[![Version](https://img.shields.io/badge/version-1.0.0-1E6FFF?style=flat-square)](manifest.json)
[![Manifest](https://img.shields.io/badge/manifest-v3-1E6FFF?style=flat-square)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

---

## Screenshots

![Product Explorer – main view](https://raw.githubusercontent.com/leoyigit/shopline-product-explorer-extension/main/screenshot-1.png)

![Product Explorer – expanded card](https://raw.githubusercontent.com/leoyigit/shopline-product-explorer-extension/main/screenshot-2.png)

---

## Features

- **Auto-detection** — Detects any Shopline store via the `window.Shopline` object; works on custom domains (e.g. `your-brand.com`) without any manual setup
- **Full product catalog** — Scrapes all products from `/collections/all`, paginating automatically through every page
- **Sort** by title, price, vendor, or product type
- **Filter** by product type and stock availability
- **Full-text search** across title, type, variant names, and SKUs
- **Expandable cards** with product image, variant table (price, SKU, availability), and direct store link
- **Copy store ID** — one click copies the store's `.myshopline.com` address to clipboard
- **Export to JSON** — full product array, pretty-printed
- **Export to CSV** — one row per variant with all fields (product info, variant, image URL, product URL)
- **Stays stable** — navigating within the same store does not re-fetch or reset the panel
- **Shopify fallback** — also works on Shopify stores via `/products.json`

---

## Installation

> The extension is not on the Chrome Web Store. Install it in developer mode:

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the extension folder

The extension icon will appear in your Chrome toolbar.

---

## Usage

1. Navigate to any Shopline store
2. Click the **Shopline Product Explorer** icon — the side panel opens
3. The extension automatically detects the store and fetches all products
4. Use the search bar, sort dropdown, and filters to explore
5. Click any product card to expand the detail view
6. Use **Export JSON** or **Export CSV** to download the full catalog

---

## How It Works

```text
Browser Tab (any Shopline store)
        │
        ▼
chrome.scripting.executeScript()
  └─ Checks window.Shopline.handle to confirm Shopline store
        │
        ▼
Fetch /collections/all?page_num=1, 2, 3 …
  └─ Parse data-product-* attributes from each product card
        │
        ▼
Side Panel renders products with sort / filter / search
```

No API keys, no OAuth, no credentials required. Product data is extracted directly from the public storefront HTML that Shopline embeds in every collection page.

---

## CSV Export Columns

| Column | Description |
| --- | --- |
| Product ID | Shopline product ID |
| Title | Product title |
| Handle | URL slug |
| Vendor | Brand / vendor name |
| Product Type | Category |
| Tags | Comma-separated tag list |
| Variant ID | Variant ID |
| Variant Title | Variant name |
| Price | Sale price |
| Compare At Price | Original price (if on sale) |
| SKU | Stock keeping unit |
| Available | `true` / `false` |
| Image URL | First product image URL |
| Product URL | Direct link to product page |

---

## File Structure

```text
shopline-product-explorer/
├── manifest.json       # Chrome Extension Manifest v3
├── background.js       # Service worker — tab change events
├── sidepanel.html      # Side panel markup
├── sidepanel.css       # Dark theme styles
├── sidepanel.js        # All logic: detect, fetch, render, export
├── icon.svg            # Source icon
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Permissions

| Permission | Why |
| --- | --- |
| `sidePanel` | Render the extension as a Chrome side panel |
| `tabs` | Detect active tab changes |
| `activeTab` | Read the current tab URL |
| `scripting` | Inject scripts to detect the platform and fetch collection pages |
| `host_permissions: https://*/*` | Access any store domain |

---

## Development

No build step required. All files are plain HTML/CSS/JS.

1. Edit any source file
2. Go to `chrome://extensions`
3. Click the **reload** icon on the extension card
4. Refresh the browser tab you're testing on

---

## License

MIT © [Lèo Yigit Ekiz](mailto:leo@flyrank.com)
