import React from 'react';
import { render, screen } from '@testing-library/react';
import { ConfigEditor } from './ConfigEditor';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { VictoriaTracesOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<VictoriaTracesOptions>;

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    options: {
      id: 1,
      uid: 'test',
      orgId: 1,
      name: 'VictoriaTraces',
      type: 'victoriatraces-datasource',
      typeName: 'VictoriaTraces',
      typeLogoUrl: '',
      access: 'proxy',
      url: 'http://localhost:10428',
      user: '',
      database: '',
      basicAuth: false,
      basicAuthUser: '',
      isDefault: false,
      jsonData: {},
      secureJsonFields: {},
      secureJsonData: {},
      version: 1,
      readOnly: false,
      withCredentials: false,
    },
    onOptionsChange: jest.fn(),
    ...overrides,
  };
}

describe('ConfigEditor', () => {
  it('renders without crashing', () => {
    expect(() => render(<ConfigEditor {...makeProps()} />)).not.toThrow();
  });

  it('shows the default URL', () => {
    render(<ConfigEditor {...makeProps()} />);
    // DataSourceHttpSettings renders the URL field
    expect(screen.getByDisplayValue('http://localhost:10428')).toBeInTheDocument();
  });
});
