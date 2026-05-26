export const constants = {
  O_CREAT: 0x40,
  O_EXCL: 0x80,
  O_RDWR: 0x2,
};

function unsupported(): never {
  throw new Error("Browser fs shim does not support filesystem access");
}

export const rmdirSync = unsupported;
export const rm = unsupported;
export const rmSync = unsupported;
export const stat = unsupported;
export const statSync = unsupported;
export const open = unsupported;
export const openSync = unsupported;
export const close = unsupported;
export const closeSync = unsupported;
export const mkdir = unsupported;
export const mkdirSync = unsupported;
export const unlink = unsupported;
export const unlinkSync = unsupported;
export const renameSync = unsupported;
export const realpath = unsupported;
export const realpathSync = unsupported;
export const writeSync = unsupported;

export default {
  constants,
  rmdirSync,
  rm,
  rmSync,
  stat,
  statSync,
  open,
  openSync,
  close,
  closeSync,
  mkdir,
  mkdirSync,
  unlink,
  unlinkSync,
  renameSync,
  realpath,
  realpathSync,
  writeSync,
};
