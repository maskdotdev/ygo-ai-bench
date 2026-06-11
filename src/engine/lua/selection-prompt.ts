import type { DuelSession, PlayerId } from "#duel/types.js";
import type { LuaPromptDecision } from "#lua/host-types.js";

export interface LuaSelectionPromptHostState {
  promptDecisions?: LuaPromptDecision[];
  nextPromptId?: number;
  promptBehavior?: "default" | "yield";
  lastConfirmedUidsByPlayer?: Partial<Record<PlayerId, string[]>>;
}

const maxUidChoiceCombinations = 160;
const maxDeckOrderPermutations = 120;

export function nextLuaPromptId(hostState: LuaSelectionPromptHostState): string {
  const id = hostState.nextPromptId ?? 1;
  hostState.nextPromptId = id + 1;
  return `lua-prompt-${id}`;
}

export function rememberConfirmedUids(hostState: LuaSelectionPromptHostState, player: PlayerId, uids: readonly string[]): void {
  if (uids.length === 0) return;
  hostState.lastConfirmedUidsByPlayer ??= {};
  hostState.lastConfirmedUidsByPlayer[player] = [...uids];
}

export function consumeConfirmedUids(hostState: LuaSelectionPromptHostState, player: PlayerId | undefined): string[] | undefined {
  if (player === undefined) return undefined;
  const uids = hostState.lastConfirmedUidsByPlayer?.[player];
  if (!uids?.length) return undefined;
  delete hostState.lastConfirmedUidsByPlayer?.[player];
  return [...uids];
}

export function revealedPromptFields(uids: readonly string[] | undefined): { revealedUids?: string[] } {
  return uids?.length ? { revealedUids: [...uids] } : {};
}

export function buildUidSelectionPrompt(
  session: DuelSession,
  hostState: LuaSelectionPromptHostState,
  api: "SelectCard",
  player: PlayerId,
  uids: readonly string[],
  min: number,
  max: number,
  revealedUids: readonly string[] = uids,
): LuaPromptDecision | undefined {
  const combinations = collectUidChoiceCombinations([...uids], min, max, maxUidChoiceCombinations);
  if (combinations.length === 0) return undefined;
  const options = combinations.map((_combination, index) => index + 1);
  const descriptions = combinations.map((combination) => firstCardCode(session, combination) ?? 0);
  return {
    id: nextLuaPromptId(hostState),
    api,
    player,
    options,
    descriptions,
    ...(combinations.some((combination) => combination.length !== 1) ? { descriptionLists: combinations.map((combination) => cardCodes(session, combination)) } : {}),
    returned: options[0] ?? 0,
    returnValues: combinations.map((combination) => [{ uids: combination }]),
    ...revealedPromptFields(revealedUids),
  };
}

export function buildDeckOrderPrompt(
  session: DuelSession,
  hostState: LuaSelectionPromptHostState,
  api: "SortDecktop" | "SortDeckbottom",
  player: PlayerId,
  deckPlayer: PlayerId,
  edge: "top" | "bottom",
  uids: readonly string[],
): LuaPromptDecision | undefined {
  if (uids.length <= 1) return undefined;
  const orders = collectUidPermutations([...uids], maxDeckOrderPermutations);
  if (orders.length === 0) return undefined;
  const options = orders.map((_order, index) => index + 1);
  return {
    id: nextLuaPromptId(hostState),
    api,
    player,
    options,
    descriptions: orders.map((order) => firstCardCode(session, order) ?? 0),
    descriptionLists: orders.map((order) => cardCodes(session, order)),
    returned: options[0] ?? 0,
    returnValues: orders.map((order) => [{ sortDeck: { player: deckPlayer, edge, uids: order } }]),
    revealedUids: [...uids],
  };
}

function collectUidChoiceCombinations(uids: string[], min: number, max: number, limit: number): string[][] {
  const boundedMin = Math.max(0, min);
  if (uids.length < boundedMin) return [];
  const boundedMax = Math.min(max > 0 ? Math.max(boundedMin, max) : uids.length, uids.length);
  const combinations: string[][] = [];
  for (let count = boundedMin; count <= boundedMax && combinations.length < limit; count += 1) {
    collectFixedUidCombinations(uids, count, combinations, limit);
  }
  return combinations;
}

function collectFixedUidCombinations(uids: string[], count: number, combinations: string[][], limit: number): void {
  const selected: string[] = [];
  const visit = (start: number): void => {
    if (combinations.length >= limit) return;
    if (selected.length === count) {
      combinations.push([...selected]);
      return;
    }
    for (let index = start; index <= uids.length - (count - selected.length); index += 1) {
      selected.push(uids[index]!);
      visit(index + 1);
      selected.pop();
    }
  };
  visit(0);
}

function collectUidPermutations(uids: string[], limit: number): string[][] {
  const permutations: string[][] = [];
  const selected: string[] = [];
  const used = new Set<string>();
  const visit = (): void => {
    if (permutations.length >= limit) return;
    if (selected.length === uids.length) {
      permutations.push([...selected]);
      return;
    }
    for (const uid of uids) {
      if (used.has(uid)) continue;
      used.add(uid);
      selected.push(uid);
      visit();
      selected.pop();
      used.delete(uid);
    }
  };
  visit();
  return permutations;
}

function cardCodes(session: DuelSession, uids: readonly string[]): number[] {
  return uids.map((uid) => firstCardCode(session, [uid]) ?? 0);
}

function firstCardCode(session: DuelSession, uids: readonly string[]): number | undefined {
  for (const uid of uids) {
    const code = Number(session.state.cards.find((card) => card.uid === uid)?.code);
    if (Number.isSafeInteger(code)) return code;
  }
  return undefined;
}
