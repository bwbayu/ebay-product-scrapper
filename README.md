# eBay + AI Web Scraper

## Overview
This service pairs a Puppeteer-powered eBay scraper (`scraper.js`) with a lightweight Express API (`index.js`). It walks the search results for a keyword, visits each listing detail page (three at a time via `p-limit`), sanitizes the HTML, lets `aiExtractor.js` normalize it through SiliconFlow, stores the array in `ebay_scraping_results.json`, and returns the same structured data to the client.

### GET /scrapeEbay
| Query | Required | Description | Default |
| --- | --- | --- | --- |
| `keyword` | yes | Term to search on eBay. Spaces are automatically turned into `+`. | — |
| `maxPages` | no | Number of result pages to traverse. Each page currently processes the first three listings (demo mode). | `1` |

Responses contain an array of `{ id, url, title, primaryPrice, approxPrice, description }`. Failures respond with `{ error: "message" }`.

## Environment (.env)
1. Copy the template: `cp .env.example .env` (or create the file manually).
2. Provide the SiliconFlow credential:
```env
SILICONFLOW_API_KEY=your_api_key_here
```
3. Variables are loaded via `dotenv` at process start; restart `node index.js` after editing `.env`.

## How to Run
1. Install dependencies: `npm install` (Node.js 18+ recommended).
2. Ensure Chromium can launch (Puppeteer runs headful by default; switch `headless` to `true` in `scraper.js` before deploying or running in CI).
3. Start the API server: `node index.js`.
4. Visit `http://localhost:3000` for a health message or call `/scrapeEbay` to kick off a scrape. Each run also updates `ebay_scraping_results.json` at the repo root.

## Example Endpoint Usage
### HTTP request
```
GET /scrapeEbay?keyword=nike+dunk&maxPages=2 HTTP/1.1
Host: localhost:3000
Accept: application/json
```

### curl
```bash
curl "http://localhost:3000/scrapeEbay?keyword=nike%20dunk&maxPages=2"
```

### Sample response
```json
[
  {
    "id": "295123456789",
    "url": "https://www.ebay.com/itm/295123456789",
    "title": "Nike Dunk Low Retro White/Black",
    "primaryPrice": "$129.99",
    "approxPrice": "Approx. $167.02",
    "description": {
      "Condition": "New with box",
      "Color": "White/Black",
      "Shipping": "Ships within 2 business days"
    }
  }
]
```
_Behavior varies per keyword; when LLM extraction fails the scraper falls back to placeholder values but keeps the listing metadata intact._
