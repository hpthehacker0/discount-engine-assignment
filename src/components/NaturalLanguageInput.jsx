/**
 * NaturalLanguageInput.jsx
 *
 * Text field where user describes a discount rule in plain English.
 * Calls the Groq API to parse it, shows a confirmation card,
 * then calls onRuleConfirmed(rule) or lets the user discard.
 */

import { useState } from 'react'
import { parseRuleFromText } from '../engine/llmRuleParser.js'

const S = {
  wrapper: {
    background: '#fff',
    border: '1px solid #CECECE',
    borderRadius: 6,
    padding: '1.2rem 1.4rem',
    marginBottom: '1.2rem',
  },
  title: {
    fontFamily: 'Georgia, serif',
    fontWeight: 700,
    fontSize: 14,
    color: '#131A48',
    marginBottom: '0.7rem',
    paddingBottom: 6,
    borderBottom: '2px solid #FF5800',
    display: 'inline-block',
  },
  row: {
    display: 'flex',
    gap: '0.6rem',
    marginTop: '0.75rem',
  },
  input: {
    flex: 1,
    border: '1px solid #CECECE',
    borderRadius: 4,
    padding: '0.55rem 0.8rem',
    fontSize: 13,
    color: '#131A48',
    outline: 'none',
    fontFamily: 'Arial, sans-serif',
  },
  btn: {
    background: '#131A48',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '0.55rem 1.2rem',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  btnDisabled: {
    background: '#CECECE',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '0.55rem 1.2rem',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'not-allowed',
    whiteSpace: 'nowrap',
  },
  hint: {
    fontSize: 11,
    color: '#888',
    marginTop: '0.4rem',
  },
  // Confirmation card
  card: {
    marginTop: '1rem',
    border: '1px solid #b8d4bf',
    borderLeft: '3px solid #1e5c2c',
    borderRadius: 4,
    padding: '0.9rem 1rem',
    background: '#f0faf2',
  },
  cardTitle: {
    fontWeight: 700,
    fontSize: 12,
    color: '#1e5c2c',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.6rem',
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: '0.4rem 1rem',
    marginBottom: '0.8rem',
  },
  fieldLabel: { fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' },
  fieldValue: { fontSize: 13, fontWeight: 600, color: '#131A48', marginTop: 2 },
  cardActions: { display: 'flex', gap: '0.5rem', marginTop: '0.6rem' },
  confirmBtn: {
    background: '#1e5c2c',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    padding: '0.45rem 1rem',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  discardBtn: {
    background: '#fff',
    color: '#888',
    border: '1px solid #CECECE',
    borderRadius: 4,
    padding: '0.45rem 1rem',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
  },
  // Error card
  errorCard: {
    marginTop: '1rem',
    border: '1px solid #e57373',
    borderLeft: '3px solid #c0392b',
    borderRadius: 4,
    padding: '0.7rem 1rem',
    background: '#fce8e8',
    fontSize: 12,
    color: '#5a1010',
  },
  errorTitle: {
    fontWeight: 700,
    fontSize: 12,
    color: '#8a1a1a',
    marginBottom: 4,
  },
}

function FieldRow({ label, value }) {
  return (
    <div>
      <div style={S.fieldLabel}>{label}</div>
      <div style={S.fieldValue}>{value}</div>
    </div>
  )
}

function formatRuleForDisplay(rule) {
  return {
    Scope: rule.scope.charAt(0).toUpperCase() + rule.scope.slice(1),
    'Applies To': rule.appliesTo || '(entire cart)',
    Type: rule.type.charAt(0).toUpperCase() + rule.type.slice(1),
    Value: rule.type === 'percentage' ? `${rule.value}% off` : `Rs.${rule.value} off`,
    Stackable: rule.stackable ? 'Yes' : 'No',
    ...(rule.minCartValue ? { 'Min Cart Value': `Rs.${rule.minCartValue.toLocaleString('en-IN')}` } : {}),
  }
}

export default function NaturalLanguageInput({ onRuleConfirmed }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [pendingRule, setPendingRule] = useState(null)   // parsed rule awaiting confirmation
  const [error, setError] = useState(null)               // ambiguous / API error

  async function handleParse() {
    if (!text.trim()) return
    setLoading(true)
    setPendingRule(null)
    setError(null)

    const result = await parseRuleFromText(text.trim())

    setLoading(false)

    if (result.ok) {
      setPendingRule(result.rule)
    } else {
      setError(result.reason)
    }
  }

  function handleConfirm() {
    if (!pendingRule) return
    onRuleConfirmed(pendingRule)
    setPendingRule(null)
    setText('')
    setError(null)
  }

  function handleDiscard() {
    setPendingRule(null)
    setError(null)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !loading && text.trim()) handleParse()
  }

  const fields = pendingRule ? formatRuleForDisplay(pendingRule) : null

  return (
    <div style={S.wrapper}>
      <div style={S.title}>Add Rule in Plain English</div>

      <div style={S.row}>
        <input
          style={S.input}
          type="text"
          placeholder='e.g. "20% off for Natura Casa brand, stackable"'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          style={loading || !text.trim() ? S.btnDisabled : S.btn}
          onClick={handleParse}
          disabled={loading || !text.trim()}
        >
          {loading ? 'Parsing…' : 'Parse Rule'}
        </button>
      </div>

      <div style={S.hint}>
        Press Enter or click Parse Rule · Try: "Rs.100 flat discount on all Flipkart items" or "10% off if cart value is more than Rs.5,000"
      </div>

      {/* Confirmation card */}
      {pendingRule && fields && (
        <div style={S.card}>
          <div style={S.cardTitle}>✓ Rule Parsed — Confirm to Add</div>
          <div style={S.fieldGrid}>
            {Object.entries(fields).map(([label, value]) => (
              <FieldRow key={label} label={label} value={value} />
            ))}
          </div>
          <div style={S.cardActions}>
            <button style={S.confirmBtn} onClick={handleConfirm}>Add Rule</button>
            <button style={S.discardBtn} onClick={handleDiscard}>Discard</button>
          </div>
        </div>
      )}

      {/* Error / ambiguous card */}
      {error && (
        <div style={S.errorCard}>
          <div style={S.errorTitle}>Could not parse rule</div>
          {error}
        </div>
      )}
    </div>
  )
}