import { computeCosts } from './calc';
import { ProviderName, seedStore, CountrySeed, ContractCosts } from './store';

type ProviderAdjust = {
  taxDelta: number;
  fixedFeeDelta: number;
};

export const providerAdjustments: Record<ProviderName, ProviderAdjust> = {
  deel: { taxDelta: 0, fixedFeeDelta: 0 },
  remote: { taxDelta: 0, fixedFeeDelta: 0 },
  oyster: { taxDelta: 0, fixedFeeDelta: 0 },
};

export const getSeedForCountry = (
  country: string,
  provider: ProviderName = 'deel'
): CountrySeed | undefined => seedStore.providers[provider][country.toUpperCase()];

export const getAdjustedSeed = (
  provider: ProviderName,
  country: string
): CountrySeed | undefined => {
  const base = getSeedForCountry(country, provider);
  if (!base) return undefined;
  const adj = providerAdjustments[provider];
  return {
    ...base,
    employer_tax_rate: Math.max(0, base.employer_tax_rate + adj.taxDelta),
    fixed_fees: Math.max(0, base.fixed_fees + adj.fixedFeeDelta),
  };
};

export const computeCostsForProvider = (
  provider: ProviderName,
  country: string,
  salary: number
): ContractCosts | undefined => {
  const adjusted = getAdjustedSeed(provider, country);
  if (!adjusted) return undefined;
  return computeCosts(salary, adjusted);
};


