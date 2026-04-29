export type PlayerId = 0 | 1;

export type DuelPhase = "draw" | "standby" | "main1" | "battle" | "main2" | "end";
export type DuelStatus = "setup" | "awaiting" | "resolving" | "ended";
export type CardPosition = "faceDownDefense" | "faceUpAttack" | "faceUpDefense" | "faceDown";
export type DuelLocation = "deck" | "hand" | "monsterZone" | "spellTrapZone" | "graveyard" | "banished" | "extraDeck" | "overlay";
export type DuelCardKind = "monster" | "spell" | "trap" | "extra";
export type DuelSummonType = "normal" | "tribute" | "flip" | "special" | "fusion" | "synchro" | "xyz" | "link" | "ritual";
export type DuelEventName =
  | "normalSummoned"
  | "specialSummoned"
  | "activated"
  | "sentToGraveyard"
  | "banished"
  | "phaseChanged"
  | "turnStarted"
  | "attackDeclared"
  | "battleDestroyed"
  | "positionChanged"
  | "flipSummoned";

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
  linkMarkers?: number;
  attack?: number;
  defense?: number;
  race?: number;
  attribute?: number;
  setcodes?: number[];
  fusionMaterials?: string[];
  synchroMaterials?: {
    tuner: string;
    nonTuners: string[];
  };
  xyzMaterials?: string[];
  linkMaterials?: string[];
  ritualMaterials?: string[];
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
  previousLocation?: DuelLocation;
  previousController?: PlayerId;
  previousSequence?: number;
  previousPosition?: CardPosition;
  previousFaceUp?: boolean;
  reason?: number;
  summonType?: DuelSummonType;
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

export interface DuelActivityCounts {
  summon: number;
  normalSummon: number;
  specialSummon: number;
  flipSummon: number;
  attack: number;
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
  ownerPlayer?: PlayerId;
  event: "ignition" | "trigger" | "quick" | "continuous" | "summonProcedure";
  triggerEvent?: DuelEventName;
  range: DuelLocation[];
  oncePerTurn?: boolean;
  countLimit?: number;
  countLimitCode?: number;
  reset?: {
    flags: number;
    count?: number;
  };
  description?: number;
  category?: number;
  property?: number;
  targetRange?: [number, number?];
  hintTiming?: [number, number?];
  canActivate?: (ctx: DuelEffectContext) => boolean;
  cost?: (ctx: DuelEffectContext) => boolean;
  target?: (ctx: DuelEffectContext) => boolean;
  operation: (ctx: DuelEffectContext) => void;
}

export interface DuelEffectContext {
  duel: DuelState;
  source: DuelCardInstance;
  player: PlayerId;
  activationLocation?: DuelLocation;
  activationSequence?: number;
  eventCard?: DuelCardInstance;
  eventName?: DuelEventName;
  checkOnly?: boolean;
  targetUids: string[];
  log(detail: string): void;
  moveCard(uid: string, to: DuelLocation, controller?: PlayerId): DuelCardInstance;
  negateChainLink(chainLinkId: string): boolean;
  setTargets(uids: string[]): void;
  getTargets(): DuelCardInstance[];
}

export interface ChainLink {
  id: string;
  player: PlayerId;
  sourceUid: string;
  effectId: string;
  activationLocation?: DuelLocation;
  activationSequence?: number;
  eventName?: DuelEventName;
  eventCardUid?: string;
  targetUids?: string[];
  negated?: boolean;
}

export interface PendingTrigger {
  id: string;
  player: PlayerId;
  sourceUid: string;
  effectId: string;
  eventName: DuelEventName;
  eventCardUid?: string;
}

export interface DuelFlagEffect {
  ownerType: "player" | "card";
  ownerId: string;
  code: number;
  reset: number;
  property: number;
  value: number;
  turn: number;
}

export type DuelPromptState =
  | { id: string; type: "selectOption"; player: PlayerId; options: number[]; returnTo?: PlayerId }
  | { id: string; type: "selectYesNo"; player: PlayerId; description?: number; returnTo?: PlayerId };

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
  flagEffects: DuelFlagEffect[];
  activityCounts: Record<PlayerId, DuelActivityCounts>;
  attacksDeclared: string[];
  positionsChanged: string[];
  currentAttack?: {
    attackerUid: string;
    targetUid?: string;
  };
  prompt?: DuelPromptState;
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
  | { type: "tributeSummon"; player: PlayerId; uid: string; tributeUids: string[]; label: string }
  | { type: "fusionSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "synchroSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "xyzSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "linkSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "ritualSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "setMonster"; player: PlayerId; uid: string; label: string }
  | { type: "setSpellTrap"; player: PlayerId; uid: string; label: string }
  | { type: "activateEffect"; player: PlayerId; uid: string; effectId: string; label: string }
  | { type: "specialSummonProcedure"; player: PlayerId; uid: string; effectId: string; label: string }
  | { type: "passChain"; player: PlayerId; label: string }
  | { type: "selectOption"; player: PlayerId; promptId: string; option: number; label: string }
  | { type: "selectYesNo"; player: PlayerId; promptId: string; yes: boolean; label: string }
  | { type: "activateTrigger"; player: PlayerId; triggerId: string; uid: string; effectId: string; label: string }
  | { type: "declineTrigger"; player: PlayerId; triggerId: string; uid: string; effectId: string; label: string }
  | { type: "flipSummon"; player: PlayerId; uid: string; label: string }
  | { type: "changePosition"; player: PlayerId; uid: string; position: CardPosition; label: string }
  | { type: "declareAttack"; player: PlayerId; attackerUid: string; targetUid?: string; label: string }
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
  prompt?: DuelPromptState;
  players: Record<PlayerId, DuelPlayerState>;
  cards: PublicDuelCard[];
  chain: ChainLink[];
  pendingTriggers: PendingTrigger[];
  activityCounts: Record<PlayerId, DuelActivityCounts>;
  attacksDeclared: string[];
  positionsChanged: string[];
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
  tributeUids?: string[];
  materialUids?: string[];
  position?: CardPosition;
  attackerUid?: string;
  targetUid?: string;
  promptId?: string;
  option?: number;
  yes?: boolean;
  effectId?: string;
  triggerId?: string;
  location?: DuelLocation;
  labelIncludes?: string;
  occurrence?: number;
}

export type ScriptedDuelStep = DuelResponse | ScriptedResponseSelector;

export interface ScriptedFixtureMove {
  player: PlayerId;
  code: string;
  from?: DuelLocation;
  to: DuelLocation;
  controller?: PlayerId;
  occurrence?: number;
}

export interface ScriptedDuelFixture {
  name: string;
  options?: DuelOptions;
  decks: Record<PlayerId, DuelPlayerDeck>;
  setup?: {
    moveCards?: ScriptedFixtureMove[];
  };
  responses: ScriptedDuelStep[];
  expected: {
    phase?: DuelPhase;
    turn?: number;
    locations?: Partial<Record<DuelLocation, string[]>>;
    logIncludes?: string[];
  };
}
