const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'api.env') });
require('dotenv').config();

function createOAuthClient(redirectUri = process.env.GOOGLE_REDIRECT_URI) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

module.exports = { createOAuthClient };
