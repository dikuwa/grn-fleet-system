import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_FONT,
  DOCUMENT_FONT_FALLBACK,
  DOCUMENT_FONT_STACK,
  SIGNATURE_FONT,
} from './document-system';

describe('official document typography', () => {
  it('uses Share Tech Mono before Space Mono', () => {
    expect(DOCUMENT_FONT).toBe('Share Tech Mono');
    expect(DOCUMENT_FONT_FALLBACK).toBe('Space Mono');
    expect(DOCUMENT_FONT_STACK[0]).toBe('Share Tech Mono');
  });

  it('keeps Allura for signatures when the bundled font is available', () => {
    expect(SIGNATURE_FONT).toBe('Allura');
  });
});
