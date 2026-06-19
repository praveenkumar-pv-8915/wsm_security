import { useState, useEffect } from 'react'
import Welcome from './pages/Welcome'
import { getAuthToken, handleAuthCallback } from './services/auth'
import './App.css'

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // TODO: Implement Managed Authentication callback when needed
    // const hasAuth = handleAuthCallback()

    // Skip auth for now - set dummy token to allow app to function
    if (!getAuthToken()) {
      localStorage.setItem('authToken', 'temp-token')
    }
    setIsAuthenticated(true)
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
    const orgId = import.meta.env.VITE_ZOHO_ORG_ID
    const authUrl = import.meta.env.VITE_SAS_AUTH_URL

    if (!orgId) {
      alert('Organization ID not configured. Please set VITE_ZOHO_ORG_ID')
      return
    }

    const managedAuthUrl = `${authUrl}?orgId=${orgId}`
    window.location.href = managedAuthUrl
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>WSM-Security</h1>
        <p>Sign in with your Zoho account</p>
        <button className="login-btn" onClick={handleLogin}>
          Sign In
        </button>
      </div>
    </div>
  )
}