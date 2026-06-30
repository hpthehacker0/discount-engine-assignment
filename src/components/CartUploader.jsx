/**
 * CartUploader.jsx
 *
 * Unified cart upload area.
 * - .csv  → parsed with parseCartCSV (existing logic)
 * - .pdf  → parsed with parsePDFCart (pdfjs + Groq fallback)
 * - anything else → error
 *
 * Props:
 *   onLoad(cartItems, fileName)  — called with parsed CartItem[]
 *   hasData: boolean
 *   fileName: string
 *   onError(errors: string[])    — called on parse failure
 */

import { useRef, useState } from 'react'
import { parseCartCSV } from '../engine/csvParser.js'
import { parsePDFCart } from '../engine/pdfCartParser.js'

const S = {
  area: (hasData, dragOver) => ({
    border: `2px dashed ${dragOver ? '#FF5800' : hasData ? '#1e5c2c' : '#CECECE'}`,
    borderRadius: 6,
    padding: '1rem 1.2rem',
    background: dragOver ? '#fff8f5' : hasData ? '#f0faf2' : '#fafafa',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
  }),
  row: { display: 'flex', alignItems: 'center', gap: '0.6rem' },
  label: { fontWeight: 700, fontSize: 13, color: '#131A48' },
  sub: { fontSize: 11, color: '#888', marginTop: 2 },
  action: (hasData) => ({
    fontSize: 11, fontWeight: 700,
    color: hasData ? '#1e5c2c' : '#FF5800',
    textTransform: 'uppercase', letterSpacing: '0.05em',
    marginLeft: 'auto',
  }),
  loading: {
    marginTop: '0.5rem',
    fontSize: 12,
    color: '#888',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
}

export default function CartUploader({ onLoad, onError, hasData, fileName }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleFile(file) {
    if (!file) return

    const name = file.name.toLowerCase()

    if (name.endsWith('.csv')) {
      // CSV — synchronous text read
      const reader = new FileReader()
      reader.onload = (evt) => {
        const { data, errors } = parseCartCSV(evt.target.result)
        if (errors.length > 0) {
          onError(errors)
        } else {
          onLoad(data, file.name)
        }
      }
      reader.readAsText(file)
      return
    }

    if (name.endsWith('.pdf')) {
      // PDF — async, show loading state
      setLoading(true)
      const { data, errors } = await parsePDFCart(file)
      setLoading(false)
      if (data.length === 0) {
        onError(errors.length > 0 ? errors : ['No cart items could be extracted from this PDF.'])
      } else {
        if (errors.length > 0) onError(errors) // partial errors
        onLoad(data, file.name)
      }
      return
    }

    // Unsupported type
    onError([`Unsupported file type: "${file.name}". Please upload a .csv or .pdf file.`])
  }

  function handleInputChange(e) {
    handleFile(e.target.files[0])
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div
      style={S.area(hasData, dragOver)}
      onClick={() => !loading && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.pdf"
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />
      <div style={S.row}>
        <span style={{ fontSize: 20 }}>
          {loading ? '⏳' : hasData ? '✅' : '📄'}
        </span>
        <div>
          <div style={S.label}>cart.csv or cart.pdf</div>
          <div style={S.sub}>
            {hasData ? fileName : 'Upload a CSV or PDF cart file'}
          </div>
        </div>
        {!loading && (
          <span style={S.action(hasData)}>
            {hasData ? 'Change' : 'Upload'}
          </span>
        )}
      </div>
      {loading && (
        <div style={S.loading}>
          <span>⏳</span> Extracting items from PDF…
        </div>
      )}
    </div>
  )
}