export interface LuaCardApiEffectRecord {
  id: number;
  typeFlags?: number;
  sourceUid?: string;
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
  pushEffectTable: (state: unknown, id: number) => void;
}
