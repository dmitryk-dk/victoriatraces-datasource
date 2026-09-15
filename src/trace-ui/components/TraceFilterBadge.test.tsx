import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { TraceFilter } from '../filters/types';
import { TraceFilterBadge } from './TraceFilterBadge';

function renderBadge(filter: TraceFilter, overrides: Partial<React.ComponentProps<typeof TraceFilterBadge>> = {}) {
  const props = {
    filter,
    open: false,
    onOpenChange: jest.fn(),
    onApply: jest.fn(),
    onRemove: jest.fn(),
    operations: ['GET /'],
    tagKeys: ['http.method'],
    fieldKeys: [{ label: 'http.method', value: 'span_attr:http.method', description: 'span_attr' }],
    tagValues: ['GET', 'POST'],
    onTagKeyChange: jest.fn(),
    ...overrides,
  };
  render(<TraceFilterBadge {...props} />);
  return props;
}

describe('TraceFilterBadge', () => {
  it('shows the filter kind and its current value', () => {
    renderBadge({ kind: 'tag', key: 'http.method', value: 'GET' });
    expect(screen.getByText('Tag')).toBeInTheDocument();
    expect(screen.getByText('http.method="GET"')).toBeInTheDocument();
  });

  it('opens the editor when the badge body is clicked', () => {
    const props = renderBadge({ kind: 'duration', min: '250ms' });
    fireEvent.click(screen.getByLabelText('Edit Duration filter'));
    expect(props.onOpenChange).toHaveBeenCalledWith(true);
  });

  it('removes without opening the editor', () => {
    const props = renderBadge({ kind: 'duration', min: '250ms' });
    fireEvent.click(screen.getByLabelText('Remove Duration filter'));
    expect(props.onRemove).toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it.each([
    ['error' as const, { kind: 'error' as const }],
    ['spanType' as const, { kind: 'spanType' as const, value: 'db' as const }],
  ])('does not offer an editor for %s, which has nothing to change', (_kind, filter) => {
    renderBadge(filter);
    expect(screen.queryByLabelText(/^Edit /)).not.toBeInTheDocument();
  });

  it('seeds the editor with the filter being edited', () => {
    renderBadge({ kind: 'duration', min: '250ms', max: '2s' }, { open: true });
    expect(screen.getByDisplayValue('250ms')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2s')).toBeInTheDocument();
  });

  it('applies an edited value and closes', () => {
    const props = renderBadge({ kind: 'duration', min: '250ms' }, { open: true });

    fireEvent.change(screen.getByDisplayValue('250ms'), { target: { value: '500ms' } });
    fireEvent.click(screen.getByText('Apply'));

    expect(props.onApply).toHaveBeenCalledWith({ kind: 'duration', min: '500ms', max: undefined });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('TraceFilterBadge editor and portalled menus', () => {
  it('stays open when a value is picked from a select menu', () => {
    // The select menu renders in a portal, outside the popover's DOM subtree.
    // Treating that click as "outside" closed the editor and, for a filter
    // being added, discarded it before it could be applied.
    const props = renderBadge({ kind: 'operation', value: '' }, { open: true });

    const [operation] = screen.getAllByRole('combobox');
    fireEvent.focus(operation);
    fireEvent.keyDown(operation, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.click(screen.getByText('GET /'));

    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  it('closes when the click really is outside the editor', () => {
    const props = renderBadge({ kind: 'operation', value: '' }, { open: true });

    fireEvent.click(document.body);

    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
