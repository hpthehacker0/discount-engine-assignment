/**
 * llmRuleParser.js
 *
 * Sends a plain-English rule description to Groq (llama-3.3-70b-versatile)
 * and parses the response into a structured DiscountRule object.
 *
 * Returns either:
 *   { ok: true,  rule: DiscountRule }
 *   { ok: false, reason: string }     ← ambiguous or unresolvable input
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MODEL = 'llama-3.3-70b-versatile'

const SYSTEM_PROMPT = `You are a discount rule parser for an e-commerce platform.

The user will describe a discount rule in plain English. Your job is to extract the structured fields and return ONLY a valid JSON object — no explanation, no markdown, no backticks.

The JSON must follow this exact shape:
{
  "scope": "brand" | "platform" | "cart",
  "appliesTo": string,        // brand name or platform name. Empty string "" for cart scope.
  "type": "percentage" | "flat",
  "value": number,            // percentage as integer (e.g. 20 for 20%) or flat amount in rupees
  "stackable": boolean,
  "minCartValue": number | null  // only for cart scope, otherwise null
}

Rules:
- scope "brand" → appliesTo is a brand name (e.g. "Natura Casa")
- scope "platform" → appliesTo is a platform name (e.g. "Flipkart", "Amazon India")
- scope "cart" → appliesTo is "" and minCartValue must be a number
- If stackable is not mentioned, default to false
- If the input is missing a required value (discount amount, threshold for cart rules, etc.) and you cannot reasonably infer it, return this exact JSON instead:
  { "ambiguous": true, "reason": "brief explanation of what is missing" }
- Never guess a value that is not stated or clearly implied. If in doubt, return ambiguous.
- Return ONLY the JSON object. No text before or after it.`

/**
 * Calls the Groq API and parses the response into a DiscountRule.
 * @param {string} userInput - plain English rule description
 * @returns {Promise<{ ok: boolean, rule?: object, reason?: string }>}
 */
export async function parseRuleFromText(userInput) {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY

  if (!apiKey) {
    return { ok: false, reason: 'Groq API key not configured. Add VITE_GROQ_API_KEY to your .env file.' }
  }

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
        max_tokens: 256,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userInput },
        ],
      }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return { ok: false, reason: `Groq API error: ${err?.error?.message ?? response.statusText}` }
    }

    const data = await response.json()
    raw = data.choices?.[0]?.message?.content?.trim() ?? ''

    // Strip accidental markdown fences if the model adds them despite instructions
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()

    const parsed = JSON.parse(raw)

    // Ambiguous case
    if (parsed.ambiguous === true) {
      return { ok: false, reason: parsed.reason ?? 'Input is too ambiguous. Please be more specific.' }
    }

    // Validate required fields
    const validScopes = ['brand', 'platform', 'cart']
    const validTypes = ['percentage', 'flat']

    if (!validScopes.includes(parsed.scope)) {
      return { ok: false, reason: `Invalid scope returned: "${parsed.scope}". Expected brand, platform, or cart.` }
    }
    if (!validTypes.includes(parsed.type)) {
      return { ok: false, reason: `Invalid type returned: "${parsed.type}". Expected percentage or flat.` }
    }
    if (typeof parsed.value !== 'number' || parsed.value <= 0) {
      return { ok: false, reason: 'Invalid discount value returned. Must be a positive number.' }
    }
    if ((parsed.scope === 'brand' || parsed.scope === 'platform') && !parsed.appliesTo) {
      return { ok: false, reason: `Rules with scope "${parsed.scope}" require a brand or platform name.` }
    }
    if (parsed.scope === 'cart' && (typeof parsed.minCartValue !== 'number' || parsed.minCartValue <= 0)) {
      return { ok: false, reason: 'Cart rules require a minimum cart value threshold.' }
    }

    // Build the DiscountRule object
    const rule = {
      ruleId: `RULE-NL-${Date.now()}`,
      scope: parsed.scope,
      appliesTo: parsed.scope === 'cart' ? '' : String(parsed.appliesTo).trim(),
      type: parsed.type,
      value: parsed.value,
      stackable: Boolean(parsed.stackable),
      minCartValue: parsed.scope === 'cart' ? parsed.minCartValue : null,
    }

    return { ok: true, rule }
  } catch (err) {
    return {
      ok: false,
      reason: `Failed to parse response${raw ? ` — model returned: ${raw.slice(0, 120)}` : ''}. Try rephrasing.`,
    }
  }
}