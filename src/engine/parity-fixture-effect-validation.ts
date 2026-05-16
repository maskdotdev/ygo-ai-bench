import { isCardPosition, isDuelEffectEvent } from "#duel/card-kinds.js";
import { isDuelEventName } from "#duel/event-names.js";
import type { DuelEffectDefinition, ScriptedFixtureCardSelector, ScriptedFixtureDraw, ScriptedFixtureEffect, ScriptedFixtureEvent, ScriptedFixtureMove } from "#duel/types.js";
import type { ParityFailure } from "./parity.js";
import { isRecord, isSafeBoolean, isSafeCount, isSafeLocationKey, isSafePlayerId, isSafeString } from "./parity-validation.js";

const TRIGGER_TIMINGS = new Set<NonNullable<DuelEffectDefinition["triggerTiming"]>>(["if", "when"]);
const ACTIVATION_CHAINS = new Set<NonNullable<ScriptedFixtureEffect["activationChain"]>>(["open", "chain"]);
const EFFECT_KEYS = [
  "id", "player", "code", "location", "event", "effectCode", "luaTypeFlags", "value", "valueCardCode", "targetCardCode", "targetRange", "triggerEvent", "triggerCode", "triggerTiming",
  "eventCardCode", "optional", "range", "oncePerTurn", "property", "activationChain", "logMessage", "negateChainEffectOnResolve", "negateAttackOnResolve", "negateSummonOnResolve",
  "chainLimitOnTarget", "targetCardsOnActivation", "collectEventsOnResolve", "drawCardsOnResolve", "moveCardsOnResolve", "occurrence",
];
const CARD_SELECTOR_KEYS = ["player", "code", "location", "occurrence"];
const EVENT_KEYS = ["collectEvent", "eventCard", "eventCode", "eventIsLast", "eventPlayer", "eventValue", "eventReason", "eventReasonPlayer", "eventReasonCardUid", "eventReasonEffectId", "relatedEffectId", "eventChainDepth", "eventChainLinkId", "eventUids"];
const DRAW_KEYS = ["player", "count", "detail", "eventIsLast", "eventReason", "eventReasonPlayer", "eventReasonCardUid", "eventReasonEffectId"];
const MOVE_KEYS = ["player", "code", "from", "to", "controller", "position", "occurrence", "moveReason", "moveReasonPlayer", "collectEvent", ...EVENT_KEYS.slice(2)];
const CHAIN_LIMIT_KEYS = ["untilChainEnd", "allowPlayer"];

export function fixtureSetupList<T>(name: string, value: T[] | undefined, failures: ParityFailure[], fixture: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    failures.push({ fixture, message: `Expected ${name} has malformed value ${String(value)}` });
    return [];
  }
  return value;
}

export function malformedFixtureEffectListExpectations(effect: ScriptedFixtureEffect): string[] {
  const failures: string[] = [];
  assertEffect("effect", effect, failures);
  assertEffectList("targetCardsOnActivation", effect.targetCardsOnActivation, failures);
  assertEffectList("collectEventsOnResolve", effect.collectEventsOnResolve, failures);
  assertEffectList("drawCardsOnResolve", effect.drawCardsOnResolve, failures);
  assertEffectList("moveCardsOnResolve", effect.moveCardsOnResolve, failures);
  assertCardSelectorList("targetCardsOnActivation", effect.targetCardsOnActivation, failures);
  assertEventList("collectEventsOnResolve", effect.collectEventsOnResolve, failures);
  assertDrawList("drawCardsOnResolve", effect.drawCardsOnResolve, failures);
  assertMoveList("moveCardsOnResolve", effect.moveCardsOnResolve, failures);
  return failures;
}

export function malformedFixtureEventListExpectations(events: ScriptedFixtureEvent[]): string[] {
  const failures: string[] = [];
  assertEventList("setup.collectEvents", events, failures);
  return failures;
}

export function malformedFixtureMoveListExpectations(moves: ScriptedFixtureMove[]): string[] {
  const failures: string[] = [];
  assertMoveList("setup.moveCards", moves, failures);
  return failures;
}

function assertEffect(description: string, effect: Partial<ScriptedFixtureEffect>, failures: string[]): void {
  if (!isSafeString(effect.id as never)) failures.push(`${description}.id has malformed value ${String(effect.id)}`);
  if (!isSafePlayerId(effect.player as never)) failures.push(`${description}.player has malformed player ${String(effect.player)}`);
  if (!isSafeString(effect.code as never)) failures.push(`${description}.code has malformed value ${String(effect.code)}`);
  if (effect.location !== undefined && !isSafeLocationKey(effect.location)) failures.push(`${description}.location has malformed value ${String(effect.location)}`);
  if (!isDuelEffectEvent(effect.event)) failures.push(`${description}.event has malformed value ${String(effect.event)}`);
  if (effect.effectCode !== undefined && !Number.isSafeInteger(effect.effectCode)) failures.push(`${description}.effectCode has malformed value ${String(effect.effectCode)}`);
  if (effect.luaTypeFlags !== undefined && !Number.isSafeInteger(effect.luaTypeFlags)) failures.push(`${description}.luaTypeFlags has malformed value ${String(effect.luaTypeFlags)}`);
  if (effect.value !== undefined && !Number.isSafeInteger(effect.value)) failures.push(`${description}.value has malformed value ${String(effect.value)}`);
  if (effect.valueCardCode !== undefined && !isSafeString(effect.valueCardCode)) failures.push(`${description}.valueCardCode has malformed value ${String(effect.valueCardCode)}`);
  if (effect.targetCardCode !== undefined && !isSafeString(effect.targetCardCode)) failures.push(`${description}.targetCardCode has malformed value ${String(effect.targetCardCode)}`);
  assertNumberTuple(`${description}.targetRange`, effect.targetRange, failures);
  if (effect.triggerEvent !== undefined && !isDuelEventName(effect.triggerEvent)) failures.push(`${description}.triggerEvent has malformed value ${String(effect.triggerEvent)}`);
  if (effect.triggerCode !== undefined && !Number.isSafeInteger(effect.triggerCode)) failures.push(`${description}.triggerCode has malformed value ${String(effect.triggerCode)}`);
  if (effect.triggerEvent !== undefined && effect.triggerTiming === undefined) failures.push(`${description}.triggerTiming is required when triggerEvent is set`);
  if (effect.triggerTiming !== undefined && !TRIGGER_TIMINGS.has(effect.triggerTiming)) failures.push(`${description}.triggerTiming has malformed value ${String(effect.triggerTiming)}`);
  if (effect.eventCardCode !== undefined && !isSafeString(effect.eventCardCode)) failures.push(`${description}.eventCardCode has malformed value ${String(effect.eventCardCode)}`);
  if (effect.optional !== undefined && !isSafeBoolean(effect.optional)) failures.push(`${description}.optional has malformed value ${String(effect.optional)}`);
  assertLocationList(`${description}.range`, effect.range, failures);
  if (effect.oncePerTurn !== undefined && !isSafeBoolean(effect.oncePerTurn)) failures.push(`${description}.oncePerTurn has malformed value ${String(effect.oncePerTurn)}`);
  if (effect.property !== undefined && !Number.isSafeInteger(effect.property)) failures.push(`${description}.property has malformed value ${String(effect.property)}`);
  if (effect.activationChain !== undefined && !ACTIVATION_CHAINS.has(effect.activationChain)) failures.push(`${description}.activationChain has malformed value ${String(effect.activationChain)}`);
  if (effect.logMessage !== undefined && !isSafeString(effect.logMessage)) failures.push(`${description}.logMessage has malformed value ${String(effect.logMessage)}`);
  if (effect.negateChainEffectOnResolve !== undefined && !isSafeString(effect.negateChainEffectOnResolve)) failures.push(`${description}.negateChainEffectOnResolve has malformed value ${String(effect.negateChainEffectOnResolve)}`);
  if (effect.negateAttackOnResolve !== undefined && !isSafeBoolean(effect.negateAttackOnResolve)) failures.push(`${description}.negateAttackOnResolve has malformed value ${String(effect.negateAttackOnResolve)}`);
  if (effect.negateSummonOnResolve !== undefined) {
    if (!isRecord(effect.negateSummonOnResolve)) failures.push(`${description}.negateSummonOnResolve has malformed value ${String(effect.negateSummonOnResolve)}`);
    else assertCardSelector(`${description}.negateSummonOnResolve`, effect.negateSummonOnResolve as Partial<ScriptedFixtureCardSelector>, failures);
  }
  assertChainLimit(`${description}.chainLimitOnTarget`, effect.chainLimitOnTarget, failures);
  if (effect.occurrence !== undefined && !isSafeCount(effect.occurrence)) failures.push(`${description}.occurrence has malformed value ${String(effect.occurrence)}`);
  for (const key of Object.keys(effect)) if (!EFFECT_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
}

function assertEffectList(name: string, value: unknown, failures: string[]): void {
  if (value !== undefined && !Array.isArray(value)) failures.push(`${name} has malformed value ${String(value)}`);
}

function assertLocationList(description: string, value: unknown, failures: string[]): void {
  if (!Array.isArray(value)) {
    failures.push(`${description} has malformed value ${String(value)}`);
    return;
  }
  for (const [index, location] of value.entries()) {
    if (!isSafeLocationKey(location)) failures.push(`${description}[${index}] has malformed value ${String(location)}`);
  }
}

function assertNumberTuple(description: string, value: unknown, failures: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    failures.push(`${description} has malformed value ${String(value)}`);
    return;
  }
  for (const [index, entry] of value.entries()) {
    if (!Number.isSafeInteger(entry)) failures.push(`${description}[${index}] has malformed value ${String(entry)}`);
  }
}

function assertChainLimit(description: string, value: unknown, failures: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    failures.push(`${description} has malformed value ${String(value)}`);
    return;
  }
  const chainLimit = value as Partial<NonNullable<ScriptedFixtureEffect["chainLimitOnTarget"]>>;
  if (!isSafeBoolean(chainLimit.untilChainEnd as never)) failures.push(`${description}.untilChainEnd has malformed value ${String(chainLimit.untilChainEnd)}`);
  if (chainLimit.allowPlayer !== undefined && !isSafePlayerId(chainLimit.allowPlayer)) failures.push(`${description}.allowPlayer has malformed player ${String(chainLimit.allowPlayer)}`);
  for (const key of Object.keys(value)) if (!CHAIN_LIMIT_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
}

function assertCardSelectorList(name: string, value: unknown, failures: string[]): void {
  if (!Array.isArray(value)) return;
  for (const [index, selector] of value.entries()) {
    const description = `${name}[${index}]`;
    if (!isRecord(selector)) {
      failures.push(`${description} has malformed value ${String(selector)}`);
      continue;
    }
    assertCardSelector(description, selector as Partial<ScriptedFixtureCardSelector>, failures);
  }
}

function assertCardSelector(description: string, selector: Partial<ScriptedFixtureCardSelector>, failures: string[]): void {
  if (!isSafePlayerId(selector.player as never)) failures.push(`${description}.player has malformed player ${String(selector.player)}`);
  if (!isSafeString(selector.code as never)) failures.push(`${description}.code has malformed value ${String(selector.code)}`);
  if (selector.location !== undefined && !isSafeLocationKey(selector.location)) failures.push(`${description}.location has malformed value ${String(selector.location)}`);
  if (selector.occurrence !== undefined && !isSafeCount(selector.occurrence)) failures.push(`${description}.occurrence has malformed value ${String(selector.occurrence)}`);
  for (const key of Object.keys(selector)) if (!CARD_SELECTOR_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
}

function assertEventList(name: string, value: unknown, failures: string[]): void {
  if (!Array.isArray(value)) return;
  for (const [index, event] of value.entries()) {
    const description = `${name}[${index}]`;
    if (!isRecord(event)) {
      failures.push(`${description} has malformed value ${String(event)}`);
      continue;
    }
    const fixtureEvent = event as Partial<ScriptedFixtureEvent>;
    if (!isDuelEventName(fixtureEvent.collectEvent)) failures.push(`${description}.collectEvent has malformed value ${String(fixtureEvent.collectEvent)}`);
    if (fixtureEvent.eventCard !== undefined) {
      if (!isRecord(fixtureEvent.eventCard)) failures.push(`${description}.eventCard has malformed value ${String(fixtureEvent.eventCard)}`);
      else assertCardSelector(`${description}.eventCard`, fixtureEvent.eventCard as Partial<ScriptedFixtureCardSelector>, failures);
    }
    assertEventPayload(description, fixtureEvent, failures);
    for (const key of Object.keys(event)) if (!EVENT_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
  }
}

function assertDrawList(name: string, value: unknown, failures: string[]): void {
  if (!Array.isArray(value)) return;
  for (const [index, draw] of value.entries()) {
    const description = `${name}[${index}]`;
    if (!isRecord(draw)) {
      failures.push(`${description} has malformed value ${String(draw)}`);
      continue;
    }
    assertDraw(description, draw as Partial<ScriptedFixtureDraw>, failures);
  }
}

function assertDraw(description: string, draw: Partial<ScriptedFixtureDraw>, failures: string[]): void {
  if (!isSafePlayerId(draw.player as never)) failures.push(`${description}.player has malformed player ${String(draw.player)}`);
  if (!isSafeCount(draw.count as never) || draw.count === 0) failures.push(`${description}.count has malformed value ${String(draw.count)}`);
  if (draw.detail !== undefined && !isSafeString(draw.detail)) failures.push(`${description}.detail has malformed value ${String(draw.detail)}`);
  if (draw.eventIsLast !== undefined && !isSafeBoolean(draw.eventIsLast)) failures.push(`${description}.eventIsLast has malformed value ${String(draw.eventIsLast)}`);
  if (draw.eventReason !== undefined && !Number.isSafeInteger(draw.eventReason)) failures.push(`${description}.eventReason has malformed value ${String(draw.eventReason)}`);
  if (draw.eventReasonPlayer !== undefined && !isSafePlayerId(draw.eventReasonPlayer)) failures.push(`${description}.eventReasonPlayer has malformed player ${String(draw.eventReasonPlayer)}`);
  if (draw.eventReasonCardUid !== undefined && !isSafeString(draw.eventReasonCardUid)) failures.push(`${description}.eventReasonCardUid has malformed value ${String(draw.eventReasonCardUid)}`);
  if (draw.eventReasonEffectId !== undefined && !Number.isSafeInteger(draw.eventReasonEffectId)) failures.push(`${description}.eventReasonEffectId has malformed value ${String(draw.eventReasonEffectId)}`);
  for (const key of Object.keys(draw)) if (!DRAW_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
}

function assertMoveList(name: string, value: unknown, failures: string[]): void {
  if (!Array.isArray(value)) return;
  for (const [index, move] of value.entries()) {
    const description = `${name}[${index}]`;
    if (!isRecord(move)) {
      failures.push(`${description} has malformed value ${String(move)}`);
      continue;
    }
    assertMove(description, move as Partial<ScriptedFixtureMove>, failures);
  }
}

function assertMove(description: string, move: Partial<ScriptedFixtureMove>, failures: string[]): void {
  if (!isSafePlayerId(move.player as never)) failures.push(`${description}.player has malformed player ${String(move.player)}`);
  if (!isSafeString(move.code as never)) failures.push(`${description}.code has malformed value ${String(move.code)}`);
  if (move.from !== undefined && !isSafeLocationKey(move.from)) failures.push(`${description}.from has malformed value ${String(move.from)}`);
  if (!isSafeLocationKey(move.to as never)) failures.push(`${description}.to has malformed value ${String(move.to)}`);
  if (move.controller !== undefined && !isSafePlayerId(move.controller)) failures.push(`${description}.controller has malformed player ${String(move.controller)}`);
  if (move.position !== undefined && !isCardPosition(move.position)) failures.push(`${description}.position has malformed value ${String(move.position)}`);
  if (move.occurrence !== undefined && !isSafeCount(move.occurrence)) failures.push(`${description}.occurrence has malformed value ${String(move.occurrence)}`);
  if (move.moveReason !== undefined && !Number.isSafeInteger(move.moveReason)) failures.push(`${description}.moveReason has malformed value ${String(move.moveReason)}`);
  if (move.moveReasonPlayer !== undefined && !isSafePlayerId(move.moveReasonPlayer)) failures.push(`${description}.moveReasonPlayer has malformed player ${String(move.moveReasonPlayer)}`);
  if (move.collectEvent !== undefined && !isDuelEventName(move.collectEvent)) failures.push(`${description}.collectEvent has malformed value ${String(move.collectEvent)}`);
  assertEventPayload(description, move, failures);
  for (const key of Object.keys(move)) if (!MOVE_KEYS.includes(key)) failures.push(`${description} has malformed key ${key}`);
}

function assertEventPayload(description: string, event: Partial<ScriptedFixtureEvent | ScriptedFixtureMove>, failures: string[]): void {
  if (event.eventCode !== undefined && !Number.isSafeInteger(event.eventCode)) failures.push(`${description}.eventCode has malformed value ${String(event.eventCode)}`);
  if (event.eventIsLast !== undefined && !isSafeBoolean(event.eventIsLast)) failures.push(`${description}.eventIsLast has malformed value ${String(event.eventIsLast)}`);
  if (event.eventPlayer !== undefined && !isSafePlayerId(event.eventPlayer)) failures.push(`${description}.eventPlayer has malformed player ${String(event.eventPlayer)}`);
  if (event.eventValue !== undefined && !Number.isSafeInteger(event.eventValue)) failures.push(`${description}.eventValue has malformed value ${String(event.eventValue)}`);
  if (event.eventReason !== undefined && !Number.isSafeInteger(event.eventReason)) failures.push(`${description}.eventReason has malformed value ${String(event.eventReason)}`);
  if (event.eventReasonPlayer !== undefined && !isSafePlayerId(event.eventReasonPlayer)) failures.push(`${description}.eventReasonPlayer has malformed player ${String(event.eventReasonPlayer)}`);
  if (event.eventReasonCardUid !== undefined && !isSafeString(event.eventReasonCardUid)) failures.push(`${description}.eventReasonCardUid has malformed value ${String(event.eventReasonCardUid)}`);
  if (event.eventReasonEffectId !== undefined && !Number.isSafeInteger(event.eventReasonEffectId)) failures.push(`${description}.eventReasonEffectId has malformed value ${String(event.eventReasonEffectId)}`);
  if (event.relatedEffectId !== undefined && !Number.isSafeInteger(event.relatedEffectId)) failures.push(`${description}.relatedEffectId has malformed value ${String(event.relatedEffectId)}`);
  if (event.eventChainDepth !== undefined && !Number.isSafeInteger(event.eventChainDepth)) failures.push(`${description}.eventChainDepth has malformed value ${String(event.eventChainDepth)}`);
  if (event.eventChainLinkId !== undefined && !isSafeString(event.eventChainLinkId)) failures.push(`${description}.eventChainLinkId has malformed value ${String(event.eventChainLinkId)}`);
  if (event.eventUids !== undefined) {
    if (!Array.isArray(event.eventUids)) {
      failures.push(`${description}.eventUids has malformed value ${String(event.eventUids)}`);
    } else {
      for (const [index, uid] of event.eventUids.entries()) {
        if (!isSafeString(uid)) failures.push(`${description}.eventUids[${index}] has malformed value ${String(uid)}`);
      }
    }
  }
}
