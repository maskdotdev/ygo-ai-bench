export function platform(): string {
  return "browser";
}

export function tmpdir(): string {
  return "/tmp";
}

export const constants = {
  errno: {
    EBADF: 9,
    ENOENT: 2,
  },
};

export default { constants, platform, tmpdir };
