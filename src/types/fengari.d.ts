declare module "fengari" {
  const fengari: {
    lua: any;
    lauxlib: any;
    lualib: any;
    to_luastring(value: string, cache?: boolean): Uint8Array;
  };
  export default fengari;
}
