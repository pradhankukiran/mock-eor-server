import fs from 'fs';
import path from 'path';

export type RoleBand = {
  title: string;
  min_salary: number;
  max_salary: number;
  seniority_levels: Array<'junior' | 'mid' | 'senior' | 'lead'>;
  description: string;
};

export type CountrySeed = {
  country: string; // ISO Alpha-2
  employer_tax_rate: number; // e.g., 0.12 means 12%
  benefits_percent: number; // e.g., 0.08 means 8%
  fixed_fees: number; // absolute monthly
  probation_months: number; // months
  currency_code: string; // ISO 4217
  currency_symbol: string; // e.g., $
  cost_notes: string;
  roles: RoleBand[];
};

export type ProviderName = 'deel' | 'remote' | 'oyster';

export type ContractInput = {
  country: string;
  salary: number;
  currency: string;
  role: string;
  start_date: string; // ISO date
  benefits: string[];
};

export type ContractCosts = {
  salary: number;
  employer_tax: number;
  benefits_cost: number;
  fixed_fees: number;
  termination_amortization: number;
  tce: number;
};

export type StoredContract = {
  id: string;
  provider: ProviderName;
  input: ContractInput;
  status: 'pending' | 'ready';
  costs?: ContractCosts;
};

export type QuoteRecord = {
  id: string;
  createdAt: number;
  query: { country: string; salary: number; currency: string; role: string; service_type?: string };
  providers: Array<{ provider: ProviderName; costs: ContractCosts }>;
  chosen_provider: ProviderName;
  requires_manual_review: boolean;
  status: 'pending' | 'approved' | 'rejected';
  validation?: {
    is_valid: boolean;
    margin_percent: number;
    risk_score: number;
    acid_test_passed: boolean;
    warnings: string[];
    errors: string[];
  };
};

export const seedStore: {
  providers: Record<ProviderName, Record<string, CountrySeed>>;
  contracts: Record<ProviderName, Map<string, StoredContract>>;
  quotes: Map<string, QuoteRecord>;
} = {
  providers: { deel: {}, remote: {}, oyster: {} },
  contracts: {
    deel: new Map<string, StoredContract>(),
    remote: new Map<string, StoredContract>(),
    oyster: new Map<string, StoredContract>(),
  },
  quotes: new Map<string, QuoteRecord>(),
};

type ProviderAdjustSpec = {
  inheritFrom?: 'deel';
  adjustments?: {
    employer_tax_rate_delta?: number; // add
    benefits_percent_delta?: number; // add
    fixed_fees_delta?: number; // add
    salary_multiplier?: number; // multiply
    perCountry?: Record<
      string,
      {
        employer_tax_rate_delta?: number;
        benefits_percent_delta?: number;
        fixed_fees_delta?: number;
        salary_multiplier?: number;
      }
    >;
  };
};

export const loadSeedFromDisk = (): void => {
  try {
    // Try multiple possible paths for provider data
    const possiblePaths = [
      path.join(process.cwd(), 'src', 'data', 'providers'),
      path.join(__dirname, '..', 'data', 'providers'), 
      path.join(process.cwd(), 'dist', 'data', 'providers'),
      path.join(__dirname, 'data', 'providers')
    ];
    
    let providersDir: string | null = null;
    for (const dir of possiblePaths) {
      if (fs.existsSync(dir)) {
        providersDir = dir;
        break;
      }
    }
    
    if (!providersDir) {
      console.error('❌ Could not find providers data directory in any of these locations:');
      possiblePaths.forEach(p => console.error(`   - ${p}`));
      throw new Error('Provider data directory not found');
    }
    
    console.log(`📁 Loading provider data from: ${providersDir}`);
    
    const deelPath = path.join(providersDir, 'deel.json');
    const remotePath = path.join(providersDir, 'remote.json');
    const oysterPath = path.join(providersDir, 'oyster.json');
    
    // Check if all required files exist
    const requiredFiles = [deelPath, remotePath, oysterPath];
    for (const filePath of requiredFiles) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Required provider data file not found: ${filePath}`);
      }
    }

    console.log('📄 Loading Deel data...');
    const deelData = JSON.parse(fs.readFileSync(deelPath, 'utf-8')) as CountrySeed[];
    const deelMap: Record<string, CountrySeed> = {};
    for (const s of deelData) deelMap[s.country.toUpperCase()] = s;
    seedStore.providers.deel = deelMap;
    console.log(`✅ Loaded ${Object.keys(deelMap).length} countries for Deel`);

    const buildDerived = (adjustFile: string, providerName: string): Record<string, CountrySeed> => {
      try {
        console.log(`📄 Loading ${providerName} data from: ${adjustFile}`);
        const spec = JSON.parse(fs.readFileSync(adjustFile, 'utf-8')) as ProviderAdjustSpec | CountrySeed[];
        
        // If full dataset provided
        if (Array.isArray(spec)) {
          const m: Record<string, CountrySeed> = {};
          for (const s of spec) m[s.country.toUpperCase()] = s;
          console.log(`✅ Loaded ${Object.keys(m).length} countries for ${providerName} (full dataset)`);
          return m;
        }
        
        // Build derived data from Deel base + adjustments
        const adjGlobal = spec.adjustments ?? {};
        const result: Record<string, CountrySeed> = {};
        
        for (const [code, base] of Object.entries(deelMap)) {
          const per = adjGlobal.perCountry?.[code] ?? {};
          const employer_tax_rate = Math.max(
            0,
            base.employer_tax_rate + (adjGlobal.employer_tax_rate_delta ?? 0) + (per.employer_tax_rate_delta ?? 0)
          );
          const benefits_percent = Math.max(
            0,
            base.benefits_percent + (adjGlobal.benefits_percent_delta ?? 0) + (per.benefits_percent_delta ?? 0)
          );
          const fixed_fees = Math.max(
            0,
            base.fixed_fees + (adjGlobal.fixed_fees_delta ?? 0) + (per.fixed_fees_delta ?? 0)
          );
          const salary_multiplier = (adjGlobal.salary_multiplier ?? 1) * (per.salary_multiplier ?? 1);
          const roles = base.roles.map((r) => ({
            ...r,
            min_salary: Math.round(r.min_salary * salary_multiplier),
            max_salary: Math.round(r.max_salary * salary_multiplier),
          }));
          result[code] = { ...base, employer_tax_rate, benefits_percent, fixed_fees, roles };
        }
        
        console.log(`✅ Loaded ${Object.keys(result).length} countries for ${providerName} (derived)`);
        return result;
      } catch (error) {
        console.error(`❌ Error loading ${providerName} data:`, error);
        throw new Error(`Failed to load ${providerName} provider data: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    seedStore.providers.remote = buildDerived(remotePath, 'Remote');
    seedStore.providers.oyster = buildDerived(oysterPath, 'Oyster');
    
    console.log('🎉 Successfully loaded all provider data!');
    
  } catch (error) {
    console.error('❌ Fatal error loading seed data:', error);
    console.error('💡 Attempting to use fallback data...');
    
    // Create minimal fallback data for basic functionality
    const fallbackCountryData: CountrySeed = {
      country: 'US',
      employer_tax_rate: 0.112,
      benefits_percent: 0.085,
      fixed_fees: 360,
      probation_months: 3,
      currency_code: 'USD',
      currency_symbol: '$',
      cost_notes: 'Fallback data - limited functionality',
      roles: [
        { title: 'Software Engineer', min_salary: 70000, max_salary: 150000, seniority_levels: ['junior', 'mid', 'senior'], description: 'Develops software applications' },
        { title: 'Product Manager', min_salary: 90000, max_salary: 170000, seniority_levels: ['mid', 'senior'], description: 'Manages product development' }
      ]
    };
    
    // Set fallback data for all providers
    const fallbackData = { 'US': fallbackCountryData };
    seedStore.providers.deel = fallbackData;
    seedStore.providers.remote = fallbackData;
    seedStore.providers.oyster = fallbackData;
    
    console.log('⚠️ Using fallback data - only US country available with limited roles');
  }
};

// Helper function to validate that seed data is loaded
export const isSeedDataLoaded = (): boolean => {
  return Object.keys(seedStore.providers.deel).length > 0 &&
         Object.keys(seedStore.providers.remote).length > 0 &&
         Object.keys(seedStore.providers.oyster).length > 0;
};

// Helper function to get available countries
export const getAvailableCountries = (): string[] => {
  return Object.keys(seedStore.providers.deel);
};

// Debug function to check seed data status
export const getSeedDataStatus = () => {
  return {
    loaded: isSeedDataLoaded(),
    providers: {
      deel: Object.keys(seedStore.providers.deel),
      remote: Object.keys(seedStore.providers.remote), 
      oyster: Object.keys(seedStore.providers.oyster)
    },
    totalCountries: {
      deel: Object.keys(seedStore.providers.deel).length,
      remote: Object.keys(seedStore.providers.remote).length,
      oyster: Object.keys(seedStore.providers.oyster).length
    }
  };
};


