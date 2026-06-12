import { useState, useEffect } from 'react'
import Welcome from './pages/Welcome'
import { getAuthToken } from './services/auth'
import './App.css'

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
    const sasAuthUrl = `${import.meta.env.VITE_SAS_AUTH_URL}?redirect_uri=${encodeURIComponent(redirectUri)}`
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