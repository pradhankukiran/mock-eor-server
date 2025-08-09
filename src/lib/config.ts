import dotenv from 'dotenv';
dotenv.config();

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: toNumber(process.env.PORT, 3000),
  mockDelayMs: toNumber(process.env.MOCK_DELAY_MS, 300),
  terminationMultiplier: Number(process.env.TERMINATION_MULTIPLIER ?? 0.5),
  
  // Margin thresholds for validation
  marginThresholds: {
    minimumMarginPercent: toNumber(process.env.MIN_MARGIN_PERCENT, 15),
    targetMarginPercent: toNumber(process.env.TARGET_MARGIN_PERCENT, 25),
    riskThresholdPercent: toNumber(process.env.RISK_THRESHOLD_PERCENT, 10),
  },
  
  // Service type configurations
  serviceTypes: {
    'full-time-employee': {
      minimumMargin: 15,
      acidTestRequired: true,
      riskMultiplier: 1.0,
    },
    'contractor': {
      minimumMargin: 10,
      acidTestRequired: false,
      riskMultiplier: 0.8,
    },
    'executive': {
      minimumMargin: 20,
      acidTestRequired: true,
      riskMultiplier: 1.2,
    },
  },
  
  // Acid test configuration
  acidTest: {
    maxTceThreshold: toNumber(process.env.MAX_TCE_THRESHOLD, 200000),
    cashFlowRatio: Number(process.env.CASH_FLOW_RATIO ?? 1.5),
    riskScoreThreshold: toNumber(process.env.RISK_SCORE_THRESHOLD, 70),
  },
};


