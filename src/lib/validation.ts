import { config } from './config';

export interface ValidationResult {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  riskScore: number;
  marginPercent: number;
  acidTestPassed: boolean;
  requiresManualReview: boolean;
}

export interface QuoteValidationInput {
  tce: number;
  salary: number;
  country: string;
  serviceType: keyof typeof config.serviceTypes;
  providerCosts: {
    salary: number;
    employer_tax: number;
    benefits_cost: number;
    fixed_fees: number;
    termination_amortization: number;
    tce: number;
  };
}

export function calculateMarginPercent(tce: number, internalCosts: number): number {
  if (tce <= 0) return 0;
  return ((tce - internalCosts) / tce) * 100;
}

export function calculateRiskScore(input: QuoteValidationInput): number {
  const { tce, salary, country, serviceType } = input;
  
  let riskScore = 50; // Base risk score
  
  // TCE risk factor
  if (tce > config.acidTest.maxTceThreshold) {
    riskScore += 20;
  } else if (tce > config.acidTest.maxTceThreshold * 0.7) {
    riskScore += 10;
  }
  
  // Salary-to-TCE ratio risk
  const salaryRatio = salary / tce;
  if (salaryRatio < 0.6) {
    riskScore += 15; // High overhead costs
  } else if (salaryRatio > 0.9) {
    riskScore -= 10; // Efficient cost structure
  }
  
  // Country risk factors (simplified)
  const highRiskCountries = ['BR', 'IN', 'MX'];
  const lowRiskCountries = ['US', 'GB', 'DE', 'NL', 'SE'];
  
  if (highRiskCountries.includes(country)) {
    riskScore += 10;
  } else if (lowRiskCountries.includes(country)) {
    riskScore -= 5;
  }
  
  // Service type risk multiplier
  const serviceConfig = config.serviceTypes[serviceType];
  if (serviceConfig) {
    riskScore *= serviceConfig.riskMultiplier;
  }
  
  return Math.min(100, Math.max(0, Math.round(riskScore)));
}

export function performAcidTest(input: QuoteValidationInput): boolean {
  const { tce, salary, serviceType } = input;
  
  const serviceConfig = config.serviceTypes[serviceType];
  if (!serviceConfig?.acidTestRequired) {
    return true; // Acid test not required for this service type
  }
  
  // Check TCE threshold
  if (tce > config.acidTest.maxTceThreshold) {
    return false;
  }
  
  // Check cash flow ratio (simplified simulation)
  const estimatedMonthlyCosts = tce / 12;
  const cashFlowBuffer = salary * 0.2; // 20% buffer
  const cashFlowRatio = (salary + cashFlowBuffer) / estimatedMonthlyCosts;
  
  if (cashFlowRatio < config.acidTest.cashFlowRatio) {
    return false;
  }
  
  return true;
}

export function validateMarginThresholds(marginPercent: number, serviceType: keyof typeof config.serviceTypes): {
  meetsMinimum: boolean;
  meetsTarget: boolean;
  isRisky: boolean;
} {
  const serviceConfig = config.serviceTypes[serviceType];
  const minimumMargin = serviceConfig?.minimumMargin || config.marginThresholds.minimumMarginPercent;
  
  return {
    meetsMinimum: marginPercent >= minimumMargin,
    meetsTarget: marginPercent >= config.marginThresholds.targetMarginPercent,
    isRisky: marginPercent <= config.marginThresholds.riskThresholdPercent,
  };
}

export function validateQuote(input: QuoteValidationInput): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  
  // Calculate internal costs (simplified - using 80% of TCE as base cost)
  const internalCosts = input.tce * 0.8;
  const marginPercent = calculateMarginPercent(input.tce, internalCosts);
  const riskScore = calculateRiskScore(input);
  const acidTestPassed = performAcidTest(input);
  
  // Validate margins
  const marginValidation = validateMarginThresholds(marginPercent, input.serviceType);
  
  if (!marginValidation.meetsMinimum) {
    errors.push(`Margin ${marginPercent.toFixed(2)}% below minimum threshold of ${config.serviceTypes[input.serviceType]?.minimumMargin || config.marginThresholds.minimumMarginPercent}%`);
  }
  
  if (!marginValidation.meetsTarget) {
    warnings.push(`Margin ${marginPercent.toFixed(2)}% below target of ${config.marginThresholds.targetMarginPercent}%`);
  }
  
  if (marginValidation.isRisky) {
    warnings.push(`Margin ${marginPercent.toFixed(2)}% in risk zone (≤${config.marginThresholds.riskThresholdPercent}%)`);
  }
  
  // Validate acid test
  if (!acidTestPassed) {
    errors.push('Failed acid test - financial viability concerns');
  }
  
  // Risk score validation
  if (riskScore > config.acidTest.riskScoreThreshold) {
    warnings.push(`High risk score: ${riskScore}/100`);
  }
  
  // TCE threshold check
  if (input.tce > config.acidTest.maxTceThreshold) {
    warnings.push(`TCE ${input.tce} exceeds threshold of ${config.acidTest.maxTceThreshold}`);
  }
  
  const requiresManualReview = errors.length > 0 || 
    riskScore > config.acidTest.riskScoreThreshold || 
    !marginValidation.meetsMinimum ||
    input.tce > config.acidTest.maxTceThreshold;
  
  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    riskScore,
    marginPercent,
    acidTestPassed,
    requiresManualReview,
  };
}

export function getServiceTypeFromRole(role: string): keyof typeof config.serviceTypes {
  const roleStr = role.toLowerCase();
  
  if (roleStr.includes('executive') || roleStr.includes('ceo') || roleStr.includes('cto') || roleStr.includes('vp')) {
    return 'executive';
  }
  
  if (roleStr.includes('contractor') || roleStr.includes('freelance') || roleStr.includes('consultant')) {
    return 'contractor';
  }
  
  return 'full-time-employee';
}