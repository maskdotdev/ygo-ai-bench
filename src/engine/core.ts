import { EffectContext, effectToAction, findZone, moveCard, pushLog, type EffectDefinition } from "./effects.js";
import { shuffle } from "./rng.js";
import type { CardDefinition, CardInstance, GameState, PlaytestAction, PublicGameState, ZoneName } from "./types.js";

export type Registry = Map<string, CardDefinition>;
export type EffectRegistry = Map<string, EffectDefinition[]>;

export interface StartOptions {
  deck: string[];
  extraDeck?: string[];
  seed?: string | number;
  handSize?: number;
  cards: Registry;
  effects: EffectRegistry;
}

export interface EngineSession {
  state: GameState;
  cards: Registry;
  effects: EffectRegistry;
}

export function startSession(options: StartOptions): EngineSession {
  const seed = String(options.seed ?? Date.now());
  const main = instantiate(options.deck, options.cards, "main");
  const extra = instantiate(options.extraDeck ?? [], options.cards, "extra");
  const state: GameState = {
    id: `playtest-${seed}-${Date.now().toString(36)}`,
    seed,
    zones: {
      deck: shuffle(main, seed),
      hand: [],
      field: [],
      graveyard: [],
      banished: [],
      extraDeck: extra,
    },
    normalSummonUsed: false,
    activatedKeys: new Set(),
    log: [],
  };
  drawOpeningHand(state, options.handSize ?? 5);
  return { state, cards: options.cards, effects: options.effects };
}

export function getLegalActions(session: EngineSession): PlaytestAction[] {
  const actions: PlaytestAction[] = [];
  if (!session.state.normalSummonUsed) {
    for (const card of session.state.zones.hand.filter((candidate) => candidate.type === "monster")) {
      actions.push({ type: "normalSummon", uid: card.uid, label: `Normal Summon ${card.name}` });
    }
  }
  for (const zone of ["hand", "field", "graveyard"] satisfies ZoneName[]) {
    for (const card of session.state.zones[zone]) {
      for (const effect of session.effects.get(card.id) ?? []) {
        if (!effect.range.includes(zone)) continue;
        if (effect.oncePerTurn && session.state.activatedKeys.has(effectKey(card.id, effect.id))) continue;
        const ctx = new EffectContext(session.state, card, effect);
        if (effect.event === "manual" && effect.condition(ctx)) actions.push(effectToAction(card, effect));
      }
      if ((card.type === "spell" || card.type === "trap") && zone === "hand") {
        actions.push({ type: "setSpellTrap", uid: card.uid, label: `Set ${card.name}` });
      }
    }
  }
  actions.sort((a, b) => actionPriority(session, b) - actionPriority(session, a) || a.label.localeCompare(b.label));
  actions.push({ type: "end", label: "End playtest" });
  return actions;
}

export function applyAction(session: EngineSession, action: PlaytestAction): { ok: boolean; error?: string } {
  try {
    if (action.type === "end") return { ok: true };
    const zone = findZone(session.state, action.uid);
    if (!zone) return { ok: false, error: `Card ${action.uid} is not in any zone` };
    const card = session.state.zones[zone].find((candidate) => candidate.uid === action.uid);
    if (!card) return { ok: false, error: `Card ${action.uid} is not in ${zone}` };

    if (action.type === "normalSummon") return normalSummon(session, card, zone);
    if (action.type === "setSpellTrap") return setSpellTrap(session, card, zone);
    return activateEffect(session, card, action.effectId, zone);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown engine error" };
  }
}

export function publicState(session: EngineSession): PublicGameState {
  const state = session.state;
  return {
    sessionId: state.id,
    deckCount: state.zones.deck.length,
    hand: state.zones.hand.map(summarize),
    field: state.zones.field.map(summarize),
    graveyard: state.zones.graveyard.map(summarize),
    banished: state.zones.banished.map(summarize),
    extraDeck: state.zones.extraDeck.map(summarize),
    normalSummonUsed: state.normalSummonUsed,
    log: state.log.slice(),
  };
}

function instantiate(ids: string[], cards: Registry, prefix: string): CardInstance[] {
  return ids.map((id, index) => {
    const def = cards.get(String(id)) ?? { id: String(id), name: `Unsupported card ${id}`, type: "monster" as const, tags: ["unsupported"] };
    return {
      uid: `${prefix}-${id}-${index}`,
      id: def.id,
      name: def.name,
      type: def.type,
      tags: def.tags ?? [],
      ...(def.level === undefined ? {} : { level: def.level }),
      ...(def.archetype === undefined ? {} : { archetype: def.archetype }),
    };
  });
}

function drawOpeningHand(state: GameState, handSize: number): void {
  for (let index = 0; index < handSize; index += 1) {
    const card = state.zones.deck.shift();
    if (!card) return;
    state.zones.hand.push(card);
    pushLog(state, "draw", card.name, "Opening hand");
  }
}

function normalSummon(session: EngineSession, card: CardInstance, zone: ZoneName): { ok: boolean; error?: string } {
  if (session.state.normalSummonUsed) return { ok: false, error: "Normal Summon already used" };
  if (zone !== "hand") return { ok: false, error: `${card.name} is not in hand` };
  if (card.type !== "monster") return { ok: false, error: `${card.name} is not a monster` };
  moveCard(session.state, card.uid, "hand", "field");
  session.state.normalSummonUsed = true;
  pushLog(session.state, "normalSummon", card.name, "Normal Summoned from hand");
  triggerEvent(session, card, "normalSummoned");
  return { ok: true };
}

function setSpellTrap(session: EngineSession, card: CardInstance, zone: ZoneName): { ok: boolean; error?: string } {
  if (zone !== "hand") return { ok: false, error: `${card.name} is not in hand` };
  if (card.type !== "spell" && card.type !== "trap") return { ok: false, error: `${card.name} is not a spell/trap` };
  moveCard(session.state, card.uid, "hand", "field");
  pushLog(session.state, "set", card.name, "Set from hand");
  return { ok: true };
}

function activateEffect(session: EngineSession, card: CardInstance, effectId: string, zone: ZoneName): { ok: boolean; error?: string } {
  const effect = (session.effects.get(card.id) ?? []).find((candidate) => candidate.id === effectId);
  if (!effect) return { ok: false, error: `${card.name} does not have effect ${effectId}` };
  if (!effect.range.includes(zone)) return { ok: false, error: `${card.name} cannot activate ${effect.label} from ${zone}` };
  if (effect.oncePerTurn && session.state.activatedKeys.has(effectKey(card.id, effect.id))) return { ok: false, error: `${effect.label} already used this turn` };
  const ctx = new EffectContext(session.state, card, effect);
  if (!effect.condition(ctx)) return { ok: false, error: `${effect.label} is not currently legal` };
  if ((card.type === "spell" || card.type === "trap") && zone === "hand") moveCard(session.state, card.uid, "hand", "field");
  pushLog(session.state, "activate", card.name, effect.label);
  effect.operation(ctx);
  if (effect.oncePerTurn) session.state.activatedKeys.add(effectKey(card.id, effect.id));
  triggerEvent(session, card, "activated");
  return { ok: true };
}

function triggerEvent(session: EngineSession, card: CardInstance, event: "normalSummoned" | "activated"): void {
  for (const effect of session.effects.get(card.id) ?? []) {
    const zone = findZone(session.state, card.uid);
    if (!zone || !effect.range.includes(zone) || effect.event !== event) continue;
    if (effect.oncePerTurn && session.state.activatedKeys.has(effectKey(card.id, effect.id))) continue;
    const ctx = new EffectContext(session.state, card, effect);
    if (!effect.condition(ctx)) continue;
    pushLog(session.state, "trigger", card.name, effect.label);
    effect.operation(ctx);
    if (effect.oncePerTurn) session.state.activatedKeys.add(effectKey(card.id, effect.id));
  }
}

function effectKey(cardId: string, effectId: string): string {
  return `${cardId}:${effectId}`;
}

function actionPriority(session: EngineSession, action: PlaytestAction): number {
  if (action.type !== "activateEffect") return action.type === "normalSummon" ? 20 : 1;
  const card = allCards(session).find((candidate) => candidate.uid === action.uid);
  const effect = card ? (session.effects.get(card.id) ?? []).find((candidate) => candidate.id === action.effectId) : undefined;
  return effect?.priority ?? 10;
}

function allCards(session: EngineSession): CardInstance[] {
  return Object.values(session.state.zones).flat();
}

function summarize(card: CardInstance) {
  return { uid: card.uid, id: card.id, name: card.name, type: card.type, tags: card.tags };
}
