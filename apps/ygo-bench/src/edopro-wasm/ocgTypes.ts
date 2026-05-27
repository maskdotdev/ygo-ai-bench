export interface OcgCardData {
  code: number;
  alias: number;
  setcodes: number[];
  type: number;
  level: number;
  attribute: number;
  race: bigint;
  attack: number;
  defense: number;
  lscale: number;
  rscale: number;
  link_marker: number;
}

export interface OcgDuelHandle {
  readonly __handle: unique symbol;
}

export interface OcgMessage {
  type: number;
  [key: string]: unknown;
}

export interface OcgCoreSync {
  getVersion(): readonly [number, number];
  createDuel(options: {
    flags: bigint;
    seed: [bigint, bigint, bigint, bigint];
    team1: { startingLP: number; startingDrawCount: number; drawCountPerTurn: number };
    team2: { startingLP: number; startingDrawCount: number; drawCountPerTurn: number };
    cardReader: (code: number) => OcgCardData | null;
    scriptReader: (name: string) => string | null;
    errorHandler?: (type: unknown, text: string) => void;
  }): OcgDuelHandle | null;
  destroyDuel(handle: OcgDuelHandle): void;
  duelNewCard(handle: OcgDuelHandle, cardInfo: {
    team: 0 | 1;
    duelist: number;
    code: number;
    controller: 0 | 1;
    location: number;
    sequence: number;
    position: number;
  }): void;
  startDuel(handle: OcgDuelHandle): void;
  duelProcess(handle: OcgDuelHandle): number;
  duelGetMessage(handle: OcgDuelHandle): OcgMessage[];
  duelSetResponse(handle: OcgDuelHandle, response: unknown): void;
}

export interface OcgRuntime {
  createCore: (options: { sync: true; printErr?: (line: string) => void }) => Promise<OcgCoreSync>;
  OcgDuelMode: Record<string, bigint>;
  OcgLocation: Record<string, number>;
  OcgMessageType: Record<string | number, string | number>;
  OcgPosition: Record<string, number>;
  OcgProcessResult: Record<string, number>;
  OcgResponseType: Record<string, number>;
  SelectIdleCMDAction: Record<string, number>;
  SelectBattleCMDAction: Record<string, number>;
}
