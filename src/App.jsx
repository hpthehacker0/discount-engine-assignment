/**
 * App.jsx
 *
 * Top-level component. Manages state for rules, cart items, and results.
 * Wires together CSV upload → parse → engine → display.
 */

import { useState, useRef, useEffect } from 'react'
import CsvUploader from './components/CsvUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import NaturalLanguageInput from './components/NaturalLanguageInput.jsx'
import { parseRulesCSV, parseCartCSV } from './engine/csvParser.js'
import { processCart, applyCartDiscount } from './engine/discountEngine.js'

// ── Column definitions ───────────────────────────────────────────

const RULES_COLUMNS = [
  { key: 'ruleId',    label: 'Rule ID' },
  { key: 'scope',     label: 'Scope',      render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  { key: 'appliesTo', label: 'Applies To', render: (v) => v || '—' },
  { key: 'type',      label: 'Type',       render: (v) => v.charAt(0).toUpperCase() + v.slice(1) },
  {
    key: 'value',
    label: 'Value',
    render: (v, row) => row.type === 'percentage' ? `${v}% off` : `Rs.${v} off`,
  },
  { key: 'stackable',    label: 'Stackable',      render: (v) => (v ? 'Yes' : 'No') },
  { key: 'minCartValue', label: 'Min Cart Value',  render: (v) => v ? `Rs.${v.toLocaleString('en-IN')}` : '—' },
]

const CART_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'brand',     label: 'Brand' },
  { key: 'platform',  label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
]

const RESULTS_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'basePrice', label: 'Base Price',  render: (v) => `Rs.${v.toLocaleString('en-IN')}` },
  { key: 'finalPrice',label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>
        Rs.{v.toLocaleString('en-IN')}
      </span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) =>
      v > 0 ? (
        <span style={{ color: '#1e5c2c', fontWeight: 600 }}>Rs.{v.toLocaleString('en-IN')}</span>
      ) : (
        <span style={{ color: '#888' }}>—</span>
      ),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    render: (v) => (
      <span style={{ color: v === 'No offers available' ? '#888' : '#131A48', fontStyle: v === 'No offers available' ? 'italic' : 'normal' }}>
        {v}
      </span>
    ),
  },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 960, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem' },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  grid2:   { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  btn:     {
    background: '#FF5800', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  btnDisabled: {
    background: '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  },
  totalRow: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
    gap: '1rem', marginTop: '0.75rem', paddingTop: '0.75rem',
    borderTop: '2px solid #131A48',
  },
  totalLabel: { fontWeight: 700, fontSize: 14, color: '#131A48' },
  totalValue: { fontWeight: 700, fontSize: 16, color: '#131A48' },
  cartOfferRow: {
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
    gap: '1rem', marginTop: '0.5rem', paddingTop: '0.5rem',
    borderTop: '1px dashed #CECECE',
  },
  cartOfferLabel: { fontSize: 13, color: '#1e5c2c', fontWeight: 600 },
  cartOfferValue: { fontSize: 13, color: '#1e5c2c', fontWeight: 700 },
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules]                     = useState([])
  const [rulesErrors, setRulesErr]            = useState([])
  const [rulesFileName, setRulesFileName]     = useState('')

  const [cartItems, setCartItems]             = useState([])
  const [cartErrors, setCartErrors]           = useState([])
  const [cartFileName, setCartFileName]       = useState('')

  const [results, setResults]                 = useState(null)
  const [cartOffer, setCartOffer]             = useState(null)

  // ── Refs to always hold latest state for use inside callbacks ──
  const rulesRef    = useRef(rules)
  const cartRef     = useRef(cartItems)

  useEffect(() => { rulesRef.current = rules },     [rules])
  useEffect(() => { cartRef.current  = cartItems }, [cartItems])

  // ── Core calculate — always reads from refs, never stale ──
  function runEngine(overrideRules, overrideCart) {
    const r = overrideRules ?? rulesRef.current
    const c = overrideCart  ?? cartRef.current
    if (r.length === 0 || c.length === 0) return
    const res   = processCart(c, r)
    const offer = applyCartDiscount(res, r)
    setResults(res)
    setCartOffer(offer)
  }

  // ── Handlers ──

  function handleRulesLoad(csvText, fileName) {
    const { data, errors } = parseRulesCSV(csvText)
    setRules(data)
    setRulesErr(errors)
    setRulesFileName(fileName)
    setResults(null)
    setCartOffer(null)
  }

  function handleCartLoad(csvText, fileName) {
    const { data, errors } = parseCartCSV(csvText)
    setCartItems(data)
    setCartErrors(errors)
    setCartFileName(fileName)
    setResults(null)
    setCartOffer(null)
  }

  function handleCalculate() {
    runEngine()
  }

  function handleRuleConfirmed(newRule) {
    const updatedRules = [...rulesRef.current, newRule]
    setRules(updatedRules)
    if (cartRef.current.length > 0) {
      runEngine(updatedRules, cartRef.current)
    }
  }

  const canCalculate = rules.length > 0 && cartItems.length > 0

  // ── Render ──

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>

        {/* Upload row */}
        <div style={S.grid2}>
          {/* Rules upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Discount Rules</div>
            <CsvUploader
              label="rules.csv"
              description="Upload your discount rules CSV"
              onLoad={handleRulesLoad}
              hasData={rules.length > 0}
              fileName={rulesFileName}
            />
            <ErrorBanner errors={rulesErrors} />
            {rules.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {rules.length} rule{rules.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={RULES_COLUMNS} rows={rules} />
              </div>
            )}
          </div>

          {/* Cart upload */}
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Items</div>
            <CsvUploader
              label="cart.csv"
              description="Upload your cart CSV"
              onLoad={handleCartLoad}
              hasData={cartItems.length > 0}
              fileName={cartFileName}
            />
            <ErrorBanner errors={cartErrors} />
            {cartItems.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                  {cartItems.length} item{cartItems.length > 1 ? 's' : ''} loaded
                </div>
                <DataTable columns={CART_COLUMNS} rows={cartItems} />
              </div>
            )}
          </div>
        </div>

        {/* Natural language rule input */}
        <NaturalLanguageInput onRuleConfirmed={handleRuleConfirmed} />

        {/* Calculate button */}
        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <button
            style={canCalculate ? S.btn : S.btnDisabled}
            onClick={handleCalculate}
            disabled={!canCalculate}
          >
            Calculate Discounts
          </button>
          {!canCalculate && (
            <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
              Upload both files to calculate
            </div>
          )}
        </div>

        {/* Results */}
        {results && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <DataTable columns={RESULTS_COLUMNS} rows={results} />

            {/* Subtotal row — always shown */}
            <div style={S.totalRow}>
              <span style={S.totalLabel}>
                {cartOffer?.applied ? 'Subtotal (before cart offer)' : 'Cart Total'}
              </span>
              <span style={S.totalValue}>
                Rs.{results.reduce((s, r) => s + r.finalPrice, 0).toLocaleString('en-IN')}
              </span>
            </div>

            {/* Cart offer row — only shown when it triggered */}
            {cartOffer?.applied && (
              <>
                <div style={S.cartOfferRow}>
                  <span style={S.cartOfferLabel}>{cartOffer.reasoning}</span>
                  <span style={S.cartOfferValue}>
                    −Rs.{cartOffer.discountAmount.toLocaleString('en-IN')}
                  </span>
                </div>

                {/* Final total */}
                <div style={{ ...S.totalRow, borderTopColor: '#FF5800' }}>
                  <span style={S.totalLabel}>Final Cart Total</span>
                  <span style={{ ...S.totalValue, color: '#1e5c2c', fontSize: 18 }}>
                    Rs.{cartOffer.finalCartTotal.toLocaleString('en-IN')}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}