#!/usr/bin/env node
/**
 * Local test script for Hacksaw violations API
 * Usage: node test-violations.js [organisation] [filter-json]
 *
 * Example:
 *   node test-violations.js "my-org"
 *   node test-violations.js "my-org" '{"COMPONENT":["JAR"],"SEVERITY_SCORE":{"MIN_SCORE":5,"MAX_SCORE":10}}'
 */

if (process.env.ENVIRONMENT !== 'production') {
  require('dotenv').config();
}

const https = require('https');
const ConnectionManager = require('./functions/server/connections');
const path = require('path');

async function testViolationsAPI() {
  const args = process.argv.slice(2);
  const organisation = args[0];
  const filterArg = args[1];

  if (!organisation) {
    console.error('❌ Error: organisation parameter is required');
    console.error('Usage: node test-violations.js <organisation> [filter-json]');
    process.exit(1);
  }

  try {
    console.log('🔧 Initializing ConnectionManager...');
    const configPath = path.join(__dirname, '..', '..', 'connections.config.json');
    const connManager = new ConnectionManager(configPath);
    console.log('✅ ConnectionManager initialized');

    console.log(`\n📋 Configuration:
  Profile: ${connManager.profile}
  Organisation: ${organisation}
  Filter: ${filterArg || 'none (default)'}`);

    const hacksawCreds = connManager.getHacksawCredentials();
    console.log('✅ Hacksaw credentials loaded');

    let filter = {};
    if (filterArg) {
      try {
        filter = JSON.parse(filterArg);
        console.log('✅ Filter parsed successfully');
      } catch (e) {
        console.error('❌ Invalid filter JSON:', e.message);
        process.exit(1);
      }
    }

    console.log(`\n🔍 Fetching violations for organisation: ${organisation}...`);
    const violations = await connManager.fetchHacksawViolations(
      hacksawCreds,
      organisation,
      filter
    );

    console.log('\n✅ Success! Response received:\n');
    console.log(JSON.stringify(violations, null, 2));

    if (violations.CONTENT) {
      console.log(`\n📊 Summary:
  Status: ${violations.STATUS}
  Total Components: ${violations.CONTENT.length}
  `);

      if (violations.CONTENT.length > 0) {
        console.log('First component:');
        console.log(JSON.stringify(violations.CONTENT[0], null, 2));
      }
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('\nTroubleshooting:');
    console.error('1. Ensure Hacksaw credentials are set in .env:');
    console.error('   - ZOHO_HACKSAW_CLIENT_ID_IN');
    console.error('   - ZOHO_HACKSAW_CLIENT_SECRET_IN');
    console.error('2. Check that the organisation name is correct');
    console.error('3. Verify network connectivity to Hacksaw');
    process.exit(1);
  }
}

testViolationsAPI();