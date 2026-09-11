import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

Object.assign(global, { TextDecoder, TextEncoder });

Object.defineProperty(global, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});

HTMLCanvasElement.prototype.getContext = () => {};

// jsdom has no ResizeObserver. Components that measure themselves (the service
// chips overflow, for one) construct one on mount and would otherwise throw.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Same for IntersectionObserver, which @grafana/ui's Select uses to page its
// menu and the trace list uses for its load-more sentinel.
global.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};

// jsdom implements no PointerEvent, so testing-library falls back to a bare
// Event and drops clientX/button — pointer-driven charts then see nothing.
// MouseEvent carries the coordinates already; the pointer fields are added on
// top, along with the capture calls jsdom's Element also lacks.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEvent extends MouseEvent {
    constructor(type, params = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEvent;
  global.PointerEvent = PointerEvent;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
  Element.prototype.hasPointerCapture = function hasPointerCapture() {
    return false;
  };
}
