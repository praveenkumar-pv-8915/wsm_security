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
    const response = await fetch('/api/health', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    return response.ok
  } catch (error) {
    return false
  }
}