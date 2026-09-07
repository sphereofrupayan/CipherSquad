const { google } = require('googleapis');
const { createOAuthClient } = require('../config/google');

function decodeBody(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractMessageBody(payload) {
  if (!payload) return '';
  const parts = payload.parts || [];
  const plainPart = parts.find(part => part.mimeType === 'text/plain' && part.body?.data);
  if (plainPart) return decodeBody(plainPart.body.data).trim();

  for (const part of parts) {
    const nested = extractMessageBody(part);
    if (nested) return nested;
  }

  if (payload.body?.data) {
    const decoded = decodeBody(payload.body.data);
    if (payload.mimeType === 'text/html') {
      return decoded
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*\n/g, '\n\n')
        .trim();
    }
    return decoded.trim();
  }

  return '';
}

function messageMetadata(message) {
  const headers = message.payload?.headers || [];
  const header = name => headers.find(h => h.name.toLowerCase() === name)?.value || '';
  return {
    id: message.id,
    threadId: message.threadId,
    sender: header('from') || 'Unknown Sender',
    receiver: header('to'),
    subject: header('subject') || 'No Subject',
    date: header('date'),
    snippet: message.snippet || '',
    labels: message.labelIds || [],
    is_read: !(message.labelIds || []).includes('UNREAD'),
    is_starred: (message.labelIds || []).includes('STARRED')
  };
}

async function fetchUserEmails(tokens, { includeBody = false } = {}) {
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const maxResults = Number(process.env.GMAIL_FETCH_LIMIT || 20);

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: process.env.GMAIL_QUERY || 'newer_than:30d'
    });

    const messages = response.data.messages || [];
    
    if (messages.length === 0) {
      return [];
    }

    // Fetch full details for each message
    const detailedEmails = await Promise.all(
      messages.map(async (msg) => {
        try {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: includeBody ? 'full' : 'metadata',
            ...(includeBody ? {} : { metadataHeaders: ['From', 'To', 'Subject', 'Date'] })
          });

          const metadata = messageMetadata(detail.data);
          if (!includeBody) return metadata;
          return { ...metadata, body: extractMessageBody(detail.data.payload) || metadata.snippet };
        } catch (err) {
          console.warn(`Failed to fetch Gmail message ${msg.id}:`, err.message);
          return null;
        }
      })
    );

    // Filter out any null responses from failed message fetches
    return detailedEmails.filter(email => email !== null);
  } catch (error) {
    console.error('Error inside gmailService:', error.message || error);
    throw error;
  }
}

async function fetchUserEmail(tokens, messageId) {
  if (!messageId) return null;
  const oauth2Client = createOAuthClient();
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const detail = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const metadata = messageMetadata(detail.data);
  return { ...metadata, body: extractMessageBody(detail.data.payload) || metadata.snippet };
}

module.exports = { fetchUserEmails, fetchUserEmail };
