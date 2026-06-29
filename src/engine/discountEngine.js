/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no side effects.
 * All functions take plain objects and return plain objects.
 *
 * Data shapes:
 *
 * DiscountRule {
 *   ruleId:       string       — e.g. "RULE-01"
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string       — e.g. "Natura Casa", "Amazon India", "" for cart
 *   type:         "percentage" | "flat"
 *   value:        number       — percentage as integer (15 = 15%), flat in rupees
 *   stackable:    boolean
 *   minCartValue: number|null  — only for cart-scope rules
 * }
 *
 * CartItem {
 *   itemId:    string       — e.g. "ITEM-01"
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number       — in rupees
 * }
 *
 * DiscountResult {
 *   itemId:        string
 *   product:       string
 *   brand:         string
 *   platform:      string
 *   basePrice:     number
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]
 *   skippedRules:  string[]
 *   reasoning:     string   — customer-readable explanation
 * }
 *
 * CartOfferResult {
 *   applied:       boolean
 *   ruleId:        string|null
 *   discountAmount: number
 *   finalCartTotal: number
 *   reasoning:     string   — e.g. "Cart offer: 10% off — Rs.593 saved"
 * }
 */

/**
 * Returns true if the rule applies to this cart item.
 * Cart-scope rules are not matched here — they apply to the whole cart total.
 */
export function ruleMatchesItem(item, rule) {
  const normalise = (s) => s.trim().toLowerCase()
  if (rule.scope === 'brand') {
    return normalise(item.brand) === normalise(rule.appliesTo)
  }
  if (rule.scope === 'platform') {
    return normalise(item.platform) === normalise(rule.appliesTo)
  }
  // cart-scope rules do not match individual items
  return false
}

/**
 * Calculates the rupee discount a rule gives on a given price.
 * Uses the provided price, not the original base price — important for stacking.
 */
export function calculateDiscountAmount(price, rule) {
  if (rule.type === 'percentage') {
    return Math.round(price * rule.value / 100)
  }
  if (rule.type === 'flat') {
    return rule.value
  }
  return 0
}

/**
 * Builds the customer-facing reasoning string for an applied item-level rule.
 */
function ruleToReasoning(rule) {
  const scopeLabel = rule.scope === 'brand' ? 'Brand' : 'Platform'
  if (rule.type === 'percentage') {
    return `${scopeLabel} offer: ${rule.value}% off`
  }
  if (rule.type === 'flat') {
    return `${scopeLabel} offer: Rs.${rule.value} off`
  }
  return `${scopeLabel} offer applied`
}

/**
 * Applies the active discount rules to a single cart item.
 * Returns a DiscountResult.
 *
 * Logic:
 *   1. Find all rules that match this item (brand/platform scope only).
 *   2. Among non-stackable rules, pick the one giving the largest discount.
 *   3. Apply any stackable rules on top of that price.
 *   4. Build the reasoning string from what was applied.
 */
export function applyDiscounts(item, rules) {
  // Only item-level rules (brand/platform); cart rules handled separately
  const matchingRules = rules.filter((r) => ruleMatchesItem(item, r))

  // No rules match — return base price with explanation
  if (matchingRules.length === 0) {
    return {
      itemId: item.itemId,
      product: item.product,
      brand: item.brand,
      platform: item.platform,
      basePrice: item.basePrice,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      reasoning: 'No offers available',
    }
  }

  const nonStackable = matchingRules.filter((r) => !r.stackable)
  const stackable = matchingRules.filter((r) => r.stackable)

  // Pick the non-stackable rule that gives the largest saving
  let winner = null
  let skipped = []

  if (nonStackable.length > 0) {
    const sorted = [...nonStackable].sort(
      (a, b) =>
        calculateDiscountAmount(item.basePrice, b) -
        calculateDiscountAmount(item.basePrice, a)
    )
    winner = sorted[0]
    skipped = sorted.slice(1)
  }

  // Apply winner first, then stack on top
  let price = item.basePrice
  const appliedRules = []
  const reasoningParts = []

  if (winner) {
    price -= calculateDiscountAmount(price, winner)
    appliedRules.push(winner.ruleId)
    reasoningParts.push(ruleToReasoning(winner))
  }

  for (const rule of stackable) {
    price -= calculateDiscountAmount(price, rule)
    appliedRules.push(rule.ruleId)
    reasoningParts.push(ruleToReasoning(rule))
  }

  const finalPrice = Math.round(price)

  return {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules,
    skippedRules: skipped.map((r) => r.ruleId),
    reasoning: reasoningParts.join(' + '),
  }
}

/**
 * Runs applyDiscounts across every item in the cart.
 * Returns an array of DiscountResult objects.
 */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/**
 * Sums the final prices across all item-level results.
 * This is the pre-cart-offer subtotal.
 */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Evaluates cart-level discount rules against the subtotal of all item final prices.
 *
 * Cart rules are applied AFTER all item-level discounts. The condition (minCartValue)
 * is checked against the item subtotal. If met, the percentage is applied to the
 * entire subtotal.
 *
 * Only one cart rule is applied — the one that gives the biggest saving (consistent
 * with the max-discount-wins logic used for item-level rules).
 *
 * Returns a CartOfferResult:
 * {
 *   applied:        boolean       — whether any cart rule triggered
 *   ruleId:         string|null   — which rule fired
 *   discountAmount: number        — rupees saved on the cart total (0 if not applied)
 *   finalCartTotal: number        — subtotal after cart discount
 *   reasoning:      string        — human-readable line shown in results
 * }
 */
export function applyCartDiscount(itemResults, rules) {
  const subtotal = cartTotal(itemResults)

  // Isolate cart-scope rules
  const cartRules = rules.filter((r) => r.scope === 'cart')

  if (cartRules.length === 0) {
    return {
      applied: false,
      ruleId: null,
      discountAmount: 0,
      finalCartTotal: subtotal,
      reasoning: '',
    }
  }

  // Find cart rules whose threshold is met, pick the one giving the best saving
  const eligible = cartRules.filter(
    (r) => r.minCartValue !== null && subtotal >= r.minCartValue
  )

  if (eligible.length === 0) {
    return {
      applied: false,
      ruleId: null,
      discountAmount: 0,
      finalCartTotal: subtotal,
      reasoning: '',
    }
  }

  // Pick the rule that saves the most
  const best = eligible.reduce((winner, rule) => {
    const saving = calculateDiscountAmount(subtotal, rule)
    const bestSaving = calculateDiscountAmount(subtotal, winner)
    return saving > bestSaving ? rule : winner
  })

  const discountAmount = calculateDiscountAmount(subtotal, best)
  const finalCartTotal = subtotal - discountAmount

  const reasoning =
    best.type === 'percentage'
      ? `Cart offer: ${best.value}% off — Rs.${discountAmount.toLocaleString('en-IN')} saved`
      : `Cart offer: Rs.${best.value} off — Rs.${discountAmount.toLocaleString('en-IN')} saved`

  return {
    applied: true,
    ruleId: best.ruleId,
    discountAmount,
    finalCartTotal,
    reasoning,
  }
}