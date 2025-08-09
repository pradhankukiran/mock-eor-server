import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { config } from '../lib/config';
import { seedStore, QuoteRecord } from '../lib/store';
import { faker } from '@faker-js/faker';
import { validateQuote, getServiceTypeFromRole, ValidationResult } from '../lib/validation';

export const quotesRouter = Router();

const compareQuerySchema = z.object({
  country: z.string().min(2),
  salary: z.preprocess((v) => Number(v), z.number().positive()),
  currency: z.string().min(3).max(3),
  role: z.string().min(2),
});

quotesRouter.get('/compare', async (req, res) => {
  const parsed = compareQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
  }
  const { country, salary, currency, role } = parsed.data;

  const baseUrl = `http://localhost:${config.port}`;
  const endpoints = [
    { provider: 'deel', url: `${baseUrl}/rest/v2/eor` },
    { provider: 'remote', url: `${baseUrl}/remote/eor` },
    { provider: 'oyster', url: `${baseUrl}/oyster/eor` },
  ] as const;

  const payload = { country, salary, currency, role, benefits: [] as string[], start_date: '2025-01-01' };

  const responses = await Promise.all(
    endpoints.map(async (e) => {
      const r = await fetch(e.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        return { provider: e.provider, error: `HTTP ${r.status}` } as const;
      }
      const data = await r.json();
      let costs: any | undefined = data.costs;
      if (!costs && data.breakdown) {
        costs = {
          salary: data.breakdown.salary,
          employer_tax: data.breakdown.employer_tax,
          benefits_cost: data.breakdown.benefits_cost,
          fixed_fees: data.breakdown.fixed_fees,
          termination_amortization: data.breakdown.termination_amortization,
          tce: data.breakdown.totalEmploymentCost,
        };
      }
      if (!costs && data.data && data.data.total_cost_employment) {
        costs = {
          salary: data.data.salary,
          employer_tax: data.data.employer_tax,
          benefits_cost: data.data.benefits,
          fixed_fees: data.data.fees_fixed,
          termination_amortization: data.data.termination,
          tce: data.data.total_cost_employment,
        };
      }
      return { provider: e.provider, costs } as const;
    })
  );

  if (responses.some((r) => 'error' in r || !r.costs)) {
    return res.status(404).json({ error: 'Country not found or provider error' });
  }

  const costsOnly = responses as Array<{ provider: 'deel' | 'remote' | 'oyster'; costs: any }>;
  const tces = costsOnly.map((c) => c.costs.tce);
  const maxTce = Math.max(...tces);
  const minTce = Math.min(...tces);
  const spreadPct = ((maxTce - minTce) / minTce) * 100;
  let chosen = costsOnly.reduce((acc, cur) => (cur.costs.tce < acc.costs.tce ? cur : acc));
  if (spreadPct <= 4) {
    // choose higher TCE when within 4%
    chosen = costsOnly.reduce((acc, cur) => (cur.costs.tce > acc.costs.tce ? cur : acc));
  }

  // Perform validation on chosen provider
  const serviceType = getServiceTypeFromRole(role);
  const validationResult = validateQuote({
    tce: chosen.costs.tce,
    salary,
    country,
    serviceType,
    providerCosts: chosen.costs,
  });

  // Legacy manual review check
  const legacyManualReview = typeof process.env.MAX_TCE === 'string' && Number(process.env.MAX_TCE) > 0
    ? maxTce > Number(process.env.MAX_TCE)
    : false;

  // Combine validation and legacy manual review requirements
  const requiresManualReview = legacyManualReview || validationResult.requiresManualReview;

  const result = {
    query: { country, salary, currency, role, service_type: serviceType },
    providers: costsOnly,
    rules: { 
      reconciliation_rule_percent: 4, 
      termination_multiplier: config.terminationMultiplier,
      margin_thresholds: config.marginThresholds,
    },
    chosen_provider: chosen.provider,
    requires_manual_review: requiresManualReview,
    validation: {
      is_valid: validationResult.isValid,
      margin_percent: validationResult.marginPercent,
      risk_score: validationResult.riskScore,
      acid_test_passed: validationResult.acidTestPassed,
      warnings: validationResult.warnings,
      errors: validationResult.errors,
    },
  };

  const id = faker.string.uuid();
  const record: QuoteRecord = {
    id,
    createdAt: Date.now(),
    query: { country, salary, currency, role, service_type: serviceType },
    providers: costsOnly as any,
    chosen_provider: chosen.provider,
    requires_manual_review: requiresManualReview,
    status: requiresManualReview ? 'pending' : 'approved',
    validation: {
      is_valid: validationResult.isValid,
      margin_percent: validationResult.marginPercent,
      risk_score: validationResult.riskScore,
      acid_test_passed: validationResult.acidTestPassed,
      warnings: validationResult.warnings,
      errors: validationResult.errors,
    },
  };
  seedStore.quotes.set(id, record);
  return res.json({ id, ...result });
});

const pdfBodySchema = z.object({
  query: z.object({ 
    country: z.string(), 
    salary: z.number(), 
    currency: z.string(), 
    role: z.string(),
    service_type: z.string().optional(),
  }),
  providers: z.array(
    z.object({
      provider: z.enum(['deel', 'remote', 'oyster']),
      costs: z.object({
        salary: z.number(),
        employer_tax: z.number(),
        benefits_cost: z.number(),
        fixed_fees: z.number(),
        termination_amortization: z.number(),
        tce: z.number(),
      }),
    })
  ),
  rules: z.any(),
  chosen_provider: z.enum(['deel', 'remote', 'oyster']),
  requires_manual_review: z.boolean().optional(),
  validation: z.object({
    is_valid: z.boolean(),
    margin_percent: z.number(),
    risk_score: z.number(),
    acid_test_passed: z.boolean(),
    warnings: z.array(z.string()),
    errors: z.array(z.string()),
  }).optional(),
});

quotesRouter.post('/pdf', (req, res) => {
  const parsed = pdfBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
  }
  const data = parsed.data;

  try {
    const doc = new PDFDocument({ size: 'A4', margin: 60 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="eor-quote-comparison.pdf"');
    doc.pipe(res);

    const pageWidth = 595; // A4 width in points
    const pageHeight = 842; // A4 height in points
    const margin = 60;
    const contentWidth = pageWidth - (margin * 2);
    let y = margin;

    // Helper function to add watermark
    const addWatermark = () => {
      doc.save();
      doc.fillColor('#f0f0f0').fontSize(80).opacity(0.1);
      doc.rotate(45, { origin: [pageWidth/2, pageHeight/2] });
      doc.text('DEMO ONLY', 0, pageHeight/2 - 40, { 
        width: pageWidth, 
        align: 'center' 
      });
      doc.restore();
    };

    // Helper function to check if we need a new page
    const checkPageSpace = (spaceNeeded: number) => {
      if (y + spaceNeeded > pageHeight - margin - 50) {
        doc.addPage();
        addWatermark();
        y = margin;
        return true;
      }
      return false;
    };

    // Add watermark to first page
    addWatermark();

    // Professional Header
    doc.fillColor('#1a365d').fontSize(26).font('Helvetica-Bold');
    doc.text('EOR Quote Comparison Report', margin, y);
    y += 35;
    
    doc.fillColor('#4a5568').fontSize(12).font('Helvetica');
    doc.text(`Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, margin, y);
    y += 30;

    // Quote Summary Section
    checkPageSpace(150);
    doc.fillColor('#2c5aa0').fontSize(18).font('Helvetica-Bold');
    doc.text('Quote Summary', margin, y);
    y += 25;
    
    const summaryData = [
      ['Country:', data.query.country],
      ['Position:', data.query.role],
      ['Service Type:', data.query.service_type || 'Full-time Employee'],
      ['Annual Salary:', `${data.query.salary.toLocaleString()} ${data.query.currency}`],
      ['Chosen Provider:', data.chosen_provider.toUpperCase()],
    ];
    
    // Summary table with better formatting
    doc.fillColor('#f7fafc').rect(margin, y - 5, contentWidth, summaryData.length * 25 + 10).fill();
    doc.fillColor('#000').fontSize(12).font('Helvetica');
    
    summaryData.forEach(([label, value]) => {
      doc.text(label, margin + 15, y, { width: 150 });
      doc.fillColor('#2d3748').font('Helvetica-Bold');
      doc.text(value, margin + 180, y, { width: contentWidth - 195 });
      doc.fillColor('#000').font('Helvetica');
      y += 25;
    });
    y += 20;

    // Validation Results Section
    if (data.validation) {
      checkPageSpace(200);
      doc.fillColor('#2c5aa0').fontSize(18).font('Helvetica-Bold');
      doc.text('Risk Assessment & Validation', margin, y);
      y += 25;
      
      // Status indicators in a structured layout
      const validationItems = [
        ['Status:', data.validation.is_valid ? 'VALIDATED' : 'REQUIRES ATTENTION', data.validation.is_valid],
        ['Profit Margin:', `${data.validation.margin_percent.toFixed(1)}%`, data.validation.margin_percent >= 15],
        ['Risk Score:', `${data.validation.risk_score}/100`, data.validation.risk_score <= 70],
        ['Financial Viability:', data.validation.acid_test_passed ? 'PASS' : 'FAIL', data.validation.acid_test_passed],
      ];
      
      validationItems.forEach(([label, value, isGood]) => {
        doc.fillColor('#000').fontSize(12).font('Helvetica');
        doc.text(String(label), margin + 15, y, { width: 150 });
        
        const statusColor = isGood ? '#38a169' : '#e53e3e';
        doc.fillColor(statusColor).font('Helvetica-Bold');
        doc.text(String(value), margin + 180, y);
        y += 22;
      });
      
      // Warnings and Errors
      if (data.validation.warnings.length > 0 || data.validation.errors.length > 0) {
        y += 10;
        checkPageSpace(100);
        
        doc.fillColor('#2c5aa0').fontSize(14).font('Helvetica-Bold');
        doc.text('Validation Notes', margin + 15, y);
        y += 20;
        
        [...data.validation.errors, ...data.validation.warnings].forEach((note) => {
          const isError = data.validation!.errors.includes(note);
          doc.fillColor(isError ? '#e53e3e' : '#d69e2e').fontSize(11).font('Helvetica');
          doc.text(`${isError ? 'ERROR' : 'WARNING'}: ${note}`, margin + 30, y, { width: contentWidth - 45 });
          y += 18;
        });
      }
      y += 25;
    }

    // Provider Comparison Table
    checkPageSpace(150);
    doc.fillColor('#2c5aa0').fontSize(18).font('Helvetica-Bold');
    doc.text('Provider Comparison', margin, y);
    y += 25;
    
    // Table setup with better proportions
    const tableStartX = margin;
    const tableWidth = contentWidth;
    const colWidths = [80, 75, 75, 75, 75, 70, 85]; // Adjusted for better fit
    const headers = ['Provider', 'Salary', 'Tax', 'Benefits', 'Fees', 'Term.', 'Total TCE'];
    
    // Table header
    doc.fillColor('#e2e8f0').rect(tableStartX, y - 5, tableWidth, 30).fill();
    doc.fillColor('#2d3748').fontSize(11).font('Helvetica-Bold');
    
    let currentX = tableStartX;
    headers.forEach((header, i) => {
      const align = i === 0 ? 'left' : 'right';
      doc.text(header, currentX + 8, y + 8, { 
        width: colWidths[i] - 16, 
        align 
      });
      currentX += colWidths[i];
    });
    y += 30;
    
    // Table rows with better formatting
    data.providers.forEach((provider, idx) => {
      const isChosen = provider.provider === data.chosen_provider;
      
      // Row background
      const rowBg = isChosen ? '#e6fffa' : (idx % 2 === 0 ? '#ffffff' : '#f9fafb');
      doc.fillColor(rowBg).rect(tableStartX, y - 5, tableWidth, 28).fill();
      
      // Add border lines
      doc.strokeColor('#e2e8f0').lineWidth(0.5)
        .moveTo(tableStartX, y - 5)
        .lineTo(tableStartX + tableWidth, y - 5)
        .stroke();
      
      doc.fillColor(isChosen ? '#065f46' : '#374151').fontSize(10).font('Helvetica');
      
      const rowData = [
        provider.provider.toUpperCase() + (isChosen ? ' (SELECTED)' : ''),
        provider.costs.salary.toLocaleString(),
        provider.costs.employer_tax.toLocaleString(),
        provider.costs.benefits_cost.toLocaleString(),
        provider.costs.fixed_fees.toLocaleString(),
        provider.costs.termination_amortization.toLocaleString(),
      ];
      
      // TCE with special formatting
      const tceValue = provider.costs.tce.toLocaleString();
      
      currentX = tableStartX;
      rowData.forEach((cell, i) => {
        const align = i === 0 ? 'left' : 'right';
        doc.text(cell, currentX + 8, y + 6, { 
          width: colWidths[i] - 16, 
          align 
        });
        currentX += colWidths[i];
      });
      
      // TCE in bold
      doc.font('Helvetica-Bold');
      doc.text(tceValue, currentX + 8, y + 6, { 
        width: colWidths[6] - 16, 
        align: 'right' 
      });
      
      y += 28;
    });
    
    // Table bottom border
    doc.strokeColor('#e2e8f0').lineWidth(1)
      .moveTo(tableStartX, y - 5)
      .lineTo(tableStartX + tableWidth, y - 5)
      .stroke();
    
    y += 25;

    // Business Rules Section
    checkPageSpace(120);
    doc.fillColor('#2c5aa0').fontSize(18).font('Helvetica-Bold');
    doc.text('Business Rules Applied', margin, y);
    y += 20;
    
    doc.fillColor('#000').fontSize(11).font('Helvetica');
    const rules = [
      `Reconciliation Rule: Within 4% spread, select higher TCE provider`,
      `Termination Multiplier: ${data.rules?.termination_multiplier || 0.5}x of probation period`,
      `Manual Review: ${data.requires_manual_review ? 'Required' : 'Not Required'}`,
    ];
    
    if (data.validation) {
      rules.push(`Minimum Margin Threshold: ${data.rules?.margin_thresholds?.minimumMarginPercent || 15}%`);
      rules.push(`Risk Assessment Threshold: ${data.rules?.margin_thresholds?.riskThresholdPercent || 10}%`);
    }
    
    rules.forEach((rule) => {
      doc.text(`• ${rule}`, margin + 15, y, { width: contentWidth - 30 });
      y += 18;
    });
    
    // Footer
    const footerY = pageHeight - margin - 30;
    doc.fillColor('#718096').fontSize(9).font('Helvetica');
    doc.text('This is a demonstration report generated by the EOR Quote Comparison System', 
             margin, footerY, { width: contentWidth, align: 'center' });
    doc.text('All data shown is simulated for demo purposes only', 
             margin, footerY + 12, { width: contentWidth, align: 'center' });
    
    // Page info
    doc.text(`Generated: ${new Date().toISOString()} | Page 1`, 
             margin, pageHeight - margin - 15, { width: contentWidth, align: 'right' });

    doc.end();
    
  } catch (error) {
    console.error('PDF generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to generate PDF', details: errorMessage });
  }
});

export default quotesRouter;

// History and review endpoints (alias to mock admin storage)
quotesRouter.get('/history', (_req, res) => {
  const items = Array.from(seedStore.quotes.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((q) => ({
      id: q.id,
      createdAt: q.createdAt,
      country: q.query.country,
      provider: q.chosen_provider,
      tce: q.providers.find((p) => p.provider === q.chosen_provider)?.costs.tce,
      status: q.status,
      requires_manual_review: q.requires_manual_review,
    }));
  res.json({ items });
});

quotesRouter.get('/:id', (req, res) => {
  const q = seedStore.quotes.get(String(req.params.id));
  if (!q) return res.status(404).json({ error: 'Not found' });
  res.json(q);
});

quotesRouter.post('/:id/review', (req, res) => {
  const q = seedStore.quotes.get(String(req.params.id));
  if (!q) return res.status(404).json({ error: 'Not found' });
  const action = String((req.body && req.body.action) || '').toLowerCase();
  if (action === 'approve') q.status = 'approved';
  else if (action === 'reject') q.status = 'rejected';
  else return res.status(400).json({ error: 'action must be approve|reject' });
  seedStore.quotes.set(q.id, q);
  res.json({ id: q.id, status: q.status });
});


