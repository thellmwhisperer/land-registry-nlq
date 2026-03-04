import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../src/schema/prompt-builder.js';

const fakeSemanticLayer = `# Semantic Layer

## Table: property_sales
| Column | Type |
|--------|------|
| price  | integer |
| town   | text |
`;

describe('buildSystemPrompt', () => {
  it('returns a string containing the semantic layer content', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain('property_sales');
    expect(prompt).toContain('price');
    expect(prompt).toContain('town');
  });

  it('includes the query generator framing', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain('PostgreSQL query generator');
  });

  it('restricts queries to the property_sales table', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain('Only generate SELECT queries against the property_sales table');
  });

  it('includes rules for uppercase comparisons', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain('UPPERCASE');
  });

  it('tells the LLM to output raw SQL only, no markdown', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain('raw SQL');
  });

  it('includes intent interpretation rule', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain('intent');
  });

  it('includes property_type O exclusion rule', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain("property_type IN ('D','S','T','F')");
  });

  it('includes hidden gems few shot example with growth calculation', () => {
    const prompt = buildSystemPrompt(fakeSemanticLayer);
    expect(prompt).toContain('growth_pct');
    expect(prompt).toContain('prices_2020');
  });
});
