# Discount Engine — Opptra FDE Intern Assignment

A customer-facing cart pricing engine that applies brand, platform, and cart-level
discount rules, picks the best deal for the customer, and shows a clear breakdown
of what was applied and why.

**Live demo:** https://YOUR-VERCEL-URL.vercel.app

## Run locally

1. `npm install`
2. Create a `.env` file in the project root with `VITE_GROQ_API_KEY=your_groq_key_here`
3. `npm run dev` and open `http://localhost:5173`

## What's implemented

- **Base engine** — CSV upload for rules and cart, item-level discount logic
  (max-discount-wins for non-stackable rules, stacking on top), results display.
- **Task 1 — Cart-level offer** — a `cart`-scope rule type with a minimum cart
  value threshold, evaluated after all item-level discounts, shown as a separate
  line in the results with the subtotal, the cart offer line, and the final total.
- **Task 2 — Natural language rule input** — a text field where a rule can be
  described in plain English. Groq (`llama-3.3-70b-versatile`) parses it into a
  structured rule object, which is shown in a confirmation card before being
  added. Ambiguous input (missing value or threshold) is surfaced as an error
  instead of guessing or crashing. The engine re-runs automatically on confirm.
- **Task 3 — PDF cart upload** — uploading a `.pdf` cart replaces the current
  cart and the engine re-runs with the existing active rules. Extraction uses a
  two-stage strategy:
  1. **Direct parsing** (`pdfjs-dist`) — reconstructs table rows from the PDF's
     text layout and strictly validates that each row has exactly 4 clean
     columns, a recognized price format, and a known platform name. If any row
     fails that check, the whole document is rejected from this path rather
     than producing a partially-correct result.
  2. **Groq fallback** — if direct parsing finds zero valid rows (e.g. the PDF
     uses inconsistent spacing, mixed price formats, or prose-style layout
     instead of a clean table), the extracted raw text is sent to Groq, which
     extracts the same structured cart item list.

  Two sample PDFs are included in `sample-data/`: `cart-clean.pdf` (clean table,
  uses the direct-parse path) and `cart-messy.pdf` (irregular real-world-style
  formatting, exercises the Groq fallback path).

## Design decisions & tradeoffs

- **No backend.** All three tasks — CSV, natural language parsing, and PDF
  extraction — run entirely client-side, per the assignment's ground rules.
  The Groq API is called directly from the browser.

- **API key exposure (documented tradeoff).** Because there's no backend proxy,
  `VITE_GROQ_API_KEY` gets bundled into the client-side JS at build time. Anyone
  inspecting network requests on the deployed site can see the key. This is an
  accepted tradeoff for this assignment's scope (no backend allowed, in-memory
  state only) — in a production system this call would go through a server-side
  proxy endpoint that holds the key, with the client never seeing it directly.

- **Direct-parse PDF strategy is intentionally strict, not lenient.** An earlier
  version of the parser tried to extract a row even from messy/inconsistent
  text and produced a single mangled row (wrong product/brand split) instead of
  failing cleanly. I changed it so the direct parser is all-or-nothing: if
  *any* line in the document doesn't cleanly resolve to 4 well-formed columns
  with a recognized price and platform, the function returns zero rows and the
  document is handed to Groq instead. A confident wrong answer is worse than a
  fallback, especially for pricing data shown to customers.

- **Stackable cart rules.** The assignment's sample data only has one cart rule
  active at a time, but the cart-offer logic picks the cart rule giving the
  largest saving if multiple cart rules are eligible — consistent with the
  same "biggest saving wins" principle used for item-level rules.

- **Confirmation step for LLM-parsed rules.** Per the brief, parsed rules are
  never auto-applied. The user sees the structured fields and explicitly
  confirms or discards, since LLM parsing of free text is not 100% reliable
  and this is pricing logic shown to real customers.

## Known limitations

- The direct PDF parser only recognizes a fixed list of platform names
  (Amazon India, Flipkart, Noon, Myntra, Meesho, Snapdeal). A cart PDF using a
  platform outside this list will always fall through to the Groq path, even
  if the table itself is clean.
- No persistence — all state (rules, cart, results) lives in memory for the
  session, per the assignment's ground rules.