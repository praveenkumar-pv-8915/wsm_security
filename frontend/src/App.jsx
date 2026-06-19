import { useState, useEffect } from 'react'
import Welcome from './pages/Welcome'
import { getAuthToken } from './services/auth'
import './App.css'

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Allow local testing without auth
    const devMode = import.meta.env.DEV
    if (devMode && !getAuthToken()) {
      localStorage.setItem('authToken', 'dev-token')
    }
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
  const handleLogin = () => {
    const redirectUri = `${window.location.origin}/auth/callback`
    const clientId = import.meta.env.VITE_ZOHO_CLIENT_ID
    const authUrl = import.meta.env.VITE_SAS_AUTH_URL

    if (!clientId) {
      alert('OAuth Client ID not configured. Please set VITE_ZOHO_CLIENT_ID')
      return
    }

    const sasAuthUrl = `${authUrl}?client_id=${clientId}&response_type=code&scope=userprofile.read&redirect_uri=${encodeURIComponent(redirectUri)}`
    window.location.href = sasAuthUrl
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Creator App</h1>
        <p>Sign in to get started</p>
        <button className="login-btn" onClick={handleLogin}>
          Sign In with Zoho
        </button>
      </div>
    </div>
  )
}