// Catalyst provides DataStore globally in the runtime
const datastore = new DataStore();

async function getCreatorProfile(userId) {
  try {
    const response = await datastore.query()
      .from('creators')
      .where('user_id', '==', userId)
      .build()
      .fetch();

    return response.length > 0 ? response[0] : null;
  } catch (error) {
    console.error('Error fetching profile:', error);
    throw error;
  }
}

async function createOrUpdateProfile(userId, profileData) {
  try {
    const existing = await getCreatorProfile(userId);

    if (existing) {
      const response = await datastore.query()
        .from('creators')
        .where('CREATORID', '==', existing.CREATORID)
        .update(profileData)
        .build()
        .fetch();
      return response;
    } else {
      const response = await datastore.query()
        .from('creators')
        .insert({
          user_id: userId,
          ...profileData,
          created_at: new Date().toISOString()
        })
        .build()
        .fetch();
      return response;
    }
  } catch (error) {
    console.error('Error creating/updating profile:', error);
    throw error;
  }
}

async function createTask(userId, taskData) {
  try {
    const response = await datastore.query()
      .from('tasks')
      .insert({
        user_id: userId,
        ...taskData,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .build()
      .fetch();
    return response;
  } catch (error) {
    console.error('Error creating task:', error);
    throw error;
  }
}

async function getTasks(userId) {
  try {
    const response = await datastore.query()
      .from('tasks')
      .where('user_id', '==', userId)
      .build()
      .fetch();
    return response;
  } catch (error) {
    console.error('Error fetching tasks:', error);
    throw error;
  }
}

async function getTaskById(taskId) {
  try {
    const response = await datastore.query()
      .from('tasks')
      .where('task_id', '==', taskId)
      .build()
      .fetch();
    return response.length > 0 ? response[0] : null;
  } catch (error) {
    console.error('Error fetching task:', error);
    throw error;
  }
}

async function updateTask(taskId, updateData) {
  try {
    const response = await datastore.query()
      .from('tasks')
      .where('task_id', '==', taskId)
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .build()
      .fetch();
    return response;
  } catch (error) {
    console.error('Error updating task:', error);
    throw error;
  }
}

async function deleteTask(taskId) {
  try {
    const response = await datastore.query()
      .from('tasks')
      .where('task_id', '==', taskId)
      .delete()
      .build()
      .fetch();
    return response;
  } catch (error) {
    console.error('Error deleting task:', error);
    throw error;
  }
}

module.exports = {
  datastore,
  getCreatorProfile,
  createOrUpdateProfile,
  createTask,
  getTasks,
  getTaskById,
  updateTask,
  deleteTask
};