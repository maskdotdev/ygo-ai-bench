import type { ChainLimit, DuelEffectContext, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaDuelOperationInfo } from "#lua/duel-api/operation.js";

export interface LuaScriptLoadResult {
  ok: boolean;
  error?: string;
  name: string;
}

export type LuaPromptCoroutineResult =
  | { status: "completed"; values: unknown[] }
  | { status: "yielded"; prompt: LuaPromptDecision; resume: (value: LuaPromptResumePayload) => LuaPromptCoroutineResult }
  | { status: "error"; error: string };

export type LuaPromptResumeValue = number | boolean | { code: number; index: number };
export type LuaPromptResumePayload = LuaPromptResumeValue | LuaPromptResumeValue[];

export function copyLuaPromptResumeValue(value: LuaPromptResumeValue): LuaPromptResumeValue {
  if (typeof value === "object" && value !== null) return { ...value };
  return value;
}

export function copyLuaPromptResumeValues(values: readonly LuaPromptResumeValue[]): LuaPromptResumeValue[] {
  return values.map(copyLuaPromptResumeValue);
}

export interface LuaScriptHost {
  readonly messages: string[];
  readonly promptDecisions: LuaPromptDecision[];
  loadScript(code: string, name: string): LuaScriptLoadResult;
  loadCardScript(cardCode: string | number, source: LuaScriptSource): LuaScriptLoadResult;
  registerInitialEffects(): number;
  registerInitialEffectsDetailed(): LuaInitialEffectRegistrationResult[];
  restoreEffectMetadata(registryKey: string, metadata: { label?: number; labelObjectId?: number }): boolean;
  runStartupEffects(): number;
  restoreChainLimit(key: string, limit: ChainLimit): ChainLimit | undefined;
  getGlobalString(name: string): string | undefined;
  getGlobalNumber(name: string): number | undefined;
  runPromptCoroutine(code: string, name: string): LuaPromptCoroutineResult;
  runPromptCallback(name: string, args?: Array<number | boolean | string>): LuaPromptCoroutineResult;
  runPromptEffectOperation(effectId: string, sourceUid: string, player: PlayerId): LuaPromptCoroutineResult;
}

export type LuaPromptDecision =
  | { id: string; api: "SelectOption" | "SelectEffect" | "AnnounceNumber" | "AnnounceNumberRange" | "AnnounceCard" | "AnnounceType" | "AnnounceLevel" | "AnnounceRace" | "AnnounceAttribute" | "SelectCardsFromCodes" | "SelectDisableField" | "SelectField" | "SelectFieldZone"; player?: PlayerId; options: number[]; descriptions: number[]; descriptionLists?: number[][]; returned: number; returnKind?: "codeIndexTable"; returnValues?: LuaPromptResumeValue[][] }
  | { id: string; api: "SelectYesNo" | "SelectEffectYesNo"; player?: PlayerId; description?: number; returned: boolean };

export type LuaPromptOverride =
  | { api?: "SelectOption" | "SelectEffect"; player?: PlayerId; returned: number }
  | { api?: Extract<LuaPromptDecision, { returned: boolean }>["api"]; player?: PlayerId; returned: boolean };

export interface LuaScriptHostOptions {
  promptOverrides?: LuaPromptOverride[];
  reuseExistingLuaEffectIds?: boolean;
}

export const luaOptionPromptApis: ReadonlyArray<Extract<LuaPromptDecision, { options: number[] }>["api"]> = [
  "SelectOption",
  "SelectEffect",
  "AnnounceNumber",
  "AnnounceNumberRange",
  "AnnounceCard",
  "AnnounceType",
  "AnnounceLevel",
  "AnnounceRace",
  "AnnounceAttribute",
  "SelectCardsFromCodes",
  "SelectDisableField",
  "SelectField",
  "SelectFieldZone",
];

export const luaYesNoPromptApis: ReadonlyArray<Extract<LuaPromptDecision, { returned: boolean }>["api"]> = [
  "SelectYesNo",
  "SelectEffectYesNo",
];

export const luaPromptApis: ReadonlyArray<LuaPromptDecision["api"]> = [...luaOptionPromptApis, ...luaYesNoPromptApis];

export function isLuaOptionPromptApi(api: unknown): api is Extract<LuaPromptDecision, { options: number[] }>["api"] {
  return luaOptionPromptApis.includes(api as Extract<LuaPromptDecision, { options: number[] }>["api"]);
}

export function isLuaOptionPromptDecision(prompt: LuaPromptDecision): prompt is Extract<LuaPromptDecision, { options: number[] }> {
  return isLuaOptionPromptApi(prompt.api);
}

export function isLuaYesNoPromptApi(api: unknown): api is Extract<LuaPromptDecision, { returned: boolean }>["api"] {
  return luaYesNoPromptApis.includes(api as Extract<LuaPromptDecision, { returned: boolean }>["api"]);
}

export function isLuaYesNoPromptDecision(prompt: LuaPromptDecision): prompt is Extract<LuaPromptDecision, { returned: boolean }> {
  return isLuaYesNoPromptApi(prompt.api);
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
  ownerUid?: string;
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
  labels?: number[];
  labelObjectUid?: string;
  labelObjectUids?: string[];
  labelObjectId?: number;
  labelObjectRef?: number;
  value?: number;
  valueDescriptor?: string;
  costDescriptor?: string;
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
  promptDecisions: LuaPromptDecision[];
  promptOverrides: LuaPromptOverride[];
  nextPromptId: number;
  promptBehavior: "default" | "yield";
  activeTargetUids: string[] | undefined;
  activeLuaEffectId: number | undefined;
  activeContext: DuelEffectContext | undefined;
  activeOperationTriggerStart: number | undefined;
  activeOperationMoved: boolean;
  pendingSetLpDefeat: boolean;
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
