import { completionContext } from './context';

describe('completionContext', () => {
  it('offers pipes right after a pipe character', () => {
    expect(completionContext('_time:5m | ')).toEqual({ kind: 'pipe', word: '' });
    expect(completionContext('_time:5m | sta')).toEqual({ kind: 'pipe', word: 'sta' });
  });

  it('offers values once a field has been named', () => {
    expect(completionContext('service.name:')).toEqual({
      kind: 'fieldValue',
      field: 'service.name',
      word: '',
    });
    expect(completionContext('level:err')).toEqual({
      kind: 'fieldValue',
      field: 'level',
      word: 'err',
    });
  });

  it('sees through the quote a value may open with', () => {
    expect(completionContext('service.name:"front')).toEqual({
      kind: 'fieldValue',
      field: 'service.name',
      word: 'front',
    });
  });

  it('offers fields inside a stream selector', () => {
    expect(completionContext('{')).toEqual({ kind: 'field', word: '' });
    expect(completionContext('{service')).toEqual({ kind: 'field', word: 'service' });
    expect(completionContext('{a="b", ho')).toEqual({ kind: 'field', word: 'ho' });
  });

  it('offers values inside a stream selector once a field is named', () => {
    expect(completionContext('{service.name="')).toEqual({
      kind: 'fieldValue',
      field: 'service.name',
      word: '',
    });
    expect(completionContext('{service.name=~"fro')).toEqual({
      kind: 'fieldValue',
      field: 'service.name',
      word: 'fro',
    });
  });

  it('falls back to fields and filters at the start of a query', () => {
    expect(completionContext('')).toEqual({ kind: 'filterOrField', word: '' });
    expect(completionContext('err')).toEqual({ kind: 'filterOrField', word: 'err' });
    expect(completionContext('_time:5m ')).toEqual({ kind: 'filterOrField', word: '' });
  });

  it('does not mistake a finished stream selector for one still open', () => {
    // The brace closed, so what follows is an ordinary filter position.
    expect(completionContext('{a="b"} err')).toEqual({ kind: 'filterOrField', word: 'err' });
  });

  it('does not treat a time filter as a field waiting for values', () => {
    // "_time:5m" is complete; suggesting values for _time helps nobody.
    expect(completionContext('_time:5m')).toEqual({
      kind: 'fieldValue',
      field: '_time',
      word: '5m',
    });
  });
});
