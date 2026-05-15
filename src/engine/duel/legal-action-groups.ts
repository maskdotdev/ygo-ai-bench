import { copyDuelAction } from "#duel/action-copy.js";
import type { DuelAction, DuelActionWindowKind, PendingTriggerBucketState, TriggerOrderPromptState } from "#duel/types.js";

export interface DuelLegalActionGroup {
  key: string;
  label: string;
  promptId?: string;
  promptType?: "selectOption" | "selectYesNo";
  windowId?: number;
  windowKind?: DuelActionWindowKind;
  windowToken?: string;
  triggerBucket?: PendingTriggerBucketState;
  triggerOrderPrompt?: TriggerOrderPromptState;
  actions: DuelAction[];
}

export function groupDuelLegalActions(actions: DuelAction[]): DuelLegalActionGroup[] {
  const groups = new Map<string, DuelLegalActionGroup>();
  for (const action of actions) {
    const windowKey = action.windowKind ?? "unknown";
    const actionKey = duelActionGroupKey(action);
    const key = `${action.windowId ?? "none"}:${windowKey}:${actionKey}${triggerBucketGroupKey(action)}`;
    const existing = groups.get(key);
    if (existing) {
      if ((action.type === "activateTrigger" || action.type === "declineTrigger") && existing.triggerBucket) {
        existing.triggerBucket.triggerIds.push(action.triggerId);
        if (existing.triggerOrderPrompt) existing.triggerOrderPrompt.triggerIds.push(action.triggerId);
        else {
          const prompt = triggerOrderPromptState(action, existing.triggerBucket);
          if (prompt) existing.triggerOrderPrompt = prompt;
        }
      }
      existing.actions.push(copyDuelAction(action));
    }
    else {
      groups.set(key, {
        key,
        label: duelActionGroupLabel(actionKey, action),
        ...promptGroupState(action),
        ...(action.windowId === undefined ? {} : { windowId: action.windowId }),
        ...(action.windowKind === undefined ? {} : { windowKind: action.windowKind }),
        ...(action.windowToken === undefined ? {} : { windowToken: action.windowToken }),
        ...triggerBucketGroupState(action),
        actions: [copyDuelAction(action)],
      });
    }
  }
  return [...groups.values()];
}

function triggerBucketGroupKey(action: DuelAction): string {
  if (action.type !== "activateTrigger" && action.type !== "declineTrigger") return "";
  return `:${action.triggerBucket}:${action.player}`;
}

function triggerBucketGroupState(action: DuelAction): { triggerBucket: PendingTriggerBucketState } | Record<string, never> {
  if (action.type !== "activateTrigger" && action.type !== "declineTrigger") return {};
  return {
    triggerBucket: {
      triggerBucket: action.triggerBucket,
      player: action.player,
      triggerIds: [action.triggerId],
    },
  };
}

function promptGroupState(action: DuelAction): { promptId: string; promptType: "selectOption" | "selectYesNo" } | Record<string, never> {
  if (action.type !== "selectOption" && action.type !== "selectYesNo") return {};
  return { promptId: action.promptId, promptType: action.type };
}

function triggerOrderPromptState(action: DuelAction, bucket: PendingTriggerBucketState): TriggerOrderPromptState | undefined {
  if ((action.type !== "activateTrigger" && action.type !== "declineTrigger") || action.windowId === undefined || bucket.triggerIds.length < 2) return undefined;
  return {
    id: `${action.windowId}:${bucket.triggerBucket}:${bucket.player}`,
    type: "orderTriggers",
    player: bucket.player,
    triggerBucket: bucket.triggerBucket,
    triggerIds: [...bucket.triggerIds],
  };
}

function duelActionGroupKey(action: DuelAction): string {
  if (action.type === "selectOption" || action.type === "selectYesNo") return `prompt:${action.promptId}`;
  if (action.type === "activateTrigger") return "trigger-activate";
  if (action.type === "declineTrigger") return "trigger-decline";
  if (action.type === "activateEffect" || action.type === "specialSummonProcedure") return "effect";
  if (action.type.endsWith("Summon") || action.type === "setMonster" || action.type === "tributeSet") return "summon";
  if (action.type === "declareAttack" || action.type === "replayAttack" || action.type === "cancelAttack") return "attack";
  if (action.type === "passAttack" || action.type === "passDamage" || action.type === "passChain") return "pass";
  if (action.type === "changePhase" || action.type === "endTurn") return "turn";
  if (action.type === "setSpellTrap") return "set";
  return "action";
}

function duelActionGroupLabel(key: string, action: DuelAction): string {
  if (key === "trigger-activate") return "Trigger Activations";
  if (key === "trigger-decline") return "Trigger Declines";
  if (key === "effect") return "Effects";
  if (key === "summon") return "Summons";
  if (key === "attack") return "Attacks";
  if (key === "pass") return "Pass";
  if (key.startsWith("prompt:")) return action.type === "selectYesNo" ? "Yes / No Prompt" : "Option Prompt";
  if (key === "turn") return "Turn";
  if (key === "set") return "Set";
  return "Actions";
}
