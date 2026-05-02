import type { DuelEffectContext, PlayerId } from "#duel/types.js";

export interface LuaCardApiEffectRecord {
  id: number;
  typeFlags?: number;
  sourceUid?: string;
  ownerPlayer?: PlayerId;
  code?: number;
  property?: number;
  value?: number;
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
  activeContext?: DuelEffectContext | undefined;
  pushEffectTable: (state: unknown, id: number) => void;
}
