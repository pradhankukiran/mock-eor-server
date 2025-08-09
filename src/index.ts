import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './lib/config';
import { seedStore, loadSeedFromDisk, getSeedDataStatus, isSeedDataLoaded } from './lib/store';
import { authRouter } from './routes/auth';
import { createProviderRouter } from './routes/provider';
import { mockAdminRouter } from './routes/mockAdmin';
import quotesRouter from './routes/quotes';
import { docsRouter } from './routes/docs';

// Initialize data on startup
console.log('🚀 Starting Mock EOR Server...');
console.log('📦 Loading seed data...');
loadSeedFromDisk();

export const app = express();

// Configure CORS to allow both local development and Azure deployment
const corsOptions = {
  origin: [
    'http://localhost:5173',          // Vite dev server
    'http://localhost:3000',          // Local backend
    'http://20.193.154.54:3000',      // Azure VM backend
    'http://20.193.154.54:5173',      // Azure VM frontend (if served)
    'http://127.0.0.1:5173',          // Alternative local addresses
    'http://127.0.0.1:3000',
    'https://mock-eor-server-ui.vercel.app'  // Vercel frontend
  ],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// Health
app.get('/health', (_req, res) => {
  const seedStatus = getSeedDataStatus();
  res.json({ 
    status: 'ok',
    seedDataLoaded: isSeedDataLoaded(),
    seedDataStatus: seedStatus,
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint for seed data
app.get('/debug/seed-data', (_req, res) => {
  res.json(getSeedDataStatus());
});

// OAuth simulation
app.use('/oauth', authRouter);

// Deel-like base: /rest/v2/*
app.use('/rest/v2', createProviderRouter('deel'));

// Remote and Oyster variants
app.use('/remote', createProviderRouter('remote'));
app.use('/oyster', createProviderRouter('oyster'));

// Admin
app.use('/mock', mockAdminRouter);

// Quotes
app.use('/quotes', quotesRouter);

// OpenAPI docs
app.use('/docs', docsRouter);

// Not found handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Basic error formatting
  if (err instanceof Error) {
    return res.status(400).json({ error: err.message });
  }
  return res.status(500).json({ error: 'Unknown error' });
});

if (require.main === module) {
  const port = config.port;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Mock EOR server listening on http://localhost:${port}`);
  });
}


