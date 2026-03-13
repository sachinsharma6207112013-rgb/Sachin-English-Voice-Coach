import { isDatabaseEnabled, loadMessages } from './_db.js';
import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  applyCors(req, res, { methods: ['GET', 'OPTIONS'] });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!isDatabaseEnabled()) {
      return res.status(200).json({ database: false, messages: [] });
    }

    const sessionId =
      (typeof req.query?.sessionId === 'string' && req.query.sessionId) ||
      new URL(req.url, 'http://localhost').searchParams.get('sessionId');

    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const messages = await loadMessages(sessionId, 120);
    return res.status(200).json({ database: true, sessionId, messages });
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: err.message || 'Failed to load history' });
  }
}
