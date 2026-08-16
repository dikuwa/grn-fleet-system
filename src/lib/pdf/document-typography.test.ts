import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_FONT,
  DOCUMENT_FONT_FALLBACK,
  DOCUMENT_FONT_STACK,
  SIGNATURE_FONT,
} from './document-system';

describe('official document typography', () => {
  it('uses Fake Receipt first with Share Tech Mono as the fallback', () => {
    expect(DOCUMENT_FONT).toBe('Fake Receipt');
    expect(DOCUMENT_FONT_FALLBACK).toBe('Share Tech Mono');
    expect(DOCUMENT_FONT_STACK[0]).toBe('Fake Receipt');
    expect(DOCUMENT_FONT_STACK).toContain('Share Tech Mono');
  });

  it('keeps Allura for applied signatures when the bundled font is available', () => {
    expect(SIGNATURE_FONT).toBe('Allura');
  });
});
