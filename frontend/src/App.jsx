import { useState, useEffect } from 'react'
import Welcome from './pages/Welcome'
import { getAuthToken, handleAuthCallback } from './services/auth'
import './App.css'

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Handle OAuth callback (when Zoho redirects back with authorization code)
    handleAuthCallback()

    // Check if user is authenticated
    const token = getAuthToken()
    setIsAuthenticated(!!token)
    setLoading(false)
  }, [])

  if (loading) {
    return <div className="loader">Loading...</div>
  }

  return (
    <div className="app">
      {isAuthenticated ? <Welcome /> : <LoginPrompt />}
    </div>
  )
}

function LoginPrompt() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleLogin = async () => {
    setLoading(true)
    setError(null)

    try {
      // Get OAuth login URL from backend
      const response = await fetch('/api/auth/login-url')
      const data = await response.json()

      if (data.login_url) {
        // Redirect to Zoho login
        window.location.href = data.login_url
      } else {
        setError('OAuth not configured on server. Please set ZOHO_CLIENT_ID.')
      }
    } catch (err) {
      setError(`Login failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>WSM-Security</h1>
        <p>Sign in with your Zoho account</p>

        {error && <div className="error-message">{error}</div>}

        <button
          className="login-btn"
          onClick={handleLogin}
          disabled={loading}
        >
          {loading ? 'Signing In...' : 'Sign In with Zoho'}
        </button>

        <p className="login-note">Secure OAuth 2.0 authentication with Zoho</p>
      </div>
    </div>
  )
}