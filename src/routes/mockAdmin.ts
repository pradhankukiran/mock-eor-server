import { Router } from 'express';
import { loadSeedFromDisk, seedStore } from '../lib/store';

export const mockAdminRouter = Router();

mockAdminRouter.post('/seed', (_req, res) => {
  loadSeedFromDisk();
  res.json({ status: 'ok', reloaded: true });
});

mockAdminRouter.get('/quotes/history', (_req, res) => {
  const items = Array.from(seedStore.quotes.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((q) => ({
      id: q.id,
      createdAt: q.createdAt,
      country: q.query.country,
      provider: q.chosen_provider,
      tce: q.providers.find((p) => p.provider === q.chosen_provider)?.costs.tce,
      status: q.status,
      requires_manual_review: q.requires_manual_review,
    }));
  res.json({ items });
});

mockAdminRouter.get('/quotes/:id', (req, res) => {
  const q = seedStore.quotes.get(String(req.params.id));
  if (!q) return res.status(404).json({ error: 'Not found' });
  res.json(q);
});

mockAdminRouter.post('/quotes/:id/review', (req, res) => {
  const q = seedStore.quotes.get(String(req.params.id));
  if (!q) return res.status(404).json({ error: 'Not found' });
  const action = String((req.body && req.body.action) || '').toLowerCase();
  if (action === 'approve') q.status = 'approved';
  else if (action === 'reject') q.status = 'rejected';
  else return res.status(400).json({ error: 'action must be approve|reject' });
  seedStore.quotes.set(q.id, q);
  res.json({ id: q.id, status: q.status });
});


