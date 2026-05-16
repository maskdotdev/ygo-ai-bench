import { copyDuelAction } from "#duel/action-copy.js";
import { pushDuelLog } from "#duel/card-state.js";
import type { DuelAction, DuelActionWindowKind, DuelPromptState, DuelResponse, DuelState, PlayerId } from "#duel/types.js";

export function getPromptResponseActions(prompt: DuelPromptState, player: PlayerId): DuelAction[] {
  if (prompt.player !== player) return [];
  if (prompt.type === "selectOption") {
    return prompt.options.map((option, index) => {
      const description = prompt.descriptions?.[index];
      const descriptionList = prompt.descriptionLists?.[index];
      const labelDescription = descriptionList === undefined ? description : descriptionList.join(", ");
      return { type: "selectOption", player, promptId: prompt.id, option, label: labelDescription === undefined ? `Select option ${option}` : `Select option ${option} (${labelDescription})` };
    });
  }
  return [
    { type: "selectYesNo", player, promptId: prompt.id, yes: true, label: "Yes" },
    { type: "selectYesNo", player, promptId: prompt.id, yes: false, label: "No" },
  ];
}

export function resolveDuelPrompt(state: DuelState, response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>): void {
  const prompt = state.prompt;
  if (!prompt || prompt.id !== response.promptId || prompt.player !== response.player || prompt.type !== response.type) throw new Error("Prompt response does not match the pending prompt");
  if (prompt.origin === "luaOperation") throw new Error("Cannot resolve a Lua operation prompt without its live operation continuation");
  if (prompt.type === "selectOption") {
    if (response.type !== "selectOption" || !prompt.options.includes(response.option)) throw new Error(`Option ${response.type === "selectOption" ? response.option : ""} is not legal`);
    pushDuelLog(state, "selectOption", response.player, undefined, `Selected option ${response.option}`);
  } else {
    if (response.type !== "selectYesNo") throw new Error("Prompt response does not match the pending prompt");
    pushDuelLog(state, "selectYesNo", response.player, undefined, response.yes ? "Selected yes" : "Selected no");
  }
  state.waitingFor = prompt.returnTo ?? state.turnPlayer;
  delete state.prompt;
}

export function stampDuelActions(actions: DuelAction[], windowId: number, windowKind: DuelActionWindowKind, windowToken: string): DuelAction[] {
  return actions.map((action) => ({ ...copyDuelAction(action), windowId, windowKind, windowToken }));
}
