// scraper.js
// main scraper that uses puppetter to collect eBay list item and item detail
import puppeteer from "puppeteer";
import fs from "fs";
import { AIExtractor } from "./aiExtractor.js";
import axios from "axios";
import pLimit from 'p-limit';

// limit concurrent page scraping
const scrapingLimit = pLimit(3);

/**
 * scrape detail information from eBay item detail page
 * @param {object} page - puppeteer page instance 
 * @param {string} id - eBay item id
 * @returns {object} raw HTML that contain title, prices, and descriptions
 */
async function scrapeItemDetail(page, id) {
    const detailUrl = `https://www.ebay.com/itm/${id}`;
    console.log(`-> Scraping: ${detailUrl}`);

    // navigate to item detail page and wait for network to idle
    await page.goto(detailUrl, { waitUntil: "networkidle2", timeout: 60000 });

    try {
      // wait for the main content to load 
      await page.waitForSelector(".vim.x-evo-atf-right-river,[data-testid='x-evo-atf-right-river']", {
          timeout: 30000,
      });
    } catch {
      console.warn(`Timeout waiting for selector on item ${id}`);
    }

    // extract HTML content from the page
    const detailHTML = await page.evaluate(() => {
      const result = {}; 

      // extract title
      const title = document.querySelector('[data-testid="x-item-title"] h1 span');
      result.title = title ? title.outerHTML : "";

      // extract primary price
      const primaryPrice = document.querySelector('[data-testid="x-price-primary"] span');
      result.primaryPrice = primaryPrice ? primaryPrice.outerHTML : "";

      // extract approximate price
      const approxPrice = document.querySelector('[data-testid="x-price-approx"] .x-price-approx__price span');
      result.approxPrice = approxPrice ? approxPrice.outerHTML : "";

      // extract all item description
      const rows = document.querySelectorAll('.ux-layout-section-evo__row');
      let aboutRowsHTML = "";
      rows.forEach(row => {
          aboutRowsHTML += row.outerHTML + "\n";
      });
      result.aboutItemHTML = aboutRowsHTML.trim();

      // also extract item description that uses frame element
      const iframe = document.querySelector('#desc_ifr');
      result.descIframeURL = iframe ? iframe.src : "";

      return result;
    });
    
    // fetch the description from iframe url
    let fullDescriptionHTML = '';
    if (detailHTML.descIframeURL) {
      try {
        // get the content using axios
        const { data } = await axios.get(detailHTML.descIframeURL, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        // extract the body content from fetched HTML
        const match = data.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        fullDescriptionHTML = match ? match[1].trim() : data.trim();
      } catch (err) {
        console.warn(`failed to get iframe URL for ${id}:`, err.message);
      }
    }

    // filter HTML by removing scripts and links
    fullDescriptionHTML = fullDescriptionHTML
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<link[^>]*>/gi, "")
        .trim();

    // return extracted data in structured object
    return {
        id,
        url: `https://www.ebay.com/itm/${id}`,
        title: detailHTML.title,
        primaryPrice: detailHTML.primaryPrice,
        approxPrice: detailHTML.approxPrice,
        aboutItemHTML: detailHTML.aboutItemHTML,
        fullDescriptionHTML
    };
}

/**
 * main scraping function that orchestrates the entire process
 * @param {string} keyword - search term for eBay 
 * @param {number} maxPages - number of search result pages to scrape
 * @returns {Array} array contain processed item data after AI extraction
 */
export async function scrapeEbay(keyword = "nike", maxPages = 1) {
    // launch browser and open blank page (set this to true for production)
    const browser = await puppeteer.launch({ 
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    const allResults = []; // final data after AI extraction
    const scrapingQueue = []; // raw HTML data for AI extraction

    try {
      // PHASE 1: scrape all listing pages and collect item details
      // change to while if later want to scraping all the pages and will stop if there is no item in the page
      for (let i = 1; i <= maxPages; i++) {
        const pageList = await browser.newPage();

        // replace space with + for ebay url format "laptop gaming" -> "laptop+gaming"
        const formattedKeyword = keyword.replace(/\s+/g, '+');
        // navigate to eBay item list page
        const url = `https://www.ebay.com/sch/i.html?_from=R40&_nkw=${formattedKeyword}&_pgn=${i}`;
        console.log(`Scraping list page ${i}: ${url}`);
        await pageList.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
        
        // wait for item listings to appear
        try {
          await pageList.waitForSelector("ul.srp-results.srp-grid.clearfix li[data-listingid]", { timeout: 60000 });
        } catch {
          console.log(`No items found on page ${i}, stopping.`);
          break; // stop the process if no items found
        }

        // extract all item ids from the listing page
        let itemIds = await pageList.$$eval(
          'ul.srp-results.srp-grid.clearfix > li[data-listingid]',
          (els) => els.map((el) => el.getAttribute("data-listingid"))
        );

        // double check if any items were found
        if (!itemIds || itemIds.length === 0) {
          console.log(`No items found on page ${i}, stopping.`);
          break;
        }

        await pageList.close();
        // logging
        console.log(`Found ${itemIds.length} items on page ${i}`);

        // DEMO MODE: limit to 3 item per page
        itemIds = itemIds.slice(0, 3)
        
        // scrape each item detail concurrently by creating promise object
        const scrapingPromises = itemIds.map((id) =>
          scrapingLimit(async () => {
            const page = await browser.newPage();
            try {
              const data = await scrapeItemDetail(page, id);
              return data;
            } catch (err) {
              console.warn(`Failed to scrape item ${id}:`, err.message);
              return null;
            } finally {
              await page.close();
            }
          })
        );

        // wait for all items on this page to be scraped
        const pageResults = await Promise.all(scrapingPromises);

        // filter failed items and add to processing queue
        const validResults = pageResults.filter(item => item !== null);
        scrapingQueue.push(...validResults);
      }

      // close the browser after all scraping is done
      await browser.close();
      
      // PHASE 2: process raw HTML through AI for structured data extraction
      for (let i = 0; i < scrapingQueue.length; i++) {
        const rawHTML = scrapingQueue[i];
        console.log(`[${i + 1}/${scrapingQueue.length}] Processing item ${rawHTML.id} with LLM`);
        
        try {
          const aiResult = await AIExtractor(rawHTML);
          allResults.push(aiResult);
          console.log(`Completed item ${rawHTML.id}\n`);
        } catch (err) {
          // fallback if AI extraction fails by set the result data to default
          console.error(`Failed to process item ${rawHTML.id}:`, err.message);
          allResults.push({
            id: rawHTML.id,
            title: "-",
            primaryPrice: "-",
            approxPrice: "-",
            description: {},
            error: err.message
          });
        }
      }
    } catch (error) {
      await browser.close();
      throw error;
    } 
    
    // save final result to JSON file
    const outputFile = "ebay_scraping_results.json";
    fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2), "utf-8");
    console.log(`Scraping complete. Data saved to ${outputFile}`);

    return allResults;
}
