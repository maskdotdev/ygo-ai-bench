import { copyDuelAction } from "#duel/action-copy.js";
import type { DuelAction, DuelActionWindowKind } from "#duel/types.js";

export interface DuelLegalActionGroup {
  key: string;
  label: string;
  windowId?: number;
  windowKind?: DuelActionWindowKind;
  actions: DuelAction[];
}

export function groupDuelLegalActions(actions: DuelAction[]): DuelLegalActionGroup[] {
  const groups = new Map<string, DuelLegalActionGroup>();
  for (const action of actions) {
    const windowKey = action.windowKind ?? "unknown";
    const actionKey = duelActionGroupKey(action);
    const key = `${action.windowId ?? "none"}:${windowKey}:${actionKey}`;
    const existing = groups.get(key);
    if (existing) existing.actions.push(copyDuelAction(action));
    else {
      groups.set(key, {
        key,
        label: duelActionGroupLabel(actionKey),
        ...(action.windowId === undefined ? {} : { windowId: action.windowId }),
        ...(action.windowKind === undefined ? {} : { windowKind: action.windowKind }),
        actions: [copyDuelAction(action)],
      });
    }
  }
  return [...groups.values()];
}

function duelActionGroupKey(action: DuelAction): string {
  if (action.type === "selectOption" || action.type === "selectYesNo") return `prompt:${action.promptId}`;
  if (action.type === "activateTrigger") return "trigger-activate";
  if (action.type === "declineTrigger") return "trigger-decline";
  if (action.type === "activateEffect" || action.type === "specialSummonProcedure") return "effect";
  if (action.type.endsWith("Summon") || action.type === "setMonster") return "summon";
  if (action.type === "declareAttack" || action.type === "replayAttack" || action.type === "cancelAttack") return "attack";
  if (action.type === "passAttack" || action.type === "passDamage" || action.type === "passChain") return "pass";
  if (action.type === "changePhase" || action.type === "endTurn") return "turn";
  if (action.type === "setSpellTrap") return "set";
  return "action";
}

function duelActionGroupLabel(key: string): string {
  if (key === "trigger-activate") return "Trigger Activations";
  if (key === "trigger-decline") return "Trigger Declines";
  if (key === "effect") return "Effects";
  if (key === "summon") return "Summons";
  if (key === "attack") return "Attacks";
  if (key === "pass") return "Pass";
  if (key.startsWith("prompt:")) return "Prompt";
  if (key === "turn") return "Turn";
  if (key === "set") return "Set";
  return "Actions";
}
