import { Router } from 'express';
import { faker } from '@faker-js/faker';

export const authRouter = Router();

authRouter.post('/token', (_req, res) => {
  const token = faker.string.alphanumeric(32);
  res.json({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
});


