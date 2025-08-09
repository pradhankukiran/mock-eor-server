import { config } from './config';
import { ContractCosts, CountrySeed } from './store';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const computeCosts = (salary: number, seed: CountrySeed): ContractCosts => {
  const employer_tax = salary * seed.employer_tax_rate;
  const benefits_cost = salary * seed.benefits_percent;
  const termination_amortization =
    salary * config.terminationMultiplier * (seed.probation_months / 12);
  const tce = salary + employer_tax + benefits_cost + seed.fixed_fees + termination_amortization;
  return {
    salary: round2(salary),
    employer_tax: round2(employer_tax),
    benefits_cost: round2(benefits_cost),
    fixed_fees: round2(seed.fixed_fees),
    termination_amortization: round2(termination_amortization),
    tce: round2(tce),
  };
};


