// Simple handler without Express for Catalyst BasicIO
exports.handler = async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;
    const method = request.method;

    // Parse JSON body
    let body = '';
    if (method === 'POST' || method === 'PUT') {
      body = await new Promise((resolve) => {
        let data = '';
        request.on('data', chunk => { data += chunk; });
        request.on('end', () => { resolve(data); });
      });
    }

    // Health check
    if (pathname === '/api/health' && method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', message: 'WSM-Security App Running' }));
      return;
    }

    // Get profile
    if (pathname === '/api/profile' && method === 'GET') {
      const userId = request.headers['x-user-id'];
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ profile: { user_id: userId, name: 'Creator', email: 'creator@example.com' } }));
      return;
    }

    // Create profile
    if (pathname === '/api/profile' && method === 'POST') {
      const userId = request.headers['x-user-id'];
      const data = JSON.parse(body);
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true, data: { user_id: userId, ...data, created_at: new Date().toISOString() } }));
      return;
    }

    // Get tasks
    if (pathname === '/api/tasks' && method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ tasks: [] }));
      return;
    }

    // Create task
    if (pathname === '/api/tasks' && method === 'POST') {
      const data = JSON.parse(body);
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ success: true, data: { ...data, created_at: new Date().toISOString() } }));
      return;
    }

    // Not found
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ message: 'WSM-Security API - Use /api/* endpoints' }));

  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: error.message }));
  }
};
