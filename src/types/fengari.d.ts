declare module "fengari" {
  const fengari: {
    lua: any;
    lauxlib: any;
    lualib: any;
    to_jsstring(value: Uint8Array, from?: number, to?: number, replacement?: boolean): string;
    to_luastring(value: string, cache?: boolean): Uint8Array;
  };
  export default fengari;
}
