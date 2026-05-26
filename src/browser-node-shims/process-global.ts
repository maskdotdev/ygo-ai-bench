declare global {
  interface Window {
    __duelDeckStudioProcess?: {
      env: { FENGARICONF: string };
      versions: { node: string };
      browser: boolean;
      addListener(): void;
      removeListener(): void;
      on(): void;
      once(): void;
      binding(name: string): unknown;
    };
  }
}

const browserGlobal = globalThis as typeof globalThis & { __duelDeckStudioProcess?: Window["__duelDeckStudioProcess"] };

browserGlobal.__duelDeckStudioProcess ??= {
  env: { FENGARICONF: "" },
  versions: { node: "99" },
  browser: true,
  addListener() {},
  removeListener() {},
  on() {},
  once() {},
  binding() {
    return {};
  },
};

export {};
