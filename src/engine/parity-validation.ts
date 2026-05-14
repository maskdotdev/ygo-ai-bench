import { isDuelActionWindowKind } from "#duel/action-window-kinds.js";
import { isDuelLocation } from "#duel/location-kinds.js";
import { isBattleStep, isDuelPhase, isDuelStatus } from "#duel/state-kinds.js";
import type { BattleStep, DuelActionWindowKind, DuelLocation, DuelPhase, DuelStatus, DuelWinner, PlayerId } from "#duel/types.js";

export function isSafeWindowId(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
export function isSafeCount(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
export function isSafePlayerKey(value: string): boolean { return value === "0" || value === "1"; }
export function isSafePlayerId(value: PlayerId): boolean { return value === 0 || value === 1; }
export function isSafeBoolean(value: boolean): boolean { return typeof value === "boolean"; }
export function isSafeString(value: string): boolean { return typeof value === "string"; }
export function isSafeStatus(value: DuelStatus): boolean { return isDuelStatus(value); }
export function isSafeWinner(value: DuelWinner): boolean { return value === 0 || value === 1 || value === "draw"; }
export function isSafeWindowKind(value: DuelActionWindowKind): boolean { return isDuelActionWindowKind(value); }
export function isSafePhase(value: DuelPhase): boolean { return isDuelPhase(value); }
export function isSafeBattleStep(value: BattleStep): boolean { return isBattleStep(value); }
export function isSafeWindowToken(value: string): boolean { return value.length > 0; }
export function isSafeLocationKey(value: string): value is DuelLocation { return isDuelLocation(value); }
export function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
