// Dashboard page (after login)
const getDashboardPage = (userId) => {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - WSM Security</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f7fa;
      min-height: 100vh;
    }
    .navbar {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    .navbar h1 {
      font-size: 24px;
    }
    .user-info {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .user-id {
      font-size: 14px;
      opacity: 0.9;
    }
    .btn-logout {
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: 1px solid white;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.2s;
    }
    .btn-logout:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    .container {
      max-width: 1000px;
      margin: 40px auto;
      padding: 0 20px;
    }
    .welcome-card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 30px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .welcome-card h2 {
      color: #333;
      margin-bottom: 10px;
    }
    .welcome-card p {
      color: #666;
      line-height: 1.6;
    }
    .actions {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
    }
    .action-card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      text-align: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: transform 0.2s;
    }
    .action-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
    }
    .action-icon {
      font-size: 48px;
      margin-bottom: 15px;
    }
    .action-card h3 {
      color: #333;
      margin-bottom: 10px;
    }
    .action-card p {
      color: #666;
      font-size: 14px;
      margin-bottom: 15px;
    }
    .btn-action {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
      width: 100%;
    }
    .btn-action:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }
    .api-endpoints {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-top: 30px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    .api-endpoints h3 {
      color: #333;
      margin-bottom: 15px;
    }
    .endpoint {
      background: #f8f9fa;
      padding: 15px;
      margin: 10px 0;
      border-radius: 6px;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      color: #333;
      border-left: 4px solid #667eea;
    }
  </style>
</head>
<body>
  <div class="navbar">
    <h1>🔐 WSM Security Dashboard</h1>
    <div class="user-info">
      <div class="user-id">User ID: ${userId}</div>
      <button class="btn-logout" onclick="logout()">Sign Out</button>
    </div>
  </div>

  <div class="container">
    <div class="welcome-card">
      <h2>Welcome to Credential Management System</h2>
      <p>You are now authenticated and can manage your credentials securely. Use the options below to add, view, or manage your credentials.</p>
    </div>

    <div class="actions">
      <div class="action-card">
        <div class="action-icon">➕</div>
        <h3>Add Credential</h3>
        <p>Store a new encrypted credential safely</p>
        <button class="btn-action" onclick="addCredential()">Add Credential</button>
      </div>

      <div class="action-card">
        <div class="action-icon">📋</div>
        <h3>List Credentials</h3>
        <p>View all your stored credentials</p>
        <button class="btn-action" onclick="listCredentials()">View List</button>
      </div>

      <div class="action-card">
        <div class="action-icon">🔍</div>
        <h3>View Details</h3>
        <p>View or retrieve a specific credential</p>
        <button class="btn-action" onclick="viewCredential()">View Details</button>
      </div>

      <div class="action-card">
        <div class="action-icon">❌</div>
        <h3>Deactivate</h3>
        <p>Safely deactivate a credential</p>
        <button class="btn-action" onclick="deactivateCredential()">Deactivate</button>
      </div>
    </div>

    <div class="api-endpoints">
      <h3>API Endpoints</h3>
      <div class="endpoint">POST /credentials/add - Add new credential</div>
      <div class="endpoint">GET /credentials - List all credentials</div>
      <div class="endpoint">GET /credentials/:name - Get specific credential</div>
      <div class="endpoint">DELETE /credentials/:id - Deactivate credential</div>
    </div>
  </div>

  <script>
    function logout() {
      // Logout via Catalyst
      window.location.href = '/__catalyst/auth/logout';
    }

    function addCredential() {
      alert('Add Credential feature - Use API POST /credentials/add\n\nExample:\n{\n  "credential_name": "github-oauth",\n  "credential_type": "OAUTH",\n  "credential_value": {...}\n}');
    }

    function listCredentials() {
      fetch('/server/welcome/credentials')
        .then(r => r.json())
        .then(data => {
          console.log('Credentials:', data);
          alert('Check console for credentials list');
        })
        .catch(e => alert('Error: ' + e.message));
    }

    function viewCredential() {
      const name = prompt('Enter credential name:');
      if (name) {
        fetch('/server/welcome/credentials/' + name)
          .then(r => r.json())
          .then(data => {
            console.log('Credential:', data);
            alert('Check console for credential details');
          })
          .catch(e => alert('Error: ' + e.message));
      }
    }

    function deactivateCredential() {
      const id = prompt('Enter credential ID:');
      if (id) {
        fetch('/server/welcome/credentials/' + id, { method: 'DELETE' })
          .then(r => r.json())
          .then(data => alert(data.message || data.error))
          .catch(e => alert('Error: ' + e.message));
      }
    }
  </script>
</body>
</html>
  `;
};

module.exports = {
  getDashboardPage
};