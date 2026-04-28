import type { CardInstance, EventName, GameState, PlaytestAction, ZoneName } from "./types.js";

export type CardPredicate = (card: CardInstance, state: GameState) => boolean;
export type EffectCondition = (ctx: EffectContext) => boolean;
export type EffectOperation = (ctx: EffectContext) => void;

export interface EffectDefinition {
  id: string;
  label: string;
  event: EventName;
  range: ZoneName[];
  oncePerTurn?: boolean;
  condition: EffectCondition;
  operation: EffectOperation;
  priority: number;
}

export class ScriptCard {
  readonly effects: EffectDefinition[] = [];
  constructor(readonly cardId: string) {}

  effect(id: string): EffectBuilder {
    return new EffectBuilder(this, id);
  }
}

export class EffectBuilder {
  private effect: EffectDefinition;

  constructor(private readonly script: ScriptCard, id: string) {
    this.effect = {
      id,
      label: id,
      event: "manual",
      range: ["hand", "field"],
      condition: () => true,
      operation: () => undefined,
      priority: 0,
    };
  }

  label(label: string): this {
    this.effect.label = label;
    return this;
  }

  when(event: EventName): this {
    this.effect.event = event;
    return this;
  }

  range(...zones: ZoneName[]): this {
    this.effect.range = zones;
    return this;
  }

  oncePerTurn(value = true): this {
    this.effect.oncePerTurn = value;
    return this;
  }

  priority(value: number): this {
    this.effect.priority = value;
    return this;
  }

  can(condition: EffectCondition): this {
    this.effect.condition = condition;
    return this;
  }

  do(operation: EffectOperation): void {
    this.effect.operation = operation;
    this.script.effects.push(this.effect);
  }
}

export class EffectContext {
  constructor(
    readonly state: GameState,
    readonly source: CardInstance,
    readonly effect: EffectDefinition,
  ) {}

  get hand(): CardInstance[] { return this.state.zones.hand; }
  get deck(): CardInstance[] { return this.state.zones.deck; }
  get field(): CardInstance[] { return this.state.zones.field; }
  get graveyard(): CardInstance[] { return this.state.zones.graveyard; }
  get extraDeck(): CardInstance[] { return this.state.zones.extraDeck; }

  hasInDeck(predicate: CardPredicate): boolean {
    return this.deck.some((card) => predicate(card, this.state));
  }

  hasInHand(predicate: CardPredicate): boolean {
    return this.hand.some((card) => predicate(card, this.state));
  }

  hasOnField(predicate: CardPredicate): boolean {
    return this.field.some((card) => predicate(card, this.state));
  }

  findInHand(predicate: CardPredicate): CardInstance | undefined {
    return this.hand.find((card) => predicate(card, this.state));
  }

  searchDeck(predicate: CardPredicate, reason: string): CardInstance | undefined {
    const card = this.deck.find((candidate) => predicate(candidate, this.state));
    if (!card) return undefined;
    moveCard(this.state, card.uid, "deck", "hand");
    pushLog(this.state, "search", card.name, reason);
    return card;
  }

  sendFromDeck(predicate: CardPredicate, reason: string): CardInstance | undefined {
    const card = this.deck.find((candidate) => predicate(candidate, this.state));
    if (!card) return undefined;
    moveCard(this.state, card.uid, "deck", "graveyard");
    pushLog(this.state, "sendToGY", card.name, reason);
    return card;
  }

  sendFromHand(predicate: CardPredicate, reason: string): CardInstance | undefined {
    const card = this.hand.find((candidate) => predicate(candidate, this.state));
    if (!card) return undefined;
    moveCard(this.state, card.uid, "hand", "graveyard");
    pushLog(this.state, "sendToGY", card.name, reason);
    return card;
  }

  specialSummonFromHand(predicate: CardPredicate, reason: string): CardInstance | undefined {
    const card = this.hand.find((candidate) => predicate(candidate, this.state));
    if (!card) return undefined;
    moveCard(this.state, card.uid, "hand", "field");
    pushLog(this.state, "specialSummon", card.name, reason);
    return card;
  }

  specialSummonSelf(reason: string): void {
    const zone = findZone(this.state, this.source.uid);
    if (zone && zone !== "field") {
      moveCard(this.state, this.source.uid, zone, "field");
      pushLog(this.state, "specialSummon", this.source.name, reason);
    }
  }

  draw(count: number, reason: string): void {
    for (let index = 0; index < count; index += 1) {
      const card = this.state.zones.deck.shift();
      if (!card) return;
      this.state.zones.hand.push(card);
      pushLog(this.state, "draw", card.name, reason);
    }
  }

  excavate(count: number): CardInstance[] {
    return this.deck.slice(0, count);
  }

  addExcavated(predicate: CardPredicate, reason: string): CardInstance | undefined {
    const top = this.excavate(3);
    const card = top.find((candidate) => predicate(candidate, this.state));
    if (!card) return undefined;
    moveCard(this.state, card.uid, "deck", "hand");
    pushLog(this.state, "excavateAdd", card.name, reason);
    return card;
  }

  fusionSummon(extraPredicate: CardPredicate, materials: CardPredicate[], reason: string): CardInstance | undefined {
    const target = this.extraDeck.find((card) => extraPredicate(card, this.state));
    if (!target) return undefined;
    const selected: CardInstance[] = [];
    for (const predicate of materials) {
      const material = [...this.hand, ...this.field].find((card) => !selected.includes(card) && predicate(card, this.state));
      if (!material) return undefined;
      selected.push(material);
    }
    for (const material of selected) {
      const zone = findZone(this.state, material.uid);
      if (zone) moveCard(this.state, material.uid, zone, "graveyard");
    }
    moveCard(this.state, target.uid, "extraDeck", "field");
    pushLog(this.state, "fusionSummon", target.name, reason);
    return target;
  }

  returnHandCardToDeck(reason: string): CardInstance | undefined {
    const card = this.hand.find((candidate) => candidate.uid !== this.source.uid);
    if (!card) return undefined;
    moveCard(this.state, card.uid, "hand", "deck");
    pushLog(this.state, "returnToDeck", card.name, reason);
    return card;
  }
}

export function effectToAction(card: CardInstance, effect: EffectDefinition): PlaytestAction {
  return {
    type: "activateEffect",
    uid: card.uid,
    effectId: effect.id,
    label: `${card.name}: ${effect.label}`,
  };
}

export function pushLog(state: GameState, action: string, card: string | undefined, detail: string): void {
  state.log.push({ step: state.log.length + 1, action, detail, ...(card === undefined ? {} : { card }) });
}

export function findZone(state: GameState, uid: string): ZoneName | undefined {
  return (Object.keys(state.zones) as ZoneName[]).find((zone) => state.zones[zone].some((card) => card.uid === uid));
}

export function moveCard(state: GameState, uid: string, from: ZoneName, to: ZoneName): CardInstance {
  const index = state.zones[from].findIndex((card) => card.uid === uid);
  if (index < 0) throw new Error(`Card ${uid} is not in ${from}`);
  const [card] = state.zones[from].splice(index, 1);
  if (!card) throw new Error(`Card ${uid} is not in ${from}`);
  state.zones[to].push(card);
  return card;
}
