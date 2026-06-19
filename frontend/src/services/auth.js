const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export function getAuthToken() {
  return localStorage.getItem('authToken')
}

export function setAuthToken(token) {
  localStorage.setItem('authToken', token)
}

export function removeAuthToken() {
  localStorage.removeItem('authToken')
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

// Handle Managed Authentication callback from Zoho
export async function handleAuthCallback() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token') || params.get('auth_token')

  if (token) {
    setAuthToken(token)
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname)
    return true
  }
  return false
}