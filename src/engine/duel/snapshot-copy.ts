import { copyLuaPromptResumeValues, isLuaOptionPromptDecision } from "#lua/host-types.js";
import type { DuelCardData, DuelCardInstance, DuelPromptState, DuelState, PublicChainLink } from "#duel/types.js";

export function copyChainLink(link: DuelState["chain"][number]): DuelState["chain"][number] {
  return {
    ...copyEventPayload(link),
    ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }),
    ...(link.operationInfos === undefined ? {} : { operationInfos: copyOperationInfos(link.operationInfos) }),
    ...(link.possibleOperationInfos === undefined ? {} : { possibleOperationInfos: copyOperationInfos(link.possibleOperationInfos) }),
  };
}

export function copyPublicChainLink(link: DuelState["chain"][number]): PublicChainLink {
  const { operationOverride: _operationOverride, ...publicLink } = link;
  return {
    ...copyEventPayload(publicLink),
    ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }),
    ...(link.operationInfos === undefined ? {} : { operationInfos: copyOperationInfos(link.operationInfos) }),
    ...(link.possibleOperationInfos === undefined ? {} : { possibleOperationInfos: copyOperationInfos(link.possibleOperationInfos) }),
  };
}

export function copyLuaOperationPromptDecision(prompt: NonNullable<DuelState["luaOperationPrompt"]>["prompt"]): NonNullable<DuelState["luaOperationPrompt"]>["prompt"] {
  if (isLuaOptionPromptDecision(prompt)) return { ...prompt, options: [...prompt.options], descriptions: [...prompt.descriptions], ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }), ...(prompt.returnValues === undefined ? {} : { returnValues: prompt.returnValues.map(copyLuaPromptResumeValues) }) };
  return { ...prompt };
}

export function copyPendingTrigger(trigger: DuelState["pendingTriggers"][number]): DuelState["pendingTriggers"][number] { return copyEventPayload(trigger); }
export function copyEventRecord(event: DuelState["eventHistory"][number]): DuelState["eventHistory"][number] { return copyEventPayload(event); }

export function copyCard(card: DuelCardInstance): DuelCardInstance {
  return {
    ...card,
    data: copyCardData(card.data),
    overlayUids: [...card.overlayUids],
    ...(card.counters ? { counters: { ...card.counters } } : {}),
    ...(card.counterBuckets ? { counterBuckets: copyCounterBuckets(card.counterBuckets) } : {}),
    ...(card.effectRelationIds ? { effectRelationIds: [...card.effectRelationIds] } : {}),
    ...(card.cardTargetUids ? { cardTargetUids: [...card.cardTargetUids] } : {}),
    ...(card.summonMaterialUids ? { summonMaterialUids: [...card.summonMaterialUids] } : {}),
    ...(card.previousCodes === undefined ? {} : { previousCodes: [...card.previousCodes] }),
    ...(card.previousSetcodes === undefined ? {} : { previousSetcodes: [...card.previousSetcodes] }),
    ...(card.assumedProperties ? { assumedProperties: { ...card.assumedProperties } } : {}),
    ...(card.uniqueOnField ? { uniqueOnField: { ...card.uniqueOnField } } : {}),
  };
}

export function copyPrompt(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") return { ...prompt, options: [...prompt.options], ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }), ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }) };
  return { ...prompt };
}

function copyOperationInfos(infos: NonNullable<DuelState["chain"][number]["operationInfos"]>): NonNullable<DuelState["chain"][number]["operationInfos"]> { return infos.map((info) => ({ category: typeof info.category === "number" && Number.isFinite(info.category) ? info.category : 0, targetUids: Array.isArray(info.targetUids) ? [...info.targetUids] : [], count: typeof info.count === "number" && Number.isFinite(info.count) ? info.count : 0, player: info.player === 1 ? 1 : 0, parameter: typeof info.parameter === "number" && Number.isFinite(info.parameter) ? info.parameter : 0 })); }

function copyEventPayload<T extends DuelState["chain"][number] | PublicChainLink | DuelState["pendingTriggers"][number] | DuelState["eventHistory"][number]>(payload: T): T {
  return {
    ...payload,
    ...(payload.eventUids === undefined ? {} : { eventUids: [...payload.eventUids] }),
    ...("effectLabels" in payload && payload.effectLabels !== undefined ? { effectLabels: [...payload.effectLabels] } : {}),
    ...("effectLabelObjectUids" in payload && payload.effectLabelObjectUids !== undefined ? { effectLabelObjectUids: [...payload.effectLabelObjectUids] } : {}),
    ...(payload.eventPreviousState === undefined ? {} : { eventPreviousState: { ...payload.eventPreviousState } }),
    ...(payload.eventCurrentState === undefined ? {} : { eventCurrentState: { ...payload.eventCurrentState } }),
  };
}

function copyCounterBuckets(counterBuckets: NonNullable<DuelCardInstance["counterBuckets"]>): NonNullable<DuelCardInstance["counterBuckets"]> { return Object.fromEntries(Object.entries(counterBuckets).map(([counterType, buckets]) => [counterType, { ...buckets }])); }

function copyCardData(data: DuelCardData): DuelCardData {
  return {
    ...data,
    ...(data.setcodes ? { setcodes: [...data.setcodes] } : {}),
    ...(data.fusionMaterials ? { fusionMaterials: [...data.fusionMaterials] } : {}),
    ...(data.fusionRequiredMaterialPredicates ? { fusionRequiredMaterialPredicates: data.fusionRequiredMaterialPredicates.map((predicate) => ({ ...predicate })) } : {}),
    ...(data.fusionRequiredMaterialSetcodes ? { fusionRequiredMaterialSetcodes: [...data.fusionRequiredMaterialSetcodes] } : {}),
    ...(data.materialSetcodes ? { materialSetcodes: [...data.materialSetcodes] } : {}),
    ...(data.synchroMaterials ? { synchroMaterials: { tuner: data.synchroMaterials.tuner, nonTuners: [...data.synchroMaterials.nonTuners] } } : {}),
    ...(data.xyzMaterials ? { xyzMaterials: [...data.xyzMaterials] } : {}),
    ...(data.linkMaterials ? { linkMaterials: [...data.linkMaterials] } : {}),
    ...(data.ritualMaterials ? { ritualMaterials: [...data.ritualMaterials] } : {}),
    ...(data.listedNames ? { listedNames: [...data.listedNames] } : {}),
    ...(data.fitMonster ? { fitMonster: [...data.fitMonster] } : {}),
  };
}
