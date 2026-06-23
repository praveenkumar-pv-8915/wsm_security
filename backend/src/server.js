// Entry point for the backend server
// Starts Express app from functions/server/index.js

const path = require('path');
require('dotenv').config();

// Import the Express app
const app = require('../functions/server/index.js');

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📚 API Endpoints:`);
  console.log(`   OAuth Services: GET /api/oauth/services`);
  console.log(`   Authorization: GET /api/oauth/authorize?service=hacksaw`);
  console.log(`   Violations: GET /api/hacksaw/violations?organisation=...&productname=...&reportlabel=...`);
});