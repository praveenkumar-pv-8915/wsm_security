const catalyst = require('zcatalyst-sdk-node');

const getServices = (context) => {
  const app = catalyst.initialize(context);
  return {
    dataStore: app.getDataStore(),
    secretManager: app.getSecretManager()
  };
};

// Add credential
const addCredential = async (context, credentialData) => {
  try {
    const { dataStore, secretManager } = getServices(context);
    const userId = context.userId;

    // Validate required fields
    if (!credentialData.credential_name || !credentialData.credential_type || !credentialData.credential_value) {
      throw new Error('Missing required: credential_name, credential_type, credential_value');
    }

    // Store encrypted data in Secret Manager
    const secretName = `cred_${credentialData.credential_name}`;
    await secretManager.createSecret(secretName, JSON.stringify(credentialData.credential_value));

    // Store metadata in DataStore
    const credTable = dataStore.getTable('credentials');
    const newCredential = {
      credential_name: credentialData.credential_name,
      credential_type: credentialData.credential_type,
      owner_id: userId,
      is_active: 1
    };

    const response = await credTable.insertRows([newCredential]);

    return {
      success: true,
      message: 'Credential created successfully',
      credential_id: response.get()[0].ROWID,
      credential_name: credentialData.credential_name
    };
  } catch (error) {
    console.error('Error adding credential:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get credential (decrypt from Secret Manager)
const getCredential = async (context, credentialName) => {
  try {
    const { dataStore, secretManager } = getServices(context);
    const userId = context.userId;

    // Verify credential exists in table
    const credTable = dataStore.getTable('credentials');
    const query = `SELECT * FROM credentials WHERE credential_name = '${credentialName}' AND is_active = 1`;
    const response = await credTable.readRows(query);
    const rows = response.get();

    if (rows.length === 0) {
      throw new Error('Credential not found or inactive');
    }

    const credential = rows[0];

    // Check if owner matches (authorization)
    if (credential.owner_id !== userId) {
      throw new Error('Unauthorized: You do not own this credential');
    }

    // Fetch encrypted data from Secret Manager
    const secretName = `cred_${credentialName}`;
    const secretData = await secretManager.readSecret(secretName);
    const decryptedValue = JSON.parse(secretData);

    return {
      success: true,
      credential: {
        credential_id: credential.ROWID,
        credential_name: credential.credential_name,
        credential_type: credential.credential_type,
        credential_value: decryptedValue,
        created_at: credential.CREATEDTIME
      }
    };
  } catch (error) {
    console.error('Error getting credential:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// List all credentials (metadata only - no decryption)
const listCredentials = async (context) => {
  try {
    const { dataStore } = getServices(context);
    const userId = context.userId;

    const credTable = dataStore.getTable('credentials');
    const query = `SELECT ROWID, credential_name, credential_type, is_active, CREATEDTIME FROM credentials WHERE owner_id = ${userId}`;
    const response = await credTable.readRows(query);
    const rows = response.get();

    return {
      success: true,
      credentials: rows,
      total_count: rows.length
    };
  } catch (error) {
    console.error('Error listing credentials:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Deactivate credential
const deactivateCredential = async (context, credentialId) => {
  try {
    const { dataStore, secretManager } = getServices(context);
    const userId = context.userId;

    // Verify ownership
    const credTable = dataStore.getTable('credentials');
    const query = `SELECT * FROM credentials WHERE ROWID = ${credentialId}`;
    const response = await credTable.readRows(query);
    const rows = response.get();

    if (rows.length === 0) {
      throw new Error('Credential not found');
    }

    if (rows[0].owner_id !== userId) {
      throw new Error('Unauthorized: You do not own this credential');
    }

    // Deactivate in table
    await credTable.updateRow({
      ROWID: credentialId,
      is_active: 0
    });

    // Delete from Secret Manager
    const secretName = `cred_${rows[0].credential_name}`;
    await secretManager.deleteSecret(secretName);

    return {
      success: true,
      message: 'Credential deactivated successfully'
    };
  } catch (error) {
    console.error('Error deactivating credential:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  addCredential,
  getCredential,
  listCredentials,
  deactivateCredential
};