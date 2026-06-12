import { useState, useEffect } from 'react'
import { getAuthToken } from '../services/auth'
import '../styles/Welcome.css'

export default function Welcome() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    const token = getAuthToken()
    if (token) {
      // Extract user info from token or fetch from backend
      setUser({ name: 'Creator', email: 'creator@example.com' })
    }
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('authToken')
    window.location.reload()
  }

  return (
    <div className="welcome-container">
      <div className="welcome-header">
        <h1>Welcome to Creator App</h1>
        <p className="subtitle">Start creating amazing content</p>
      </div>

      <div className="welcome-card">
        {user && (
          <div className="user-info">
            <p>Welcome, <strong>{user.name}</strong></p>
            <p className="email">{user.email}</p>
          </div>
        )}

        <div className="welcome-content">
          <div className="feature">
            <div className="feature-icon">✨</div>
            <h2>Create & Manage</h2>
            <p>Build and manage your creative projects effortlessly.</p>
          </div>

          <div className="feature">
            <div className="feature-icon">📊</div>
            <h2>Analytics</h2>
            <p>Track your progress with comprehensive analytics.</p>
          </div>

          <div className="feature">
            <div className="feature-icon">🚀</div>
            <h2>Deploy</h2>
            <p>Launch your creations to the world instantly.</p>
          </div>
        </div>

        <div className="action-buttons">
          <button className="primary-btn">Get Started</button>
          <button className="secondary-btn" onClick={handleLogout}>Sign Out</button>
        </div>
      </div>

      <footer className="welcome-footer">
        <p>&copy; 2026 Creator App. Powered by Zoho Catalyst.</p>
      </footer>
    </div>
  )
}