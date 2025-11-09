// scraper.js
import puppeteer from "puppeteer";
import fs from "fs";
import { AIExtractor } from "./aiExtractor.js";
import axios from "axios";
import pLimit from 'p-limit';

// batasi concurrent scraping
const scrapingLimit = pLimit(10);

async function scrapeItemDetail(page, id) {
    const detailUrl = `https://www.ebay.com/itm/${id}`;
    console.log(`-> Scraping: ${detailUrl}`);

    await page.goto(detailUrl, { waitUntil: "networkidle2", timeout: 60000 });

    try {
        await page.waitForSelector(".vim.x-evo-atf-right-river,[data-testid='x-evo-atf-right-river']", {
            timeout: 30000,
        });
    } catch {
        console.warn(`Timeout waiting for selector on item ${id}`);
    }

    const detailHTML = await page.evaluate(() => {
        const result = {}; 

        const title = document.querySelector('[data-testid="x-item-title"] h1 span');
        result.title = title ? title.outerHTML : "";

        const primaryPrice = document.querySelector('[data-testid="x-price-primary"] span');
        result.primaryPrice = primaryPrice ? primaryPrice.outerHTML : "";

        const approxPrice = document.querySelector('[data-testid="x-price-approx"] .x-price-approx__price span');
        result.approxPrice = approxPrice ? approxPrice.outerHTML : "";

        const rows = document.querySelectorAll('.tabs__cell .vim.d-vi-evo-region .ux-layout-section-evo__row'); // HARUSNYA SEMUA ROW DIAMBIL
        let aboutRowsHTML = "";
        rows.forEach(row => {
            aboutRowsHTML += row.outerHTML + "\n";
        });
        result.aboutItemHTML = aboutRowsHTML.trim();

        const iframe = document.querySelector('#desc_ifr');
        result.descIframeURL = iframe ? iframe.src : "";

        return result;
    });
    
    let fullDescriptionHTML = '';
    if (detailHTML.descIframeURL) {
        try {
            const { data } = await axios.get(detailHTML.descIframeURL, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            const match = data.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            fullDescriptionHTML = match ? match[1].trim() : data.trim();
            console.log(`Berhasil ambil via axios untuk ${id}`);
        } catch (err) {
            console.warn(`Gagal ambil iframe URL langsung untuk ${id}:`, err.message);
        }
    }

    // Clean up HTML by removing scripts and links
    fullDescriptionHTML = fullDescriptionHTML
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<link[^>]*>/gi, "")
        .trim();

    // Return structured data object instead of concatenated HTML string
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

async function scrapeEbay(keyword = "nike", maxPages = 1) {
    // launch browser and open blank page
    const browser = await puppeteer.launch({ headless: false });

    const allResults = [];
    const scrapingQueue = [];

    try {
        // iterate through all the pages
        for (let i = 1; i <= maxPages; i++) {
            const pageList = await browser.newPage();
            // navigate the page to a url with wait until network idle so the content from web is rendered at all
            const url = `https://www.ebay.com/sch/i.html?_from=R40&_nkw=${keyword}&_pgn=${i}`;
            console.log(`Scraping list page ${i}: ${url}`);
            await pageList.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
            
            // fallback for waiting until the item in listing page
            try {
                await pageList.waitForSelector("ul.srp-results.srp-grid.clearfix li[data-listingid]", { timeout: 60000 });
            } catch {
                console.log(`No items found on page ${i}, stopping.`);
                break;
            }

            // get item ids from listing page by getting the data-listingid
            let itemIds = await pageList.$$eval(
                'ul.srp-results.srp-grid.clearfix > li[data-listingid]',
                (els) => els.map((el) => el.getAttribute("data-listingid"))
            );

            // fallback when there is no item ids found on the listing page
            if (!itemIds || itemIds.length === 0) {
                console.log(`No items found on page ${i}, stopping.`);
                break;
            }

            await pageList.close();
            // logging
            console.log(`Found ${itemIds.length} items on page ${i}`);
            // demo only per page get 3 item
            itemIds = itemIds.slice(0, 1)

            // Create a new page for each item
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

            const pageResults = await Promise.all(scrapingPromises);

            // Filter out failed items (null values) and add to queue
            const validResults = pageResults.filter(item => item !== null);
            scrapingQueue.push(...validResults);
        }
        // close browser
        await browser.close();
        
        for (let i = 0; i < scrapingQueue.length; i++) {
            const rawHTML = scrapingQueue[i];
            console.log(`[${i + 1}/${scrapingQueue.length}] Processing item ${rawHTML.id} with LLM...`);
            
            try {
                const aiResult = await AIExtractor(rawHTML);
                allResults.push(aiResult);
                console.log(`Completed item ${rawHTML.id}\n`);
            } catch (err) {
                console.error(`Failed to process item ${rawHTML.id}:`, err.message);
                // Add fallback result with error info
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

    const outputFile = "ebay_scraping_results.json";
    fs.writeFileSync(outputFile, JSON.stringify(allResults, null, 2), "utf-8");
    const outputFileRaw = "ebay_scraping_results_raw.json";
    fs.writeFileSync(outputFileRaw, JSON.stringify(scrapingQueue, null, 2), "utf-8");
    console.log(`✓ Scraping complete. ${allResults.filter(r => r).length} items saved to ${outputFile}`);
    return allResults;
}

scrapeEbay().catch(console.error);
