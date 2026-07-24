import { useState } from 'react'
import './App.css'

export default function App() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [input, setInput] = useState('')

  const testApi = async (endpoint, method = 'GET', body = null) => {
    setLoading(true)
    setError(null)
    try {
      const options = {
        method,
        headers: { 'Content-Type': 'application/json' }
      }
      if (body) options.body = JSON.stringify(body)

      // Prepend function path if endpoint doesn't already have it
      const url = endpoint.startsWith('/server/welcome/') ? endpoint : `/server/welcome${endpoint}`
      const response = await fetch(url, options)
      const result = await response.json()
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>🧪 Catalyst Database Test</h1>

      <div style={{ marginBottom: '20px' }}>
        <button onClick={() => testApi('/api/health')} disabled={loading}>
          Test Health
        </button>
        <button onClick={() => testApi('/api/test/products')} disabled={loading} style={{ marginLeft: '10px' }}>
          Fetch Products
        </button>
        <button onClick={() => testApi('/api/test/add', 'POST', { name: 'Test Product', price: 99.99 })} disabled={loading} style={{ marginLeft: '10px' }}>
          Add Product
        </button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Enter product name..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ padding: '8px', width: '200px' }}
        />
        <button onClick={() => testApi('/api/test/add', 'POST', { name: input, price: Math.random() * 100 })} disabled={loading} style={{ marginLeft: '10px' }}>
          Add
        </button>
      </div>

      {loading && <p>⏳ Loading...</p>}
      {error && <p style={{ color: 'red' }}>❌ Error: {error}</p>}
      {data && (
        <pre style={{
          background: '#f0f0f0',
          padding: '10px',
          borderRadius: '5px',
          overflow: 'auto',
          maxHeight: '400px'
        }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  )
}