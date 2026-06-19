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