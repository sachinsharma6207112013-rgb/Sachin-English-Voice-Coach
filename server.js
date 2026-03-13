import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyCors } from './api/_cors.js';
import chatHandler from './api/chat.js';
import authHandler from './api/auth.js';
import historyHandler from './api/history.js';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const app = express();
const PORT = process.env.PORT || 3000;

// Security hardening
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        scriptSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  })
);
app.use(express.json({ limit: '1mb' }));

// Basic rate limiting for all /api routes
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
});
app.use('/api', apiLimiter);
app.use('/api', (req, res, next) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// Wire existing handlers
app.post('/api/chat', chatHandler);
app.post('/api/auth', authHandler);
app.get('/api/history', historyHandler);

// Serve frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, 'public');

app.use(express.static(publicDir));
app.use((req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sachin AI running at http://localhost:${PORT}`);
});
