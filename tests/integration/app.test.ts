import request from 'supertest';
import { app } from '../../src/index';

describe('Mock EOR Server', () => {
  it('POST /oauth/token returns token', async () => {
    const res = await request(app).post('/oauth/token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.expires_in).toBe('number');
  });

  it('POST /rest/v2/eor immediate mode returns costs and plausible tce', async () => {
    const payload = {
      country: 'US',
      salary: 100000,
      currency: 'USD',
      role: 'Software Engineer',
      start_date: '2025-01-01',
      benefits: ['healthcare']
    };
    const res = await request(app).post('/rest/v2/eor').send(payload);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('costs');
    const { costs } = res.body;
    expect(costs.salary).toBeCloseTo(100000, 2);
    expect(costs.tce).toBeGreaterThan(100000);
    expect(costs).toHaveProperty('employer_tax');
    expect(costs).toHaveProperty('benefits_cost');
    expect(costs).toHaveProperty('fixed_fees');
    expect(costs).toHaveProperty('termination_amortization');
  });

  it('POST /rest/v2/eor?delay=true returns contract then details are ready after delay', async () => {
    const payload = {
      country: 'US',
      salary: 80000,
      currency: 'USD',
      role: 'Software Engineer',
      start_date: '2025-01-01',
      benefits: ['healthcare']
    };
    const create = await request(app).post('/rest/v2/eor?delay=true').send(payload);
    expect(create.status).toBe(202);
    const id = create.body.contract_id as string;
    expect(id).toBeTruthy();

    // Wait for provider latency + buffer
    await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS || '50') + 50));

    const details = await request(app).get(`/rest/v2/eor/contracts/${id}/details`);
    expect(details.status).toBe(200);
    expect(details.body.status).toBe('ready');
    expect(details.body).toHaveProperty('costs');
    expect(details.body.costs.tce).toBeGreaterThan(80000);
  });
});


