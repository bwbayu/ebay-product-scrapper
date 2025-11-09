// aiExtractor.js
// use LLM to extract structured data from messy HTML
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config()

const openai = new OpenAI({
        baseURL: 'https://api.deepseek.com',
        apiKey: process.env.DEEPSEEK_API_KEY,
});
const MODEL = "deepseek-chat";

/**
 * sends raw HTML to AI model for structured json extraction
 * @param {object} rawHTML - object containing scraped HTML 
 * @returns  {object} cleaned json with title, prices, description, and item metadata
 */
export async function AIExtractor(rawHTML){
    // organize raw HTML into labeled section
    const htmlContent = `
        <section id="title">
        ${rawHTML.title}
        </section>

        <section id="primaryPrice">
        ${rawHTML.primaryPrice}
        </section>

        <section id="approxPrice">
        ${rawHTML.approxPrice}
        </section>

        <section id="description">
        ${rawHTML.aboutItemHTML}
        </section>

        <section id="description2">
        ${rawHTML.fullDescriptionHTML}
        </section>
    `.trim();

    // create prompt for instruction to AI how to extract and format the HTML data
    const prompt = `
        You are a data extraction model, who transforms messy e-commerce HTML into organized, developer-friendly JSON.
        
        Extract these top-level fields:
        - title
        - primaryPrice
        - approxPrice
        - description

        Description guidelines (be adaptive and context-aware):
        - Combine all meaningful data from every <section> related to "description" (for example: specifications, attributes, payment, shipping, notes, etc.).
        - When structured data (like "Color: White" or "Year Manufactured: 2017") exists, organize it as key-value pairs inside the "description" object.
        - When there is narrative text (like paragraphs under "Payment" or "Shipping"), include them as readable string values under appropriately inferred keys.
        - Preserve hierarchy only when it adds clarity, otherwise flatten intelligently.
        - If any top-level field is missing or empty, return "-" as its value.
        - The final result must be clean, syntactically valid JSON—no comments or explanations.

        Expected output format:
        {
            "title": "",
            "primaryPrice": "",
            "approxPrice": "",
            "description": {}
        }

        HTML content:
        """
        ${htmlContent}
        """
    `

    try {
        // send post request to deepseek
        const response = await openai.chat.completions.create(
            {
                model: MODEL,
                messages: [
                    {
                        role: "system",
                        content:
                        "You are a precise data extraction specialist. Extract data accurately from HTML and return only valid JSON without any markdown formatting or explanations. Never wrap your response in code blocks.",
                    },
                    { role: "user", content: prompt },
                ],
                // temperature: 0.1,
            }
        );

        // extract the AI response
        const output = response.choices?.[0]?.message?.content || "{}";

        // parse JSON and merge with item id and url
        const parsed = JSON.parse(output);
        const data = { id: rawHTML.id, url: rawHTML.url, ...parsed};
        // console.log({data});
        return data;
    } catch (error) {
        // error handling for different failure scenarios
        if (error.response) {
            console.error("API Error:", error.response.status, error.response.data);
        } else if (error.request) {
            console.error("Network Error: No response received");
        } else if (error instanceof SyntaxError) {
            console.error("JSON Parse Error:", error.message);
            console.error("Response was:", error);
        } else {
            console.error("Error:", error.message);
        }
        throw error;
    }
}