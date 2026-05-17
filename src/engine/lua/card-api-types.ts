import type { DuelEffectContext, PlayerId } from "#duel/types.js";
import type { LuaScriptLoadResult } from "#lua/host-types.js";

export interface LuaCardApiEffectRecord {
  id: number;
  typeFlags?: number;
  sourceUid?: string;
  ownerUid?: string;
  ownerPlayer?: PlayerId;
  code?: number;
  property?: number;
  copyId?: number;
  value?: number;
  valueDescriptor?: string;
  valueRef?: number;
  targetRef?: number;
  labelObjectId?: number;
  reset?: {
    flags: number;
    count?: number;
  };
}

export interface LuaCardApiState<EffectRecord extends LuaCardApiEffectRecord> {
  effects: Map<number, EffectRecord>;
  operatedUids?: string[];
  activeLuaEffectId?: number | undefined;
  activeContext?: DuelEffectContext | undefined;
  activeOperationTriggerStart?: number | undefined;
  activeOperationMoved?: boolean;
  pushEffectTable: (state: unknown, id: number) => void;
  loadScriptFile?: (name: string, forced?: boolean) => LuaScriptLoadResult;
  nextCopyId?: number;
}
