import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Mock EOR API',
    version: '1.0.0',
    description: 'Mock endpoints for Deel, Remote, Oyster EOR quotes',
  },
  servers: [{ url: '/' }],
  paths: {
    '/oauth/token': {
      post: {
        summary: 'Get access token',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/rest/v2/eor': {
      post: {
        summary: 'Create EOR quote/contract',
        parameters: [{ in: 'query', name: 'delay', schema: { type: 'boolean' } }],
        responses: { '200': { description: 'Costs' }, '202': { description: 'Queued' } },
      },
    },
    '/rest/v2/eor/contracts/{id}/details': {
      get: {
        summary: 'Get contract details',
        parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/rest/v2/eor/additional-costs/{country}': {
      get: {
        summary: 'Country rules',
        parameters: [{ in: 'path', name: 'country', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/rest/v2/forms/eor/create-contract/{country}': {
      get: {
        summary: 'Contract form schema',
        parameters: [{ in: 'path', name: 'country', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/quotes/compare': {
      get: {
        summary: 'Compare providers for a quote',
        parameters: [
          { in: 'query', name: 'country', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'salary', required: true, schema: { type: 'number' } },
          { in: 'query', name: 'currency', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'role', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/quotes/pdf': {
      post: {
        summary: 'Generate a PDF for a comparison',
        responses: { '200': { description: 'PDF' } },
      },
    },
    '/mock/seed': {
      post: { summary: 'Reload seed data', responses: { '200': { description: 'OK' } } },
    },
  },
};

export const docsRouter = Router();
docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(openapi));


