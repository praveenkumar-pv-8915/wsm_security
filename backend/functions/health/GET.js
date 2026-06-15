module.exports = async (request, response) => {
  response.status(200).json({
    status: 'ok',
    message: 'Team Management App Backend Running'
  });
};