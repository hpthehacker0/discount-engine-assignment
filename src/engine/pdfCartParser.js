/**
 * pdfCartParser.js
 *
 * Extracts cart items from a PDF file.
 *
 * Strategy:
 *   1. Use pdfjs-dist to extract raw text from the PDF (client-side, no backend)
 *   2. Parse the extracted text to find table rows with: Product, Brand, Platform, Base Price
 *   3. If text extraction yields no usable rows, fall back to Groq LLM to parse the text
 *   4. Returns { data: CartItem[], errors: string[] }
 */

import * as pdfjsLib from 'pdfjs-dist'

// Point the worker at the bundled worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

// ── Step 1: Extract raw text from PDF ───────────────────────────

/**
 * Extracts all text content from a PDF ArrayBuffer.
 * Returns a single string with page text joined by newlines.
 */
async function extractTextFromPDF(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pageTexts = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // pdfjs gives each text item a `transform` matrix; transform[5] is the
    // y-coordinate on the page. Items on the same visual line share (roughly)
    // the same y. We group by y first, THEN join within a group by x-order,
    // so multi-column rows reconstruct as a single line — same idea as
    // `pdftotext -layout`. Without this, every item on the page gets joined
    // into one giant line and row-based parsing becomes impossible.
    const lineMap = new Map() // y (rounded) -> [{x, str}]

    for (const item of content.items) {
      const x = item.transform[4]
      const y = Math.round(item.transform[5]) // round to absorb tiny float jitter
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y).push({ x, str: item.str })
    }

    // Sort lines top-to-bottom (descending y = higher on page in PDF space),
    // and within each line sort tokens left-to-right by x.
    const sortedY = [...lineMap.keys()].sort((a, b) => b - a)
    const pageLines = sortedY.map((y) =>
      lineMap.get(y)
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str)
        .join(' ')
        .trim()
    )

    pageTexts.push(pageLines.filter(Boolean).join('\n'))
  }

  return pageTexts.join('\n')
}

// ── Step 2A: Parse text directly ────────────────────────────────

/**
 * Tries to parse cart rows directly from extracted PDF text.
 *
 * This path is intentionally STRICT. It only succeeds when the PDF uses a
 * clean, consistent table layout — e.g. fixed-width columns or a clear
 * delimiter (pipe, tab, 2+ spaces) separating exactly 4 fields per row,
 * with prices in a single recognizable "Rs.<number>" format.
 *
 * If ANY row fails to match that strict shape, the whole function returns
 * an empty array — forcing a fallback to the Groq LLM, which is much
 * better suited to messy, inconsistent, or prose-style documents.
 *
 * Rationale: a half-correct direct parse (e.g. mangled product/brand split)
 * is worse than no parse at all, because it silently ships wrong data to
 * the discount engine. Better to fail loudly to Groq than guess.
 */
function parseTableFromText(rawText) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  // Strict price pattern: must be exactly "Rs." or "Rs" followed by a number,
  // optionally with commas, with NOTHING else around it on that token
  // (e.g. "Rs.1,299" or "Rs 1299" — not "599 rupees" or "2,499/-" or "INR 849")
  const strictPricePattern = /^Rs\.?\s?[\d,]+$/i

  const knownPlatforms = ['amazon india', 'flipkart', 'noon', 'myntra', 'meesho', 'snapdeal']

  const candidateRows = []

  for (const line of lines) {
    const lower = line.toLowerCase()

    // Skip header / metadata lines
    if (lower.includes('product') && lower.includes('brand') && lower.includes('platform')) continue
    if (lower.includes('order #') || lower.includes('date:')) continue
    if (/^-{3,}$/.test(line)) continue // separator line of dashes

    // Split on 2+ spaces (fixed-width table columns) — the ONLY delimiter
    // style this strict path accepts. Single-space-separated prose
    // (the messy PDF case) will not split into 4 clean tokens here.
    const tokens = line.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean)

    if (tokens.length !== 4) {
      // Not a clean 4-column row — bail on the whole document.
      return []
    }

    const [product, brand, platform, price] = tokens

    if (!strictPricePattern.test(price)) {
      return []
    }

    if (!knownPlatforms.includes(platform.toLowerCase())) {
      return []
    }

    if (!product || !brand) {
      return []
    }

    const basePrice = parseFloat(price.replace(/Rs\.?\s?/i, '').replace(/,/g, ''))
    if (isNaN(basePrice) || basePrice <= 0) {
      return []
    }

    candidateRows.push({ product, brand, platform, basePrice: Math.round(basePrice) })
  }

  if (candidateRows.length === 0) return []

  return candidateRows.map((row, i) => ({
    itemId: `ITEM-PDF-${String(i + 1).padStart(2, '0')}`,
    product: row.product,
    brand: row.brand,
    platform: row.platform,
    basePrice: row.basePrice,
  }))
}

// ── Step 2B: Groq fallback ───────────────────────────────────────

/**
 * Sends raw PDF text to Groq and asks it to extract the cart table.
 * Returns { data: CartItem[], errors: string[] }
 */
async function parseTableViaGroq(rawText) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY
  if (!apiKey) {
    return { data: [], errors: ['Groq API key not configured — cannot fall back to LLM parsing.'] }
  }

  const systemPrompt = `You are a cart data extractor. The user will give you raw text extracted from a PDF order/cart document.

Your job is to find all product rows in the text and return ONLY a JSON array — no explanation, no markdown, no backticks.

Each element in the array must be:
{
  "product": string,
  "brand": string,
  "platform": string,
  "basePrice": number
}

Rules:
- basePrice must be a positive number in rupees (strip "Rs.", commas, spaces)
- If a field is missing or unreadable for a row, omit that row entirely
- If no rows are found, return an empty array []
- Return ONLY the JSON array, nothing else`

  let raw = ''
  try {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Extract cart items from this PDF text:\n\n${rawText}` },
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { data: [], errors: [`Groq API error: ${err?.error?.message ?? response.statusText}`] }
    }

    const apiData = await response.json()
    raw = apiData.choices?.[0]?.message?.content?.trim() ?? ''
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return { data: [], errors: ['LLM returned unexpected format — expected a JSON array.'] }
    }

    const data = []
    const errors = []

    parsed.forEach((row, i) => {
      if (!row.product) { errors.push(`LLM row ${i + 1}: missing product`); return }
      if (!row.platform) { errors.push(`LLM row ${i + 1}: missing platform`); return }
      const basePrice = parseFloat(row.basePrice)
      if (isNaN(basePrice) || basePrice <= 0) { errors.push(`LLM row ${i + 1}: invalid basePrice`); return }

      data.push({
        itemId: `ITEM-PDF-${String(i + 1).padStart(2, '0')}`,
        product: String(row.product).trim(),
        brand: String(row.brand ?? '').trim(),
        platform: String(row.platform).trim(),
        basePrice: Math.round(basePrice),
      })
    })

    return { data, errors }
  } catch (err) {
    return {
      data: [],
      errors: [`Failed to parse LLM response${raw ? ` — got: ${raw.slice(0, 120)}` : ''}. Try a different PDF.`],
    }
  }
}

// ── Main export ──────────────────────────────────────────────────

/**
 * Parses a PDF File object into CartItem objects.
 *
 * @param {File} file - the uploaded PDF file
 * @returns {Promise<{ data: CartItem[], errors: string[] }>}
 */
export async function parsePDFCart(file) {
  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer()

  // Step 1: Extract text
  let rawText = ''
  try {
    rawText = await extractTextFromPDF(arrayBuffer)
  } catch (err) {
    return { data: [], errors: [`Could not read PDF: ${err.message}`] }
  }

  if (!rawText.trim()) {
    return { data: [], errors: ['PDF appears to be empty or scanned with no text layer.'] }
  }

  // Step 2A: Try direct parsing
  const directRows = parseTableFromText(rawText)
  if (directRows.length > 0) {
    return { data: directRows, errors: [] }
  }

  // Step 2B: Fall back to Groq
  console.info('[pdfCartParser] Direct parse found 0 rows — falling back to Groq LLM')
  return parseTableViaGroq(rawText)
}