export type PlayerId = 0 | 1;
export type DuelWinner = PlayerId | "draw";

export type DuelPhase = "draw" | "standby" | "main1" | "battle" | "main2" | "end";
export type DuelStatus = "setup" | "awaiting" | "resolving" | "ended";
export type CardPosition = "faceDownDefense" | "faceUpAttack" | "faceUpDefense" | "faceDown";
export type DuelLocation = "deck" | "hand" | "monsterZone" | "spellTrapZone" | "graveyard" | "banished" | "extraDeck" | "overlay";
export type DuelCardKind = "monster" | "spell" | "trap" | "extra";
export interface FusionMaterialPredicateRequirement {
  attribute?: number;
  attackMax?: number;
  attackMin?: number;
  location?: number;
  levelMax?: number;
  levelMin?: number;
  race?: number;
  setcode?: number;
  type?: number;
}
export type DuelSummonType = "normal" | "tribute" | "flip" | "special" | "fusion" | "synchro" | "xyz" | "link" | "ritual" | "pendulum";
export type DuelEventName =
  | "normalSummoning"
  | "normalSummonNegated"
  | "normalSummoned"
  | "flipSummoning"
  | "flipSummonNegated"
  | "specialSummoning"
  | "specialSummonNegated"
  | "specialSummoned"
  | "monsterSet"
  | "spellTrapSet"
  | "activated"
  | "moved"
  | "destroying"
  | "destroyed"
  | "becameTarget"
  | "sentToGraveyard"
  | "leftGraveyard"
  | "sentToHand"
  | "sentToDeck"
  | "released"
  | "discarded"
  | "leftField"
  | "banished"
  | "phaseChanged"
  | "phaseDraw"
  | "phaseStandby"
  | "phaseMain1"
  | "phaseBattle"
  | "phaseMain2"
  | "phaseEnd"
  | "phaseStartDraw"
  | "phaseStartStandby"
  | "phaseStartMain1"
  | "phaseStartBattle"
  | "phaseStartMain2"
  | "phaseStartEnd"
  | "turnEnded"
  | "turnStarted"
  | "startup"
  | "adjust"
  | "chainSolved"
  | "chainSolving"
  | "chainActivating"
  | "chaining"
  | "chainNegated"
  | "chainDisabled"
  | "chainEnded"
  | "breakEffect"
  | "damageDealt"
  | "recoveredLifePoints"
  | "lifePointCostPaid"
  | "detachedMaterial"
  | "returnedToGraveyard"
  | "confirmed"
  | "sentToHandConfirmed"
  | "levelChanged"
  | "counterAdded"
  | "counterRemoved"
  | "customEvent"
  | "cardsDrawn"
  | "preDraw"
  | "controlChanged"
  | "equipped"
  | "coinTossed"
  | "diceTossed"
  | "coinTossNegated"
  | "diceTossNegated"
  | "preUsedAsMaterial"
  | "usedAsMaterial"
  | "attackDeclared"
  | "battleTargeted"
  | "battleStarted"
  | "battleConfirmed"
  | "attackDisabled"
  | "battleDestroyed"
  | "beforeDamageCalculation"
  | "damageCalculating"
  | "battleEnded"
  | "afterDamageCalculation"
  | "beforeBattleDamage"
  | "battleDamageDealt"
  | "damageStepEnded"
  | "positionChanged"
  | "flipSummoned";

export interface DuelOptions {
  seed?: string | number;
  startingLifePoints?: number;
  startingHandSize?: number;
  drawPerTurn?: number;
  duelTypeFlags?: number;
}

export interface DuelCardData {
  code: string;
  name: string;
  kind: DuelCardKind;
  typeFlags?: number;
  alias?: string;
  level?: number;
  normalTributes?: number;
  normalTributeMin?: number;
  normalTributeMax?: number;
  leftScale?: number;
  rightScale?: number;
  linkMarkers?: number;
  attack?: number;
  defense?: number;
  race?: number;
  attribute?: number;
  setcodes?: number[];
  fusionMaterials?: string[];
  fusionMaterialAttackMax?: number;
  fusionMaterialAttackMin?: number;
  fusionMaterialLevel?: number;
  fusionMaterialLevelMax?: number;
  fusionMaterialLevelMin?: number;
  fusionMaterialAttribute?: number;
  fusionMaterialExcludedType?: number;
  fusionMaterialMin?: number;
  fusionMaterialMax?: number;
  fusionMaterialRace?: number;
  fusionMaterialType?: number;
  fusionMaterialSetcode?: number;
  fusionMaterialLocation?: number;
  fusionRequiredMaterialPredicates?: FusionMaterialPredicateRequirement[];
  fusionRequiredMaterialSetcodes?: number[];
  materialSetcodes?: number[];
  synchroMaterials?: {
    tuner: string;
    nonTuners: string[];
  };
  synchroTunerMin?: number;
  synchroTunerMax?: number;
  synchroTunerLevel?: number;
  synchroTunerAttribute?: number;
  synchroTunerRace?: number;
  synchroTunerType?: number;
  synchroTunerSetcode?: number;
  handSynchroMaterialSetcode?: number;
  handSynchroMaterialCount?: number;
  synchroNonTunerMin?: number;
  synchroNonTunerMax?: number;
  synchroNonTunerAttribute?: number;
  synchroNonTunerRace?: number;
  synchroNonTunerType?: number;
  synchroNonTunerSetcode?: number;
  xyzMaterials?: string[];
  xyzMaterialCount?: number;
  xyzMaterialMax?: number;
  xyzMaterialRace?: number;
  xyzMaterialAttribute?: number;
  xyzMaterialType?: number;
  xyzMaterialSetcode?: number;
  xyzMaterialRank?: number;
  linkMaterials?: string[];
  linkMaterialMin?: number;
  linkMaterialMax?: number;
  linkMaterialType?: number;
  linkMaterialRace?: number;
  linkMaterialAttribute?: number;
  linkMaterialSetcode?: number;
  linkMaterialSummonType?: number;
  linkMaterialLevel?: number;
  linkMaterialMinLevel?: number;
  ritualMaterials?: string[];
  listedNames?: string[];
  fitMonster?: string[];
}

export interface DuelCardCounterBuckets {
  permanent?: number;
  resetWhileNegated?: number;
}

export interface DuelCardInstance {
  uid: string;
  code: string;
  name: string;
  kind: DuelCardKind;
  fieldId?: number;
  owner: PlayerId;
  controller: PlayerId;
  location: DuelLocation;
  sequence: number;
  position: CardPosition;
  overlayUids: string[];
  counters?: Record<number, number>;
  counterBuckets?: Record<number, DuelCardCounterBuckets>;
  faceUp: boolean;
  previousLocation?: DuelLocation;
  previousController?: PlayerId;
  previousSequence?: number;
  previousPosition?: CardPosition;
  previousFaceUp?: boolean;
  previousCodes?: string[];
  previousSetcodes?: number[];
  previousTypeFlags?: number;
  previousAttack?: number;
  previousDefense?: number;
  previousLevel?: number;
  previousRank?: number;
  previousLink?: number;
  previousRace?: number;
  previousAttribute?: number;
  battlePosition?: CardPosition;
  equippedToUid?: string;
  previousEquippedToUid?: string;
  reason?: number;
  reasonPlayer?: PlayerId;
  reasonCardUid?: string;
  reasonEffectId?: number;
  cancelToGrave?: boolean;
  customStatusMask?: number;
  effectRelationIds?: number[];
  cardTargetUids?: string[];
  turnId?: number;
  turnCounter?: number;
  summonType?: DuelSummonType;
  summonTypeCode?: number;
  summonPlayer?: PlayerId;
  summonPhase?: DuelPhase;
  summonMaterialUids?: string[];
  attackModifier?: number;
  defenseModifier?: number;
  levelModifier?: number;
  rankModifier?: number;
  linkModifier?: number;
  scaleModifier?: number;
  assumedProperties?: Record<number, number>;
  uniqueOnField?: {
    self: boolean;
    opponent: boolean;
    code: number;
    locationMask: number;
  };
  data: DuelCardData;
}

export interface DuelEventCardState {
  controller: PlayerId;
  location: DuelLocation;
  sequence: number;
  position: CardPosition;
  faceUp: boolean;
}

export interface DuelPlayerDeck {
  main: string[];
  extra?: string[];
}

export interface DuelPlayerState {
  id: PlayerId;
  lifePoints: number;
  normalSummonAvailable: boolean;
  pendulumSummonAvailable: boolean;
  extraPendulumSummons?: number;
  extraPendulumSummonGrants?: ExtraPendulumSummonGrant[];
  initialMainDeckSize?: number;
}

export interface ExtraPendulumSummonGrant {
  locationMask?: number;
  scalePlayer?: PlayerId;
  scaleAlternatives?: ExtraPendulumSummonGrantScaleAlternative[];
  setcode?: number;
}

export interface ExtraPendulumSummonGrantScaleAlternative {
  locationMask?: number;
  scalePlayer: PlayerId;
}

export interface DuelActivityCounts {
  summon: number;
  normalSummon: number;
  specialSummon: number;
  flipSummon: number;
  attack: number;
}

export interface DuelActivityRecord {
  player: PlayerId;
  activity: number;
  cardUid?: string;
  effectId?: string;
}

export interface DuelLogEntry {
  step: number;
  action: string;
  player?: PlayerId;
  card?: string;
  detail: string;
}

export interface SkippedDuelPhase {
  player: PlayerId;
  phase: DuelPhase;
  remaining: number;
}

export interface DuelEffectDefinition {
  id: string;
  sourceUid: string;
  controller: PlayerId;
  ownerPlayer?: PlayerId;
  registryKey?: string;
  event: "ignition" | "trigger" | "quick" | "continuous" | "summonProcedure";
  luaTypeFlags?: number;
  code?: number;
  value?: number;
  luaConditionDescriptor?: string;
  luaCostDescriptor?: string;
  luaValueDescriptor?: string;
  luaTargetDescriptor?: string;
  triggerEvent?: DuelEventName;
  triggerCode?: number;
  triggerSourceOnly?: boolean;
  triggerTiming?: "if" | "when";
  optional?: boolean;
  range: DuelLocation[];
  oncePerTurn?: boolean;
  countLimit?: number;
  countLimitCode?: number;
  reset?: {
    flags: number;
    count?: number;
  };
  label?: number;
  labels?: number[];
  labelObjectId?: number;
  description?: number;
  category?: number;
  property?: number;
  copyId?: number;
  targetRange?: [number, number?];
  hintTiming?: [number, number?];
  battleDamageValue?: (ctx: DuelEffectContext, player: PlayerId, amount: number) => number | undefined;
  forceMonsterZoneValue?: (ctx: DuelEffectContext, forcePlayer: PlayerId, reason: number) => number | undefined;
  lifePointValue?: (ctx: DuelEffectContext, player: PlayerId, amount: number) => number | undefined;
  statValue?: (ctx: DuelEffectContext, card: DuelCardInstance) => number | undefined;
  valueCardPredicate?: (ctx: DuelEffectContext, card: DuelCardInstance) => boolean;
  targetCardPredicate?: (ctx: DuelEffectContext, card: DuelCardInstance) => boolean;
  valuePredicate?: (ctx: DuelEffectContext, reasonPlayer?: PlayerId) => boolean;
  canActivate?: (ctx: DuelEffectContext) => boolean;
  cost?: (ctx: DuelEffectContext) => boolean;
  target?: (ctx: DuelEffectContext) => boolean;
  labelObjectUid?: string;
  labelObjectUids?: string[];
  operation: (ctx: DuelEffectContext) => void;
  promptOperation?: (ctx: DuelEffectContext) => unknown;
}

export interface ChainLimit {
  registryKey?: string;
  expiresAtChainLength?: number;
  untilChainEnd: boolean;
  allows(effect: DuelEffectDefinition, player: PlayerId, chainPlayer: PlayerId): boolean;
  release?: () => void;
}

export type SerializedDuelEffect = Omit<
  DuelEffectDefinition,
  "battleDamageValue" | "canActivate" | "cost" | "forceMonsterZoneValue" | "lifePointValue" | "luaTypeFlags" | "operation" | "promptOperation" | "statValue" | "target" | "targetCardPredicate" | "valueCardPredicate" | "valuePredicate"
>;
export type SerializedChainLimit = Omit<ChainLimit, "allows" | "release">;

export interface DuelEffectContext {
  duel: DuelState;
  source: DuelCardInstance;
  player: PlayerId;
  activationLocation?: DuelLocation;
  activationSequence?: number;
  eventCard?: DuelCardInstance;
  eventName?: DuelEventName;
  eventCode?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventDestination?: DuelLocation;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  evaluatingStatEffectId?: string;
  summonTypeCode?: number;
  summonPosition?: CardPosition;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  checkOnly?: boolean;
  targetUids: string[];
  operationInfos?: DuelOperationInfo[];
  possibleOperationInfos?: DuelOperationInfo[];
  targetPlayer?: PlayerId;
  targetParam?: number;
  effectLabel?: number;
  effectLabels?: number[];
  effectLabelObjectId?: number;
  effectLabelObjectUid?: string;
  effectLabelObjectUids?: string[];
  chainLink?: ChainLink;
  log(detail: string): void;
  moveCard(uid: string, to: DuelLocation, controller?: PlayerId): DuelCardInstance;
  negateChainLink(chainLinkId: string): boolean;
  setTargets(uids: string[]): void;
  getTargets(): DuelCardInstance[];
  setTargetPlayer(player: PlayerId): void;
  setTargetParam(parameter: number): void;
}

export interface DuelOperationInfo {
  category: number;
  targetUids: string[];
  count: number;
  player: PlayerId;
  parameter: number;
}

export interface ChainLink {
  id: string;
  chainIndex?: number;
  player: PlayerId;
  sourceUid: string;
  effectId: string;
  activationLocation?: DuelLocation;
  activationSequence?: number;
  eventName?: DuelEventName;
  eventCode?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  eventCardUid?: string;
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
  eventTriggerTiming?: TriggerTiming;
  targetUids?: string[];
  operationInfos?: DuelOperationInfo[];
  possibleOperationInfos?: DuelOperationInfo[];
  targetPlayer?: PlayerId;
  targetParam?: number;
  effectLabel?: number;
  effectLabels?: number[];
  effectLabelObjectId?: number;
  effectLabelObjectUid?: string;
  effectLabelObjectUids?: string[];
  negated?: boolean;
  disableReason?: number;
  disablePlayer?: PlayerId;
  operationOverrideRegistryKey?: string;
  operationOverride?: (ctx: DuelEffectContext) => void;
}

export type PublicChainLink = Omit<ChainLink, "operationOverride">;

export interface LuaOperationPromptState {
  chainLink: PublicChainLink;
  prompt: import("#lua/host-types.js").LuaPromptDecision;
}

export type TriggerBucket = "turnMandatory" | "opponentMandatory" | "turnOptional" | "opponentOptional";
export type TriggerTiming = "if" | "when";

export interface PendingTrigger {
  id: string;
  player: PlayerId;
  sourceUid: string;
  effectId: string;
  eventName: DuelEventName;
  triggerBucket: TriggerBucket;
  eventCode?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  eventCardUid?: string;
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
  eventTriggerTiming?: TriggerTiming;
  effectLabelObjectUid?: string;
  effectLabelObjectUids?: string[];
}

export interface PendingTriggerBucketState {
  triggerBucket: TriggerBucket;
  player: PlayerId;
  triggerIds: string[];
}

export interface TriggerOrderPromptState {
  id: string;
  type: "orderTriggers";
  player: PlayerId;
  triggerBucket: TriggerBucket;
  triggerIds: string[];
}

export interface DuelEventRecord {
  eventName: DuelEventName;
  eventCode?: number;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  eventCardUid?: string;
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
}

export interface DuelFlagEffect {
  ownerType: "player" | "card";
  ownerId: string;
  code: number;
  reset: number;
  resetCount?: number;
  property: number;
  value: number;
  turn: number;
}

export type DuelPromptState =
  | { id: string; type: "selectOption"; player: PlayerId; options: number[]; descriptions?: number[]; descriptionLists?: number[][]; returnTo?: PlayerId; origin?: "luaOperation" }
  | { id: string; type: "selectYesNo"; player: PlayerId; description?: number; returnTo?: PlayerId; origin?: "luaOperation" };

export type BattleStep = "attack" | "damage" | "damageCalculation";
export type BattleWindowKind =
  | "attackDeclaration"
  | "attackTargetConfirmation"
  | "attackNegationResponse"
  | "replayDecision"
  | "startDamageStep"
  | "beforeDamageCalculation"
  | "duringDamageCalculation"
  | "afterDamageCalculation"
  | "endDamageStep";

export interface BattleWindowState {
  id: number;
  kind: BattleWindowKind;
  step: BattleStep;
  attackerUid: string;
  targetUid?: string;
  responsePlayer: PlayerId;
  attackNegated: boolean;
}

export interface DuelBattlePair {
  attackerUid: string;
  targetUid: string;
}

export interface DuelState {
  id: string;
  seed: string;
  actionWindowId: number;
  actionWindowToken: string;
  status: DuelStatus;
  winner?: DuelWinner;
  winReason?: number;
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelPhase;
  randomCounter: number;
  lastDiceResults: number[];
  lastCoinResults: number[];
  players: Record<PlayerId, DuelPlayerState>;
  cards: DuelCardInstance[];
  effects: DuelEffectDefinition[];
  chain: ChainLink[];
  chainLimits: ChainLimit[];
  chainPasses: PlayerId[];
  pendingTriggers: PendingTrigger[];
  eventHistory: DuelEventRecord[];
  usedCountKeys: string[];
  flagEffects: DuelFlagEffect[];
  duelTypeFlags: number;
  globalFlags: number;
  unofficialProcEnabled: boolean;
  shuffleCheckDisabled: boolean;
  skippedPhases: SkippedDuelPhase[];
  phaseActivity: boolean;
  activityCounts: Record<PlayerId, DuelActivityCounts>;
  activityHistory: DuelActivityRecord[];
  battleDamage: Record<PlayerId, number>;
  attackCostPaid: number;
  attacksDeclared: string[];
  attackCanceledUids: string[];
  attackedTargetUids: string[];
  battlePairs: DuelBattlePair[];
  attackPasses: PlayerId[];
  damagePasses: PlayerId[];
  battleStep?: BattleStep;
  battleWindow?: BattleWindowState;
  positionsChanged: string[];
  currentAttack?: {
    attackerUid: string;
    targetUid?: string;
    replayTargetCount?: number;
    replayTargetUids?: string[];
  };
  pendingBattle?: {
    attackerUid: string;
    targetUid?: string;
    replayTargetCount?: number;
    replayTargetUids?: string[];
    replayPending?: boolean;
    battleDamageOverrides?: Partial<Record<PlayerId, number>>;
    resultApplied?: boolean;
    damageApplied?: boolean;
    deferredBattleDestroyed?: {
      uid: string;
      reasonPlayer: PlayerId;
      reasonCardUid: string;
    }[];
  };
  prompt?: DuelPromptState;
  luaOperationPrompt?: LuaOperationPromptState;
  waitingFor?: PlayerId;
  log: DuelLogEntry[];
  options: Required<Pick<DuelOptions, "startingLifePoints" | "startingHandSize" | "drawPerTurn">>;
}

export interface DuelSession {
  state: DuelState;
  cardReader: DuelCardReader;
}

export type DuelCardReader = (code: string) => DuelCardData | undefined;

export type DuelAction = (
  | { type: "normalSummon"; player: PlayerId; uid: string; label: string }
  | { type: "tributeSummon"; player: PlayerId; uid: string; tributeUids: string[]; effectId?: string; label: string }
  | { type: "tributeSet"; player: PlayerId; uid: string; tributeUids: string[]; label: string }
  | { type: "fusionSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "synchroSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "xyzSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "linkSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "ritualSummon"; player: PlayerId; uid: string; materialUids: string[]; label: string }
  | { type: "pendulumSummon"; player: PlayerId; summonUids: string[]; maxSummons: number; label: string }
  | { type: "setMonster"; player: PlayerId; uid: string; label: string }
  | { type: "setSpellTrap"; player: PlayerId; uid: string; label: string }
  | { type: "activateEffect"; player: PlayerId; uid: string; effectId: string; label: string }
  | { type: "specialSummonProcedure"; player: PlayerId; uid: string; effectId: string; label: string }
  | { type: "passChain"; player: PlayerId; label: string }
  | { type: "passAttack"; player: PlayerId; label: string }
  | { type: "passDamage"; player: PlayerId; label: string }
  | { type: "replayAttack"; player: PlayerId; attackerUid: string; targetUid?: string; directAttack?: true; label: string }
  | { type: "cancelAttack"; player: PlayerId; attackerUid: string; label: string }
  | { type: "selectOption"; player: PlayerId; promptId: string; option: number; label: string }
  | { type: "selectYesNo"; player: PlayerId; promptId: string; yes: boolean; label: string }
  | { type: "activateTrigger"; player: PlayerId; triggerId: string; triggerBucket: TriggerBucket; uid: string; effectId: string; label: string }
  | { type: "declineTrigger"; player: PlayerId; triggerId: string; triggerBucket: TriggerBucket; uid: string; effectId: string; label: string }
  | { type: "flipSummon"; player: PlayerId; uid: string; label: string }
  | { type: "changePosition"; player: PlayerId; uid: string; position: CardPosition; label: string }
  | { type: "declareAttack"; player: PlayerId; attackerUid: string; targetUid?: string; directAttack?: true; label: string }
  | { type: "changePhase"; player: PlayerId; phase: DuelPhase; label: string }
  | { type: "endTurn"; player: PlayerId; label: string }
) & { windowId?: number; windowKind?: DuelActionWindowKind; windowToken?: string };

export type DuelResponse = DuelAction;

export type DuelActionWindowKind = "prompt" | "chainResponse" | "triggerBucket" | "battle" | "open";

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
  counters?: Record<number, number>;
  revealedToPlayers?: PlayerId[];
}

export type ScriptedDuelCardExpectation = Partial<PublicDuelCard & Pick<DuelCardInstance, "reason" | "reasonPlayer" | "reasonCardUid" | "reasonEffectId">> & Pick<PublicDuelCard, "uid">;

export interface PublicDuelState {
  id: string;
  status: DuelStatus;
  winner?: DuelWinner;
  winReason?: number;
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelPhase;
  waitingFor?: PlayerId;
  actionWindowId: number;
  actionWindowToken: string;
  windowKind?: DuelActionWindowKind;
  prompt?: DuelPromptState;
  luaOperationPrompt?: LuaOperationPromptState;
  triggerOrderPrompt?: TriggerOrderPromptState;
  players: Record<PlayerId, DuelPlayerState>;
  cards: PublicDuelCard[];
  chain: PublicChainLink[];
  pendingTriggers: PendingTrigger[];
  pendingTriggerBuckets: PendingTriggerBucketState[];
  activityCounts: Record<PlayerId, DuelActivityCounts>;
  attacksDeclared: string[];
  attackCanceledUids: string[];
  attackedTargetUids: string[];
  battlePairs: DuelBattlePair[];
  attackPasses: PlayerId[];
  damagePasses: PlayerId[];
  battleStep?: BattleStep;
  battleWindow?: BattleWindowState;
  positionsChanged: string[];
  log: DuelLogEntry[];
}

export interface ApplyDuelResponseResult {
  ok: boolean;
  error?: string;
  state: PublicDuelState;
  legalActions: DuelAction[];
  legalActionGroups: import("#duel/legal-action-groups.js").DuelLegalActionGroup[];
}

export interface ScriptedDuelRunResult extends ApplyDuelResponseResult {
  failedStep?: number;
  failure?: string;
  divergencePlayer?: PlayerId;
  divergenceWindowId?: number;
  divergenceWindowKind?: DuelActionWindowKind;
  divergenceWindowToken?: string;
  divergenceGroupKey?: string;
  divergenceGroupLabel?: string;
  divergenceActions?: DuelAction[];
}

export interface SerializedDuel {
  version: 1;
  state: Omit<DuelState, "chain" | "chainLimits" | "effects"> & {
    chain: PublicChainLink[];
    chainLimits: SerializedChainLimit[];
    effects: SerializedDuelEffect[];
    pendingTriggerBuckets?: PendingTriggerBucketState[];
  };
}

export interface ScriptedResponseSelector {
  type: DuelResponse["type"];
  player: PlayerId;
  windowId?: number;
  windowKind?: DuelActionWindowKind;
  windowToken?: string;
  code?: string;
  uid?: string;
  tributeUids?: string[];
  materialUids?: string[];
  summonUids?: string[];
  position?: CardPosition;
  phase?: DuelPhase;
  attackerUid?: string;
  targetUid?: string;
  directAttack?: boolean;
  promptId?: string;
  option?: number;
  yes?: boolean;
  effectId?: string;
  triggerId?: string;
  triggerBucket?: TriggerBucket;
  location?: DuelLocation;
  labelIncludes?: string;
  occurrence?: number;
}

export interface ScriptedLegalActionExpectation extends ScriptedResponseSelector {
  count?: number;
}

export interface ScriptedLegalActionGroupExpectation {
  player: PlayerId;
  key?: string;
  label?: string;
  windowId?: number;
  windowKind?: DuelActionWindowKind;
  windowToken?: string;
  triggerBucket?: Partial<PendingTriggerBucketState>;
  triggerOrderPrompt?: Partial<TriggerOrderPromptState> | null;
  count?: number;
  actions?: ScriptedLegalActionExpectation[];
}

interface ScriptedDuelWindowExpectationFields {
  note?: string;
  status?: DuelStatus;
  winner?: DuelWinner | null;
  winReason?: number | null;
  windowId?: number;
  windowKind?: DuelActionWindowKind;
  waitingFor?: PlayerId;
  turn?: number;
  turnPlayer?: PlayerId;
  phase?: DuelPhase;
  randomCounter?: number;
  lastDiceResults?: number[];
  lastCoinResults?: number[];
  lifePoints?: Partial<Record<PlayerId, number>>;
  activityCounts?: Partial<Record<PlayerId, Partial<DuelActivityCounts>>>;
  activityHistory?: Array<Partial<DuelActivityRecord>>;
  skippedPhases?: SkippedDuelPhase[];
  phaseActivity?: boolean;
  battleDamage?: Partial<Record<PlayerId, number>>;
  attackCostPaid?: number;
  options?: Partial<DuelState["options"]>;
  duelTypeFlags?: number;
  globalFlags?: number;
  unofficialProcEnabled?: boolean;
  shuffleCheckDisabled?: boolean;
  usedCountKeys?: string[];
  battleStep?: BattleStep;
  battleWindow?: Partial<BattleWindowState> | null;
  pendingBattle?: boolean;
  currentAttack?: boolean;
  chainLimits?: Array<Partial<Pick<ChainLimit, "registryKey" | "untilChainEnd" | "expiresAtChainLength">>>;
  chainPasses?: PlayerId[];
  attackPasses?: PlayerId[];
  damagePasses?: PlayerId[];
  chain?: Array<Partial<Pick<ChainLink, "id" | "player" | "sourceUid" | "effectId" | "eventName" | "eventCode" | "eventPlayer" | "eventValue" | "eventReason" | "eventReasonPlayer" | "eventReasonCardUid" | "eventReasonEffectId" | "relatedEffectId" | "eventChainDepth" | "eventChainLinkId" | "eventUids" | "eventCardUid" | "eventPreviousState" | "eventCurrentState" | "eventTriggerTiming" | "effectLabels" | "effectLabelObjectUid" | "effectLabelObjectUids">>>;
  pendingTriggers?: Array<Partial<Pick<PendingTrigger, "id" | "player" | "sourceUid" | "effectId" | "eventName" | "triggerBucket" | "eventCode" | "eventPlayer" | "eventValue" | "eventReason" | "eventReasonPlayer" | "eventReasonCardUid" | "eventReasonEffectId" | "relatedEffectId" | "eventChainDepth" | "eventChainLinkId" | "eventUids" | "eventCardUid" | "eventPreviousState" | "eventCurrentState" | "eventTriggerTiming" | "effectLabelObjectUid" | "effectLabelObjectUids">>>;
  pendingTriggerBuckets?: Array<Partial<PendingTriggerBucketState>>;
  eventHistory?: Array<Partial<Pick<DuelEventRecord, "eventName" | "eventCode" | "eventPlayer" | "eventValue" | "eventReason" | "eventReasonPlayer" | "eventReasonCardUid" | "eventReasonEffectId" | "relatedEffectId" | "eventChainDepth" | "eventChainLinkId" | "eventUids" | "eventCardUid" | "eventPreviousState" | "eventCurrentState">>>;
  prompt?: Partial<DuelPromptState> | null;
  triggerOrderPrompt?: Partial<TriggerOrderPromptState> | null;
  legalActionCounts?: Partial<Record<PlayerId, number>>;
  legalActionGroupCounts?: Partial<Record<PlayerId, number>>;
  legalActions?: ScriptedLegalActionExpectation[];
  legalActionGroups?: ScriptedLegalActionGroupExpectation[];
  absentLegalActions?: ScriptedLegalActionExpectation[];
  absentLegalActionGroups?: ScriptedLegalActionGroupExpectation[];
  locations?: Partial<Record<DuelLocation, string[]>>;
  locationCounts?: Partial<Record<DuelLocation, Record<string, number>>>;
  cards?: ScriptedDuelCardExpectation[];
  positionsChanged?: string[];
  attacksDeclared?: string[];
  attackCanceledUids?: string[];
  attackedTargetUids?: string[];
  battlePairs?: DuelBattlePair[];
  logCount?: number;
  log?: Array<Partial<DuelLogEntry>>;
  logIncludes?: string[];
}

export type ScriptedDuelWindowExpectation = ScriptedDuelWindowExpectationFields & (
  | { source: "edopro"; note?: string }
  | { source: "parity-backlog"; note: string }
);

export interface ScriptedDuelStepWithAssertions {
  response: DuelResponse | ScriptedResponseSelector;
  before?: ScriptedDuelWindowExpectation;
  after?: ScriptedDuelWindowExpectation;
  snapshotRestore?: boolean | "before" | "after" | "both";
}

export type ScriptedDuelStep = ScriptedDuelStepWithAssertions;

export interface ScriptedFixtureMove {
  player: PlayerId;
  code: string;
  from?: DuelLocation;
  to: DuelLocation;
  controller?: PlayerId;
  position?: CardPosition;
  occurrence?: number;
  moveReason?: number;
  moveReasonPlayer?: PlayerId;
  collectEvent?: DuelEventName;
  eventCode?: number;
  eventIsLast?: boolean;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
}

export interface ScriptedFixtureDraw {
  player: PlayerId;
  count: number;
  detail?: string;
  eventIsLast?: boolean;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
}

export interface ScriptedFixtureLifePointChange {
  player: PlayerId;
  amount: number;
  eventIsLast?: boolean;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
}

export interface ScriptedFixtureCardSelector {
  player: PlayerId;
  code: string;
  location?: DuelLocation;
  occurrence?: number;
}

export interface ScriptedFixtureEvent {
  collectEvent: DuelEventName;
  eventCard?: ScriptedFixtureCardSelector;
  eventCode?: number;
  eventIsLast?: boolean;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventChainDepth?: number;
  eventChainLinkId?: string;
  eventUids?: string[];
  eventPreviousState?: DuelEventCardState;
  eventCurrentState?: DuelEventCardState;
}

export interface ScriptedFixtureEffect {
  id: string;
  player: PlayerId;
  code: string;
  location?: DuelLocation;
  event: DuelEffectDefinition["event"];
  effectCode?: number;
  luaTypeFlags?: number;
  value?: number;
  valueCardCode?: string;
  targetCardCode?: string;
  targetRange?: DuelEffectDefinition["targetRange"];
  triggerEvent?: DuelEventName;
  triggerCode?: number;
  triggerTiming?: DuelEffectDefinition["triggerTiming"];
  eventCardCode?: string;
  optional?: boolean;
  range: DuelLocation[];
  oncePerTurn?: boolean;
  property?: number;
  activationChain?: "open" | "chain";
  logMessage?: string;
  negateChainEffectOnResolve?: string;
  negateAttackOnResolve?: boolean;
  negateSummonOnResolve?: {
    player: PlayerId;
    code: string;
    location?: DuelLocation;
    occurrence?: number;
  };
  chainLimitOnTarget?: {
    untilChainEnd: boolean;
    allowPlayer?: PlayerId;
  };
  targetCardsOnActivation?: ScriptedFixtureCardSelector[];
  collectEventsOnResolve?: ScriptedFixtureEvent[];
  drawCardsOnResolve?: ScriptedFixtureDraw[];
  damagePlayerOnResolve?: ScriptedFixtureLifePointChange[];
  recoverPlayerOnResolve?: ScriptedFixtureLifePointChange[];
  moveCardsOnResolve?: ScriptedFixtureMove[];
  occurrence?: number;
}

export interface ScriptedDuelFixture {
  name: string;
  options?: DuelOptions;
  decks: Record<PlayerId, DuelPlayerDeck>;
  setup?: {
    moveCards?: ScriptedFixtureMove[];
    effects?: ScriptedFixtureEffect[];
    collectEvents?: ScriptedFixtureEvent[];
    prompt?: DuelPromptState;
  };
  before?: ScriptedDuelWindowExpectation;
  responses: ScriptedDuelStep[];
  expected: ScriptedDuelWindowExpectation;
}
