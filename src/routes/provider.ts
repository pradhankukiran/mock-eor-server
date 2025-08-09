import { Router } from 'express';
import { faker } from '@faker-js/faker';
import { config } from '../lib/config';
import { computeCosts } from '../lib/calc';
import { ContractInput, ProviderName, seedStore, StoredContract, isSeedDataLoaded, getSeedDataStatus } from '../lib/store';
import { getSeedForCountry, getAdjustedSeed } from '../lib/providerLogic';
import { contractInputSchema } from '../validation/schemas';

// adjustments now centralized in providerLogic

export const createProviderRouter = (provider: ProviderName): Router => {
  const router = Router();

  // Additional costs per country
  router.get('/eor/additional-costs/:country', (req, res) => {
    try {
      // Check if seed data is loaded
      if (!isSeedDataLoaded()) {
        console.error(`❌ Seed data not loaded when accessing ${provider} additional-costs for ${req.params.country}`);
        console.error('Seed data status:', getSeedDataStatus());
        return res.status(503).json({ 
          error: 'Service temporarily unavailable', 
          message: 'Provider data is still loading. Please try again in a few seconds.',
          debug: getSeedDataStatus()
        });
      }

      const country = String(req.params.country).toUpperCase();
      console.log(`🔍 Looking up ${provider} additional-costs for country: ${country}`);
      
      const base = getAdjustedSeed(provider, country);
      if (!base) {
        console.warn(`⚠️ Country ${country} not found for provider ${provider}`);
        const availableCountries = Object.keys(seedStore.providers[provider]);
        return res.status(404).json({ 
          error: 'Country not found', 
          availableCountries,
          requestedCountry: country,
          provider
        });
      }
      
      console.log(`✅ Found data for ${country} in ${provider}`);
      return res.json({
        country: base.country,
        employer_tax_rate: base.employer_tax_rate,
        benefits_percent: base.benefits_percent,
        fixed_fees: base.fixed_fees,
        probation_months: base.probation_months,
        currency_code: base.currency_code,
        currency_symbol: base.currency_symbol,
        cost_notes: base.cost_notes,
      });
    } catch (error) {
      console.error(`❌ Error in ${provider} additional-costs endpoint:`, error);
      return res.status(500).json({ 
        error: 'Internal server error', 
        message: 'Failed to retrieve country data',
        provider,
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Form fields for contract creation
  router.get('/forms/eor/create-contract/:country', (req, res) => {
    try {
      // Check if seed data is loaded
      if (!isSeedDataLoaded()) {
        console.error(`❌ Seed data not loaded when accessing ${provider} forms for ${req.params.country}`);
        return res.status(503).json({ 
          error: 'Service temporarily unavailable', 
          message: 'Provider data is still loading. Please try again in a few seconds.',
          debug: getSeedDataStatus()
        });
      }

      const country = String(req.params.country).toUpperCase();
      console.log(`🔍 Looking up ${provider} form schema for country: ${country}`);
      
      const base = getSeedForCountry(country, provider);
      if (!base) {
        console.warn(`⚠️ Country ${country} not found for provider ${provider}`);
        const availableCountries = Object.keys(seedStore.providers[provider]);
        return res.status(404).json({ 
          error: 'Country not found', 
          availableCountries,
          requestedCountry: country,
          provider
        });
      }
      
      const roles = base.roles.map((r) => r.title);
      const currencies = ['USD', 'GBP', 'INR', 'BRL', 'EUR'];
      const benefits = ['healthcare', 'dental', 'vision', 'meal_vouchers', 'internet'];
      
      console.log(`✅ Found form schema for ${country} in ${provider} with ${roles.length} roles`);
      
      res.json({
        country: base.country,
        fields: {
          salary: { type: 'number', note: 'Use role bands for guidance' },
          currency: { type: 'enum', values: currencies },
          role: { type: 'enum', values: roles },
          start_date: { type: 'date' },
          benefits: { type: 'array', values: benefits },
        },
        role_bands: base.roles,
      });
    } catch (error) {
      console.error(`❌ Error in ${provider} forms endpoint:`, error);
      return res.status(500).json({ 
        error: 'Internal server error', 
        message: 'Failed to retrieve form schema',
        provider,
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Create EOR quote/contract
  router.post('/eor', async (req, res) => {
    const parse = contractInputSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parse.error.flatten() });
    }
    const input = parse.data as ContractInput;
    const base = getAdjustedSeed(provider, input.country);
    if (!base) return res.status(404).json({ error: 'Country not found' });
    const adjusted = base;

    const delayMode = String(req.query.delay ?? 'false') === 'true';
    if (delayMode) {
      const id = faker.string.uuid();
      const stored: StoredContract = {
        id,
        provider,
        input,
        status: 'pending',
      };
      seedStore.contracts[provider].set(id, stored);
      setTimeout(() => {
        const costs = computeCosts(input.salary, adjusted);
        const current = seedStore.contracts[provider].get(id);
        if (current) {
          current.status = 'ready';
          current.costs = costs;
          seedStore.contracts[provider].set(id, current);
        }
      }, Math.max(0, config.mockDelayMs));
      return res.status(202).json({ contract_id: id });
    }

    // Randomize salary within band if role matches a band
    const band = base.roles.find((r) => r.title.toLowerCase() === input.role.toLowerCase());
    const randomizedSalary = band
      ? Math.round(
          (band.min_salary + band.max_salary) / 2 +
            (Math.random() - 0.5) * (band.max_salary - band.min_salary) * 0.2
        )
      : input.salary;
    const salary = provider === 'deel' ? input.salary : randomizedSalary;

    // Add small random jitter to fees and percents
    const jitter = (n: number, pct: number) => n * (1 + (Math.random() - 0.5) * 2 * pct);
    const adjustedJittered = {
      ...adjusted,
      employer_tax_rate: Math.max(0, jitter(adjusted.employer_tax_rate, 0.03)),
      benefits_percent: Math.max(0, jitter(adjusted.benefits_percent, 0.03)),
      fixed_fees: Math.max(0, jitter(adjusted.fixed_fees, 0.03)),
    };

    const costs = computeCosts(salary, adjustedJittered);
    if (provider === 'deel') {
      return res.json({ costs });
    }
    if (provider === 'remote') {
      return res.json({
        breakdown: {
          salary: costs.salary,
          employer_tax: costs.employer_tax,
          benefits_cost: costs.benefits_cost,
          fixed_fees: costs.fixed_fees,
          termination_amortization: costs.termination_amortization,
          totalEmploymentCost: costs.tce,
        },
      });
    }
    // oyster
    return res.json({
      data: {
        salary: costs.salary,
        employer_tax: costs.employer_tax,
        benefits: costs.benefits_cost,
        fees_fixed: costs.fixed_fees,
        termination: costs.termination_amortization,
        total_cost_employment: costs.tce,
      },
    });
  });

  // Contract details
  router.get('/eor/contracts/:id/details', (req, res) => {
    const id = String(req.params.id);
    const found = seedStore.contracts[provider].get(id);
    if (!found) return res.status(404).json({ error: 'Contract not found' });
    return res.json({ contract_id: found.id, status: found.status, costs: found.costs });
  });

  return router;
};


