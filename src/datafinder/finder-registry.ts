const _registry = new Map<string, new (...args: any[]) => unknown>();

export function registerRelatedFinderClass(name: string, cls: new (...args: any[]) => unknown): void {
  _registry.set(name, cls);
}

export function getRelatedFinderClass(name: string): (new (...args: any[]) => unknown) | undefined {
  return _registry.get(name);
}
