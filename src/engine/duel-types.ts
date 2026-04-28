export type PlayerId = 0 | 1;

export type DuelPhase = "draw" | "standby" | "main1" | "battle" | "main2" | "end";
export type DuelStatus = "setup" | "awaiting" | "resolving" | "ended";
export type CardPosition = "faceDownDefense" | "faceUpAttack" | "faceUpDefense" | "faceDown";
export type DuelLocation = "deck" | "hand" | "monsterZone" | "spellTrapZone" | "graveyard" | "banished" | "extraDeck";
export type DuelCardKind = "monster" | "spell" | "trap" | "extra";
export type DuelEventName = "normalSummoned" | "specialSummoned" | "activated" | "sentToGraveyard" | "phaseChanged" | "turnStarted";

export interface DuelOptions {
  seed?: string | number;
  startingLifePoints?: number;
  startingHandSize?: number;
  drawPerTurn?: number;
}

export interface DuelCardData {
  code: string;
  name: string;
  kind: DuelCardKind;
  typeFlags?: number;
  alias?: string;
  level?: number;
  attack?: number;
  defense?: number;
  setcodes?: number[];
}

export interface DuelCardInstance {
  uid: string;
  code: string;
  name: string;
  kind: DuelCardKind;
  owner: PlayerId;
  controller: PlayerId;
  location: DuelLocation;
  sequence: number;
  position: CardPosition;
  overlayUids: string[];
  faceUp: boolean;
  data: DuelCardData;
}

export interface DuelPlayerDeck {
  main: string[];
  extra?: string[];
}

export interface DuelPlayerState {
  id: PlayerId;
  lifePoints: number;
  normalSummonAvailable: boolean;
}

export interface DuelLogEntry {
  step: number;
  action: string;
  player?: PlayerId;
  card?: string;
  detail: string;
}

export interface DuelEffectDefinition {
  id: string;
  sourceUid: string;
  controller: PlayerId;
  event: "ignition" | "trigger" | "quick" | "continuous";
  triggerEvent?: DuelEventName;
  range: DuelLocation[];
  oncePerTurn?: boolean;
  canActivate?: (ctx: DuelEffectContext) => boolean;
  cost?: (ctx: DuelEffectContext) => boolean;
  target?: (ctx: DuelEffectContext) => boolean;
  operation: (ctx: DuelEffectContext) => void;
}

export interface DuelEffectContext {
  duel: DuelState;
  source: DuelCardInstance;
  player: PlayerId;
  eventCard?: DuelCardInstance;
  eventName?: DuelEventName;
  log(detail: string): void;
  moveCard(uid: string, to: DuelLocation, controller?: PlayerId): DuelCardInstance;
}

export interface ChainLink {
  id: string;
  player: PlayerId;
  sourceUid: string;
  effectId: string;
}

export interface PendingTrigger {
  id: string;
  player: PlayerId;
  sourceUid: string;
  effectId: string;
  eventName: DuelEventName;
  eventCardUid?: string;
}

export interface DuelState {
  id: string;
  seed: string;
  status: DuelStatus;
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelPhase;
  players: Record<PlayerId, DuelPlayerState>;
  cards: DuelCardInstance[];
  effects: DuelEffectDefinition[];
  chain: ChainLink[];
  chainPasses: PlayerId[];
  pendingTriggers: PendingTrigger[];
  usedCountKeys: string[];
  waitingFor?: PlayerId;
  log: DuelLogEntry[];
  options: Required<Pick<DuelOptions, "startingLifePoints" | "startingHandSize" | "drawPerTurn">>;
}

export interface DuelSession {
  state: DuelState;
  cardReader: DuelCardReader;
}

export type DuelCardReader = (code: string) => DuelCardData | undefined;

export type DuelAction =
  | { type: "normalSummon"; player: PlayerId; uid: string; label: string }
  | { type: "setSpellTrap"; player: PlayerId; uid: string; label: string }
  | { type: "activateEffect"; player: PlayerId; uid: string; effectId: string; label: string }
  | { type: "passChain"; player: PlayerId; label: string }
  | { type: "activateTrigger"; player: PlayerId; triggerId: string; uid: string; effectId: string; label: string }
  | { type: "declineTrigger"; player: PlayerId; triggerId: string; uid: string; effectId: string; label: string }
  | { type: "changePhase"; player: PlayerId; phase: DuelPhase; label: string }
  | { type: "endTurn"; player: PlayerId; label: string };

export type DuelResponse = DuelAction;

export interface PublicDuelCard {
  uid: string;
  code: string;
  name: string;
  kind: DuelCardKind;
  owner: PlayerId;
  controller: PlayerId;
  location: DuelLocation;
  sequence: number;
  position: CardPosition;
  faceUp: boolean;
  overlayCount: number;
}

export interface PublicDuelState {
  id: string;
  status: DuelStatus;
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelPhase;
  waitingFor?: PlayerId;
  players: Record<PlayerId, DuelPlayerState>;
  cards: PublicDuelCard[];
  chain: ChainLink[];
  pendingTriggers: PendingTrigger[];
  log: DuelLogEntry[];
}

export interface ApplyDuelResponseResult {
  ok: boolean;
  error?: string;
  state: PublicDuelState;
  legalActions: DuelAction[];
}

export interface SerializedDuel {
  version: 1;
  state: DuelState;
}

export interface ScriptedResponseSelector {
  type: DuelResponse["type"];
  player: PlayerId;
  code?: string;
  uid?: string;
  effectId?: string;
  triggerId?: string;
  location?: DuelLocation;
  labelIncludes?: string;
  occurrence?: number;
}

export type ScriptedDuelStep = DuelResponse | ScriptedResponseSelector;

export interface ScriptedDuelFixture {
  name: string;
  options?: DuelOptions;
  decks: Record<PlayerId, DuelPlayerDeck>;
  responses: ScriptedDuelStep[];
  expected: {
    phase?: DuelPhase;
    turn?: number;
    locations?: Partial<Record<DuelLocation, string[]>>;
    logIncludes?: string[];
  };
}
