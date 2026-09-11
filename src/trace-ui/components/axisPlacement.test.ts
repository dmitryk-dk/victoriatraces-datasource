import { horizontalTickStyle, verticalTickStyle } from './axisPlacement';

describe('verticalTickStyle', () => {
  it('centres a tick in the middle of the axis', () => {
    expect(verticalTickStyle(50)).toEqual({ bottom: '50%' });
  });

  it('pins the top tick inside the plot', () => {
    expect(verticalTickStyle(100)).toEqual({ top: 0, transform: 'none' });
  });

  it('pins the bottom tick inside the plot', () => {
    expect(verticalTickStyle(0)).toEqual({ bottom: 0, transform: 'none' });
  });
});

describe('horizontalTickStyle', () => {
  it('centres a tick in the middle of the axis', () => {
    expect(horizontalTickStyle(40)).toEqual({ left: '40%' });
  });

  it('pins the last tick inside the plot', () => {
    expect(horizontalTickStyle(100)).toEqual({ right: 0, transform: 'none' });
  });

  it('pins the first tick inside the plot', () => {
    expect(horizontalTickStyle(0)).toEqual({ left: 0, transform: 'none' });
  });
});
