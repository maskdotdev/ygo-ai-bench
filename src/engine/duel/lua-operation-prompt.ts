import type { DuelResponse, DuelState } from "#duel/types.js";
import type { LuaPromptCoroutineResult } from "#lua/host-types.js";
import { copyLuaOperationPromptDecision } from "#duel/snapshot-copy.js";
import { isYieldedLuaPromptCoroutineResult, resolveDuelPromptAndResumeLuaCoroutine } from "#lua/prompt-state.js";

type YieldedLuaPrompt = Extract<LuaPromptCoroutineResult, { status: "yielded" }>;

interface PendingLuaOperationPrompt {
  yielded: YieldedLuaPrompt;
  onComplete: () => void;
}

const pendingOperations = new WeakMap<DuelState, PendingLuaOperationPrompt>();
const pendingOperationSymbol = Symbol("pendingLuaOperationPrompt");

export function setPendingLuaOperationPrompt(state: DuelState, yielded: YieldedLuaPrompt, onComplete: () => void): void {
  if (state.prompt) state.prompt = { ...state.prompt, origin: "luaOperation" };
  const pending = { yielded, onComplete };
  pendingOperations.set(state, pending);
  setPendingOperationSymbol(state, pending);
}

export function hasPendingLuaOperationPrompt(state: DuelState): boolean {
  return pendingOperations.has(state) || pendingOperationFromSymbol(state) !== undefined;
}

export function resolvePendingLuaOperationPrompt(state: DuelState, response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>): boolean {
  const pending = pendingOperations.get(state) ?? pendingOperationFromSymbol(state);
  if (!pending) return false;
  const returnTo = state.prompt?.returnTo;
  const chainLink = state.luaOperationPrompt?.chainLink;
  const result = resolveDuelPromptAndResumeLuaCoroutine(state, pending.yielded, response);
  if (isYieldedLuaPromptCoroutineResult(result)) {
    if (state.prompt) state.prompt = { ...state.prompt, origin: "luaOperation", ...(returnTo === undefined ? {} : { returnTo }) };
    if (chainLink !== undefined) state.luaOperationPrompt = { chainLink: { ...chainLink }, prompt: copyLuaOperationPromptDecision(result.prompt) };
    setPendingLuaOperationPrompt(state, result, pending.onComplete);
    return true;
  }
  pendingOperations.delete(state);
  clearPendingOperationSymbol(state);
  if (result.status === "error") throw new Error(result.error);
  pending.onComplete();
  return true;
}

function pendingOperationFromSymbol(state: DuelState): PendingLuaOperationPrompt | undefined {
  return (state as DuelState & { [pendingOperationSymbol]?: PendingLuaOperationPrompt })[pendingOperationSymbol];
}

function setPendingOperationSymbol(state: DuelState, pending: PendingLuaOperationPrompt): void {
  Object.defineProperty(state, pendingOperationSymbol, { configurable: true, enumerable: false, value: pending, writable: true });
}

function clearPendingOperationSymbol(state: DuelState): void {
  delete (state as DuelState & { [pendingOperationSymbol]?: PendingLuaOperationPrompt })[pendingOperationSymbol];
}
