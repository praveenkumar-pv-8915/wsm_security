const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export function getAuthToken() {
  return localStorage.getItem('authToken')
}

export function setAuthToken(token) {
  localStorage.setItem('authToken', token)
}

export function removeAuthToken() {
  localStorage.removeItem('authToken')
  localStorage.removeItem('user')
}

export function getUser() {
  const user = localStorage.getItem('user')
  return user ? JSON.parse(user) : null
}

export function setUser(user) {
  localStorage.setItem('user', JSON.stringify(user))
}

export function isAuthenticated() {
  return !!getAuthToken()
}

export async function verifyToken(token) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    return response.ok
  } catch (error) {
    return false
  }
}

/**
 * Handle OAuth callback from Zoho
 * Zoho redirects back to app with authorization code
 */
export async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const error = params.get('error')

  if (error) {
    console.error('OAuth error:', error)
    localStorage.removeItem('authInProgress')
    return false
  }

  if (!code) {
    return false
  }

  try {
    // Exchange code for token via backend
    const response = await fetch(`${API_BASE_URL}/api/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    })

    if (!response.ok) {
      throw new Error(`Auth failed: ${response.statusText}`)
    }

    const data = await response.json()

    if (data.success && data.token) {
      // Store encrypted token
      setAuthToken(data.token)

      // Store user info
      if (data.user) {
        setUser(data.user)
      }

      // Clean up URL to hide code
      window.history.replaceState({}, document.title, window.location.pathname)

      console.log('✅ Authentication successful')
      return true
    }
  } catch (error) {
    console.error('❌ OAuth callback error:', error)
  }

  return false
}