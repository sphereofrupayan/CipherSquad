const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function analyzeEmailsWithAI(emails) {
  if (!emails || emails.length === 0) {
    return {
      total_emails: 0,
      important_count: 0,
      action_items_count: 0,
      needs_attention: [],
      ai_insight: "No recent emails found in the last 2 days."
    };
  }

  const aiEmails = emails.map(email => ({
    sender: email.sender || '',
    subject: email.subject || '',
    date: email.date || '',
    snippet: String(email.snippet || '').slice(0, 500),
    body: String(email.body || '').slice(0, 12000)
  }));

  const prompt = `
  Analyze the following list of emails retrieved from the user's inbox. Be thorough and treat every distinct email separately.

  Return ONLY a raw JSON object with no markdown formatting or triple backticks:
  {
    "total_emails": <integer count of all processed emails provided>,
    "important_count": <integer count of high priority emails>,
    "action_items_count": <integer count of items requiring action or replies>,
    "needs_attention": [
      {"sender": "<sender name/email>", "reason": "<specific task, action item, or alert>"}
    ],
    "ai_insight": "<a high-level, executive strategic summary (1-2 sentences) giving an overarching view of workload, critical priorities, or risks across all emails, rather than repeating exact sender message text>"
  }

  Emails:
  ${JSON.stringify(aiEmails)}
  `;

  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      contents: prompt,
    });

    let responseText = response.text || '';
    
    // Clean out markdown code fence blocks if returned by the LLM
    responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (error) {
    console.error('Error inside aiService:', error.message || error);
    throw error;
  }
}

module.exports = { analyzeEmailsWithAI };
