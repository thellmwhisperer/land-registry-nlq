import express from 'express';
import { ask } from './pipeline';

export const app = express();
app.use(express.json());

app.post('/api/query', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    const question = body?.question;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Missing "question" field in request body' });
      return;
    }

    const result = await ask(question);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);

  const status = err.status
    ?? (err.message.startsWith('Query rejected') || err.message.includes('not allowed') ? 400 : 500);

  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
