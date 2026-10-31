import { describe, expect, it } from 'vitest';
import { detectLanguage, resolveLanguage } from '../src/ai/lang';
import { classify } from '../src/ai/router';

describe('language detection', () => {
  it('detects English', () => {
    expect(detectLanguage('What is overdue in Project Phoenix?')).toBe('en');
    expect(detectLanguage('Show the status of this activity')).toBe('en');
  });
  it('detects Devanagari Hindi', () => {
    expect(detectLanguage('इस प्रोजेक्ट का स्टेटस बताओ')).toBe('hi');
  });
  it('detects romanised Hinglish', () => {
    expect(detectLanguage('Phoenix ka status batao')).toBe('hi');
    expect(detectLanguage('kya kya deri mein hai?')).toBe('hi');
    expect(detectLanguage('kaun dekh raha hai yeh task')).toBe('hi');
  });
  it('respects an explicit language', () => {
    expect(resolveLanguage('en', 'status batao')).toBe('en');
    expect(resolveLanguage('hi', 'what is the status')).toBe('hi');
    expect(resolveLanguage('auto', 'status batao')).toBe('hi');
  });
});

describe('router agent', () => {
  it('routes status questions to the tracker at level 1', () => {
    const r = classify('What is the status of this project?', true);
    expect(r.primary).toBe('status');
    expect(r.domains).toEqual(['tracker']);
    expect(r.level).toBe(1);
  });
  it('routes overdue/blocked in Hindi', () => {
    expect(classify('क्या देरी में है?', true).primary).toBe('overdue');
    expect(classify('kya atka hua hai', true).intents).toContain('blocked');
  });
  it('routes finance and TSA to the finance agent', () => {
    expect(classify('What is the fee budget?', true).domains).toContain('finance');
    expect(classify('Which TSA services exit next?', true).primary).toBe('tsa');
  });
  it('treats "what is a TSA" as knowledge, not finance', () => {
    const r = classify('What is a TSA?', false);
    expect(r.primary).toBe('knowledge');
    expect(r.domains).toEqual(['knowledge']);
  });
  it('detects drafting intents', () => {
    expect(classify('Draft a status email to the owner', true).primary).toBe('draft_email');
    expect(classify('Schedule a meeting with the team', true).primary).toBe('meeting');
  });
  it('escalates cross-domain questions to level 3 (max 3 agents)', () => {
    const r = classify('Summarise risks and costs and compare with past deals', true);
    expect(r.level).toBe(3);
    expect(r.domains.length).toBeGreaterThanOrEqual(2);
  });
  it('falls back to help with no context and no intent', () => {
    expect(classify('xyz', false).primary).toBe('help');
  });
});
