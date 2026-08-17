import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DocumentViewerActions } from './document-viewer-actions';

describe('DocumentViewerActions', () => {
  it('opens the inline canonical PDF in a separate tab for printing', () => {
    render(<DocumentViewerActions documentId="document-123" documentType="trip_authority" />);

    const printLink = screen.getByRole('link', { name: 'Print' });
    expect(printLink).toHaveAttribute(
      'href',
      '/api/documents/document-123/pdf?preview=1',
    );
    expect(printLink).toHaveAttribute('target', '_blank');
    expect(printLink).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
});
