declare module "bippy/dist/core.js" {
  export type BippyFiber = {
    tag?: number;
    key?: null | string | number;
    type?: unknown;
    elementType?: unknown;
    stateNode?: unknown;
    return?: BippyFiber | null;
    child?: BippyFiber | null;
    sibling?: BippyFiber | null;
    alternate?: BippyFiber | null;
    _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null;
    _debugStack?: Error | null;
  };

  export function b(
    fiber: BippyFiber | null,
    selector: (fiber: BippyFiber) => boolean | void | Promise<boolean | void>,
    ascending?: boolean,
  ): BippyFiber | null | Promise<BippyFiber | null>;
  export function i(type: unknown): string | null;
  export function l(fiber: BippyFiber): BippyFiber;
  export function m(fiber: BippyFiber): boolean;
  export function s(hostInstance: unknown): BippyFiber | null;
}
