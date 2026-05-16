import type { DuelPromptState, DuelResponse, DuelState, PlayerId } from "#duel/types.js";
import { resolveDuelPrompt } from "#duel/prompt-response.js";
import { copyLuaPromptResumeValues, isLuaOptionPromptDecision, isLuaYesNoPromptDecision, type LuaPromptCoroutineResult, type LuaPromptDecision, type LuaPromptResumePayload } from "#lua/host-types.js";

export function isYieldedLuaPromptCoroutineResult(result: LuaPromptCoroutineResult): result is Extract<LuaPromptCoroutineResult, { status: "yielded" }> {
  return result.status === "yielded";
}

export function luaPromptDecisionToDuelPrompt(decision: LuaPromptDecision, id = decision.id, returnTo?: PlayerId): DuelPromptState | undefined {
  if (decision.player === undefined) return undefined;
  if (isLuaOptionPromptDecision(decision)) {
    return {
      id,
      type: "selectOption",
      player: decision.player,
      options: [...decision.options],
      descriptions: [...decision.descriptions],
      ...(decision.descriptionLists === undefined ? {} : { descriptionLists: decision.descriptionLists.map((descriptions) => [...descriptions]) }),
      ...(returnTo === undefined ? {} : { returnTo }),
    };
  }
  if (isLuaYesNoPromptDecision(decision)) return {
    id,
    type: "selectYesNo",
    player: decision.player,
    ...(decision.description === undefined ? {} : { description: decision.description }),
    ...(returnTo === undefined ? {} : { returnTo }),
  };
  return undefined;
}

export function duelPromptResponseToLuaValue(
  prompt: DuelPromptState,
  response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>,
): number | boolean {
  if (prompt.id !== response.promptId || prompt.player !== response.player || prompt.type !== response.type) throw new Error("Prompt response does not match the pending Lua prompt");
  if (prompt.type === "selectOption") {
    if (response.type !== "selectOption" || !prompt.options.includes(response.option)) throw new Error(`Option ${response.type === "selectOption" ? response.option : ""} is not legal for the pending Lua prompt`);
    return response.option;
  }
  if (response.type !== "selectYesNo") throw new Error("Prompt response does not match the pending Lua prompt");
  return response.yes;
}

function duelPromptResponseToLuaResumeValue(
  luaPrompt: LuaPromptDecision,
  prompt: DuelPromptState,
  response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>,
): LuaPromptResumePayload {
  const value = duelPromptResponseToLuaValue(prompt, response);
  if (isLuaOptionPromptDecision(luaPrompt) && luaPrompt.returnValues !== undefined) {
    if (typeof value !== "number") throw new Error(`${luaPrompt.api} prompt with return values must resume with a numeric option`);
    const optionIndex = luaPrompt.options.indexOf(value);
    const returnValues = luaPrompt.returnValues[optionIndex];
    if (returnValues === undefined) throw new Error(`${luaPrompt.api} prompt response is missing return values`);
    return copyLuaPromptResumeValues(returnValues);
  }
  if (luaPrompt.api !== "SelectCardsFromCodes" || luaPrompt.returnKind !== "codeIndexTable") return value;
  if (typeof value !== "number") throw new Error("SelectCardsFromCodes index prompt must resume with a numeric option");
  const optionIndex = luaPrompt.options.indexOf(value);
  const code = luaPrompt.descriptions[optionIndex];
  if (code === undefined) throw new Error("SelectCardsFromCodes index prompt response is missing its code");
  return { code, index: value };
}

export function yieldedLuaPromptToDuelPrompt(
  yielded: Extract<LuaPromptCoroutineResult, { status: "yielded" }>,
  returnTo?: PlayerId,
): DuelPromptState | undefined {
  return luaPromptDecisionToDuelPrompt(yielded.prompt, undefined, returnTo);
}

export function applyYieldedLuaPromptToDuelState(
  state: DuelState,
  yielded: Extract<LuaPromptCoroutineResult, { status: "yielded" }>,
  returnTo?: PlayerId,
): DuelPromptState {
  const prompt = yieldedLuaPromptToDuelPrompt(yielded, returnTo);
  if (!prompt) throw new Error("Cannot expose Lua prompt coroutine without a prompt player");
  state.prompt = prompt;
  state.waitingFor = prompt.player;
  state.status = "awaiting";
  return prompt;
}

export function resumeLuaPromptCoroutineWithDuelResponse(
  yielded: Extract<LuaPromptCoroutineResult, { status: "yielded" }>,
  response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>,
  returnTo?: PlayerId,
): LuaPromptCoroutineResult {
  const prompt = yieldedLuaPromptToDuelPrompt(yielded, returnTo);
  if (!prompt) throw new Error("Cannot resume Lua prompt coroutine without a prompt player");
  return yielded.resume(duelPromptResponseToLuaResumeValue(yielded.prompt, prompt, response));
}

export function resolveDuelPromptAndResumeLuaCoroutine(
  state: DuelState,
  yielded: Extract<LuaPromptCoroutineResult, { status: "yielded" }>,
  response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>,
  returnTo?: PlayerId,
): LuaPromptCoroutineResult {
  const prompt = state.prompt;
  if (!prompt) throw new Error("Cannot resume Lua prompt coroutine without a pending duel prompt");
  const expectedPrompt = yieldedLuaPromptToDuelPrompt(yielded, prompt.returnTo);
  if (!expectedPrompt || !sameDuelPrompt(prompt, expectedPrompt)) throw new Error("Pending duel prompt does not match the yielded Lua prompt");
  const value = duelPromptResponseToLuaResumeValue(yielded.prompt, prompt, response);
  if (prompt.origin === "luaOperation") state.prompt = promptWithoutOrigin(prompt);
  resolveDuelPrompt(state, response);
  const result = yielded.resume(value);
  if (isYieldedLuaPromptCoroutineResult(result)) applyYieldedLuaPromptToDuelState(state, result, returnTo);
  return result;
}

function promptWithoutOrigin(prompt: DuelPromptState): DuelPromptState {
  const { origin: _origin, ...rest } = prompt;
  if (rest.type === "selectOption") return { ...rest, options: [...rest.options], ...(rest.descriptions === undefined ? {} : { descriptions: [...rest.descriptions] }), ...(rest.descriptionLists === undefined ? {} : { descriptionLists: rest.descriptionLists.map((descriptions) => [...descriptions]) }) };
  return { ...rest };
}

function sameDuelPrompt(left: DuelPromptState, right: DuelPromptState): boolean {
  if (left.id !== right.id || left.type !== right.type || left.player !== right.player || left.returnTo !== right.returnTo) return false;
  if (right.origin !== undefined && left.origin !== right.origin) return false;
  if (left.type === "selectOption") return right.type === "selectOption" && sameNumbers(left.options, right.options) && sameOptionalNumbers(left.descriptions, right.descriptions) && sameOptionalNumberLists(left.descriptionLists, right.descriptionLists);
  return right.type === "selectYesNo" && left.description === right.description;
}

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameOptionalNumbers(left: number[] | undefined, right: number[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return sameNumbers(left, right);
}

function sameOptionalNumberLists(left: number[][] | undefined, right: number[][] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((values, index) => sameNumbers(values, right[index] ?? []));
}
