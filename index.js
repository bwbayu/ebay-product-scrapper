// index.js
// server that exposes an endpoint to scrape eBay items
import express from "express";
import { scrapeEbay } from "./scraper.js";

const app = express();
app.use(express.json());

/**
 * GET /scrapeEbay
 * Query params:
 * - keyword: search term for eBay (required)
 * - maxPages: number of result pages to scrape (optional, default: 1)
 * 
 * Example: GET /scrapeEbay?keyword=nike&maxPages=3
 */
app.get("/scrapeEbay", async (req, res) => {
  const keyword = req.query.keyword;
  const maxPages = parseInt(req.query.maxPages) || 1; // default to 1

  // validate keyword
  if (!keyword) return res.status(400).json({ error: "Missing keyword query" });

  try {
    // scraping process
    const results = await scrapeEbay(keyword, maxPages)

    // return scraped data as json
    res.json(results);
  } catch (error) {
    // fallback when there is error in scraping process
    console.error("Scraping error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/", (req, res) => {
  res.json({ message: "welcome to scrape server" })
})

// start server
app.listen(3000, () => console.log("Server running on http://localhost:3000"));
