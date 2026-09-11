import { of, throwError } from 'rxjs';

import { fetchResource, invalidateResources } from './resource';

const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

beforeEach(() => {
  mockFetch.mockReset();
  invalidateResources();
});

describe('fetchResource', () => {
  it('targets the datasource resource endpoint', () => {
    mockFetch.mockReturnValue(of({ data: ['a'] }));

    fetchResource('my-uid', 'services').subscribe();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/datasources/uid/my-uid/resources/services', method: 'GET' })
    );
  });

  it('appends defined params and drops empty ones', () => {
    mockFetch.mockReturnValue(of({ data: [] }));

    fetchResource('uid', 'search', { q: '', start: 1, end: undefined, limit: 50 }).subscribe();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/api/datasources/uid/uid/resources/search?start=1&limit=50' })
    );
  });

  it('unwraps the response body', (done) => {
    mockFetch.mockReturnValue(of({ data: ['frontend'] }));

    fetchResource<string[]>('uid', 'services').subscribe((data) => {
      expect(data).toEqual(['frontend']);
      done();
    });
  });

  it('makes one request for concurrent identical calls', () => {
    mockFetch.mockReturnValue(of({ data: [] }));

    fetchResource('uid', 'services').subscribe();
    fetchResource('uid', 'services').subscribe();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('treats different params as different resources', () => {
    mockFetch.mockReturnValue(of({ data: [] }));

    fetchResource('uid', 'operations', { service: 'a' }).subscribe();
    fetchResource('uid', 'operations', { service: 'b' }).subscribe();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not serve a failed request from cache', () => {
    mockFetch.mockReturnValue(throwError(() => new Error('boom')));
    fetchResource('uid', 'services').subscribe({ error: () => {} });

    mockFetch.mockReturnValue(of({ data: ['frontend'] }));
    fetchResource('uid', 'services').subscribe();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('refetches after invalidation', () => {
    mockFetch.mockReturnValue(of({ data: [] }));

    fetchResource('uid', 'services').subscribe();
    invalidateResources();
    fetchResource('uid', 'services').subscribe();

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
