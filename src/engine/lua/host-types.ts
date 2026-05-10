import type { ChainLimit, DuelEffectContext, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaDuelOperationInfo } from "#lua/duel-api/operation.js";

export interface LuaScriptLoadResult {
  ok: boolean;
  error?: string;
  name: string;
}

export interface LuaScriptHost {
  readonly messages: string[];
  loadScript(code: string, name: string): LuaScriptLoadResult;
  loadCardScript(cardCode: string | number, source: LuaScriptSource): LuaScriptLoadResult;
  registerInitialEffects(): number;
  registerInitialEffectsDetailed(): LuaInitialEffectRegistrationResult[];
  runStartupEffects(): number;
  restoreChainLimit(key: string, limit: ChainLimit): ChainLimit | undefined;
  getGlobalString(name: string): string | undefined;
  getGlobalNumber(name: string): number | undefined;
}

export interface LuaInitialEffectRegistrationResult {
  code: string;
  uid: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export interface LuaScriptSource {
  readScript(name: string): string | undefined;
}

export interface LuaEffectRecord {
  id: number;
  typeFlags: number;
  sourceUid?: string;
  isGlobal?: boolean;
  ownerPlayer?: PlayerId;
  code?: number;
  range?: DuelLocation[];
  countLimit?: number;
  description?: number;
  category?: number;
  property?: number;
  copyId?: number;
  targetRange?: [number, number?];
  hintTiming?: [number, number?];
  countLimitCode?: number;
  reset?: {
    flags: number;
    count?: number;
  };
  label?: number;
  labelObjectUid?: string;
  labelObjectUids?: string[];
  labelObjectId?: number;
  labelObjectRef?: number;
  value?: number;
  valueDescriptor?: string;
  valueRef?: number;
  conditionDescriptor?: string;
  targetDescriptor?: string;
  conditionRef?: number;
  costRef?: number;
  targetRef?: number;
  operationRef?: number;
  tableRef?: number;
}

export interface LuaHostState {
  session: DuelSession;
  nextEffectId: number;
  nextCopyId: number;
  effects: Map<number, LuaEffectRecord>;
  functionDescriptors: Map<number, string>;
  usedEffectCounts: Map<string, number>;
  messages: string[];
  activeTargetUids: string[] | undefined;
  activeLuaEffectId: number | undefined;
  activeContext: DuelEffectContext | undefined;
  activeOperationTriggerStart: number | undefined;
  activeOperationMoved: boolean;
  operationInfos: LuaDuelOperationInfo[];
  possibleOperationInfos: LuaDuelOperationInfo[];
  operatedUids: string[];
  summonNegatedUids: string[];
  selectedUids: string[];
  fusionMaterialUids: string[];
  scriptSource: LuaScriptSource | undefined;
  loadedScripts: Set<string>;
  loadedScriptBodies: Map<string, string>;
  currentScriptCardCode: string | undefined;
  pushEffectTable: (state: unknown, id: number) => void;
  getEffectTypeFlags: (id: number) => number | undefined;
  majesticCopy: (state: unknown, receiverUid: string, sourceUid: string, reset?: number) => number;
  changeChainOperation: (state: unknown, chainIndex: number, operationRef: number) => boolean;
  registerEffect: (state: unknown, id: number, player: PlayerId) => boolean;
  loadScriptFile: (name: string, forced?: boolean) => LuaScriptLoadResult;
}
