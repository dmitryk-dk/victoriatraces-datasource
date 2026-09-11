import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { FilterForm } from './FilterForms';
import type { TraceFilter } from '../filters/types';

const fieldKeys = [
  { label: 'http.route', value: 'span_attr:http.route', description: 'span_attr' },
  { label: 'host.name', value: 'resource_attr:host.name', description: 'resource_attr' },
];

function renderForm(overrides: Partial<React.ComponentProps<typeof FilterForm>> = {}) {
  const props = {
    kind: 'field' as const,
    operations: [],
    tagKeys: ['http.route', 'host.name'],
    fieldKeys,
    tagValues: [],
    onTagKeyChange: jest.fn(),
    onApply: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
  render(<FilterForm {...props} />);
  return props;
}

describe('FilterForm field mode', () => {
  it('filters on the storage name of the chosen field', () => {
    // Only "span_attr:http.route" exists in storage; a filter naming the bare
    // "http.route" matches nothing.
    const { onApply } = renderForm();

    // The mode radio group also labels an option "Field", so the select is
    // addressed by role.
    const [field, , value] = screen.getAllByRole('combobox');
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.click(screen.getByText('http.route'));

    // The value select takes free text.
    fireEvent.change(value, { target: { value: '/checkout' } });
    fireEvent.keyDown(value, { key: 'Enter', code: 'Enter' });
    fireEvent.click(screen.getByText('Apply'));

    expect(onApply).toHaveBeenCalledWith({
      kind: 'field',
      mode: 'field',
      field: 'span_attr:http.route',
      operator: 'equals',
      value: '/checkout',
    });
  });

  it('shows the bare name of a field being edited', () => {
    const filter: TraceFilter = {
      kind: 'field',
      mode: 'field',
      field: 'span_attr:http.route',
      operator: 'equals',
      value: '/checkout',
    };
    renderForm({ filter });

    expect(screen.getByText('http.route')).toBeInTheDocument();
    expect(screen.queryByText('span_attr:http.route')).not.toBeInTheDocument();
  });
});

describe('FilterForm validation and actions', () => {
  it('keeps Apply disabled until the filter says something', () => {
    // Clicking Apply on an incomplete filter used to do nothing at all, with
    // no hint as to why.
    renderForm();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('enables Apply once the filter is complete', () => {
    renderForm();

    const [field, , value] = screen.getAllByRole('combobox');
    fireEvent.focus(field);
    fireEvent.keyDown(field, { key: 'ArrowDown', code: 'ArrowDown' });
    fireEvent.click(screen.getByText('http.route'));
    fireEvent.change(value, { target: { value: '/checkout' } });
    fireEvent.keyDown(value, { key: 'Enter', code: 'Enter' });

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('needs no value for an operator that takes none', () => {
    renderForm({
      filter: { kind: 'field', mode: 'field', field: 'span_attr:http.route', operator: 'exists', value: '' },
    });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('removes the filter from inside its own editor', () => {
    const onRemove = jest.fn();
    renderForm({ filter: { kind: 'error' }, kind: 'error', onRemove });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('offers no Remove when the caller supplies no way to remove', () => {
    renderForm();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('refuses a negative span count', () => {
    const { onApply } = renderForm({ kind: 'spans' });

    const [min] = screen.getAllByRole('spinbutton');
    fireEvent.change(min, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('accepts a zero span count as a real bound', () => {
    const { onApply } = renderForm({ kind: 'spans' });

    const [min] = screen.getAllByRole('spinbutton');
    fireEvent.change(min, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith({ kind: 'spans', min: 0, max: undefined });
  });
});
