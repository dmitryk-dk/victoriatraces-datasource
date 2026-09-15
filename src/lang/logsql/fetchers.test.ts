import { createLogsqlFetchers } from './fetchers';

const getFieldNames = jest.fn().mockResolvedValue(['service.name']);
const getFieldValues = jest.fn().mockResolvedValue(['frontend']);

jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ get: jest.fn().mockResolvedValue({ getFieldNames, getFieldValues }) }),
}));

const range = { start: '2026-09-13T10:00:00Z', end: '2026-09-13T11:00:00Z' };

describe('createLogsqlFetchers', () => {
  it('asks the datasource for its field names within the range', async () => {
    // Unscoped metadata calls took ~25s against a busy store; the range is
    // what keeps completion usable.
    const fetchers = createLogsqlFetchers('uid-1', range)!;

    await expect(fetchers.fields()).resolves.toEqual(['service.name']);
    expect(getFieldNames).toHaveBeenCalledWith(undefined, undefined, undefined, range);
  });

  it('asks for the values of the field being filtered', async () => {
    const fetchers = createLogsqlFetchers('uid-1', range)!;

    await expect(fetchers.values('service.name')).resolves.toEqual(['frontend']);
    expect(getFieldValues).toHaveBeenCalledWith('service.name', expect.any(Number), undefined, undefined, range);
  });

  it('offers nothing without a datasource to ask', () => {
    expect(createLogsqlFetchers(undefined, range)).toBeUndefined();
  });
});
