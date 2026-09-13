import { locationService } from '@grafana/runtime';

import { addFiltersToQuery, navigateExplore, rebuildTarget } from './exploreQuery';

jest.mock('@grafana/runtime', () => ({
  locationService: { getSearch: jest.fn(), push: jest.fn() },
}));

const mockedLocation = locationService as unknown as {
  getSearch: jest.Mock;
  push: jest.Mock;
};

/** The query Explore would hold after our edit. */
function pushedQuery(): Record<string, unknown> {
  const [{ search }] = mockedLocation.push.mock.calls[0];
  const panes = JSON.parse(new URLSearchParams(search).get('panes')!);
  return panes.abc.queries[0];
}

function exploreSearch(query: Record<string, unknown>) {
  return new URLSearchParams({
    schemaVersion: '1',
    panes: JSON.stringify({ abc: { datasource: 'ds', queries: [query], range: { from: 'now-1h', to: 'now' } } }),
  });
}

beforeEach(() => {
  mockedLocation.getSearch.mockReset();
  mockedLocation.push.mockReset();
});

describe('navigateExplore', () => {
  it('writes the rebuilt query back into the pane', () => {
    mockedLocation.getSearch.mockReturnValue(
      exploreSearch({ refId: 'A', datasource: { uid: 'u' }, queryType: 'traceList', services: [] })
    );

    navigateExplore((q) => rebuildTarget(q, { queryType: 'traceList', services: ['checkout'] }));

    expect(pushedQuery()).toMatchObject({ refId: 'A', services: ['checkout'] });
  });

  it('keeps the rest of the URL intact', () => {
    mockedLocation.getSearch.mockReturnValue(
      exploreSearch({ refId: 'A', datasource: { uid: 'u' }, queryType: 'traceList' })
    );

    navigateExplore((q) => rebuildTarget(q, { queryType: 'traceList' }));

    const [{ search }] = mockedLocation.push.mock.calls[0];
    expect(new URLSearchParams(search).get('schemaVersion')).toBe('1');
  });
});

describe('addFiltersToQuery', () => {
  it('leaves the query the panel reads its selection from intact', () => {
    // The sidebar ticks a value by reading it back off the query, so anything
    // an edit drops silently disappears from the sidebar as well.
    mockedLocation.getSearch.mockReturnValue(
      exploreSearch({
        refId: 'A',
        datasource: { uid: 'u' },
        queryType: 'traceList',
        entity: 'traces',
        services: ['checkout'],
        expr: '_time:5m',
        customFields: ['http.route'],
        traceFilters: [],
      })
    );

    addFiltersToQuery([{ kind: 'operation', value: 'POST /order' }], new Set(['operation']));

    expect(pushedQuery()).toMatchObject({
      services: ['checkout'],
      entity: 'traces',
      expr: '_time:5m',
      customFields: ['http.route'],
      traceFilters: [{ kind: 'operation', value: 'POST /order' }],
    });
  });
});
