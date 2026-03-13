import { isDatabaseEnabled, saveMessage } from './_db.js';
import { applyCors } from './_cors.js';

export default async function handler(req, res) {
  applyCors(req, res, { methods: ['POST', 'OPTIONS'] });

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { messages, system, sessionId } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    if (!apiKey) return res.status(500).json({ error: 'API key not configured' });
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }

    const normalizedMessages = messages
      .filter((m) => m && typeof m.content === 'string')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content.trim()
      }))
      .filter((m) => m.content.length > 0);

    if (normalizedMessages.length === 0) {
      return res.status(400).json({ error: 'No valid message content found' });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const geminiBody = {
      system_instruction: {
        parts: [{ text: system || 'You are Sachin, a helpful AI assistant and English coach.' }]
      },
      contents: normalizedMessages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      })),
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.85
      }
    };

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    const data = await geminiRes.json();

    if (!geminiRes.ok) {
      console.error('Gemini error:', data);
      return res.status(500).json({ error: data?.error?.message || 'Gemini API error' });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sorry, no response.';

    const cleanSessionId =
      typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;

    if (isDatabaseEnabled() && cleanSessionId) {
      const latestUser = [...normalizedMessages].reverse().find((m) => m.role === 'user');

      if (latestUser?.content) {
        await saveMessage(cleanSessionId, 'user', latestUser.content);
      }

      await saveMessage(cleanSessionId, 'assistant', reply);
    }

    return res.status(200).json({
      reply,
      sessionId: cleanSessionId,
      database: isDatabaseEnabled()
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: err.message });
  }
}
