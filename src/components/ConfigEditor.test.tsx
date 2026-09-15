import React from 'react';
import { render, screen } from '@testing-library/react';
import { ConfigEditor } from './ConfigEditor';
import { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { VictoriaTracesOptions } from '../types';

// DataSourcePicker calls getDataSourceSrv().getList() during render, which
// returns undefined outside a Grafana runtime. Stub it out with a no-op
// component for these unit tests — the picker isn't what we're testing.
jest.mock('@grafana/runtime', () => {
  const actual = jest.requireActual('@grafana/runtime');
  return {
    ...actual,
    DataSourcePicker: () => null,
    getDataSourceSrv: () => ({
      getList: () => [],
      getInstanceSettings: () => undefined,
      get: () => Promise.resolve(undefined),
    }),
  };
});

// DerivedFields is lazy-loaded in production via React.lazy. In tests the
// Suspense resolution fires outside any act() boundary and triggers a
// console.error from react-dom. Replace it with a sync no-op so the Suspense
// boundary never has to suspend.
jest.mock('./DerivedFields', () => ({
  DerivedFields: () => null,
}));

type Props = DataSourcePluginOptionsEditorProps<VictoriaTracesOptions>;

function makeProps(overrides: Partial<Props> = {}): Props {
  return {
    options: {
      id: 1,
      uid: 'test',
      orgId: 1,
      name: 'VictoriaTraces',
      type: 'victoriametrics-traces-datasource',
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
  it('renders without crashing', async () => {
    render(<ConfigEditor {...makeProps()} />);
    await screen.findByDisplayValue('http://localhost:10428');
  });

  it('shows the default URL', async () => {
    render(<ConfigEditor {...makeProps()} />);
    expect(await screen.findByDisplayValue('http://localhost:10428')).toBeInTheDocument();
  });
});
