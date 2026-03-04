import express from 'express';
import { ask } from './pipeline/index.js';

const app = express();
app.use(express.json());

app.post('/api/query', async (req, res, next) => {
  try {
    const { question } = req.body;

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

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
